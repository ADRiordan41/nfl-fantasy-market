from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Numeric, DateTime, ForeignKey, Text, UniqueConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

NUM = Numeric(18, 6)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    cash_balance: Mapped[float] = mapped_column(NUM, default=0)
    password_hash: Mapped[str | None] = mapped_column(String(512), nullable=True)
    profile_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)

    holdings: Mapped[list["Holding"]] = relationship(back_populates="user")
    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user")
    forum_posts: Mapped[list["ForumPost"]] = relationship(back_populates="user")
    forum_comments: Mapped[list["ForumComment"]] = relationship(back_populates="user")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    user: Mapped["User"] = relationship(back_populates="sessions")


class ForumPost(Base):
    __tablename__ = "forum_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text)
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        index=True,
    )

    user: Mapped["User"] = relationship(back_populates="forum_posts")
    comments: Mapped[list["ForumComment"]] = relationship(back_populates="post")


class ForumComment(Base):
    __tablename__ = "forum_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("forum_posts.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        index=True,
    )

    user: Mapped["User"] = relationship(back_populates="forum_comments")
    post: Mapped["ForumPost"] = relationship(back_populates="comments")


class ForumPostView(Base):
    __tablename__ = "forum_post_views"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("forum_posts.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

class Player(Base):
    __tablename__ = "players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sport: Mapped[str] = mapped_column(String(16), index=True, default="NFL")
    name: Mapped[str] = mapped_column(String(128), index=True)
    team: Mapped[str] = mapped_column(String(8), index=True)
    position: Mapped[str] = mapped_column(String(8), index=True)
    ipo_open: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    ipo_season: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    ipo_opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    live_now: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    live_week: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    live_game_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    live_game_label: Mapped[str | None] = mapped_column(String(96), nullable=True)
    live_game_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    live_game_stat_line: Mapped[str | None] = mapped_column(Text, nullable=True)
    live_game_fantasy_points: Mapped[float | None] = mapped_column(NUM, nullable=True)
    live_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

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


class PricePoint(Base):
    __tablename__ = "price_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    source: Mapped[str] = mapped_column(String(32), default="SYSTEM")
    fundamental_price: Mapped[float] = mapped_column(NUM, default=0)
    spot_price: Mapped[float] = mapped_column(NUM, default=0)
    total_shares: Mapped[float] = mapped_column(NUM, default=0)
    points_to_date: Mapped[float] = mapped_column(NUM, default=0)
    latest_week: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class SettledWeek(Base):
    __tablename__ = "settled_weeks"
    __table_args__ = (UniqueConstraint("week", name="uq_settled_week"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    week: Mapped[int] = mapped_column(Integer, index=True)
    settled_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SeasonClose(Base):
    __tablename__ = "season_closes"
    __table_args__ = (UniqueConstraint("season", name="uq_season_close"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    season: Mapped[int] = mapped_column(Integer, index=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ArchivedWeeklyStat(Base):
    __tablename__ = "archived_weekly_stats"
    __table_args__ = (UniqueConstraint("season", "player_id", "week", name="uq_archived_season_player_week"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    season: Mapped[int] = mapped_column(Integer, index=True)
    player_id: Mapped[int] = mapped_column(Integer, index=True)
    week: Mapped[int] = mapped_column(Integer, index=True)
    fantasy_points: Mapped[float] = mapped_column(NUM, default=0)
    archived_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ArchivedHolding(Base):
    __tablename__ = "archived_holdings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    season: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    player_id: Mapped[int] = mapped_column(Integer, index=True)
    shares_owned: Mapped[float] = mapped_column(NUM, default=0)
    user_cash_balance: Mapped[float] = mapped_column(NUM, default=0)
    archived_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SeasonReset(Base):
    __tablename__ = "season_resets"
    __table_args__ = (UniqueConstraint("season", name="uq_season_reset"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    season: Mapped[int] = mapped_column(Integer, index=True)
    archived_stats_count: Mapped[int] = mapped_column(Integer, default=0)
    archived_holdings_count: Mapped[int] = mapped_column(Integer, default=0)
    reset_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
