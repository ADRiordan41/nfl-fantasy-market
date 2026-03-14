import argparse
import json
import random
import string
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from typing import Any


USER_AGENTS = [
    "MatchupMarketBot/1.0 (+synthetic beta user)",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MatchupMarketSynthetic/1.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 MatchupMarketSynthetic/1.0",
]

PERSONA_ACTION_WEIGHTS = {
    "lurker": {
        "browse_market": 34,
        "read_forum": 22,
        "view_portfolio": 12,
        "trade": 12,
        "feedback": 8,
        "message": 6,
        "auth_ping": 6,
    },
    "casual": {
        "browse_market": 24,
        "read_forum": 14,
        "view_portfolio": 15,
        "trade": 28,
        "feedback": 6,
        "message": 7,
        "auth_ping": 6,
    },
    "aggressive": {
        "browse_market": 20,
        "read_forum": 8,
        "view_portfolio": 18,
        "trade": 38,
        "feedback": 4,
        "message": 6,
        "auth_ping": 6,
    },
    "community": {
        "browse_market": 16,
        "read_forum": 28,
        "view_portfolio": 8,
        "trade": 14,
        "feedback": 12,
        "message": 14,
        "auth_ping": 8,
    },
    "market_maker_balanced": {
        "browse_market": 24,
        "read_forum": 4,
        "view_portfolio": 20,
        "trade": 40,
        "feedback": 2,
        "message": 4,
        "auth_ping": 6,
    },
    "market_maker_long": {
        "browse_market": 22,
        "read_forum": 4,
        "view_portfolio": 20,
        "trade": 42,
        "feedback": 2,
        "message": 4,
        "auth_ping": 6,
    },
}

PERSONA_POOL = [
    "lurker",
    "lurker",
    "casual",
    "casual",
    "aggressive",
    "community",
    "market_maker_balanced",
    "market_maker_long",
]

POST_TITLES = [
    "Who looks mispriced right now?",
    "Best early beta trading lesson so far",
    "Does live scoring move prices too fast?",
    "Favorite long shot on the board",
    "How are you handling short exposure?",
    "Which market screen do you check first?",
]

POST_BODIES = [
    "I have been rotating between a few players and wanted to compare notes on where pricing feels ahead of the fundamentals.",
    "Curious how everyone is thinking about balancing projection-based value versus momentum while the market is moving intraday.",
    "The beta is making it easy to spot how different users approach risk. What signals are you trusting most right now?",
    "Trying to figure out whether current prices are mostly reacting to stat updates or to user flow. Interested in other takes.",
]

COMMENT_BODIES = [
    "I like that angle. The spread still matters a lot more than I expected.",
    "Same here. I usually wait for a second look before adding size.",
    "Interesting read. I think the market is reacting faster than the raw season totals.",
    "This is exactly the kind of thread that helps me calibrate.",
    "I ended up taking the opposite side, but I can see the case.",
]

FEEDBACK_MESSAGES = [
    "Synthetic beta user feedback: the overall flow is smooth, but I wanted to flag that I am checking how the market behaves during repeated browsing.",
    "Synthetic beta user feedback: testing navigation and trade loops. Nothing broken here, but I wanted to make sure the feedback pipeline is exercised.",
    "Synthetic beta user feedback: community and portfolio flow feels solid. Logging this so support/admin views have realistic beta traffic.",
]

DM_MESSAGES = [
    "Trying a synthetic DM flow to make sure inbox notifications and thread updates behave normally.",
    "Checking whether direct threads stay readable after a few rounds of market activity.",
    "Curious what kind of players you have been watching in the beta so far.",
]

PAGE_PATHS = [
    "/",
    "/market",
    "/portfolio",
    "/community",
    "/live",
    "/player/1",
]

MARKET_MAKER_PERSONAS = {"market_maker_balanced", "market_maker_long"}


