import argparse
import csv
import io
import json
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable
from urllib import error, parse, request
from zoneinfo import ZoneInfo

MLB_STATS_API_BASE = "https://statsapi.mlb.com"
MLB_STATS_API_SCHEDULE_PATH = "/api/v1/schedule"
MLB_STATS_API_LIVE_FEED_PATH = "/api/v1.1/game/{game_pk}/feed/live"
MLB_STATS_API_TRANSACTIONS_PATH = "/api/v1/transactions"
DEFAULT_MLB_ALLOWED_GAME_TYPES = {"R", "F", "D", "L", "W", "S"}
CHICAGO_TZ = ZoneInfo("America/Chicago")
MLB_SCHEDULE_TIMEZONE = ZoneInfo("America/New_York")
STALE_LIVE_CLEAR_MINUTES = 15
SEASON_ENDING_INJURY_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bout for (the )?season\b", re.IGNORECASE),
    re.compile(r"\bseason[- ]ending\b", re.IGNORECASE),
    re.compile(r"\bmiss (the )?remainder of (the )?season\b", re.IGNORECASE),
    re.compile(r"\b(torn|ruptured)\s+(acl|achilles|labrum|ucl)\b", re.IGNORECASE),
    re.compile(r"\btommy john\b", re.IGNORECASE),
)
MLB_TEAM_ALIASES = {
    "SFG": "SF",
    "SFN": "SF",
    "CHW": "CWS",
    "KCR": "KC",
    "TBR": "TB",
    "WSN": "WSH",
}


@dataclass
class PlayerRef:
    player_id: int
    name: str
    team: str


@dataclass
class IncomingStat:
    row_number: int
    name: str
    team: str
    week: int
    fantasy_points: float
    live_now: bool | None = None
    live_week: int | None = None
    live_game_id: str | None = None
    live_game_label: str | None = None
    live_game_status: str | None = None
    live_game_stat_line: str | None = None
    live_game_fantasy_points: float | None = None


@dataclass
class CycleCounts:
    source_rows: int = 0
    parsed_rows: int = 0
    matched_rows: int = 0
    unchanged_rows: int = 0
    posted_rows: int = 0
    unmatched_rows: int = 0
    invalid_rows: int = 0
    failed_posts: int = 0
    stale_live_clears: int = 0
    injury_candidates: int = 0
    injury_alert_posts: int = 0
    injury_alert_failures: int = 0


@dataclass
class ApiAuthContext:
    api_base: str
    timeout: float
    token: str | None = None
    username: str | None = None
    password: str | None = None
    session_token: str | None = None
    session_expires_at: datetime | None = None

    def can_reauthenticate(self) -> bool:
        return bool(self.username and self.password)

    def invalidate_session(self) -> None:
        self.session_token = None
        self.session_expires_at = None

    def session_is_expired(self) -> bool:
        if self.session_expires_at is None:
            return False
        return datetime.now(CHICAGO_TZ) >= self.session_expires_at - timedelta(seconds=60)

    def current_token(self) -> str | None:
        if self.can_reauthenticate():
            if self.session_token and not self.session_is_expired():
                return self.session_token
            self.session_token, self.session_expires_at = login_for_access_token(
                api_base=self.api_base,
                username=str(self.username),
                password=str(self.password),
                timeout=self.timeout,
            )
            return self.session_token
        return self.token


def now_iso() -> str:
    return datetime.now(CHICAGO_TZ).isoformat()


def log(message: str) -> None:
    print(f"[{now_iso()}] {message}", flush=True)


def normalize(value: str) -> str:
    raw = unicodedata.normalize("NFKD", str(value or ""))
    folded = "".join(ch for ch in raw if not unicodedata.combining(ch))
    cleaned = "".join(ch if ch.isalnum() else " " for ch in folded.lower())
    return " ".join(cleaned.split())


def normalize_team_code(value: str) -> str:
    token = normalize(value).replace(" ", "").upper()
    if not token:
        return ""
    return MLB_TEAM_ALIASES.get(token, token)


def detect_column(sample_row: dict[str, Any], candidates: Iterable[str]) -> str:
    normalized_keys = {normalize(key): key for key in sample_row.keys()}
    for candidate in candidates:
        key = normalized_keys.get(normalize(candidate))
        if key:
            return key
    return ""


def normalize_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def season_ending_injury_reason_from_text(*texts: Any) -> str | None:
    merged_text = " | ".join(
        str(value).strip()
        for value in texts
        if value is not None and str(value).strip()
    )
    if not merged_text:
        return None
    for pattern in SEASON_ENDING_INJURY_PATTERNS:
        match = pattern.search(merged_text)
        if match:
            return match.group(0)
    return None


def parse_mlb_allowed_game_types(raw_value: str | None) -> set[str]:
    raw = str(raw_value or "").strip().upper()
    if not raw:
        return set(DEFAULT_MLB_ALLOWED_GAME_TYPES)
    allowed = {
        token.strip().upper()
        for token in raw.replace(";", ",").split(",")
        if token.strip()
    }
    # Backward compatibility: previous defaults excluded spring training ("S"),
    # which can suppress live MLB games before Opening Day.
    if allowed == {"R", "F", "D", "L", "W"}:
        allowed.add("S")
    return allowed or set(DEFAULT_MLB_ALLOWED_GAME_TYPES)


def parse_live_flag(value: Any) -> bool | None:
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if not normalized:
        return None
    if normalized in {"1", "true", "yes", "y", "live", "in_progress", "in-progress", "active", "playing"}:
        return True
    if normalized in {"0", "false", "no", "n", "not_live", "offline", "final", "ended", "complete", "completed"}:
        return False
    return None


def parse_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        parsed = float(raw)
    except ValueError:
        return None
    return parsed


