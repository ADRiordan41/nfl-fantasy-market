from decimal import Decimal
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from .db import get_db, SessionLocal
from .models import User, Player, Holding, Transaction, WeeklyStat
from .schemas import (
    PlayerOut, PortfolioOut, PortfolioHolding, TradeIn, TradeOut, StatIn, SettlementOut, QuoteOut
)
from .pricing import spot_price, cost_to_buy, proceeds_to_sell
from .seed import init_db, seed
from .settlement import run_weekly_dividends
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="NFL Fantasy Market (Sandbox)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SANDBOX_USERNAME = "sandbox"

@app.on_event("startup")
def on_startup():
    init_db()
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()

def get_sandbox_user(db: Session) -> User:
    user = db.execute(select(User).where(User.username == SANDBOX_USERNAME)).scalar_one_or_none()
    if not user:
        raise HTTPException(500, "Sandbox user missing. Did seed run?")
    return user

def player_to_out(p: Player) -> PlayerOut:
    sp = spot_price(Decimal(str(p.base_price)), Decimal(str(p.k)), Decimal(str(p.total_shares)))
    return PlayerOut(
        id=p.id, name=p.name, team=p.team, position=p.position,
        base_price=float(p.base_price), k=float(p.k), total_shares=float(p.total_shares),
        spot_price=float(sp),
    )

@app.get("/players", response_model=list[PlayerOut])
def list_players(db: Session = Depends(get_db)):
    players = db.execute(select(Player).order_by(Player.name)).scalars().all()
    return [player_to_out(p) for p in players]

@app.get("/players/{player_id}", response_model=PlayerOut)
def get_player(player_id: int, db: Session = Depends(get_db)):
    p = db.get(Player, player_id)
    if not p:
        raise HTTPException(404, "Player not found")
    return player_to_out(p)

@app.get("/portfolio", response_model=PortfolioOut)
def portfolio(db: Session = Depends(get_db)):
    user = get_sandbox_user(db)
    holdings = db.execute(select(Holding).where(Holding.user_id == user.id)).scalars().all()
    return PortfolioOut(
        cash_balance=float(user.cash_balance),
        holdings=[PortfolioHolding(player_id=h.player_id, shares_owned=float(h.shares_owned)) for h in holdings],
    )

@app.post("/quote/buy", response_model=QuoteOut)
def quote_buy(trade: TradeIn, db: Session = Depends(get_db)):
    p = db.get(Player, trade.player_id)
    if not p:
        raise HTTPException(404, "Player not found")

    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    base = Decimal(str(p.base_price))
    k = Decimal(str(p.k))
    S = Decimal(str(p.total_shares))

    spot_before = spot_price(base, k, S)
    total_cost = cost_to_buy(base, k, S, qty)
    spot_after = spot_price(base, k, S + qty)
    avg = (total_cost / qty) if qty > 0 else Decimal("0")

    return QuoteOut(
        player_id=p.id,
        shares=float(qty),
        spot_price_before=float(spot_before),
        spot_price_after=float(spot_after),
        average_price=float(avg),
        total=float(total_cost),
    )

@app.post("/quote/sell", response_model=QuoteOut)
def quote_sell(trade: TradeIn, db: Session = Depends(get_db)):
    user = get_sandbox_user(db)
    p = db.get(Player, trade.player_id)
    if not p:
        raise HTTPException(404, "Player not found")

    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    # optional: check holdings so quote matches what you can actually sell
    holding = db.execute(
        select(Holding).where(Holding.user_id == user.id, Holding.player_id == p.id)
    ).scalar_one_or_none()
    owned = Decimal(str(holding.shares_owned)) if holding else Decimal("0")
    if qty > owned:
        raise HTTPException(400, f"Trying to sell {float(qty):.4f} but only own {float(owned):.4f}")

    base = Decimal(str(p.base_price))
    k = Decimal(str(p.k))
    S = Decimal(str(p.total_shares))

    spot_before = spot_price(base, k, S)
    proceeds = proceeds_to_sell(base, k, S, qty)
    spot_after = spot_price(base, k, S - qty)
    avg = (proceeds / qty) if qty > 0 else Decimal("0")

    return QuoteOut(
        player_id=p.id,
        shares=float(qty),
        spot_price_before=float(spot_before),
        spot_price_after=float(spot_after),
        average_price=float(avg),
        total=float(proceeds),
    )

