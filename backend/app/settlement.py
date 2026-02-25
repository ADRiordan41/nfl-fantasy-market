from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Holding, Player, Transaction, User, WeeklyStat


def run_season_closeout(
    db: Session,
    payout_per_point: Decimal,
) -> tuple[Decimal, int, int]:
    point_rows = db.execute(
        select(WeeklyStat.player_id, func.coalesce(func.sum(WeeklyStat.fantasy_points), 0)).group_by(WeeklyStat.player_id)
    ).all()
    final_points_by_player = {
        int(player_id): Decimal(str(total_points)) for player_id, total_points in point_rows
    }

    holdings = db.execute(
        select(Holding).where(Holding.shares_owned != 0)
    ).scalars().all()

    total_paid = Decimal("0")
    credited_users: set[int] = set()
    closed_positions = 0
    closed_shares_by_player: dict[int, Decimal] = {}

    for holding in holdings:
        shares = Decimal(str(holding.shares_owned))
        if shares == 0:
            continue

        final_points = final_points_by_player.get(holding.player_id, Decimal("0"))
        payout = shares * final_points * payout_per_point

        user = db.get(User, holding.user_id)
        if user is not None:
            user.cash_balance = float(Decimal(str(user.cash_balance)) + payout)

        db.add(
            Transaction(
                user_id=holding.user_id,
                player_id=holding.player_id,
                type="SEASON_CLOSE",
                shares=float(shares),
                unit_price=float(final_points * payout_per_point),
                amount=float(payout),
            )
        )

        total_paid += payout
        closed_positions += 1
        if payout > 0:
            credited_users.add(holding.user_id)

        closed_shares_by_player[holding.player_id] = (
            closed_shares_by_player.get(holding.player_id, Decimal("0")) + shares
        )
        holding.shares_owned = 0.0

    for player_id, closed_shares in closed_shares_by_player.items():
        player = db.get(Player, player_id)
        if player is None:
            continue
        current_total = Decimal(str(player.total_shares))
        player.total_shares = float(max(Decimal("0"), current_total - closed_shares))

    return total_paid, len(credited_users), closed_positions