def parse_float(value: Any) -> float:
    if value is None:
        return 0.0
    raw = str(value).strip()
    if not raw:
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def parse_innings_pitched(value: Any) -> float:
    raw = str(value or "").strip()
    if not raw:
        return 0.0
    if "." not in raw:
        return parse_float(raw)
    whole_raw, frac_raw = raw.split(".", 1)
    whole = parse_float(whole_raw)
    outs = 0
    if frac_raw and frac_raw[0].isdigit():
        outs = int(frac_raw[0])
    outs = max(0, min(2, outs))
    return whole + (outs / 3.0)


def mlb_hitter_points(stats: dict[str, Any]) -> float:
    hits = parse_float(stats.get("hits"))
    doubles = parse_float(stats.get("doubles"))
    triples = parse_float(stats.get("triples"))
    homers = parse_float(stats.get("homeRuns"))
    runs = parse_float(stats.get("runs"))
    rbi = parse_float(stats.get("rbi"))
    walks = parse_float(stats.get("baseOnBalls"))
    steals = parse_float(stats.get("stolenBases"))
    strikeouts = parse_float(stats.get("strikeOuts"))
    singles = max(0.0, hits - doubles - triples - homers)
    points = (
        singles
        + (2.0 * doubles)
        + (3.0 * triples)
        + (4.0 * homers)
        + runs
        + rbi
        + walks
        + (2.0 * steals)
        - (0.25 * strikeouts)
    )
    return round(points, 6)


def mlb_pitcher_points(stats: dict[str, Any]) -> float:
    innings = parse_innings_pitched(stats.get("inningsPitched"))
    strikeouts = parse_float(stats.get("strikeOuts"))
    wins = parse_float(stats.get("wins"))
    saves = parse_float(stats.get("saves"))
    earned_runs = parse_float(stats.get("earnedRuns"))
    hits_allowed = parse_float(stats.get("hits"))
    walks = parse_float(stats.get("baseOnBalls"))
    losses = parse_float(stats.get("losses"))
    points = (
        (3.0 * innings)
        + strikeouts
        + (5.0 * wins)
        + (5.0 * saves)
        - (2.0 * earned_runs)
        - (0.25 * hits_allowed)
        - (0.5 * walks)
        - (2.0 * losses)
    )
    return round(points, 6)


def format_mlb_live_stat_line(
    game_batting: dict[str, Any],
    game_pitching: dict[str, Any],
) -> str | None:
    # Prefer pitching line when innings are recorded (starter/reliever appearance).
    batting_hits = parse_float(game_batting.get("hits"))
    batting_ab = parse_float(game_batting.get("atBats"))
    batting_runs = parse_float(game_batting.get("runs"))
    batting_hr = parse_float(game_batting.get("homeRuns"))
    batting_rbi = parse_float(game_batting.get("rbi"))
    batting_bb = parse_float(game_batting.get("baseOnBalls"))
    batting_sb = parse_float(game_batting.get("stolenBases"))

    pitching_ip_raw = str(game_pitching.get("inningsPitched") or "").strip()
    pitching_k = parse_float(game_pitching.get("strikeOuts"))
    pitching_er = parse_float(game_pitching.get("earnedRuns"))
    pitching_hits = parse_float(game_pitching.get("hits"))
    pitching_bb = parse_float(game_pitching.get("baseOnBalls"))

    if pitching_ip_raw or pitching_k > 0 or pitching_er > 0:
        return (
            f"IP {pitching_ip_raw or '0.0'} | K {int(pitching_k)} | ER {int(pitching_er)}"
            f" | H {int(pitching_hits)} | BB {int(pitching_bb)}"
        )
    if any(
        key in game_batting
        for key in ("atBats", "hits", "runs", "rbi", "baseOnBalls", "stolenBases", "strikeOuts")
    ):
        return (
            f"AB {int(batting_ab)} | H {int(batting_hits)} | R {int(batting_runs)}"
            f" | RBI {int(batting_rbi)} | BB {int(batting_bb)} | SB {int(batting_sb)}"
        )
    return None


def http_get_text(url: str, timeout: float) -> str:
    req = request.Request(url, method="GET")
    with request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8")


def http_get_json(url: str, timeout: float) -> Any:
    raw = http_get_text(url=url, timeout=timeout)
    return json.loads(raw)


def http_post_json(url: str, payload: dict[str, Any], timeout: float, headers: dict[str, str] | None = None) -> Any:
    request_headers = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=request_headers,
        method="POST",
    )
    with request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def parse_api_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=CHICAGO_TZ)
    return parsed.astimezone(CHICAGO_TZ)


def login_for_access_token(
    *,
    api_base: str,
    username: str,
    password: str,
    timeout: float,
) -> tuple[str, datetime | None]:
    url = f"{api_base.rstrip('/')}/auth/login"
    payload = http_post_json(
        url=url,
        payload={"username": username, "password": password},
        timeout=timeout,
    )
    if not isinstance(payload, dict) or "access_token" not in payload:
        raise ValueError("Auth login response did not include an access token.")
    expires_at = parse_api_datetime(payload.get("expires_at"))
    log("Authenticated live poller session.")
    return str(payload["access_token"]), expires_at


def fetch_players(api_base: str, sport: str | None, timeout: float) -> list[dict[str, Any]]:
    encoded_sport = (sport or "").strip().upper()
    query = ""
    if encoded_sport and encoded_sport != "ALL":
        query = f"?sport={parse.quote(encoded_sport)}"
    url = f"{api_base.rstrip('/')}/players{query}"
    payload = http_get_json(url=url, timeout=timeout)
    if not isinstance(payload, list):
        raise ValueError("Expected /players response to be a JSON list.")
    return [row for row in payload if isinstance(row, dict)]


