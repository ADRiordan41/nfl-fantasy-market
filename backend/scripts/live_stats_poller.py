import argparse
import csv
import io
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib import error, parse, request


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


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    print(f"[{now_iso()}] {message}", flush=True)


def normalize(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


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


def parse_optional_non_negative_float(value: Any) -> float | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        parsed = float(raw)
    except ValueError:
        return None
    if parsed < 0:
        return None
    return parsed


def http_get_text(url: str, timeout: float) -> str:
    req = request.Request(url, method="GET")
    with request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8")


def http_get_json(url: str, timeout: float) -> Any:
    raw = http_get_text(url=url, timeout=timeout)
    return json.loads(raw)


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


def load_source_text(source_url: str | None, source_file: str | None, timeout: float) -> str:
    if source_url:
        return http_get_text(url=source_url, timeout=timeout)
    if source_file:
        file_path = Path(source_file)
        return file_path.read_text(encoding="utf-8")
    raise ValueError("Either source_url or source_file is required.")


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
        if points < 0:
            invalid_rows += 1
            continue

        live_now = parse_live_flag(row.get(col_live)) if col_live else None
        live_game_id = normalize_optional_text(row.get(col_live_game_id)) if col_live_game_id else None
        live_game_label = normalize_optional_text(row.get(col_live_game_label)) if col_live_game_label else None
        live_game_status = normalize_optional_text(row.get(col_live_status)) if col_live_status else None
        live_game_stat_line = normalize_optional_text(row.get(col_live_stat_line)) if col_live_stat_line else None
        live_game_fantasy_points = (
            parse_optional_non_negative_float(row.get(col_live_points))
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
        if points < 0:
            invalid_rows += 1
            continue

        live_now = parse_live_flag(row.get(col_live)) if col_live else None
        live_game_id = normalize_optional_text(row.get(col_live_game_id)) if col_live_game_id else None
        live_game_label = normalize_optional_text(row.get(col_live_game_label)) if col_live_game_label else None
        live_game_status = normalize_optional_text(row.get(col_live_status)) if col_live_status else None
        live_game_stat_line = normalize_optional_text(row.get(col_live_stat_line)) if col_live_stat_line else None
        live_game_fantasy_points = (
            parse_optional_non_negative_float(row.get(col_live_points))
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
    key_team = normalize(team)
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
        key_team = normalize(ref.team)
        by_name_team[(key_name, key_team)] = ref
        by_name.setdefault(key_name, []).append(ref)
    return by_name_team, by_name


def row_signature(row: IncomingStat) -> str:
    payload = {
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
    token: str | None,
    timeout: float,
    max_retries: int,
    retry_backoff: float,
) -> None:
    attempts = max(1, max_retries)
    for attempt in range(1, attempts + 1):
        try:
            post_stat(api_base=api_base, payload=payload, token=token, timeout=timeout)
            return
        except error.HTTPError:
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
    token: str | None,
    sport: str | None,
    source_url: str | None,
    source_file: str | None,
    source_format: str,
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

    source_text = load_source_text(source_url=source_url, source_file=source_file, timeout=timeout)
    parsed_stats, invalid_rows, source_rows = parse_source_stats(
        text=source_text,
        source_format=source_format,
        week_override=week_override,
    )
    counts.source_rows = source_rows
    counts.invalid_rows = invalid_rows
    counts.parsed_rows = len(parsed_stats)

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
                token=token,
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
    return counts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Poll a live source and upsert fantasy points to /stats. "
            "Posts only changed player/week values."
        )
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--source-url", help="HTTP URL returning JSON or CSV rows")
    source_group.add_argument("--source-file", help="Path to local JSON/CSV file")

    parser.add_argument("--source-format", choices=("auto", "json", "csv"), default="auto")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", default=None, help="Admin bearer token for /stats")
    parser.add_argument("--sport", default=None, help="Optional sport filter when fetching /players")
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
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.week is not None and args.week <= 0:
        print("[error] --week must be > 0")
        return 1
    if args.interval_seconds <= 0:
        print("[error] --interval-seconds must be > 0")
        return 1
    if args.max_post_retries <= 0:
        print("[error] --max-post-retries must be > 0")
        return 1

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
                token=args.token,
                sport=args.sport,
                source_url=args.source_url,
                source_file=args.source_file,
                source_format=args.source_format,
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
