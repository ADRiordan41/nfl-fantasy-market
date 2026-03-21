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

from sqlalchemy import select

from backend.app.db import SessionLocal
from backend.app.models import User
from backend.app.site_reset import execute_site_reset


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
    parser.add_argument(
        "--hide-sport",
        action="append",
        default=[],
        help="Sport code to mark as not IPO'd after reset. Repeat for multiple sports.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    hide_sports = {value.strip().upper() for value in args.hide_sport if value.strip()}
    db = SessionLocal()
    try:
        users = db.execute(select(User)).scalars().all()
        if args.username:
            target_users = [user for user in users if user.username == args.username]
            if not target_users:
                raise SystemExit(f"User '{args.username}' was not found.")
        else:
            target_users = users

        print("Reset summary:")
        print(f"  users_to_reset: {len(target_users)}")
        print(f"  starting_cash: {args.starting_cash}")
        if hide_sports:
            print(f"  sports_to_hide: {', '.join(sorted(hide_sports))}")
        for user in target_users:
            print(
                f"  {user.username}_cash_balance: {Decimal(str(user.cash_balance))} -> {args.starting_cash}"
            )

        if args.dry_run:
            print("Dry run complete. No changes committed.")
            return 0

        result = execute_site_reset(
            db,
            starting_cash=args.starting_cash,
            hide_sports=hide_sports,
            usernames={args.username} if args.username else None,
        )
        print(f"  holdings_cleared: {result.holdings_cleared}")
        print(f"  transactions_cleared: {result.transactions_cleared}")
        print(f"  players_reset: {result.players_reset}")
        print("Reset complete.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