def fetch_mlb_season_ending_injury_events(*, timeout: float, lookback_days: int) -> list[dict[str, Any]]:
    bounded_lookback = max(0, min(int(lookback_days), 60))
    today_et = datetime.now(MLB_SCHEDULE_TIMEZONE).date()
    start_date = (today_et - timedelta(days=bounded_lookback)).isoformat()
    end_date = today_et.isoformat()
    params = parse.urlencode(
        {
            "sportId": 1,
            "startDate": start_date,
            "endDate": end_date,
        }
    )
    transactions_url = f"{MLB_STATS_API_BASE}{MLB_STATS_API_TRANSACTIONS_PATH}?{params}"
    payload = http_get_json(url=transactions_url, timeout=timeout)
    transactions = payload.get("transactions", []) if isinstance(payload, dict) else []
    if not isinstance(transactions, list):
        return []

    events: list[dict[str, Any]] = []
    for tx in transactions:
        if not isinstance(tx, dict):
            continue
        person = tx.get("person", {}) if isinstance(tx.get("person"), dict) else {}
        player_name = normalize_optional_text(person.get("fullName"))
        if not player_name:
            continue
        description = normalize_optional_text(tx.get("description"))
        type_desc = normalize_optional_text(tx.get("typeDesc"))
        matched_reason = season_ending_injury_reason_from_text(description, type_desc)
        if matched_reason is None:
            continue
        events.append(
            {
                "player_name": player_name,
                "headline": description or type_desc or "Season-ending injury transaction",
                "summary": type_desc,
                "reason": matched_reason,
                "source": "mlb-statsapi-transactions",
                "external_id": normalize_optional_text(tx.get("id")),
                "published_at": normalize_optional_text(tx.get("date"))
                or normalize_optional_text(tx.get("effectiveDate")),
            }
        )
    return events


def post_stat(
    api_base: str,
    payload: dict[str, Any],
    token: str | None,
    timeout: float,
) -> None:
    url = f"{api_base.rstrip('/')}/stats"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with request.urlopen(req, timeout=timeout):
        return


def post_injury_alert(
    api_base: str,
    payload: dict[str, Any],
    token: str | None,
    timeout: float,
) -> None:
    url = f"{api_base.rstrip('/')}/admin/injuries/alert"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    _ = http_post_json(url=url, payload=payload, timeout=timeout, headers=headers)


def post_injury_alert_with_retry(
    api_base: str,
    payload: dict[str, Any],
    auth: ApiAuthContext | None,
    timeout: float,
    max_retries: int,
    retry_backoff: float,
) -> None:
    attempts = max(1, max_retries)
    for attempt in range(1, attempts + 1):
        try:
            token = auth.current_token() if auth else None
            post_injury_alert(api_base=api_base, payload=payload, token=token, timeout=timeout)
            return
        except error.HTTPError as exc:
            if exc.code == 401 and auth and auth.can_reauthenticate():
                auth.invalidate_session()
                if attempt < attempts:
                    continue
            if attempt >= attempts:
                raise
        except error.URLError:
            if attempt >= attempts:
                raise
        except TimeoutError:
            if attempt >= attempts:
                raise
        sleep_seconds = max(0.1, retry_backoff * attempt)
        time.sleep(sleep_seconds)


def load_source_text(source_url: str | None, source_file: str | None, timeout: float) -> str:
    if source_url:
        return http_get_text(url=source_url, timeout=timeout)
    if source_file:
        file_path = Path(source_file)
        return file_path.read_text(encoding="utf-8")
    raise ValueError("Either source_url or source_file is required.")


