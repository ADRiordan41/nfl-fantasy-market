from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Numeric, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

NUM = Numeric(18, 6)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    cash_balance: Mapped[float] = mapped_column(NUM, default=0)

    holdings: Mapped[list["Holding"]] = relationship(back_populates="user")

class Player(Base):
    __tablename__ = "players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    team: Mapped[str] = mapped_column(String(8), index=True)
    position: Mapped[str] = mapped_column(String(8), index=True)

    base_price: Mapped[float] = mapped_column(NUM, default=10)
    k: Mapped[float] = mapped_column(NUM, default=0.0025)  # curve steepness
    total_shares: Mapped[float] = mapped_column(NUM, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("user_id", "player_id", name="uq_user_player"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)

    shares_owned: Mapped[float] = mapped_column(NUM, default=0)

    user: Mapped["User"] = relationship(back_populates="holdings")

class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    player_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"), nullable=True, index=True)

    type: Mapped[str] = mapped_column(String(16))  # BUY, SELL, DIVIDEND
    shares: Mapped[float] = mapped_column(NUM, default=0)
    unit_price: Mapped[float] = mapped_column(NUM, default=0)
    amount: Mapped[float] = mapped_column(NUM, default=0)  # cash delta (+ credit, - debit)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class WeeklyStat(Base):
    __tablename__ = "weekly_stats"
    __table_args__ = (UniqueConstraint("player_id", "week", name="uq_player_week"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    week: Mapped[int] = mapped_column(Integer, index=True)
    fantasy_points: Mapped[float] = mapped_column(NUM, default=0)
