from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import (
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


@dataclass
class SiteResetResult:
    users_reset: int
    players_reset: int
    holdings_cleared: int
    transactions_cleared: int
    weekly_stats_cleared: int
    price_points_cleared: int
    player_game_points_cleared: int
    settled_weeks_cleared: int
    season_closes_cleared: int
    season_resets_cleared: int
    archived_weekly_stats_cleared: int
    archived_holdings_cleared: int
    hidden_sports: list[str]
    starting_cash: float


def execute_site_reset(
    db: Session,
    *,
    starting_cash: Decimal,
    hide_sports: set[str] | None = None,
    usernames: set[str] | None = None,
) -> SiteResetResult:
    normalized_hide_sports = {value.strip().upper() for value in (hide_sports or set()) if value.strip()}
    normalized_usernames = {value.strip().lower() for value in (usernames or set()) if value.strip()}

    users = db.execute(select(User)).scalars().all()
    target_users = (
        [user for user in users if str(user.username).strip().lower() in normalized_usernames]
        if normalized_usernames
        else users
    )
    players = db.execute(select(Player)).scalars().all()

    holdings_rows = db.execute(select(Holding)).scalars().all()
    transaction_rows = db.execute(select(Transaction)).scalars().all()
    weekly_stat_rows = db.execute(select(WeeklyStat)).scalars().all()
    price_point_rows = db.execute(select(PricePoint)).scalars().all()
    player_game_point_rows = db.execute(select(PlayerGamePoint)).scalars().all()
    settled_week_rows = db.execute(select(SettledWeek)).scalars().all()
    season_close_rows = db.execute(select(SeasonClose)).scalars().all()
    season_reset_rows = db.execute(select(SeasonReset)).scalars().all()
    archived_weekly_stat_rows = db.execute(select(ArchivedWeeklyStat)).scalars().all()
    archived_holding_rows = db.execute(select(ArchivedHolding)).scalars().all()

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

    players_reset = 0
    for player in players:
        if Decimal(str(player.total_shares)) != Decimal("0") or Decimal(str(player.market_bias)) != Decimal("0"):
            players_reset += 1
        player.total_shares = 0.0
        player.market_bias = 0.0
        player.market_bias_updated_at = None
        if str(player.sport).upper() in normalized_hide_sports:
            player.ipo_open = False
            player.ipo_season = None
            player.ipo_opened_at = None
        player.live_now = False
        player.live_week = None
        player.live_game_id = None
        player.live_game_label = None
        player.live_game_status = None
        player.live_game_stat_line = None
        player.live_game_fantasy_points = 0.0
        player.live_updated_at = None

    for user in target_users:
        user.cash_balance = float(starting_cash)

    db.commit()

    return SiteResetResult(
        users_reset=len(target_users),
        players_reset=players_reset,
        holdings_cleared=len(holdings_rows),
        transactions_cleared=len(transaction_rows),
        weekly_stats_cleared=len(weekly_stat_rows),
        price_points_cleared=len(price_point_rows),
        player_game_points_cleared=len(player_game_point_rows),
        settled_weeks_cleared=len(settled_week_rows),
        season_closes_cleared=len(season_close_rows),
        season_resets_cleared=len(season_reset_rows),
        archived_weekly_stats_cleared=len(archived_weekly_stat_rows),
        archived_holdings_cleared=len(archived_holding_rows),
        hidden_sports=sorted(normalized_hide_sports),
        starting_cash=float(starting_cash),
    )