def fetch_mlb_statsapi_rows(
    *,
    timeout: float,
    week_override: int | None,
    schedule_date: str | None,
    live_only: bool,
    allowed_game_types: set[str],
) -> tuple[list[IncomingStat], int]:
    requested_date = (schedule_date or "").strip()
    if requested_date:
        target_dates = [requested_date]
    else:
        now_et = datetime.now(MLB_SCHEDULE_TIMEZONE).date()
        target_dates = [
            now_et.isoformat(),
            (now_et - timedelta(days=1)).isoformat(),
        ]

    game_rows_by_pk: dict[str, dict[str, Any]] = {}
    for target_date in target_dates:
        params = parse.urlencode({"sportId": 1, "date": target_date})
        schedule_url = f"{MLB_STATS_API_BASE}{MLB_STATS_API_SCHEDULE_PATH}?{params}"
        schedule_payload = http_get_json(url=schedule_url, timeout=timeout)
        dates = schedule_payload.get("dates", []) if isinstance(schedule_payload, dict) else []
        for date_block in dates:
            if not isinstance(date_block, dict):
                continue
            games = date_block.get("games", [])
            if not isinstance(games, list):
                continue
            for game in games:
                if not isinstance(game, dict):
                    continue
                game_pk = game.get("gamePk")
                if game_pk is None:
                    continue
                game_rows_by_pk[str(game_pk)] = game

    game_rows = list(game_rows_by_pk.values())

    out_rows: dict[tuple[str, str], IncomingStat] = {}
    row_week = int(week_override) if week_override is not None else 1
    if row_week <= 0:
        row_week = 1

    for game in game_rows:
        game_pk = game.get("gamePk")
        if game_pk is None:
            continue
        game_type = str(game.get("gameType") or "").strip().upper()
        if allowed_game_types and game_type not in allowed_game_types:
            continue
        status_block = game.get("status", {}) if isinstance(game.get("status"), dict) else {}
        abstract_state = str(status_block.get("abstractGameState") or "").strip()
        if abstract_state.upper() == "PREVIEW":
            continue
        if live_only and abstract_state.upper() != "LIVE":
            continue

        feed_url = f"{MLB_STATS_API_BASE}{MLB_STATS_API_LIVE_FEED_PATH.format(game_pk=game_pk)}"
        feed_payload = http_get_json(url=feed_url, timeout=timeout)
        if not isinstance(feed_payload, dict):
            continue

        game_data = feed_payload.get("gameData", {}) if isinstance(feed_payload.get("gameData"), dict) else {}
        live_data = feed_payload.get("liveData", {}) if isinstance(feed_payload.get("liveData"), dict) else {}
        feed_game_type = str(game_data.get("gameType") or game_type).strip().upper()
        if allowed_game_types and feed_game_type not in allowed_game_types:
            continue
        status = game_data.get("status", {}) if isinstance(game_data.get("status"), dict) else {}
        abstract = str(status.get("abstractGameState") or abstract_state).strip()
        detailed = str(status.get("detailedState") or "").strip() or None
        live_now = abstract.upper() == "LIVE"

        teams_meta = game_data.get("teams", {}) if isinstance(game_data.get("teams"), dict) else {}
        home_meta = teams_meta.get("home", {}) if isinstance(teams_meta.get("home"), dict) else {}
        away_meta = teams_meta.get("away", {}) if isinstance(teams_meta.get("away"), dict) else {}
        home_abbr = str(home_meta.get("abbreviation") or "").strip().upper()
        away_abbr = str(away_meta.get("abbreviation") or "").strip().upper()
        game_label = f"{away_abbr} @ {home_abbr}".strip()
        if not game_label or game_label == "@":
            game_label = str(game_data.get("gameType") or "MLB Game").strip()

        teams_box = (live_data.get("boxscore") or {}).get("teams")
        if not isinstance(teams_box, dict):
            continue

        for side in ("home", "away"):
            side_box = teams_box.get(side, {})
            if not isinstance(side_box, dict):
                continue
            team_abbr = home_abbr if side == "home" else away_abbr
            players = side_box.get("players", {})
            if not isinstance(players, dict):
                continue

            for player_entry in players.values():
                if not isinstance(player_entry, dict):
                    continue
                person = player_entry.get("person", {})
                if not isinstance(person, dict):
                    continue
                name = str(person.get("fullName") or "").strip()
                if not name:
                    continue

                game_stats = player_entry.get("stats", {})
                if not isinstance(game_stats, dict):
                    game_stats = {}
                season_stats = player_entry.get("seasonStats", {})
                if not isinstance(season_stats, dict):
                    season_stats = {}

                game_batting = game_stats.get("batting", {}) if isinstance(game_stats.get("batting"), dict) else {}
                game_pitching = game_stats.get("pitching", {}) if isinstance(game_stats.get("pitching"), dict) else {}
                season_batting = season_stats.get("batting", {}) if isinstance(season_stats.get("batting"), dict) else {}
                season_pitching = season_stats.get("pitching", {}) if isinstance(season_stats.get("pitching"), dict) else {}

                # Persist a season-to-date fantasy total for each player through /stats.
                # This is the ongoing anchor the backend stores in WeeklyStat and uses for pricing.
                season_points = mlb_hitter_points(season_batting) + mlb_pitcher_points(season_pitching)
                game_points = mlb_hitter_points(game_batting) + mlb_pitcher_points(game_pitching)
                live_stat_line = format_mlb_live_stat_line(game_batting=game_batting, game_pitching=game_pitching)

                row = IncomingStat(
                    row_number=int(game_pk),
                    name=name,
                    team=normalize_team_code(team_abbr),
                    week=row_week,
                    fantasy_points=round(season_points, 6),
                    live_now=live_now,
                    live_week=row_week,
                    live_game_id=str(game_pk),
                    live_game_label=game_label,
                    live_game_status=detailed,
                    live_game_stat_line=live_stat_line,
                    live_game_fantasy_points=round(game_points, 6),
                )

                dedupe_key = (normalize(name), normalize_team_code(team_abbr))
                existing = out_rows.get(dedupe_key)
                if existing is None:
                    out_rows[dedupe_key] = row
                    continue
                if bool(row.live_now) and not bool(existing.live_now):
                    out_rows[dedupe_key] = row
                    continue
                if (row.live_game_fantasy_points or 0.0) > (existing.live_game_fantasy_points or 0.0):
                    out_rows[dedupe_key] = row

    return list(out_rows.values()), len(game_rows)


