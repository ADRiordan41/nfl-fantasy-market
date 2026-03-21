from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal


def bootstrap_import_path() -> None:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    backend_root = os.path.dirname(current_dir)
    repo_root = os.path.dirname(backend_root)
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)


bootstrap_import_path()

from sqlalchemy import delete, select

from backend.app.db import SessionLocal
from backend.app.models import (
    ArchivedHolding,
    ArchivedWeeklyStat,
    Holding,
    Player,
    PlayerGamePoint,
    PricePoint,
    SeasonClose,
    SeasonReset,
    SettledWeek,
    Transaction,
    User,
    WeeklyStat,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Reset market state to a blank slate without changing any product features. "
            "This clears open positions and market history, and can restore a target user's balance."
        )
    )
    parser.add_argument(
        "--username",
        default="",
        help="Optional username to reset individually. Leave blank to reset all users.",
    )
    parser.add_argument(
        "--starting-cash",
        type=Decimal,
        default=Decimal("100000.00"),
        help="Cash balance to assign to the target username.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without committing.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db = SessionLocal()
    try:
        users = db.execute(select(User)).scalars().all()
        if args.username:
            target_users = [user for user in users if user.username == args.username]
            if not target_users:
                raise SystemExit(f"User '{args.username}' was not found.")
        else:
            target_users = users

        counts = {
            "holdings": db.execute(select(Holding)).scalars().all(),
            "transactions": db.execute(select(Transaction)).scalars().all(),
            "weekly_stats": db.execute(select(WeeklyStat)).scalars().all(),
            "price_points": db.execute(select(PricePoint)).scalars().all(),
            "player_game_points": db.execute(select(PlayerGamePoint)).scalars().all(),
            "settled_weeks": db.execute(select(SettledWeek)).scalars().all(),
            "season_closes": db.execute(select(SeasonClose)).scalars().all(),
            "season_resets": db.execute(select(SeasonReset)).scalars().all(),
            "archived_weekly_stats": db.execute(select(ArchivedWeeklyStat)).scalars().all(),
            "archived_holdings": db.execute(select(ArchivedHolding)).scalars().all(),
        }
        players = db.execute(select(Player)).scalars().all()

        print("Reset summary:")
        for label, rows in counts.items():
            print(f"  {label}: {len(rows)}")
        print(f"  players_to_reseed_market_state: {len(players)}")
        for user in target_users:
            print(
                f"  {user.username}_cash_balance: {Decimal(str(user.cash_balance))} -> {args.starting_cash}"
            )

        if args.dry_run:
            print("Dry run complete. No changes committed.")
            return 0

        db.execute(delete(Holding))
        db.execute(delete(Transaction))
        db.execute(delete(WeeklyStat))
        db.execute(delete(PricePoint))
        db.execute(delete(PlayerGamePoint))
        db.execute(delete(SettledWeek))
        db.execute(delete(SeasonClose))
        db.execute(delete(SeasonReset))
        db.execute(delete(ArchivedWeeklyStat))
        db.execute(delete(ArchivedHolding))

        for player in players:
            player.total_shares = 0.0
            player.market_bias = 0.0
            player.market_bias_updated_at = None
            player.live_now = False
            player.live_week = None
            player.live_game_id = None
            player.live_game_label = None
            player.live_game_status = None
            player.live_game_stat_line = None
            player.live_game_fantasy_points = 0.0
            player.live_updated_at = None

        for user in target_users:
            user.cash_balance = float(args.starting_cash)

        db.commit()
        print("Reset complete.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