@app.post("/trade/buy", response_model=TradeOut)
def buy(trade: TradeIn, db: Session = Depends(get_db)):
    user = get_sandbox_user(db)
    p = db.get(Player, trade.player_id)
    if not p:
        raise HTTPException(404, "Player not found")

    qty = Decimal(str(trade.shares))
    base = Decimal(str(p.base_price))
    k = Decimal(str(p.k))
    S = Decimal(str(p.total_shares))

    total_cost = cost_to_buy(base, k, S, qty)
    cash = Decimal(str(user.cash_balance))

    if total_cost > cash:
        raise HTTPException(400, f"Insufficient cash. Need {float(total_cost):.2f}, have {float(cash):.2f}")

    user.cash_balance = float(cash - total_cost)

    holding = db.execute(
        select(Holding).where(Holding.user_id == user.id, Holding.player_id == p.id)
    ).scalar_one_or_none()
    if not holding:
        holding = Holding(user_id=user.id, player_id=p.id, shares_owned=0)
        db.add(holding)

    holding.shares_owned = float(Decimal(str(holding.shares_owned)) + qty)
    p.total_shares = float(S + qty)

    unit_est = (total_cost / qty) if qty > 0 else Decimal("0")
    db.add(Transaction(
        user_id=user.id,
        player_id=p.id,
        type="BUY",
        shares=float(qty),
        unit_price=float(unit_est),
        amount=float(-total_cost),
    ))

    db.commit()
    return TradeOut(
        player_id=p.id,
        shares=float(qty),
        unit_price_estimate=float(unit_est),
        total_cost_or_proceeds=float(total_cost),
        new_cash_balance=float(user.cash_balance),
        new_total_shares=float(p.total_shares),
    )

@app.post("/trade/sell", response_model=TradeOut)
def sell(trade: TradeIn, db: Session = Depends(get_db)):
    user = get_sandbox_user(db)
    p = db.get(Player, trade.player_id)
    if not p:
        raise HTTPException(404, "Player not found")

    holding = db.execute(
        select(Holding).where(Holding.user_id == user.id, Holding.player_id == p.id)
    ).scalar_one_or_none()
    if not holding or Decimal(str(holding.shares_owned)) <= 0:
        raise HTTPException(400, "No shares to sell")

    qty = Decimal(str(trade.shares))
    owned = Decimal(str(holding.shares_owned))
    if qty > owned:
        raise HTTPException(400, f"Trying to sell {float(qty):.4f} but only own {float(owned):.4f}")

    base = Decimal(str(p.base_price))
    k = Decimal(str(p.k))
    S = Decimal(str(p.total_shares))

    proceeds = proceeds_to_sell(base, k, S, qty)

    cash = Decimal(str(user.cash_balance))
    user.cash_balance = float(cash + proceeds)

    holding.shares_owned = float(owned - qty)
    p.total_shares = float(S - qty)

    unit_est = (proceeds / qty) if qty > 0 else Decimal("0")
    db.add(Transaction(
        user_id=user.id,
        player_id=p.id,
        type="SELL",
        shares=float(qty),
        unit_price=float(unit_est),
        amount=float(proceeds),
    ))

    db.commit()
    return TradeOut(
        player_id=p.id,
        shares=float(qty),
        unit_price_estimate=float(unit_est),
        total_cost_or_proceeds=float(proceeds),
        new_cash_balance=float(user.cash_balance),
        new_total_shares=float(p.total_shares),
    )

@app.post("/stats", response_model=dict)
def upsert_weekly_stat(stat: StatIn, db: Session = Depends(get_db)):
    p = db.get(Player, stat.player_id)
    if not p:
        raise HTTPException(404, "Player not found")

    existing = db.execute(
        select(WeeklyStat).where(WeeklyStat.player_id == stat.player_id, WeeklyStat.week == stat.week)
    ).scalar_one_or_none()

    if existing:
        existing.fantasy_points = stat.fantasy_points
    else:
        db.add(WeeklyStat(player_id=stat.player_id, week=stat.week, fantasy_points=stat.fantasy_points))

    db.commit()
    return {"ok": True}

@app.post("/settlement/week/{week}", response_model=SettlementOut)
def settle_week(week: int, db: Session = Depends(get_db)):
    total_paid, users = run_weekly_dividends(db, week)
    db.commit()
    return SettlementOut(week=week, dividends_paid_total=float(total_paid), users_credited=users)