def parse_csv_rows(
    text: str,
    week_override: int | None,
) -> tuple[list[IncomingStat], int]:
    stream = io.StringIO(text)
    reader = csv.DictReader(stream)
    rows = list(reader)
    if not rows:
        return [], 0

    sample = rows[0]
    col_name = detect_column(sample, ("player_name", "name", "player"))
    col_team = detect_column(sample, ("team", "team_abbr", "team_code"))
    col_week = detect_column(sample, ("week",))
    col_points = detect_column(sample, ("fantasy_points", "points", "fpts", "half_ppr_points"))
    col_live = detect_column(sample, ("is_live", "live_now", "live"))
    col_live_game_id = detect_column(sample, ("live_game_id", "game_id", "event_id"))
    col_live_game_label = detect_column(sample, ("live_game_label", "game_label", "game", "matchup"))
    col_live_status = detect_column(sample, ("live_game_status", "game_status", "live_status", "status"))
    col_live_stat_line = detect_column(sample, ("live_game_stat_line", "game_stat_line", "stat_line", "live_stats"))
    col_live_points = detect_column(
        sample,
        ("live_game_fantasy_points", "game_fantasy_points", "current_fantasy_points", "fantasy_points_game"),
    )

    if not col_name or not col_points:
        raise ValueError("CSV source must include player name and fantasy points columns.")

    parsed: list[IncomingStat] = []
    invalid_rows = 0
    for idx, row in enumerate(rows, start=2):
        name = str(row.get(col_name, "")).strip()
        team = str(row.get(col_team, "")).strip() if col_team else ""
        points_raw = str(row.get(col_points, "")).strip()
        if not name or not points_raw:
            invalid_rows += 1
            continue

        row_week = week_override
        if row_week is None:
            if not col_week:
                invalid_rows += 1
                continue
            try:
                row_week = int(str(row.get(col_week, "")).strip())
            except ValueError:
                invalid_rows += 1
                continue
        if row_week <= 0:
            invalid_rows += 1
            continue

        try:
            points = float(points_raw)
        except ValueError:
            invalid_rows += 1
            continue

        live_now = parse_live_flag(row.get(col_live)) if col_live else None
        live_game_id = normalize_optional_text(row.get(col_live_game_id)) if col_live_game_id else None
        live_game_label = normalize_optional_text(row.get(col_live_game_label)) if col_live_game_label else None
        live_game_status = normalize_optional_text(row.get(col_live_status)) if col_live_status else None
        live_game_stat_line = normalize_optional_text(row.get(col_live_stat_line)) if col_live_stat_line else None
        live_game_fantasy_points = (
            parse_optional_float(row.get(col_live_points))
            if col_live_points
            else None
        )
        if live_now is True and live_game_fantasy_points is None:
            live_game_fantasy_points = points

        parsed.append(
            IncomingStat(
                row_number=idx,
                name=name,
                team=team,
                week=int(row_week),
                fantasy_points=points,
                live_now=live_now,
                live_week=int(row_week) if live_now is not None else None,
                live_game_id=live_game_id,
                live_game_label=live_game_label,
                live_game_status=live_game_status,
                live_game_stat_line=live_game_stat_line,
                live_game_fantasy_points=live_game_fantasy_points,
            )
        )
    return parsed, invalid_rows


def extract_json_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("rows", "players", "data", "stats"):
            value = payload.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
    raise ValueError(
        "JSON source must be an array of row objects, or an object containing rows/data/players/stats."
    )


def parse_json_rows(
    payload: Any,
    week_override: int | None,
) -> tuple[list[IncomingStat], int]:
    rows = extract_json_rows(payload)
    if not rows:
        return [], 0

    sample = rows[0]
    col_name = detect_column(sample, ("player_name", "name", "player"))
    col_team = detect_column(sample, ("team", "team_abbr", "team_code"))
    col_week = detect_column(sample, ("week",))
    col_points = detect_column(sample, ("fantasy_points", "points", "fpts", "half_ppr_points"))
    col_live = detect_column(sample, ("is_live", "live_now", "live"))
    col_live_game_id = detect_column(sample, ("live_game_id", "game_id", "event_id"))
    col_live_game_label = detect_column(sample, ("live_game_label", "game_label", "game", "matchup"))
    col_live_status = detect_column(sample, ("live_game_status", "game_status", "live_status", "status"))
    col_live_stat_line = detect_column(sample, ("live_game_stat_line", "game_stat_line", "stat_line", "live_stats"))
    col_live_points = detect_column(
        sample,
        ("live_game_fantasy_points", "game_fantasy_points", "current_fantasy_points", "fantasy_points_game"),
    )

    if not col_name or not col_points:
        raise ValueError("JSON source must include player name and fantasy points fields.")

    parsed: list[IncomingStat] = []
    invalid_rows = 0
    for idx, row in enumerate(rows, start=1):
        name = str(row.get(col_name, "")).strip()
        team = str(row.get(col_team, "")).strip() if col_team else ""
        points_raw = row.get(col_points, "")
        if not name or points_raw is None or str(points_raw).strip() == "":
            invalid_rows += 1
            continue

        row_week = week_override
        if row_week is None:
            if not col_week:
                invalid_rows += 1
                continue
            try:
                row_week = int(str(row.get(col_week, "")).strip())
            except ValueError:
                invalid_rows += 1
                continue
        if row_week <= 0:
            invalid_rows += 1
            continue

        try:
            points = float(points_raw)
        except (TypeError, ValueError):
            invalid_rows += 1
            continue

        live_now = parse_live_flag(row.get(col_live)) if col_live else None
        live_game_id = normalize_optional_text(row.get(col_live_game_id)) if col_live_game_id else None
        live_game_label = normalize_optional_text(row.get(col_live_game_label)) if col_live_game_label else None
        live_game_status = normalize_optional_text(row.get(col_live_status)) if col_live_status else None
        live_game_stat_line = normalize_optional_text(row.get(col_live_stat_line)) if col_live_stat_line else None
        live_game_fantasy_points = (
            parse_optional_float(row.get(col_live_points))
            if col_live_points
            else None
        )
        if live_now is True and live_game_fantasy_points is None:
            live_game_fantasy_points = points

        parsed.append(
            IncomingStat(
                row_number=idx,
                name=name,
                team=team,
                week=int(row_week),
                fantasy_points=points,
                live_now=live_now,
                live_week=int(row_week) if live_now is not None else None,
                live_game_id=live_game_id,
                live_game_label=live_game_label,
                live_game_status=live_game_status,
                live_game_stat_line=live_game_stat_line,
                live_game_fantasy_points=live_game_fantasy_points,
            )
        )
    return parsed, invalid_rows


def parse_source_stats(
    text: str,
    source_format: str,
    week_override: int | None,
) -> tuple[list[IncomingStat], int, int]:
    source_format_normalized = source_format.strip().lower()

    if source_format_normalized == "json":
        payload = json.loads(text)
        parsed_rows, invalid_rows = parse_json_rows(payload=payload, week_override=week_override)
        raw_count = len(extract_json_rows(payload))
        return parsed_rows, invalid_rows, raw_count

    if source_format_normalized == "csv":
        parsed_rows, invalid_rows = parse_csv_rows(text=text, week_override=week_override)
        raw_count = len(list(csv.DictReader(io.StringIO(text))))
        return parsed_rows, invalid_rows, raw_count

    try:
        payload = json.loads(text)
        parsed_rows, invalid_rows = parse_json_rows(payload=payload, week_override=week_override)
        raw_count = len(extract_json_rows(payload))
        return parsed_rows, invalid_rows, raw_count
    except json.JSONDecodeError:
        parsed_rows, invalid_rows = parse_csv_rows(text=text, week_override=week_override)
        raw_count = len(list(csv.DictReader(io.StringIO(text))))
        return parsed_rows, invalid_rows, raw_count


