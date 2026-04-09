from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, timedelta

from live_stats_poller import (
    ApiAuthContext,
    build_player_indexes,
    fetch_mlb_statsapi_rows,
    fetch_players,
    log,
    parse_mlb_allowed_game_types,
    post_stat_with_retry,
    resolve_player,
)


@dataclass
class BackfillCounts:
    dates_processed: int = 0
    source_games: int = 0
    source_rows: int = 0
    matched_rows: int = 0
    unmatched_rows: int = 0
    posted_rows: int = 0
    failed_posts: int = 0


def iter_date_range(start_date: date, end_date: date):
    current = start_date
    while current <= end_date:
        yield current.isoformat()
        current += timedelta(days=1)


def parse_iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value.strip())
    except Exception as exc:  # noqa: BLE001 - user-provided CLI input
        raise argparse.ArgumentTypeError(f"invalid date '{value}'; expected YYYY-MM-DD") from exc


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "One-time MLB stats backfill by date range. "
            "Replays game feeds and posts rows to /stats."
        )
    )
    parser.add_argument("--start-date", required=True, type=parse_iso_date, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", default=None, type=parse_iso_date, help="End date (YYYY-MM-DD), defaults to start-date")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--week", type=int, default=1, help="Week value to post to /stats")
    parser.add_argument("--token", default=None, help="Admin bearer token for /stats")
    parser.add_argument("--auth-username", default=None, help="Admin username/email for /auth/login")
    parser.add_argument("--auth-password", default=None, help="Admin password for /auth/login")
    parser.add_argument("--timeout", type=float, default=25.0, help="HTTP timeout seconds")
    parser.add_argument("--max-post-retries", type=int, default=3, help="Retry attempts per /stats post")
    parser.add_argument("--retry-backoff", type=float, default=1.5, help="Backoff multiplier in seconds")
    parser.add_argument(
        "--mlb-allowed-game-types",
        default="R,F,D,L,W,S",
        help="Comma-separated MLB gameType codes to ingest",
    )
    parser.add_argument("--dry-run", action="store_true", help="Process/fetch only; do not post to /stats")
    return parser.parse_args(argv)


def run_backfill(args: argparse.Namespace) -> int:
    start_date: date = args.start_date
    end_date: date = args.end_date or start_date
    if end_date < start_date:
        log(f"[error] end-date {end_date.isoformat()} is before start-date {start_date.isoformat()}")
        return 1
    if args.week <= 0:
        log("[error] --week must be > 0")
        return 1
    if args.max_post_retries <= 0:
        log("[error] --max-post-retries must be > 0")
        return 1
    if not args.dry_run and not args.token and not (args.auth_username and args.auth_password):
        log("[error] provide --token or --auth-username/--auth-password unless --dry-run is set")
        return 1

    auth = ApiAuthContext(
        api_base=args.api_base,
        timeout=float(args.timeout),
        token=args.token,
        username=args.auth_username,
        password=args.auth_password,
    )
    allowed_game_types = parse_mlb_allowed_game_types(args.mlb_allowed_game_types)

    players = fetch_players(api_base=args.api_base, sport="MLB", timeout=float(args.timeout))
    if not players:
        log("[error] no listed MLB players returned by /players")
        return 1
    by_name_team, by_name = build_player_indexes(players)

    counts = BackfillCounts()
    for target_date in iter_date_range(start_date, end_date):
        rows, source_games = fetch_mlb_statsapi_rows(
            timeout=float(args.timeout),
            week_override=int(args.week),
            schedule_date=target_date,
            live_only=False,
            allowed_game_types=allowed_game_types,
        )
        counts.dates_processed += 1
        counts.source_games += int(source_games)
        counts.source_rows += len(rows)
        log(f"date={target_date} games={source_games} rows={len(rows)}")

        for row in rows:
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

            payload = {
                "player_id": int(ref.player_id),
                "week": int(row.week),
                "fantasy_points": float(row.fantasy_points),
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

            if args.dry_run:
                counts.posted_rows += 1
                continue

            try:
                post_stat_with_retry(
                    api_base=args.api_base,
                    payload=payload,
                    auth=auth,
                    timeout=float(args.timeout),
                    max_retries=int(args.max_post_retries),
                    retry_backoff=float(args.retry_backoff),
                )
                counts.posted_rows += 1
            except Exception as exc:  # noqa: BLE001 - log + continue for batch backfill
                counts.failed_posts += 1
                log(
                    f"[error] date={target_date} failed post for "
                    f"{ref.name} ({ref.team}) game={row.live_game_id or '--'}: {exc}"
                )

    log(
        "backfill_complete"
        + f" dates={counts.dates_processed}"
        + f" source_games={counts.source_games}"
        + f" source_rows={counts.source_rows}"
        + f" matched={counts.matched_rows}"
        + f" unmatched={counts.unmatched_rows}"
        + f" posted={counts.posted_rows}"
        + f" failed_posts={counts.failed_posts}"
    )
    return 0 if counts.failed_posts == 0 else 2


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    return run_backfill(args)


if __name__ == "__main__":
    raise SystemExit(main())