class ApiError(Exception):
    def __init__(self, status_code: int, detail: str, headers: dict[str, str] | None = None):
        super().__init__(f"{status_code}: {detail}")
        self.status_code = int(status_code)
        self.detail = detail
        self.headers = headers or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create synthetic users that behave like beta users against the live MatchupMarket API."
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--bot-count", type=int, default=6)
    parser.add_argument("--duration-seconds", type=int, default=90)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--username-prefix", default="betabot")
    parser.add_argument("--email-domain", default="example.test")
    parser.add_argument("--default-password", default="BetaBotPass123")
    parser.add_argument(
        "--bot-config-file",
        default="",
        help="Path to a JSON file containing explicit bot definitions with name, username, and persona.",
    )
    parser.add_argument(
        "--persona-plan",
        default="",
        help="Comma-separated persona counts, e.g. lurker=2,casual=2,market_maker_balanced=1",
    )
    parser.add_argument("--min-delay-ms", type=int, default=800)
    parser.add_argument("--max-delay-ms", type=int, default=2400)
    parser.add_argument("--startup-stagger-ms", type=int, default=250)
    parser.add_argument("--summary-file", default="")
    parser.add_argument(
        "--use-admin-bots",
        action="store_true",
        help="Load active bot profiles from /admin/bots instead of using the local default persona pool.",
    )
    parser.add_argument(
        "--admin-token",
        default="",
        help="Bearer token for admin endpoints when using --use-admin-bots.",
    )
    parser.add_argument(
        "--reuse-existing",
        action="store_true",
        help="If a bot username already exists, try logging in with the provided default password.",
    )
    parser.add_argument(
        "--spoof-forwarded-for",
        action="store_true",
        help="Send unique X-Forwarded-For values per bot to avoid local single-IP auth throttles during testing.",
    )
    return parser.parse_args()


