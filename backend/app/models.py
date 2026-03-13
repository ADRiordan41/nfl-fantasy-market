from __future__ import annotations
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

NUM = Numeric(18, 6)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, index=True, nullable=True)
    cash_balance: Mapped[float] = mapped_column(NUM, default=0)
    password_hash: Mapped[str | None] = mapped_column(String(512), nullable=True)
    profile_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)

    holdings: Mapped[list["Holding"]] = relationship(back_populates="user")
    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user")
    forum_posts: Mapped[list["ForumPost"]] = relationship(back_populates="user")
    forum_comments: Mapped[list["ForumComment"]] = relationship(back_populates="user")
    feedback_messages: Mapped[list["FeedbackMessage"]] = relationship(back_populates="user")
    content_reports: Mapped[list["ContentReport"]] = relationship(
        foreign_keys="ContentReport.reporter_user_id",
        back_populates="reporter",
    )
    reviewed_content_reports: Mapped[list["ContentReport"]] = relationship(
        foreign_keys="ContentReport.reviewed_by_user_id",
        back_populates="reviewed_by",
    )
    content_moderation_actions: Mapped[list["ContentModeration"]] = relationship(
        back_populates="moderator",
    )
    direct_threads_as_user_one: Mapped[list["DirectThread"]] = relationship(
        foreign_keys="DirectThread.user_one_id",
        back_populates="user_one",
    )
    direct_threads_as_user_two: Mapped[list["DirectThread"]] = relationship(
        foreign_keys="DirectThread.user_two_id",
        back_populates="user_two",
    )
    sent_direct_messages: Mapped[list["DirectMessage"]] = relationship(
        back_populates="sender",
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    user: Mapped["User"] = relationship(back_populates="sessions")


class DirectThread(Base):
    __tablename__ = "direct_threads"
    __table_args__ = (UniqueConstraint("user_one_id", "user_two_id", name="uq_direct_thread_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_one_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    user_two_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    user_one_last_read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    user_two_last_read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        index=True,
    )

    user_one: Mapped["User"] = relationship(
        foreign_keys=[user_one_id],
        back_populates="direct_threads_as_user_one",
    )
    user_two: Mapped["User"] = relationship(
        foreign_keys=[user_two_id],
        back_populates="direct_threads_as_user_two",
    )
    messages: Mapped[list["DirectMessage"]] = relationship(back_populates="thread")


class DirectMessage(Base):
    __tablename__ = "direct_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("direct_threads.id"), index=True)
    sender_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    thread: Mapped["DirectThread"] = relationship(back_populates="messages")
    sender: Mapped["User"] = relationship(back_populates="sent_direct_messages")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


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


class TradingControl(Base):
    __tablename__ = "trading_controls"
    __table_args__ = (UniqueConstraint("sport", name="uq_trading_control_sport"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sport: Mapped[str] = mapped_column(String(16), index=True)
    halted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reason: Mapped[str | None] = mapped_column(String(280), nullable=True)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class FeedbackMessage(Base):
    __tablename__ = "feedback_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    page_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="NEW", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    user: Mapped["User"] = relationship(back_populates="feedback_messages")


class ContentReport(Base):
    __tablename__ = "content_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reporter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    content_type: Mapped[str] = mapped_column(String(24), index=True)
    content_id: Mapped[int] = mapped_column(Integer, index=True)
    reason: Mapped[str] = mapped_column(String(96))
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="OPEN", index=True)
    action_taken: Mapped[str] = mapped_column(String(24), default="NONE")
    moderator_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        index=True,
    )

    reporter: Mapped["User"] = relationship(
        foreign_keys=[reporter_user_id],
        back_populates="content_reports",
    )
    reviewed_by: Mapped["User"] = relationship(
        foreign_keys=[reviewed_by_user_id],
        back_populates="reviewed_content_reports",
    )


class ContentModeration(Base):
    __tablename__ = "content_moderation"
    __table_args__ = (UniqueConstraint("content_type", "content_id", name="uq_content_moderation_target"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    content_type: Mapped[str] = mapped_column(String(24), index=True)
    content_id: Mapped[int] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(24), default="HIDDEN", index=True)
    reason: Mapped[str | None] = mapped_column(String(256), nullable=True)
    source_report_id: Mapped[int | None] = mapped_column(ForeignKey("content_reports.id"), nullable=True, index=True)
    moderator_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        index=True,
    )

    moderator: Mapped["User"] = relationship(back_populates="content_moderation_actions")

class Player(Base):
    __tablename__ = "players"
    __table_args__ = (
        Index("ix_players_ipo_open_sport_name", "ipo_open", "sport", "name"),
        Index(
            "ix_players_live_board",
            "ipo_open",
            "live_now",
            "sport",
            "live_game_label",
            "live_game_status",
            "name",
        ),
    )

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
    market_bias: Mapped[float] = mapped_column(NUM, default=0)
    market_bias_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (
        UniqueConstraint("user_id", "player_id", name="uq_user_player"),
        Index("ix_holdings_user_player_shares", "user_id", "player_id", "shares_owned"),
        Index("ix_holdings_player_user_shares", "player_id", "user_id", "shares_owned"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)

    shares_owned: Mapped[float] = mapped_column(NUM, default=0)
    basis_amount: Mapped[float] = mapped_column(NUM, default=0)

    user: Mapped["User"] = relationship(back_populates="holdings")

class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_user_player_type_created", "user_id", "player_id", "type", "created_at", "id"),
    )
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
    __table_args__ = (
        Index("ix_price_points_player_created_id", "player_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    source: Mapped[str] = mapped_column(String(32), default="SYSTEM")
    fundamental_price: Mapped[float] = mapped_column(NUM, default=0)
    spot_price: Mapped[float] = mapped_column(NUM, default=0)
    total_shares: Mapped[float] = mapped_column(NUM, default=0)
    points_to_date: Mapped[float] = mapped_column(NUM, default=0)
    latest_week: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class PlayerGamePoint(Base):
    __tablename__ = "player_game_points"
    __table_args__ = (
        UniqueConstraint("player_id", "game_id", name="uq_player_game_point"),
        Index("ix_player_game_points_player_recorded_id", "player_id", "recorded_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    game_id: Mapped[str] = mapped_column(String(64), index=True)
    game_label: Mapped[str | None] = mapped_column(String(96), nullable=True)
    game_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    game_fantasy_points: Mapped[float] = mapped_column(NUM, default=0)
    season_fantasy_points: Mapped[float] = mapped_column(NUM, default=0)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


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