def resolve_player(
    name: str,
    team: str,
    by_name_team: dict[tuple[str, str], PlayerRef],
    by_name: dict[str, list[PlayerRef]],
) -> PlayerRef | None:
    key_name = normalize(name)
    key_team = normalize_team_code(team)
    if key_name and key_team:
        direct = by_name_team.get((key_name, key_team))
        if direct:
            return direct

    matches = by_name.get(key_name, [])
    if len(matches) == 1:
        return matches[0]
    return None


def build_player_indexes(players: list[dict[str, Any]]) -> tuple[dict[tuple[str, str], PlayerRef], dict[str, list[PlayerRef]]]:
    by_name_team: dict[tuple[str, str], PlayerRef] = {}
    by_name: dict[str, list[PlayerRef]] = {}
    for player in players:
        if "id" not in player or "name" not in player or "team" not in player:
            continue
        ref = PlayerRef(
            player_id=int(player["id"]),
            name=str(player["name"]),
            team=str(player["team"]),
        )
        key_name = normalize(ref.name)
        key_team = normalize_team_code(ref.team)
        by_name_team[(key_name, key_team)] = ref
        by_name.setdefault(key_name, []).append(ref)
    return by_name_team, by_name


def row_signature(row: IncomingStat) -> str:
    payload = {
        "team": row.team,
        "fantasy_points": round(float(row.fantasy_points), 6),
        "live_now": row.live_now,
        "live_week": row.live_week,
        "live_game_id": row.live_game_id,
        "live_game_label": row.live_game_label,
        "live_game_status": row.live_game_status,
        "live_game_stat_line": row.live_game_stat_line,
        "live_game_fantasy_points": (
            round(float(row.live_game_fantasy_points), 6)
            if row.live_game_fantasy_points is not None
            else None
        ),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def load_state(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    signatures = payload.get("row_signature_by_player_week")
    if isinstance(signatures, dict):
        out: dict[str, str] = {}
        for key, value in signatures.items():
            if value is None:
                continue
            out[str(key)] = str(value)
        return out

    # Backward compatibility with older point-only state format.
    points = payload.get("points_by_player_week")
    if isinstance(points, dict):
        out: dict[str, str] = {}
        for key, value in points.items():
            try:
                parsed = float(value)
            except (TypeError, ValueError):
                continue
            out[str(key)] = json.dumps({"fantasy_points": round(parsed, 6)}, sort_keys=True, separators=(",", ":"))
        return out
    return {}


def save_state(path: Path, row_signature_by_player_week: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "updated_at": now_iso(),
        "row_signature_by_player_week": row_signature_by_player_week,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def post_stat_with_retry(
    api_base: str,
    payload: dict[str, Any],
    auth: ApiAuthContext | None,
    timeout: float,
    max_retries: int,
    retry_backoff: float,
) -> None:
    attempts = max(1, max_retries)
    for attempt in range(1, attempts + 1):
        try:
            token = auth.current_token() if auth else None
            post_stat(api_base=api_base, payload=payload, token=token, timeout=timeout)
            return
        except error.HTTPError as exc:
            if exc.code == 401 and auth and auth.can_reauthenticate():
                auth.invalidate_session()
                if attempt < attempts:
                    continue
            if attempt >= attempts:
                raise
        except error.URLError:
            if attempt >= attempts:
                raise
        except TimeoutError:
            if attempt >= attempts:
                raise
        sleep_seconds = max(0.1, retry_backoff * attempt)
        time.sleep(sleep_seconds)


def run_cycle(
    *,
    api_base: str,
    auth: ApiAuthContext | None,
    sport: str | None,
    source_provider: str | None,
    source_url: str | None,
    source_file: str | None,
    source_format: str,
    mlb_date: str | None,
    mlb_live_only: bool,
    mlb_allowed_game_types: set[str],
    mlb_injury_lookback_days: int,
    week_override: int | None,
    timeout: float,
    max_post_retries: int,
    retry_backoff: float,
    dry_run: bool,
    state: dict[str, str],
) -> CycleCounts:
    counts = CycleCounts()
    players = fetch_players(api_base=api_base, sport=sport, timeout=timeout)
    if not players:
        log("No listed players returned by /players. IPO may be hidden for selected sport.")
        return counts
    by_name_team, by_name = build_player_indexes(players)

    if source_provider == "mlb-statsapi":
        parsed_stats, source_rows = fetch_mlb_statsapi_rows(
            timeout=timeout,
            week_override=week_override,
            schedule_date=mlb_date,
            live_only=mlb_live_only,
            allowed_game_types=mlb_allowed_game_types,
        )
        invalid_rows = 0
        try:
            injury_events = fetch_mlb_season_ending_injury_events(
                timeout=timeout,
                lookback_days=mlb_injury_lookback_days,
            )
        except Exception as exc:
            injury_events = []
            log(f"[warn] unable to fetch MLB injury transactions: {exc}")
    else:
        source_text = load_source_text(source_url=source_url, source_file=source_file, timeout=timeout)
        parsed_stats, invalid_rows, source_rows = parse_source_stats(
            text=source_text,
            source_format=source_format,
            week_override=week_override,
        )
        injury_events = []
    counts.source_rows = source_rows
    counts.invalid_rows = invalid_rows
    counts.parsed_rows = len(parsed_stats)
    counts.injury_candidates = len(injury_events)

    if injury_events:
        alerted_player_ids: set[int] = set()
        for event in injury_events:
            ref = resolve_player(
                name=str(event.get("player_name") or ""),
                team="",
                by_name_team=by_name_team,
                by_name=by_name,
            )
            if not ref:
                continue
            if ref.player_id in alerted_player_ids:
                continue
            alerted_player_ids.add(ref.player_id)
            payload = {
                "player_id": int(ref.player_id),
                "headline": str(event.get("headline") or "Potential season-ending injury"),
                "summary": normalize_optional_text(event.get("summary")),
                "source": normalize_optional_text(event.get("source")),
                "published_at": normalize_optional_text(event.get("published_at")),
                "external_id": normalize_optional_text(event.get("external_id")),
            }
            if dry_run:
                log(
                    f"[dry-run] post /admin/injuries/alert {ref.name} ({ref.team}) "
                    f"headline={payload['headline']}"
                )
                counts.injury_alert_posts += 1
                continue
            try:
                post_injury_alert_with_retry(
                    api_base=api_base,
                    payload=payload,
                    auth=auth,
                    timeout=timeout,
                    max_retries=max_post_retries,
                    retry_backoff=retry_backoff,
                )
                counts.injury_alert_posts += 1
            except Exception as exc:
                counts.injury_alert_failures += 1
                log(f"[error] failed injury alert for {ref.name} ({ref.team}): {exc}")

    active_live_game_ids = {
        str(row.live_game_id).strip()
        for row in parsed_stats
        if row.live_now is True and row.live_game_id
    }

    for row in parsed_stats:
        ref = resolve_player(
            name=row.name,
            team=row.team,
            by_name_team=by_name_team,
            by_name=by_name,
        )
        if not ref:
            counts.unmatched_rows += 1
            continue
        counts.matched_rows += 1

        state_key = f"{ref.player_id}:{row.week}"
        next_signature = row_signature(row)
        previous = state.get(state_key)
        if previous is not None and previous == next_signature:
            counts.unchanged_rows += 1
            continue

        payload = {
            "player_id": ref.player_id,
            "week": row.week,
            "fantasy_points": row.fantasy_points,
            "team": row.team,
        }
        if row.live_now is not None:
            payload["live_now"] = bool(row.live_now)
            payload["live_week"] = int(row.live_week or row.week)
        if row.live_game_id is not None:
            payload["live_game_id"] = row.live_game_id
        if row.live_game_label is not None:
            payload["live_game_label"] = row.live_game_label
        if row.live_game_status is not None:
            payload["live_game_status"] = row.live_game_status
        if row.live_game_stat_line is not None:
            payload["live_game_stat_line"] = row.live_game_stat_line
        if row.live_game_fantasy_points is not None:
            payload["live_game_fantasy_points"] = float(row.live_game_fantasy_points)
        if dry_run:
            log(
                f"[dry-run] post /stats {ref.name} ({ref.team}) week={row.week} "
                f"points={row.fantasy_points:.3f}"
            )
            counts.posted_rows += 1
            continue

        try:
            post_stat_with_retry(
                api_base=api_base,
                payload=payload,
                auth=auth,
                timeout=timeout,
                max_retries=max_post_retries,
                retry_backoff=retry_backoff,
            )
            state[state_key] = next_signature
            counts.posted_rows += 1
        except Exception as exc:
            counts.failed_posts += 1
            log(
                f"[error] failed post for {ref.name} ({ref.team}) "
                f"week={row.week} points={row.fantasy_points:.3f}: {exc}"
            )

    # MLB live-only mode excludes non-live games, which can leave stale live flags
    # behind. Clear players that are still marked live but no longer belong to an
    # active live game id, using an age window to avoid overreacting to brief feed gaps.
    if source_provider == "mlb-statsapi":
        now_chicago = datetime.now(CHICAGO_TZ)
        stale_cutoff = timedelta(minutes=STALE_LIVE_CLEAR_MINUTES)
        clear_week = int(week_override) if week_override is not None else 1
        for player in players:
            live_payload = player.get("live")
            if not isinstance(live_payload, dict):
                continue
            if not bool(live_payload.get("live_now")):
                continue

            live_game_id = str(live_payload.get("game_id") or "").strip()
            if live_game_id and live_game_id in active_live_game_ids:
                continue

            updated_at = parse_api_datetime(live_payload.get("updated_at"))
            if updated_at is not None and (now_chicago - updated_at) < stale_cutoff:
                continue

            raw_player_id = player.get("id")
            try:
                player_id = int(raw_player_id)
            except (TypeError, ValueError):
                continue

            fantasy_points = parse_float(player.get("points_to_date"))
            state_key = f"{player_id}:{clear_week}"
            clear_signature = row_signature(
                IncomingStat(
                    row_number=0,
                    name=str(player.get("name") or ""),
                    team=str(player.get("team") or ""),
                    week=clear_week,
                    fantasy_points=fantasy_points,
                    live_now=False,
                )
            )
            previous = state.get(state_key)
            if previous is not None and previous == clear_signature:
                counts.unchanged_rows += 1
                continue

            payload = {
                "player_id": player_id,
                "week": clear_week,
                "fantasy_points": fantasy_points,
                "team": str(player.get("team") or ""),
                "live_now": False,
            }
            if dry_run:
                log(
                    f"[dry-run] clear stale live flag for player_id={player_id} "
                    f"week={clear_week} points={fantasy_points:.3f}"
                )
                counts.posted_rows += 1
                counts.stale_live_clears += 1
                continue

            try:
                post_stat_with_retry(
                    api_base=api_base,
                    payload=payload,
                    auth=auth,
                    timeout=timeout,
                    max_retries=max_post_retries,
                    retry_backoff=retry_backoff,
                )
                state[state_key] = clear_signature
                counts.posted_rows += 1
                counts.stale_live_clears += 1
            except Exception as exc:
                counts.failed_posts += 1
                log(
                    f"[error] failed stale-live clear for player_id={player_id} "
                    f"week={clear_week}: {exc}"
                )
    return counts


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Poll a live source and upsert fantasy points to /stats. "
            "Posts only changed player/week values."
        )
    )
    source_group = parser.add_mutually_exclusive_group(required=False)
    source_group.add_argument("--source-url", help="HTTP URL returning JSON or CSV rows")
    source_group.add_argument("--source-file", help="Path to local JSON/CSV file")
    parser.add_argument(
        "--source-provider",
        choices=("mlb-statsapi",),
        default=None,
        help="Use a built-in real source provider instead of source-url/source-file.",
    )

    parser.add_argument("--source-format", choices=("auto", "json", "csv"), default="auto")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", default=None, help="Admin bearer token for /stats")
    parser.add_argument("--auth-username", default=None, help="Admin username/email for automatic session login")
    parser.add_argument("--auth-password", default=None, help="Admin password for automatic session login")
    parser.add_argument("--sport", default=None, help="Optional sport filter when fetching /players")
    parser.add_argument("--mlb-date", default=None, help="Optional date (YYYY-MM-DD) for MLB StatsAPI provider")
    parser.add_argument("--mlb-live-only", action="store_true", help="When using MLB provider, include only games currently live")
    parser.add_argument(
        "--mlb-injury-lookback-days",
        type=int,
        default=7,
        help="When using MLB provider, lookback window in days for MLB transaction injury alerts.",
    )
    parser.add_argument(
        "--mlb-allowed-game-types",
        default="R,F,D,L,W,S",
        help="Comma-separated MLB gameType codes to ingest (default includes regular season, postseason, and spring training)",
    )
    parser.add_argument("--week", type=int, default=None, help="Optional week override")
    parser.add_argument("--interval-seconds", type=int, default=60, help="Polling interval for continuous mode")
    parser.add_argument("--once", action="store_true", help="Run one cycle and exit")
    parser.add_argument(
        "--state-file",
        default="backend/data/live_stats_state.json",
        help="State file used to skip unchanged player/week rows",
    )
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout seconds")
    parser.add_argument("--max-post-retries", type=int, default=3, help="Retry attempts per /stats post")
    parser.add_argument("--retry-backoff", type=float, default=1.5, help="Backoff multiplier in seconds")
    parser.add_argument("--dry-run", action="store_true", help="Process and log without posting to /stats")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.source_provider and not args.source_url and not args.source_file:
        print("[error] provide one source: --source-provider or one of --source-url/--source-file")
        return 1
    if args.source_provider and (args.source_url or args.source_file):
        print("[error] --source-provider cannot be combined with --source-url/--source-file")
        return 1
    if args.week is not None and args.week <= 0:
        print("[error] --week must be > 0")
        return 1
    if args.interval_seconds <= 0:
        print("[error] --interval-seconds must be > 0")
        return 1
    if args.mlb_injury_lookback_days < 0:
        print("[error] --mlb-injury-lookback-days must be >= 0")
        return 1
    if args.max_post_retries <= 0:
        print("[error] --max-post-retries must be > 0")
        return 1
    if not args.dry_run and not args.token and not (args.auth_username and args.auth_password):
        print("[error] provide --token or --auth-username/--auth-password unless --dry-run is set")
        return 1

    auth = ApiAuthContext(
        api_base=args.api_base,
        timeout=float(args.timeout),
        token=args.token,
        username=args.auth_username,
        password=args.auth_password,
    )
    mlb_allowed_game_types = parse_mlb_allowed_game_types(args.mlb_allowed_game_types)

    state_path = Path(args.state_file)
    state = load_state(state_path)
    log(f"Loaded state entries: {len(state)} from {state_path}")

    cycles_with_failures = 0
    cycle_index = 0
    while True:
        cycle_index += 1
        try:
            counts = run_cycle(
                api_base=args.api_base,
                auth=auth,
                sport=args.sport,
                source_provider=args.source_provider,
                source_url=args.source_url,
                source_file=args.source_file,
                source_format=args.source_format,
                mlb_date=args.mlb_date,
                mlb_live_only=bool(args.mlb_live_only),
                mlb_allowed_game_types=mlb_allowed_game_types,
                mlb_injury_lookback_days=int(args.mlb_injury_lookback_days),
                week_override=args.week,
                timeout=float(args.timeout),
                max_post_retries=int(args.max_post_retries),
                retry_backoff=float(args.retry_backoff),
                dry_run=bool(args.dry_run),
                state=state,
            )
            save_state(state_path, state)
            log(
                "cycle="
                + str(cycle_index)
                + f" source_rows={counts.source_rows}"
                + f" parsed={counts.parsed_rows}"
                + f" matched={counts.matched_rows}"
                + f" posted={counts.posted_rows}"
                + f" stale_clears={counts.stale_live_clears}"
                + f" injury_candidates={counts.injury_candidates}"
                + f" injury_alert_posts={counts.injury_alert_posts}"
                + f" injury_alert_failures={counts.injury_alert_failures}"
                + f" unchanged={counts.unchanged_rows}"
                + f" unmatched={counts.unmatched_rows}"
                + f" invalid={counts.invalid_rows}"
                + f" failed_posts={counts.failed_posts}"
            )
            if counts.failed_posts > 0:
                cycles_with_failures += 1
        except Exception as exc:
            cycles_with_failures += 1
            log(f"[error] cycle={cycle_index} failed: {exc}")

        if args.once:
            break
        time.sleep(args.interval_seconds)

    return 0 if cycles_with_failures == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
