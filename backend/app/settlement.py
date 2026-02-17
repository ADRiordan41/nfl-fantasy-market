from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import select
from .models import WeeklyStat, Holding, User, Transaction

DIV_PER_POINT = Decimal("0.10")  # $0.10 per fantasy point per share

def run_weekly_dividends(db: Session, week: int) -> tuple[Decimal, int]:
    stats = db.execute(select(WeeklyStat).where(WeeklyStat.week == week)).scalars().all()
    points_by_player = {s.player_id: Decimal(str(s.fantasy_points)) for s in stats}

    holdings = db.execute(select(Holding)).scalars().all()

    total_paid = Decimal("0")
    credited_users = set()

    for h in holdings:
        pts = points_by_player.get(h.player_id)
        if pts is None:
            continue

        shares = Decimal(str(h.shares_owned))
        if shares <= 0:
            continue

        dividend = shares * pts * DIV_PER_POINT
        if dividend <= 0:
            continue

        user = db.get(User, h.user_id)
        user.cash_balance = Decimal(str(user.cash_balance)) + dividend

        tx = Transaction(
            user_id=h.user_id,
            player_id=h.player_id,
            type="DIVIDEND",
            shares=float(shares),
            unit_price=float(DIV_PER_POINT * pts),
            amount=float(dividend),
        )
        db.add(tx)
        total_paid += dividend
        credited_users.add(h.user_id)

    return total_paid, len(credited_users)