def random_suffix(rng: random.Random, length: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(rng.choice(alphabet) for _ in range(length))


def choose_weighted(rng: random.Random, weights: dict[str, int]) -> str:
    keys = list(weights.keys())
    values = list(weights.values())
    return rng.choices(keys, weights=values, k=1)[0]


def clamp_delay(min_delay_ms: int, max_delay_ms: int) -> tuple[float, float]:
    low = max(0, min(min_delay_ms, max_delay_ms)) / 1000.0
    high = max(0, max(min_delay_ms, max_delay_ms)) / 1000.0
    return low, high


def now_ms() -> int:
    return int(time.time() * 1000)


def decode_error_body(exc: urllib.error.HTTPError) -> str:
    try:
        payload = exc.read().decode("utf-8")
    except Exception:
        return exc.reason if isinstance(exc.reason, str) else f"HTTP {exc.code}"

    try:
        body = json.loads(payload)
    except Exception:
        return payload.strip() or f"HTTP {exc.code}"

    if isinstance(body, dict):
        detail = body.get("detail")
        if isinstance(detail, str):
            return detail
        if detail is not None:
            return json.dumps(detail)
    return payload.strip() or f"HTTP {exc.code}"


@dataclass
class BotState:
    index: int
    name: str
    username: str
    email: str
    password: str
    persona: str
    forwarded_for: str | None
    user_agent: str
    token: str | None = None
    user_id: int | None = None
    last_player_id: int | None = None
    action_counts: Counter[str] = field(default_factory=Counter)
    error_counts: Counter[str] = field(default_factory=Counter)


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def request_json(
        self,
        path: str,
        *,
        method: str = "GET",
        token: str | None = None,
        payload: Any | None = None,
        extra_headers: dict[str, str] | None = None,
        timeout_seconds: float = 15.0,
    ) -> Any:
        headers = {
            "Accept": "application/json",
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if extra_headers:
            headers.update(extra_headers)

        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")

        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method=method.upper(),
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                raw = response.read().decode("utf-8")
                if not raw.strip():
                    return None
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            raise ApiError(exc.code, decode_error_body(exc), dict(exc.headers.items())) from exc
        except urllib.error.URLError as exc:
            raise ApiError(0, str(exc.reason)) from exc


class SyntheticUserSimulator:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.client = ApiClient(args.base_url)
        self.seed_rng = random.Random(args.seed)
        self.run_id = random_suffix(self.seed_rng, 5)
        self.delay_min_seconds, self.delay_max_seconds = clamp_delay(args.min_delay_ms, args.max_delay_ms)
        self.summary_lock = threading.Lock()
        self.summary_counts: Counter[str] = Counter()
        self.error_counts: Counter[str] = Counter()
        self.bots: list[BotState] = []

    def run(self) -> dict[str, Any]:
        self.bots = self._provision_bots()
        players = self._safe_public_players_sample()

        deadline = time.perf_counter() + max(1, self.args.duration_seconds)
        threads: list[threading.Thread] = []
        started_at = time.perf_counter()

        for bot in self.bots:
            thread = threading.Thread(target=self._run_bot_loop, args=(bot, players, deadline), daemon=True)
            threads.append(thread)
            thread.start()
            if self.args.startup_stagger_ms > 0:
                time.sleep(self.args.startup_stagger_ms / 1000.0)

        for thread in threads:
            thread.join()

        elapsed_seconds = max(0.001, time.perf_counter() - started_at)
        summary = {
            "base_url": self.args.base_url,
            "seed": self.args.seed,
            "run_id": self.run_id,
            "bot_count": len(self.bots),
            "duration_seconds": self.args.duration_seconds,
            "elapsed_seconds": round(elapsed_seconds, 2),
            "actions_total": int(sum(self.summary_counts.values())),
            "actions_per_second": round(sum(self.summary_counts.values()) / elapsed_seconds, 2),
            "action_counts": dict(self.summary_counts),
            "error_counts": dict(self.error_counts),
            "bots": [
                {
                    "username": bot.username,
                    "name": bot.name,
                    "persona": bot.persona,
                    "user_id": bot.user_id,
                    "action_counts": dict(bot.action_counts),
                    "error_counts": dict(bot.error_counts),
                }
                for bot in self.bots
            ],
        }
        if self.args.summary_file:
            with open(self.args.summary_file, "w", encoding="utf-8") as handle:
                json.dump(summary, handle, indent=2)
        return summary

    def _provision_bots(self) -> list[BotState]:
        configured_bots = self._configured_bot_definitions()
        bots: list[BotState] = []
        for index, config in enumerate(configured_bots):
            persona = str(config["persona"])
            username = str(config["username"])
            name = str(config["name"])
            password = self.args.default_password
            email = f"{username}@{self.args.email_domain}"
            forwarded_for = f"10.24.0.{index + 10}" if self.args.spoof_forwarded_for else None
            user_agent = USER_AGENTS[index % len(USER_AGENTS)]
            bot = BotState(
                index=index,
                name=name,
                username=username,
                email=email,
                password=password,
                persona=persona,
                forwarded_for=forwarded_for,
                user_agent=user_agent,
            )
            self._register_or_login(bot)
            bots.append(bot)
        return bots

    def _configured_bot_definitions(self) -> list[dict[str, str]]:
        if self.args.bot_config_file.strip():
            return self._load_bot_config_file()
        if self.args.use_admin_bots:
            return self._load_admin_bot_definitions()
        if self.args.persona_plan.strip():
            return self._build_persona_plan_definitions()
        return self._build_default_bot_definitions()

    def _build_default_bot_definitions(self) -> list[dict[str, str]]:
        definitions: list[dict[str, str]] = []
        for index in range(self.args.bot_count):
            persona = PERSONA_POOL[index % len(PERSONA_POOL)]
            username = f"{self.args.username_prefix}_{self.run_id}_{index + 1:02d}"
            definitions.append(
                {
                    "name": f"{persona.replace('_', ' ').title()} {index + 1}",
                    "username": username,
                    "persona": persona,
                }
            )
        return definitions

    def _build_persona_plan_definitions(self) -> list[dict[str, str]]:
        definitions: list[dict[str, str]] = []
        index = 0
        seen_names: Counter[str] = Counter()
        chunks = [chunk.strip() for chunk in self.args.persona_plan.split(",") if chunk.strip()]
        if not chunks:
            raise SystemExit("Persona plan was provided but no entries were parsed.")

        for chunk in chunks:
            if "=" not in chunk:
                raise SystemExit(f"Invalid persona plan entry '{chunk}'. Use persona=count.")
            persona, count_text = [part.strip().lower() for part in chunk.split("=", 1)]
            if persona not in PERSONA_ACTION_WEIGHTS:
                raise SystemExit(f"Unknown persona '{persona}' in persona plan.")
            try:
                count = int(count_text)
            except ValueError as exc:
                raise SystemExit(f"Invalid count '{count_text}' for persona '{persona}'.") from exc
            if count <= 0:
                continue
            for _ in range(count):
                index += 1
                seen_names[persona] += 1
                username = f"{self.args.username_prefix}_{self.run_id}_{index:02d}"
                definitions.append(
                    {
                        "name": f"{persona.replace('_', ' ').title()} {seen_names[persona]}",
                        "username": username,
                        "persona": persona,
                    }
                )

        if not definitions:
            raise SystemExit("Persona plan did not produce any bots.")
        return definitions

    def _load_admin_bot_definitions(self) -> list[dict[str, str]]:
        admin_token = self.args.admin_token.strip()
        if not admin_token:
            raise SystemExit("--admin-token is required when using --use-admin-bots.")
        response = self.client.request_json(
            "/admin/bots?active_only=true",
            token=admin_token,
        )
        if not isinstance(response, list):
            raise SystemExit("Admin bot response was not a list.")

        definitions = []
        for row in response:
            if not isinstance(row, dict):
                continue
            persona = str(row.get("persona", "")).strip().lower()
            username = str(row.get("username", "")).strip().lower()
            name = str(row.get("name", "")).strip()
            if persona not in PERSONA_ACTION_WEIGHTS or not username or not name:
                continue
            definitions.append({"name": name, "username": username, "persona": persona})

        if not definitions:
            raise SystemExit("No active admin bots were returned from /admin/bots.")
        return definitions

    def _load_bot_config_file(self) -> list[dict[str, str]]:
        config_path = self.args.bot_config_file.strip()
        try:
            with open(config_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except OSError as exc:
            raise SystemExit(f"Unable to read bot config file '{config_path}': {exc}") from exc
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Bot config file '{config_path}' is not valid JSON: {exc}") from exc

        if not isinstance(payload, list):
            raise SystemExit("Bot config file must contain a JSON array.")

        definitions: list[dict[str, str]] = []
        for index, row in enumerate(payload, start=1):
            if not isinstance(row, dict):
                raise SystemExit(f"Bot config row {index} is not an object.")
            persona = str(row.get("persona", "")).strip().lower()
            username = str(row.get("username", "")).strip().lower()
            name = str(row.get("name", "")).strip()
            if persona not in PERSONA_ACTION_WEIGHTS:
                raise SystemExit(f"Bot config row {index} uses unknown persona '{persona}'.")
            if not username or not name:
                raise SystemExit(f"Bot config row {index} must include non-empty name and username.")
            definitions.append({"name": name, "username": username, "persona": persona})

        if not definitions:
            raise SystemExit("Bot config file did not contain any bot definitions.")
        return definitions

    def _register_or_login(self, bot: BotState) -> None:
        headers = self._headers_for_bot(bot)
        registration_payload = {
            "username": bot.username,
            "email": bot.email,
            "password": bot.password,
            "form_started_at_ms": now_ms() - (3200 + (bot.index * 250)),
            "contact_email": "",
        }
        try:
            response = self.client.request_json(
                "/auth/register",
                method="POST",
                payload=registration_payload,
                extra_headers=headers,
            )
        except ApiError as exc:
            if exc.status_code == 409 and self.args.reuse_existing:
                response = self.client.request_json(
                    "/auth/login",
                    method="POST",
                    payload={"username": bot.username, "password": bot.password},
                    extra_headers=headers,
                )
            else:
                raise
        bot.token = str(response["access_token"])
        bot.user_id = int(response["user"]["id"])

    def _headers_for_bot(self, bot: BotState) -> dict[str, str]:
        headers = {"User-Agent": bot.user_agent}
        if bot.forwarded_for:
            headers["X-Forwarded-For"] = bot.forwarded_for
        return headers

    def _safe_public_players_sample(self) -> list[dict[str, Any]]:
        try:
            players = self.client.request_json("/players")
        except ApiError:
            return []
        if not isinstance(players, list):
            return []
        return [player for player in players if isinstance(player, dict)]

    def _run_bot_loop(self, bot: BotState, initial_players: list[dict[str, Any]], deadline: float) -> None:
        rng = random.Random(self.args.seed + (bot.index * 1000) + 7)
        players_cache = list(initial_players)
        while time.perf_counter() < deadline:
            action = choose_weighted(rng, PERSONA_ACTION_WEIGHTS[bot.persona])
            try:
                if action == "browse_market":
                    players_cache = self._action_browse_market(bot, rng, players_cache)
                elif action == "read_forum":
                    self._action_read_forum(bot, rng)
                elif action == "view_portfolio":
                    self._action_view_portfolio(bot)
                elif action == "trade":
                    players_cache = self._action_trade(bot, rng, players_cache)
                elif action == "feedback":
                    self._action_feedback(bot, rng)
                elif action == "message":
                    self._action_message(bot, rng)
                elif action == "auth_ping":
                    self._action_auth_ping(bot)
                self._record_action(bot, action)
            except ApiError as exc:
                label = f"{action}:http_{exc.status_code}"
                if exc.status_code == 429:
                    retry_after = exc.headers.get("Retry-After")
                    if retry_after:
                        try:
                            time.sleep(min(5.0, max(0.0, float(retry_after))))
                        except ValueError:
                            pass
                self._record_error(bot, label, exc.detail)
            except Exception as exc:  # pragma: no cover - runtime reporting
                self._record_error(bot, f"{action}:{type(exc).__name__}", str(exc))

            if self.delay_max_seconds > 0:
                time.sleep(rng.uniform(self.delay_min_seconds, self.delay_max_seconds))

    def _action_auth_ping(self, bot: BotState) -> None:
        self.client.request_json("/auth/me", token=bot.token, extra_headers=self._headers_for_bot(bot))

    def _action_browse_market(
        self,
        bot: BotState,
        rng: random.Random,
        players_cache: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        players = self.client.request_json("/players", token=bot.token, extra_headers=self._headers_for_bot(bot))
        if not isinstance(players, list):
            return players_cache
        normalized = [player for player in players if isinstance(player, dict)]
        if not normalized:
            return players_cache

        if rng.random() < 0.55:
            chosen = rng.choice(normalized)
            player_id = int(chosen["id"])
            self.client.request_json(
                f"/players/{player_id}",
                token=bot.token,
                extra_headers=self._headers_for_bot(bot),
            )
            if rng.random() < 0.55:
                self.client.request_json(
                    f"/players/{player_id}/history?limit=50",
                    token=bot.token,
                    extra_headers=self._headers_for_bot(bot),
                )
            if rng.random() < 0.35:
                self.client.request_json(
                    f"/players/{player_id}/game-history?limit=25",
                    token=bot.token,
                    extra_headers=self._headers_for_bot(bot),
                )
        else:
            self.client.request_json("/market/movers", token=bot.token, extra_headers=self._headers_for_bot(bot))

        return normalized

    def _action_view_portfolio(self, bot: BotState) -> dict[str, Any]:
        portfolio = self.client.request_json("/portfolio", token=bot.token, extra_headers=self._headers_for_bot(bot))
        if not isinstance(portfolio, dict):
            return {}
        return portfolio

    def _action_trade(
        self,
        bot: BotState,
        rng: random.Random,
        players_cache: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        portfolio = self._action_view_portfolio(bot)
        holdings = portfolio.get("holdings") if isinstance(portfolio, dict) else []
        positive_holdings = []
        negative_holdings = []
        if isinstance(holdings, list):
            for holding in holdings:
                if not isinstance(holding, dict):
                    continue
                shares_owned = float(holding.get("shares_owned", 0) or 0)
                if shares_owned > 0:
                    positive_holdings.append(holding)
                elif shares_owned < 0:
                    negative_holdings.append(holding)

        side: str
        player_id: int
        shares: int

        if bot.persona in MARKET_MAKER_PERSONAS:
            market_maker_trade = self._choose_market_maker_trade(
                bot=bot,
                rng=rng,
                players_cache=players_cache,
                positive_holdings=positive_holdings,
                negative_holdings=negative_holdings,
            )
            if market_maker_trade is None:
                return players_cache
            side, player_id, shares = market_maker_trade
        elif positive_holdings and rng.random() < 0.34:
            holding = rng.choice(positive_holdings)
            player_id = int(holding["player_id"])
            max_shares = max(1, int(abs(float(holding.get("shares_owned", 0)))))
            side = "sell"
            shares = rng.randint(1, min(4, max_shares))
        elif negative_holdings and rng.random() < 0.34:
            holding = rng.choice(negative_holdings)
            player_id = int(holding["player_id"])
            max_shares = max(1, int(abs(float(holding.get("shares_owned", 0)))))
            side = "cover"
            shares = rng.randint(1, min(4, max_shares))
        else:
            if not players_cache:
                players_cache = self._safe_public_players_sample()
            if not players_cache:
                return players_cache
            chosen = rng.choice(players_cache)
            player_id = int(chosen["id"])
            if bot.persona == "aggressive":
                side = "short" if rng.random() < 0.45 else "buy"
                shares = rng.randint(2, 8)
            elif bot.persona == "lurker":
                side = "buy" if rng.random() < 0.8 else "short"
                shares = rng.randint(1, 3)
            else:
                side = "buy" if rng.random() < 0.65 else "short"
                shares = rng.randint(1, 5)

        payload = {"player_id": player_id, "shares": shares}
        self.client.request_json(
            f"/quote/{side}",
            method="POST",
            token=bot.token,
            payload=payload,
            extra_headers=self._headers_for_bot(bot),
        )
        self.client.request_json(
            f"/trade/{side}",
            method="POST",
            token=bot.token,
            payload=payload,
            extra_headers=self._headers_for_bot(bot),
        )
        bot.last_player_id = player_id
        return players_cache

    def _choose_market_maker_trade(
        self,
        *,
        bot: BotState,
        rng: random.Random,
        players_cache: list[dict[str, Any]],
        positive_holdings: list[dict[str, Any]],
        negative_holdings: list[dict[str, Any]],
    ) -> tuple[str, int, int] | None:
        max_inventory = 12 if bot.persona == "market_maker_long" else 8
        recycle_size_cap = 5 if bot.persona == "market_maker_long" else 4

        if positive_holdings:
            heavy_long = [
                holding
                for holding in positive_holdings
                if int(abs(float(holding.get("shares_owned", 0) or 0))) >= max_inventory
            ]
            if heavy_long:
                holding = rng.choice(heavy_long)
                shares_owned = max(1, int(abs(float(holding.get("shares_owned", 0) or 0))))
                return ("sell", int(holding["player_id"]), rng.randint(1, min(recycle_size_cap, shares_owned)))

        if negative_holdings:
            heavy_short = [
                holding
                for holding in negative_holdings
                if int(abs(float(holding.get("shares_owned", 0) or 0))) >= max_inventory
            ]
            if heavy_short:
                holding = rng.choice(heavy_short)
                shares_owned = max(1, int(abs(float(holding.get("shares_owned", 0) or 0))))
                return ("cover", int(holding["player_id"]), rng.randint(1, min(recycle_size_cap, shares_owned)))

        if positive_holdings and rng.random() < 0.4:
            holding = rng.choice(positive_holdings)
            shares_owned = max(1, int(abs(float(holding.get("shares_owned", 0) or 0))))
            return ("sell", int(holding["player_id"]), rng.randint(1, min(recycle_size_cap, shares_owned)))

        if negative_holdings and rng.random() < 0.4:
            holding = rng.choice(negative_holdings)
            shares_owned = max(1, int(abs(float(holding.get("shares_owned", 0) or 0))))
            return ("cover", int(holding["player_id"]), rng.randint(1, min(recycle_size_cap, shares_owned)))

        if not players_cache:
            players_cache = self._safe_public_players_sample()
        if not players_cache:
            return None

        preferred_players = [
            player for player in players_cache
            if isinstance(player, dict) and float(player.get("spot_price", 0) or 0) > 0
        ]
        if not preferred_players:
            preferred_players = players_cache

        same_player = None
        if bot.last_player_id is not None:
            for player in preferred_players:
                if int(player.get("id", 0)) == bot.last_player_id:
                    same_player = player
                    break

        chosen = same_player if same_player and rng.random() < 0.45 else rng.choice(preferred_players)
        player_id = int(chosen["id"])

        if bot.persona == "market_maker_long":
            side = "buy" if rng.random() < 0.72 else "sell"
        else:
            side = rng.choices(["buy", "short"], weights=[58, 42], k=1)[0]

        shares = rng.randint(2, 6 if bot.persona == "market_maker_long" else 5)
        return (side, player_id, shares)

    def _action_read_forum(self, bot: BotState, rng: random.Random) -> None:
        sort = "popular" if rng.random() < 0.25 else "new"
        posts = self.client.request_json(
            f"/forum/posts?limit=10&sort={urllib.parse.quote(sort)}",
            token=bot.token,
            extra_headers=self._headers_for_bot(bot),
        )
        if not isinstance(posts, list) or not posts:
            if rng.random() < 0.6:
                self._action_create_post(bot, rng)
            return

        visible_posts = [post for post in posts if isinstance(post, dict)]
        if not visible_posts:
            return
        chosen = rng.choice(visible_posts)
        post_id = int(chosen["id"])
        self.client.request_json(
            f"/forum/posts/{post_id}",
            token=bot.token,
            extra_headers=self._headers_for_bot(bot),
        )
        if rng.random() < 0.35:
            self.client.request_json(
                f"/forum/posts/{post_id}/comments",
                method="POST",
                token=bot.token,
                payload={"body": rng.choice(COMMENT_BODIES)},
                extra_headers=self._headers_for_bot(bot),
            )
        elif rng.random() < 0.2:
            self._action_create_post(bot, rng)

    def _action_create_post(self, bot: BotState, rng: random.Random) -> None:
        title = rng.choice(POST_TITLES)
        body = rng.choice(POST_BODIES)
        self.client.request_json(
            "/forum/posts",
            method="POST",
            token=bot.token,
            payload={"title": title, "body": body},
            extra_headers=self._headers_for_bot(bot),
        )

    def _action_feedback(self, bot: BotState, rng: random.Random) -> None:
        self.client.request_json(
            "/feedback",
            method="POST",
            token=bot.token,
            payload={
                "message": rng.choice(FEEDBACK_MESSAGES),
                "page_path": rng.choice(PAGE_PATHS),
            },
            extra_headers=self._headers_for_bot(bot),
        )

    def _action_message(self, bot: BotState, rng: random.Random) -> None:
        other_bots = [candidate for candidate in self.bots if candidate.username != bot.username]
        if not other_bots:
            return

        threads = self.client.request_json("/inbox/threads", token=bot.token, extra_headers=self._headers_for_bot(bot))
        if isinstance(threads, list) and threads and rng.random() < 0.55:
            visible_threads = [item for item in threads if isinstance(item, dict)]
            if not visible_threads:
                return
            thread = rng.choice(visible_threads)
            thread_id = int(thread["id"])
            self.client.request_json(
                f"/inbox/threads/{thread_id}",
                token=bot.token,
                extra_headers=self._headers_for_bot(bot),
            )
            self.client.request_json(
                f"/inbox/threads/{thread_id}/messages",
                method="POST",
                token=bot.token,
                payload={"body": rng.choice(DM_MESSAGES)},
                extra_headers=self._headers_for_bot(bot),
            )
            return

        target = rng.choice(other_bots)
        self.client.request_json(
            "/inbox/threads",
            method="POST",
            token=bot.token,
            payload={
                "username": target.username,
                "initial_message": rng.choice(DM_MESSAGES),
            },
            extra_headers=self._headers_for_bot(bot),
        )

    def _record_action(self, bot: BotState, action: str) -> None:
        with self.summary_lock:
            bot.action_counts[action] += 1
            self.summary_counts[action] += 1

    def _record_error(self, bot: BotState, label: str, detail: str) -> None:
        with self.summary_lock:
            bot.error_counts[label] += 1
            self.error_counts[label] += 1
        if detail:
            print(f"[bot:{bot.username}] {label} - {detail}")


def main() -> None:
    args = parse_args()
    simulator = SyntheticUserSimulator(args)
    summary = simulator.run()
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
