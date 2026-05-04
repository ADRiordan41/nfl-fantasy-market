import csv
import io
import json
import logging
import os
import re
import smtplib
import subprocess
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from dataclasses import dataclass
from decimal import Decimal
from math import pow
from pathlib import Path
from time import perf_counter

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import and_, delete, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import (
    generate_session_token,
    hash_password,
    hash_session_token,
    session_expiry_from_now,
    verify_password,
)
from .db import SessionLocal, get_db
from .infra import CACHE, RATE_LIMITER
from .mailer import SmtpSettings, build_password_reset_email, send_smtp_message
from .mlb_statsapi import (
    MlbGameState,
    MlbIncomingStat,
    fetch_mlb_game_states,
    fetch_mlb_schedule_game_pks,
    fetch_mlb_statsapi_rows,
    normalize_game_pk as normalize_mlb_game_pk,
    normalize_lookup_text as normalize_mlb_lookup_text,
    normalize_team_code as normalize_mlb_team_code,
    parse_mlb_allowed_game_types,
)
from .models import (
    ArchivedHolding,
    ArchivedWeeklyStat,
    BotProfile,
    ContentModeration,
    ContentReport,
    DirectMessage,
    DirectThread,
    Friendship,
    FeedbackMessage,
    ForumComment,
    ForumPost,
    ForumPostView,
    Holding,
    Notification,
    PasswordResetToken,
    Player,
    PlayerWatchlist,
    PlayerGamePoint,
    PricePoint,
    SeasonClose,
    SeasonReset,
    SystemSetting,
    TradingControl,
    Transaction,
    User,
    UserSession,
    WeeklyStat,
)
from .pricing import (
    DEFAULT_PRICE_IMPACT_MULTIPLIER,
    LIVE_POINTS_WEIGHT,
    RECENT_FORM_WINDOW,
    cost_to_buy,
    effective_k,
    get_price_impact_multiplier,
    proceeds_to_sell,
    set_price_impact_multiplier,
    spot_price,
    spread_percentage,
)
from .site_reset import execute_site_reset
from .time_utils import chicago_now, chicago_rollover_start
from .win_probability import build_mlb_current_win_probability, build_mlb_win_probability_series
from .schemas import (
    AdminActivityAuditOut,
    AdminBotPersonaOut,
    AdminBotProfileCreateIn,
    AdminBotProfileOut,
    AdminBotProfileUpdateIn,
    AdminBotSimulationStartIn,
    AdminBotSimulationStatusOut,
    AdminAuditDirectMessageOut,
    AdminAuditForumCommentOut,
    AdminAuditForumPostOut,
    AdminAuditSessionOut,
    AdminAuditTradeOut,
    AdminIpoActionOut,
    AdminIpoHideIn,
    AdminInjuryAlertIn,
    AdminIpoLaunchIn,
    AdminIpoPlayerCreateIn,
    AdminIpoPlayerCreateOut,
    AdminIpoPlayerOut,
    AdminIpoPlayersOut,
    AdminIpoSuggestionOut,
    AdminIpoSuggestionsOut,
    AdminSeasonEndingCloseoutIn,
    AdminSeasonEndingCloseoutOut,
    AdminSiteResetIn,
    AdminSiteResetOut,
    AdminStatsBackfillMlbIn,
    AdminStatsBackfillMlbOut,
    AdminStatsClearSportIn,
    AdminStatsClearSportOut,
    AdminIpoSportOut,
    AdminStatsPreviewIn,
    AdminStatsPreviewOut,
    AdminStatsPreviewRow,
    AdminStatsPublishOut,
    AdminModerationReportOut,
    AdminModerationResolveIn,
    AdminModerationUnhideIn,
    AdminModerationUnhideOut,
    AdminNormalizeHoldingsOut,
    AdminUserListItemOut,
    AdminUserEquityOut,
    AdminFeedbackOut,
    AdminFeedbackUpdateIn,
    AdminDeleteUserOut,
    AdminFlattenUserEquityIn,
    AdminFlattenUserEquityOut,
    AdminHomeHowToContentUpdateIn,
    AdminPricingConfigOut,
    AdminPricingConfigUpdateIn,
    AdminSportTradingHaltUpdateIn,
    AdminTradingHaltUpdateIn,
    FeedbackCreateIn,
    FeedbackOut,
    ForumCommentCreateIn,
    ForumCommentOut,
    ForumPostCreateIn,
    ForumPostDetailOut,
    ForumPostSummaryOut,
    LeaderboardEntryOut,
    LeaderboardOut,
    AuthLoginIn,
    AuthLogoutOut,
    NotificationListOut,
    NotificationOut,
    NotificationReadIn,
    AuthPasswordUpdateIn,
    AuthPasswordUpdateOut,
    AuthPasswordResetConfirmIn,
    AuthPasswordResetConfirmOut,
    AuthPasswordResetRequestIn,
    AuthPasswordResetRequestOut,
    AuthRegisterIn,
    AuthSessionOut,
    DirectMessageCreateIn,
    DirectMessageOut,
    DirectThreadCreateIn,
    DirectThreadDetailOut,
    DirectThreadSummaryOut,
    FriendsDashboardOut,
    FriendRequestOut,
    FriendSummaryOut,
    FriendshipRequestCreateIn,
    FriendshipStatusOut,
    HomeHowToContentOut,
    HomeHowToStepOut,
    LiveGameAtBatOut,
    LiveGameOut,
    LiveGamePlayerOut,
    LiveGameStateOut,
    LiveGameWinProbabilityPointOut,
    LiveGamesOut,
    MarketMoverOut,
    MarketMoversOut,
    ModerationReportCreateIn,
    ModerationReportOut,
    PlayerLiveOut,
    PlayerGamePointOut,
    PlayerOut,
    PricePointOut,
    PortfolioHolding,
    PortfolioOut,
    QuoteOut,
    SearchResultOut,
    SeasonCloseOut,
    SeasonResetOut,
    SettlementOut,
    StatIn,
    TradingHaltStateOut,
    TradingStatusOut,
    TradeIn,
    TradeOut,
    UserProfileHoldingOut,
    UserProfileOut,
    UserProfileUpdateIn,
    UserOut,
    WatchlistPlayerOut,
)
from .seed import init_db, seed
from .settlement import run_season_closeout

if not logging.getLogger().handlers:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

logger = logging.getLogger("matchupmarket.api")
app = FastAPI(title="MatchupMarket (Sandbox)")
APP_READY = False
REQUEST_LOG_SLOW_MS = max(1, int(os.environ.get("REQUEST_LOG_SLOW_MS", "500")))
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_request_timing(request: Request, call_next):
    started_at = perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception:
        duration_ms = (perf_counter() - started_at) * 1000
        logger.exception(
            "request_failed method=%s path=%s duration_ms=%.1f client=%s",
            request.method,
            request.url.path,
            duration_ms,
            request.client.host if request.client else "-",
        )
        raise

    duration_ms = (perf_counter() - started_at) * 1000
    response.headers["X-Response-Time-Ms"] = f"{duration_ms:.1f}"
    log_fn = logger.warning if duration_ms >= REQUEST_LOG_SLOW_MS else logger.info
    log_fn(
        "request_complete method=%s path=%s status=%s duration_ms=%.1f client=%s",
        request.method,
        request.url.path,
        status_code,
        duration_ms,
        request.client.host if request.client else "-",
    )
    return response


@app.get("/")
def root():
    return {"ok": True, "service": "MatchupMarket API", "docs": "/docs", "health": "/healthz"}


@app.get("/healthz")
def healthz():
    return {"ok": True}


SYNTHETIC_PLAYER_NAME = re.compile(r"^[A-Z]{2,3} (QB|RB|WR|TE)\d$")
VALID_USERNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
VALID_SPORT_CODE = re.compile(r"^[A-Z0-9_-]{2,16}$")
VALID_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
BOT_PERSONA_CATALOG = {
    "lurker": {
        "label": "Lurker",
        "description": "Mostly browses the market and community with only occasional trades.",
        "market_maker": False,
    },
    "casual": {
        "label": "Casual Trader",
        "description": "Makes light long and short trades while checking portfolio often.",
        "market_maker": False,
    },
    "aggressive": {
        "label": "Aggressive Trader",
        "description": "Trades frequently, takes larger positions, and leans into short exposure.",
        "market_maker": False,
    },
    "community": {
        "label": "Community Regular",
        "description": "Spends more time in forum, feedback, and inbox flows than on trading.",
        "market_maker": False,
    },
    "market_maker_balanced": {
        "label": "Market Maker Balanced",
        "description": "Recycles inventory with two-sided flow to keep the market feeling active.",
        "market_maker": True,
    },
    "market_maker_long": {
        "label": "Market Maker Long",
        "description": "Provides steadier long-side liquidity while trimming oversized inventory.",
        "market_maker": True,
    },
}
BOT_SIMULATION_RUN_DIR = Path(__file__).resolve().parent.parent / "data" / "bot_runs"


@dataclass
class BotSimulationRunState:
    process: subprocess.Popen | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    requested_by_username: str | None = None
    duration_seconds: int | None = None
    min_delay_ms: int | None = None
    max_delay_ms: int | None = None
    startup_stagger_ms: int | None = None
    active_bot_count: int = 0
    config_file: str | None = None
    summary_file: str | None = None
    log_file: str | None = None
    exit_code: int | None = None
    message: str | None = None
    _log_handle: object | None = None

    def refresh(self) -> None:
        if self.process is None:
            return
        next_exit_code = self.process.poll()
        if next_exit_code is None:
            return
        self.exit_code = int(next_exit_code)
        self.completed_at = self.completed_at or chicago_now()
        self.process = None
        if self._log_handle is not None:
            try:
                self._log_handle.close()
            except Exception:
                pass
            self._log_handle = None

    def status_out(self) -> AdminBotSimulationStatusOut:
        self.refresh()
        running = self.process is not None and self.process.poll() is None
        pid = int(self.process.pid) if self.process is not None and running else None
        return AdminBotSimulationStatusOut(
            running=running,
            pid=pid,
            started_at=self.started_at,
            requested_by_username=self.requested_by_username,
            duration_seconds=self.duration_seconds,
            min_delay_ms=self.min_delay_ms,
            max_delay_ms=self.max_delay_ms,
            startup_stagger_ms=self.startup_stagger_ms,
            active_bot_count=self.active_bot_count,
            config_file=self.config_file,
            summary_file=self.summary_file,
            log_file=self.log_file,
            exit_code=self.exit_code,
            completed_at=self.completed_at,
            message=self.message,
        )


BOT_SIMULATION_STATE = BotSimulationRunState()

DEFAULT_SEASON_PROGRESS_UNITS = int(os.environ.get("DEFAULT_SEASON_PROGRESS_UNITS", "100"))
SPORT_SEASON_PROGRESS_UNITS = {
    "MLB": int(os.environ.get("MLB_SEASON_GAMES", "162")),
    "NFL": int(os.environ.get("NFL_SEASON_GAMES", "17")),
    "NBA": int(os.environ.get("NBA_SEASON_GAMES", "82")),
    "NHL": int(os.environ.get("NHL_SEASON_GAMES", "82")),
}
MLB_STARTING_PITCHER_SEASON_STARTS = int(os.environ.get("MLB_STARTING_PITCHER_SEASON_STARTS", "32"))
MLB_STARTING_PITCHER_ROTATION_GAMES = int(os.environ.get("MLB_STARTING_PITCHER_ROTATION_GAMES", "5"))
SEASON_CLOSE_PAYOUT_PER_POINT = Decimal(os.environ.get("SEASON_CLOSE_PAYOUT_PER_POINT", "1.0"))
MIN_SPOT_PRICE = Decimal(os.environ.get("MIN_SPOT_PRICE", "1.0"))
MAINTENANCE_MARGIN_LONG = Decimal(os.environ.get("MAINTENANCE_MARGIN_LONG", "0.0"))
MAINTENANCE_MARGIN_SHORT = Decimal(os.environ.get("MAINTENANCE_MARGIN_SHORT", "0.0"))
MAX_POSITION_NOTIONAL_PER_PLAYER = Decimal(os.environ.get("MAX_POSITION_NOTIONAL_PER_PLAYER", "10000"))
MARKET_IMPACT_REFERENCE_PRICE = max(
    Decimal("1"),
    Decimal(os.environ.get("MARKET_IMPACT_REFERENCE_PRICE", "100")),
)
MARKET_IMPACT_DECAY_RATE = max(
    Decimal("0"),
    Decimal(os.environ.get("MARKET_IMPACT_DECAY_RATE", "0.05")),
)
OPEN_POSITION_FEE_RATE = max(Decimal("0"), Decimal(os.environ.get("OPEN_POSITION_FEE_RATE", "0.0")))
MARKET_REVERSION_HALF_LIFE_MINUTES = max(
    Decimal("1"),
    Decimal(os.environ.get("MARKET_REVERSION_HALF_LIFE_MINUTES", "180")),
)
REGISTER_STARTING_CASH = Decimal("100000")
RAW_SANDBOX_USERNAME = (os.environ.get("SANDBOX_USERNAME") or "").strip()
DEFAULT_SANDBOX_USERNAME = RAW_SANDBOX_USERNAME or "ForeverHopeful"
RAW_ADMIN_USERNAMES = (os.environ.get("ADMIN_USERNAMES") or "").strip()
if not RAW_ADMIN_USERNAMES:
    RAW_ADMIN_USERNAMES = DEFAULT_SANDBOX_USERNAME
ADMIN_USERNAMES = {
    name.strip().lower()
    for name in RAW_ADMIN_USERNAMES.split(",")
    if name.strip()
}
GLOBAL_TRADING_CONTROL_SPORT = "ALL"
MODERATION_CONTENT_FORUM_POST = "FORUM_POST"
MODERATION_CONTENT_FORUM_COMMENT = "FORUM_COMMENT"
MODERATION_CONTENT_TYPES = {
    MODERATION_CONTENT_FORUM_POST,
    MODERATION_CONTENT_FORUM_COMMENT,
}
MODERATION_REPORT_STATUS_OPEN = "OPEN"
MODERATION_REPORT_STATUS_RESOLVED = "RESOLVED"
MODERATION_REPORT_STATUS_DISMISSED = "DISMISSED"
MODERATION_REPORT_STATUSES = {
    MODERATION_REPORT_STATUS_OPEN,
    MODERATION_REPORT_STATUS_RESOLVED,
    MODERATION_REPORT_STATUS_DISMISSED,
}
MODERATION_ACTION_NONE = "NONE"
MODERATION_ACTION_HIDE_CONTENT = "HIDE_CONTENT"
MODERATION_ACTIONS = {
    MODERATION_ACTION_NONE,
    MODERATION_ACTION_HIDE_CONTENT,
}
CONTENT_MODERATION_ACTION_HIDDEN = "HIDDEN"
RATE_LIMIT_AUTH_LOGIN = int(os.environ.get("RATE_LIMIT_AUTH_LOGIN", "12"))
RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS = int(os.environ.get("RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS", "300"))
RATE_LIMIT_AUTH_REGISTER = int(os.environ.get("RATE_LIMIT_AUTH_REGISTER", "6"))
RATE_LIMIT_AUTH_REGISTER_WINDOW_SECONDS = int(os.environ.get("RATE_LIMIT_AUTH_REGISTER_WINDOW_SECONDS", "3600"))
REGISTER_MIN_SUBMIT_MS = max(0, int(os.environ.get("REGISTER_MIN_SUBMIT_MS", "2500")))
RATE_LIMIT_AUTH_PASSWORD_RESET_REQUEST = int(os.environ.get("RATE_LIMIT_AUTH_PASSWORD_RESET_REQUEST", "6"))
RATE_LIMIT_AUTH_PASSWORD_RESET_REQUEST_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_AUTH_PASSWORD_RESET_REQUEST_WINDOW_SECONDS", "3600")
)
RATE_LIMIT_AUTH_PASSWORD_RESET_CONFIRM = int(os.environ.get("RATE_LIMIT_AUTH_PASSWORD_RESET_CONFIRM", "12"))
RATE_LIMIT_AUTH_PASSWORD_RESET_CONFIRM_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_AUTH_PASSWORD_RESET_CONFIRM_WINDOW_SECONDS", "1800")
)
PASSWORD_RESET_TTL_MINUTES = max(5, int(os.environ.get("PASSWORD_RESET_TTL_MINUTES", "60")))
PASSWORD_RESET_PREVIEW_ENABLED = os.environ.get("PASSWORD_RESET_PREVIEW_ENABLED", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}
PASSWORD_RESET_BASE_URL = (
    os.environ.get("PASSWORD_RESET_BASE_URL", "http://localhost:3000/auth").strip()
    or "http://localhost:3000/auth"
)
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = (os.environ.get("SMTP_USERNAME") or "").strip() or None
SMTP_PASSWORD = (os.environ.get("SMTP_PASSWORD") or "").strip() or None
SMTP_FROM_EMAIL = (os.environ.get("SMTP_FROM_EMAIL") or "").strip()
SMTP_FROM_NAME = (os.environ.get("SMTP_FROM_NAME") or "MatchupMarket").strip()
SMTP_USE_STARTTLS = os.environ.get("SMTP_USE_STARTTLS", "true").strip().lower() in {"1", "true", "yes"}
SMTP_USE_SSL = os.environ.get("SMTP_USE_SSL", "false").strip().lower() in {"1", "true", "yes"}
RATE_LIMIT_FORUM_POST_CREATE = int(os.environ.get("RATE_LIMIT_FORUM_POST_CREATE", "8"))
RATE_LIMIT_FORUM_POST_CREATE_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_FORUM_POST_CREATE_WINDOW_SECONDS", "600")
)
RATE_LIMIT_FORUM_COMMENT_CREATE = int(os.environ.get("RATE_LIMIT_FORUM_COMMENT_CREATE", "30"))
RATE_LIMIT_FORUM_COMMENT_CREATE_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_FORUM_COMMENT_CREATE_WINDOW_SECONDS", "600")
)
RATE_LIMIT_DIRECT_THREAD_CREATE = int(os.environ.get("RATE_LIMIT_DIRECT_THREAD_CREATE", "20"))
RATE_LIMIT_DIRECT_THREAD_CREATE_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_DIRECT_THREAD_CREATE_WINDOW_SECONDS", "3600")
)
RATE_LIMIT_DIRECT_MESSAGE_CREATE = int(os.environ.get("RATE_LIMIT_DIRECT_MESSAGE_CREATE", "40"))
RATE_LIMIT_DIRECT_MESSAGE_CREATE_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_DIRECT_MESSAGE_CREATE_WINDOW_SECONDS", "600")
)
RATE_LIMIT_MODERATION_REPORT_CREATE = int(os.environ.get("RATE_LIMIT_MODERATION_REPORT_CREATE", "20"))
RATE_LIMIT_MODERATION_REPORT_CREATE_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_MODERATION_REPORT_CREATE_WINDOW_SECONDS", "3600")
)


SMTP_SETTINGS = SmtpSettings(
    host=SMTP_HOST,
    port=SMTP_PORT,
    username=SMTP_USERNAME,
    password=SMTP_PASSWORD,
    from_email=SMTP_FROM_EMAIL,
    from_name=SMTP_FROM_NAME,
    use_starttls=SMTP_USE_STARTTLS,
    use_ssl=SMTP_USE_SSL,
)


@dataclass
class PositionRisk:
    holding: Holding
    player: Player
    shares: Decimal
    average_entry_price: Decimal
    basis_amount: Decimal
    entry_basis_amount: Decimal
    mark_basis_amount: Decimal
    spot_price: Decimal
    market_value: Decimal
    maintenance_margin_required: Decimal
    fundamental_price: Decimal
    points_to_date: Decimal
    latest_week: int


@dataclass
class AccountRiskSnapshot:
    cash_balance: Decimal
    equity: Decimal
    net_exposure: Decimal
    gross_exposure: Decimal
    margin_used: Decimal
    available_buying_power: Decimal
    margin_call: bool
    positions: list[PositionRisk]


@dataclass(frozen=True)
class PlayerStatsSnapshot:
    points_to_date: Decimal
    latest_week: int
    recent_points: Decimal
    recent_sample_size: int
    latest_game_id: str | None = None
    uses_game_history: bool = False
    team_games_played: int = 0


def calculate_open_position_fee(notional: Decimal) -> Decimal:
    if notional <= 0 or OPEN_POSITION_FEE_RATE <= 0:
        return Decimal("0")
    return notional * OPEN_POSITION_FEE_RATE


def holding_basis_amount(holding: Holding) -> Decimal:
    return max(Decimal("0"), Decimal(str(holding.basis_amount or 0)))


def holding_entry_basis_amount(holding: Holding) -> Decimal:
    return max(Decimal("0"), Decimal(str(getattr(holding, "entry_basis_amount", 0) or 0)))


def holding_mark_basis_amount(holding: Holding) -> Decimal:
    return max(Decimal("0"), Decimal(str(getattr(holding, "mark_basis_amount", 0) or 0)))


def average_entry_price_for_position(*, basis_amount: Decimal, shares: Decimal) -> Decimal:
    abs_shares = abs(shares)
    if basis_amount <= 0 or abs_shares <= 0:
        return Decimal("0")
    return basis_amount / abs_shares


def current_market_bias(player: Player, *, now: datetime | None = None) -> Decimal:
    raw_bias = Decimal(str(getattr(player, "market_bias", 0) or 0))
    return Decimal("0") if abs(raw_bias) < Decimal("0.000001") else raw_bias


def set_market_bias(player: Player, *, bias: Decimal, now: datetime | None = None) -> None:
    normalized_bias = Decimal("0") if abs(bias) < Decimal("0.000001") else bias
    player.market_bias = float(normalized_bias)
    player.market_bias_updated_at = now or chicago_now()


def apply_market_bias_delta(player: Player, *, delta: Decimal, now: datetime | None = None) -> Decimal:
    as_of = now or chicago_now()
    next_bias = current_market_bias(player, now=as_of) + delta
    set_market_bias(player, bias=next_bias, now=as_of)
    return next_bias


def pricing_spread_pct(player: Player, *, fundamental_price: Decimal) -> Decimal:
    return Decimal("0")


def current_spot_price(
    player: Player,
    *,
    fundamental_price: Decimal,
    market_bias: Decimal | None = None,
) -> Decimal:
    return spot_price(
        fundamental_price,
        Decimal(str(player.k)),
        current_market_bias(player) if market_bias is None else market_bias,
        live_now=bool(player.live_now),
    )


def market_impact_bias_delta_for_trade(
    *,
    qty: Decimal,
    spot_price_before: Decimal,
    market_bias_before: Decimal,
) -> Decimal:
    if qty <= 0:
        return Decimal("0")
    safe_spot = max(Decimal("0.000001"), spot_price_before)
    base_delta = qty * (safe_spot / MARKET_IMPACT_REFERENCE_PRICE)
    decay_scale = Decimal("1") + (abs(market_bias_before) * MARKET_IMPACT_DECAY_RATE)
    return base_delta / decay_scale


def current_bid_ask_prices(
    player: Player,
    *,
    fundamental_price: Decimal,
    market_bias: Decimal | None = None,
) -> tuple[Decimal, Decimal]:
    mid = current_spot_price(
        player,
        fundamental_price=fundamental_price,
        market_bias=market_bias,
    )
    return mid, mid


def current_cost_to_buy(
    player: Player,
    *,
    fundamental_price: Decimal,
    qty: Decimal,
    market_bias: Decimal | None = None,
) -> Decimal:
    return cost_to_buy(
        fundamental_price,
        Decimal(str(player.k)),
        current_market_bias(player) if market_bias is None else market_bias,
        qty,
        live_now=bool(player.live_now),
        spread_pct=pricing_spread_pct(player, fundamental_price=fundamental_price),
    )


def current_proceeds_to_sell(
    player: Player,
    *,
    fundamental_price: Decimal,
    qty: Decimal,
    market_bias: Decimal | None = None,
) -> Decimal:
    return proceeds_to_sell(
        fundamental_price,
        Decimal(str(player.k)),
        current_market_bias(player) if market_bias is None else market_bias,
        qty,
        live_now=bool(player.live_now),
        spread_pct=pricing_spread_pct(player, fundamental_price=fundamental_price),
    )


def trade_execution_notional_after_move(
    *,
    qty: Decimal,
    spot_price_after: Decimal,
) -> Decimal:
    if qty <= 0:
        return Decimal("0")
    return qty * spot_price_after


def canonical_executed_spot_price(
    *,
    player: Player,
    fundamental_price: Decimal,
    next_market_bias: Decimal,
) -> Decimal:
    return current_spot_price(
        player,
        fundamental_price=fundamental_price,
        market_bias=next_market_bias,
    )


def short_position_close_value(
    *,
    qty: Decimal,
    basis_amount: Decimal,
    executed_spot_price: Decimal,
) -> Decimal:
    cover_cost = trade_execution_notional_after_move(
        qty=qty,
        spot_price_after=executed_spot_price,
    )
    return (basis_amount * Decimal("2")) - cover_cost


def market_value_for_position(
    *,
    player: Player,
    fundamental_price: Decimal,
    shares: Decimal,
    basis_amount: Decimal,
    market_bias: Decimal,
) -> Decimal:
    if shares > 0:
        return current_proceeds_to_sell(
            player,
            fundamental_price=fundamental_price,
            qty=shares,
            market_bias=market_bias,
        )
    if shares < 0:
        executed_spot_price = canonical_executed_spot_price(
            player=player,
            fundamental_price=fundamental_price,
            next_market_bias=market_bias + abs(shares),
        )
        return short_position_close_value(
            qty=abs(shares),
            basis_amount=basis_amount,
            executed_spot_price=executed_spot_price,
        )
    return Decimal("0")


def mark_to_market_value_for_position(
    *,
    shares: Decimal,
    mark_basis_amount: Decimal,
    spot_price: Decimal,
) -> Decimal:
    if shares > 0:
        return shares * spot_price
    if shares < 0:
        return (mark_basis_amount * Decimal("2")) - (abs(shares) * spot_price)
    return Decimal("0")


def basis_amount_closed_pro_rata(
    *,
    basis_amount: Decimal,
    shares_before: Decimal,
    shares_closed: Decimal,
) -> Decimal:
    abs_before = abs(shares_before)
    abs_closed = abs(shares_closed)
    if basis_amount <= 0 or abs_before <= 0 or abs_closed <= 0:
        return Decimal("0")
    if abs_closed >= abs_before:
        return basis_amount
    return basis_amount * abs_closed / abs_before


def reduce_basis_pro_rata(*, basis_amount: Decimal, shares_before: Decimal, shares_closed: Decimal) -> Decimal:
    abs_before = abs(shares_before)
    abs_closed = abs(shares_closed)
    if basis_amount <= 0 or abs_before <= 0 or abs_closed <= 0:
        return basis_amount
    if abs_closed >= abs_before:
        return Decimal("0")
    return basis_amount - (basis_amount * abs_closed / abs_before)


def remark_open_holding_to_current_spot(
    *,
    holding: Holding,
    shares_owned: Decimal,
    current_spot: Decimal,
) -> None:
    abs_shares = abs(shares_owned)
    if abs_shares <= 0:
        holding.entry_basis_amount = 0.0
        holding.mark_basis_amount = 0.0
        return
    current_notional = abs_shares * current_spot
    holding.entry_basis_amount = float(current_notional)
    holding.mark_basis_amount = float(current_notional)


@dataclass
class AuthContext:
    user: User
    session: UserSession


@dataclass
class ParsedStatRow:
    row_number: int
    status: str
    input_name: str
    input_team: str | None
    player_id: int | None
    matched_name: str | None
    matched_team: str | None
    week: int | None
    fantasy_points: float | None
    existing_points: float | None
    delta_points: float | None
    game_id: str | None = None
    game_label: str | None = None
    game_status: str | None = None
    game_fantasy_points: float | None = None
    season_fantasy_points: float | None = None
    message: str | None = None


@app.on_event("startup")
def on_startup():
    global APP_READY
    init_db()
    db = SessionLocal()
    try:
        seed(db)
        set_price_impact_multiplier(
            load_decimal_system_setting(
                db,
                key=PRICE_IMPACT_SETTING_KEY,
                default=DEFAULT_PRICE_IMPACT_MULTIPLIER,
            )
        )
        ensure_initial_price_history(db)
    finally:
        db.close()
    APP_READY = True


@app.get("/health", response_model=dict)
def healthcheck():
    return {"ok": True}


@app.get("/ready", response_model=dict)
def readiness_check(db: Session = Depends(get_db)):
    if not APP_READY:
        raise HTTPException(status_code=503, detail="Application startup is not complete.")
    db.execute(select(1)).scalar_one()
    return {"ok": True, "db": "ok"}


def normalize_username(raw_username: str | None) -> str:
    username = (raw_username or "").strip()
    if not username:
        raise HTTPException(400, "username is required")
    if not VALID_USERNAME.match(username):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid username. Use letters, numbers, underscore, or hyphen "
                "(max 64 chars)."
            ),
        )
    return username


def username_lookup_key(raw_username: str | None) -> str:
    return normalize_username(raw_username).lower()


def slugify_bot_name(raw_name: str | None) -> str:
    collapsed = re.sub(r"[^a-z0-9_-]+", "-", (raw_name or "").strip().lower())
    collapsed = re.sub(r"-{2,}", "-", collapsed).strip("-_")
    if not collapsed:
        collapsed = "bot"
    return collapsed[:48]


def normalize_bot_name(raw_name: str | None) -> str:
    name = " ".join((raw_name or "").strip().split())
    if not name:
        raise HTTPException(400, "Bot name is required.")
    if len(name) > 64:
        raise HTTPException(400, "Bot name must be 64 characters or fewer.")
    return name


def normalize_bot_persona(raw_persona: str | None) -> str:
    persona = (raw_persona or "").strip().lower()
    if persona not in BOT_PERSONA_CATALOG:
        raise HTTPException(400, "Invalid bot persona.")
    return persona


def unique_bot_username(db: Session, raw_name: str, *, exclude_bot_id: int | None = None) -> str:
    base_username = normalize_username(f"bot_{slugify_bot_name(raw_name)}")
    candidate = base_username
    suffix = 2
    while True:
        stmt = select(BotProfile).where(BotProfile.username == candidate)
        existing_bot = db.execute(stmt).scalar_one_or_none()
        if not existing_bot or (exclude_bot_id is not None and int(existing_bot.id) == exclude_bot_id):
            return candidate
        candidate = normalize_username(f"{base_username[:58]}-{suffix}")
        suffix += 1


def normalize_email(raw_email: str | None) -> str:
    email = (raw_email or "").strip().lower()
    if not email:
        raise HTTPException(400, "email is required")
    if len(email) > 320 or not VALID_EMAIL.match(email):
        raise HTTPException(400, "Invalid email address.")
    return email


def normalize_login_identifier(raw_identifier: str | None) -> str:
    identifier = (raw_identifier or "").strip()
    if not identifier:
        raise HTTPException(400, "username or email is required")
    return normalize_email(identifier) if "@" in identifier else username_lookup_key(identifier)


def normalize_password_reset_token(raw_token: str | None) -> str:
    token = (raw_token or "").strip()
    if not token:
        raise HTTPException(400, "Reset token is required.")
    return token


def normalize_sport_code(raw_sport: str | None, default: str = "NFL") -> str:
    sport = (raw_sport or default).strip().upper()
    if not sport:
        return default
    if not VALID_SPORT_CODE.match(sport):
        raise HTTPException(400, "Invalid sport code.")
    return sport


def normalize_player_name(raw_name: str | None) -> str:
    normalized = " ".join((raw_name or "").strip().split())
    if not normalized:
        raise HTTPException(400, "Player name is required.")
    if len(normalized) > 128:
        raise HTTPException(400, "Player name must be 128 characters or fewer.")
    return normalized


def normalize_player_team_code(*, sport_code: str, raw_team: str | None) -> str:
    normalized = normalize_optional_profile_field(raw_team)
    if not normalized:
        raise HTTPException(400, "Team code is required.")
    condensed = "".join(ch for ch in normalized.upper() if ch.isalnum())
    if sport_code == "MLB":
        condensed = normalize_mlb_team_code(condensed) or condensed
    if not condensed or len(condensed) > 8:
        raise HTTPException(400, "Team code must contain 1-8 letters or numbers.")
    return condensed


def normalize_player_position_code(raw_position: str | None) -> str:
    normalized = normalize_optional_profile_field(raw_position)
    if not normalized:
        raise HTTPException(400, "Position code is required.")
    condensed = "".join(ch for ch in normalized.upper() if ch.isalnum())
    if not condensed or len(condensed) > 8:
        raise HTTPException(400, "Position code must contain 1-8 letters or numbers.")
    return condensed


def client_ip_from_request(request: Request) -> str:
    forwarded_for = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded_for:
        first_ip = forwarded_for.split(",")[0].strip()
        if first_ip:
            return first_ip
    real_ip = (request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def enforce_rate_limit(*, key: str, limit: int, window_seconds: int, label: str) -> None:
    allowed, retry_after_seconds = RATE_LIMITER.allow(
        key,
        limit=max(1, int(limit)),
        window_seconds=max(1, int(window_seconds)),
    )
    if allowed:
        return
    raise HTTPException(
        status_code=429,
        detail=f"Rate limit exceeded for {label}. Try again in {retry_after_seconds} seconds.",
        headers={"Retry-After": str(retry_after_seconds)},
    )


def build_cache_key(*parts: object) -> str:
    normalized_parts: list[str] = ["v3"]
    for part in parts:
        text = str(part).strip()
        normalized_parts.append(text or "-")
    return "|".join(normalized_parts)


def get_cached_json(key: str) -> object | None:
    return CACHE.get_json(key)


def set_cached_json(key: str, value: object, *, ttl_seconds: int) -> object:
    encoded = jsonable_encoder(value)
    CACHE.set_json(key, encoded, ttl_seconds)
    return value


def invalidate_cache_keys(*keys: str) -> None:
    normalized = [str(key).strip() for key in keys if str(key).strip()]
    if normalized:
        CACHE.delete_keys(normalized)


def invalidate_cache_prefixes(*prefixes: str) -> None:
    normalized = [str(prefix).strip() for prefix in prefixes if str(prefix).strip()]
    if normalized:
        CACHE.delete_prefixes(normalized)


def invalidate_market_read_cache(
    *,
    player_ids: set[int] | list[int] | tuple[int, ...] = (),
    sports: set[str] | list[str] | tuple[str, ...] = (),
    include_sports_catalog: bool = False,
) -> None:
    normalized_sports = {
        normalize_sport_code(sport)
        for sport in sports
        if str(sport).strip()
    }
    normalized_player_ids = {int(player_id) for player_id in player_ids}

    keys = [build_cache_key("players", "ALL"), build_cache_key("live_games", "ALL")]
    prefixes = [
        build_cache_key("market_movers"),
    ]
    if include_sports_catalog:
        keys.append(build_cache_key("sports"))
    for sport_code in normalized_sports:
        keys.append(build_cache_key("players", sport_code))
        keys.append(build_cache_key("live_games", sport_code))
    for player_id in normalized_player_ids:
        keys.append(build_cache_key("player", player_id))
        prefixes.append(build_cache_key("player_history", player_id))
        prefixes.append(build_cache_key("player_game_history", player_id))

    invalidate_cache_keys(*keys)
    invalidate_cache_prefixes(*prefixes)


def rebuild_players_from_open_holdings(
    db: Session,
    *,
    player_ids: set[int] | list[int] | tuple[int, ...],
    source: str,
) -> tuple[set[int], set[str]]:
    normalized_player_ids = sorted({int(player_id) for player_id in player_ids})
    if not normalized_player_ids:
        return set(), set()

    players = db.execute(
        select(Player).where(Player.id.in_(normalized_player_ids)).order_by(Player.id.asc())
    ).scalars().all()
    if not players:
        return set(), set()

    share_rows = db.execute(
        select(Holding.player_id, func.sum(Holding.shares_owned))
        .where(
            Holding.player_id.in_(normalized_player_ids),
            Holding.shares_owned != 0,
        )
        .group_by(Holding.player_id)
    ).all()
    shares_by_player_id = {
        int(player_id): Decimal(str(total_shares or 0))
        for player_id, total_shares in share_rows
    }
    stats_snapshot = get_stats_snapshot_by_player(db, normalized_player_ids)
    touched_players: set[int] = set()
    touched_sports: set[str] = set()

    for player in players:
        player_id = int(player.id)
        net_open_shares = shares_by_player_id.get(player_id, Decimal("0"))
        previous_total_shares = Decimal(str(player.total_shares or 0))
        previous_market_bias = current_market_bias(player)
        if previous_total_shares != net_open_shares or previous_market_bias != net_open_shares:
            touched_players.add(player_id)
            touched_sports.add(str(player.sport))
        player.total_shares = float(net_open_shares)
        set_market_bias(player, bias=net_open_shares)
        fundamental_price, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        add_price_point(
            db=db,
            player=player,
            source=source,
            fundamental_price=fundamental_price,
            points_to_date=points_to_date,
            latest_week=latest_week,
        )

    return touched_players, touched_sports


def enforce_ip_rate_limit(
    request: Request,
    *,
    bucket: str,
    limit: int,
    window_seconds: int,
    label: str,
) -> None:
    ip = client_ip_from_request(request)
    enforce_rate_limit(
        key=f"{bucket}:ip:{ip}",
        limit=limit,
        window_seconds=window_seconds,
        label=label,
    )


def enforce_user_rate_limit(
    user_id: int,
    *,
    bucket: str,
    limit: int,
    window_seconds: int,
    label: str,
) -> None:
    enforce_rate_limit(
        key=f"{bucket}:user:{int(user_id)}",
        limit=limit,
        window_seconds=window_seconds,
        label=label,
    )


def validate_registration_request(payload: AuthRegisterIn) -> None:
    honeypot = (payload.contact_email or "").strip()
    if honeypot:
        raise HTTPException(400, "Invalid registration request.")

    if REGISTER_MIN_SUBMIT_MS <= 0:
        return

    started_at_ms = payload.form_started_at_ms
    if started_at_ms is None:
        raise HTTPException(400, "Invalid registration request.")

    now_ms = int(chicago_now().timestamp() * 1000)
    elapsed_ms = now_ms - int(started_at_ms)
    if elapsed_ms < REGISTER_MIN_SUBMIT_MS or elapsed_ms > 86_400_000:
        raise HTTPException(400, "Invalid registration request.")


def revoke_password_reset_tokens_for_user(db: Session, user_id: int, *, used_at: datetime | None = None) -> None:
    timestamp = used_at or chicago_now()
    tokens = db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == int(user_id),
            PasswordResetToken.used_at.is_(None),
        )
    ).scalars().all()
    for token in tokens:
        token.used_at = timestamp


def revoke_active_sessions_for_user(db: Session, user_id: int, *, revoked_at: datetime | None = None) -> None:
    timestamp = revoked_at or chicago_now()
    sessions = db.execute(
        select(UserSession).where(
            UserSession.user_id == int(user_id),
            UserSession.revoked_at.is_(None),
        )
    ).scalars().all()
    for session in sessions:
        session.revoked_at = timestamp


def password_reset_preview_url(token: str) -> str:
    separator = "&" if "?" in PASSWORD_RESET_BASE_URL else "?"
    return f"{PASSWORD_RESET_BASE_URL}{separator}reset_token={token}"


def send_password_reset_email(*, to_email: str, token: str) -> bool:
    if not SMTP_SETTINGS.enabled:
        return False
    message = build_password_reset_email(
        to_email=to_email,
        from_name=SMTP_SETTINGS.from_name,
        from_email=SMTP_SETTINGS.from_email,
        reset_url=password_reset_preview_url(token),
        expiry_minutes=PASSWORD_RESET_TTL_MINUTES,
    )
    try:
        send_smtp_message(SMTP_SETTINGS, message, recipients=[to_email])
    except (OSError, smtplib.SMTPException) as exc:
        print(f"password reset email delivery failed for {to_email}: {exc}")
        return False
    return True


def player_is_listed(player: Player) -> bool:
    return bool(getattr(player, "ipo_open", False))


def ensure_player_is_listed_or_raise(player: Player) -> None:
    if player_is_listed(player):
        return
    raise HTTPException(
        status_code=403,
        detail=(
            f"{str(player.sport)} IPO is not launched yet. "
            "Trading is disabled until an admin launches IPO."
        ),
    )


def ensure_trading_control_row(
    db: Session,
    sport: str,
    *,
    for_update: bool = False,
) -> TradingControl:
    stmt = select(TradingControl).where(TradingControl.sport == sport)
    if for_update:
        stmt = stmt.with_for_update()
    row = db.execute(stmt).scalar_one_or_none()
    if row:
        return row

    now = chicago_now()
    row = TradingControl(
        sport=sport,
        halted=False,
        reason=None,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def trading_halt_state_to_out(row: TradingControl) -> TradingHaltStateOut:
    return TradingHaltStateOut(
        sport=str(row.sport),
        halted=bool(row.halted),
        reason=normalize_optional_profile_field(row.reason),
        updated_at=row.updated_at or chicago_now(),
    )


def build_trading_status_out(db: Session) -> TradingStatusOut:
    all_rows = db.execute(select(TradingControl).order_by(TradingControl.sport.asc())).scalars().all()
    by_sport: dict[str, TradingControl] = {str(row.sport).upper(): row for row in all_rows}

    global_row = by_sport.get(GLOBAL_TRADING_CONTROL_SPORT)
    if not global_row:
        global_row = ensure_trading_control_row(db, GLOBAL_TRADING_CONTROL_SPORT, for_update=False)
        db.flush()

    sport_halts: list[TradingHaltStateOut] = []
    for sport, row in sorted(by_sport.items(), key=lambda item: item[0]):
        if sport == GLOBAL_TRADING_CONTROL_SPORT:
            continue
        sport_halts.append(trading_halt_state_to_out(row))

    return TradingStatusOut(
        global_halt=trading_halt_state_to_out(global_row),
        sport_halts=sport_halts,
    )


def ensure_trading_allowed_or_raise(db: Session, sport: str) -> None:
    sport_code = normalize_sport_code(sport)
    rows = db.execute(
        select(TradingControl).where(
            TradingControl.halted.is_(True),
            TradingControl.sport.in_([GLOBAL_TRADING_CONTROL_SPORT, sport_code]),
        )
    ).scalars().all()
    if not rows:
        return

    global_row = next((row for row in rows if str(row.sport).upper() == GLOBAL_TRADING_CONTROL_SPORT), None)
    if global_row:
        reason = normalize_optional_profile_field(global_row.reason)
        detail = "Trading is temporarily halted across all sports."
        if reason:
            detail += f" Reason: {reason}"
        raise HTTPException(status_code=403, detail=detail)

    sport_row = next((row for row in rows if str(row.sport).upper() == sport_code), None)
    if sport_row:
        reason = normalize_optional_profile_field(sport_row.reason)
        detail = f"Trading is temporarily halted for {sport_code}."
        if reason:
            detail += f" Reason: {reason}"
        raise HTTPException(status_code=403, detail=detail)


def auth_exception(detail: str = "Authentication required.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_bearer_token(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> str:
    if not authorization:
        raise auth_exception()
    scheme, _, token = authorization.partition(" ")
    if scheme.strip().lower() != "bearer" or not token.strip():
        raise auth_exception("Invalid authorization header.")
    return token.strip()


def get_user_by_username_or_raise(
    db: Session,
    username: str,
    for_update: bool = False,
) -> User:
    stmt = select(User).where(func.lower(User.username) == username_lookup_key(username))
    if for_update:
        stmt = stmt.with_for_update()
    user = db.execute(stmt).scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=404,
            detail=f"User '{username}' not found.",
        )
    return user


def get_user_by_id_or_raise(
    db: Session,
    user_id: int,
    for_update: bool = False,
) -> User:
    stmt = select(User).where(User.id == user_id)
    if for_update:
        stmt = stmt.with_for_update()
    user = db.execute(stmt).scalar_one_or_none()
    if not user:
        raise auth_exception("User not found.")
    return user


def get_auth_context(
    bearer_token: str = Depends(get_bearer_token),
    db: Session = Depends(get_db),
) -> AuthContext:
    session = db.execute(
        select(UserSession).where(
            UserSession.token_hash == hash_session_token(bearer_token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > chicago_now(),
        )
    ).scalar_one_or_none()
    if not session:
        raise auth_exception("Session is invalid or expired.")
    user = get_user_by_id_or_raise(
        db=db,
        user_id=int(session.user_id),
        for_update=False,
    )
    return AuthContext(user=user, session=session)


def get_admin_context(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
    username = str(auth.user.username).strip().lower()
    if username not in ADMIN_USERNAMES:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return auth


PRICE_IMPACT_SETTING_KEY = "price_impact_multiplier"
HOME_HOW_TO_USE_SETTING_KEY = "home_how_to_use_steps_json"
DEFAULT_HOME_HOW_TO_USE_STEPS: tuple[dict[str, str], ...] = (
    {
        "title": "What Is Matchup Market?",
        "body": (
            "Matchup Market is a sports market game where you can buy and short shares of players based on how you "
            "think their fantasy value will change. If you believe a player's value is going to rise, you can buy "
            "shares. If you think a player's value may fall, you can short shares and benefit if the price drops. "
            "It is a simple and competitive game where you can use your sports knowledge."
        ),
    },
    {
        "title": "Browse And Buy Shares",
        "body": (
            "Find players you know, compare prices, and buy shares when you think a player's value will rise."
        ),
    },
    {
        "title": "Manage Your Portfolio",
        "body": (
            "You can sell your positions to lock in gains, reduce risk, or free up space for new opportunities. Your "
            "portfolio shows how your decisions are performing over time."
        ),
    },
    {
        "title": "Grow Your Portfolio",
        "body": (
            "The goal of Matchup Market is to grow your portfolio over time. As your portfolio value increases, you "
            "can invest in more players, build a stronger strategy, and take advantage of more opportunities across "
            "the market.\n\nThe more value you build, the higher you can climb on the leaderboard and the closer you "
            "get to the top."
        ),
    },
    {
        "title": "Why People Use Matchup Market",
        "body": (
            "Matchup Market gives fans a fun way to do more than just watch the games. You can make predictions, act "
            "on your opinions, and compete against other users in a fun and competitive game. Whether you are new to "
            "fantasy sports or already know the players well, Matchup Market makes it easy to get started."
        ),
    },
)


def load_decimal_system_setting(
    db: Session,
    *,
    key: str,
    default: Decimal,
) -> Decimal:
    row = db.execute(
        select(SystemSetting).where(SystemSetting.key == key)
    ).scalar_one_or_none()
    if row is None:
        return default
    try:
        return Decimal(str(row.value))
    except Exception:
        return default


def upsert_decimal_system_setting(
    db: Session,
    *,
    key: str,
    value: Decimal,
) -> Decimal:
    normalized_value = max(Decimal("0.000001"), value)
    row = db.execute(
        select(SystemSetting).where(SystemSetting.key == key).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        row = SystemSetting(key=key, value=str(normalized_value))
        db.add(row)
    else:
        row.value = str(normalized_value)
    return normalized_value


def load_text_system_setting(
    db: Session,
    *,
    key: str,
) -> str | None:
    row = db.execute(
        select(SystemSetting).where(SystemSetting.key == key)
    ).scalar_one_or_none()
    if row is None:
        return None
    return str(row.value or "")


def upsert_text_system_setting(
    db: Session,
    *,
    key: str,
    value: str,
) -> str:
    normalized_value = str(value)
    row = db.execute(
        select(SystemSetting).where(SystemSetting.key == key).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        row = SystemSetting(key=key, value=normalized_value)
        db.add(row)
    else:
        row.value = normalized_value
    return normalized_value


def home_how_to_default_steps() -> list[HomeHowToStepOut]:
    return [
        HomeHowToStepOut(title=str(step["title"]), body=str(step["body"]))
        for step in DEFAULT_HOME_HOW_TO_USE_STEPS
    ]


def normalize_home_how_to_steps(raw_steps: object) -> list[HomeHowToStepOut]:
    if not isinstance(raw_steps, list):
        return []
    normalized: list[HomeHowToStepOut] = []
    for item in raw_steps:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        body = str(item.get("body", "")).strip()
        if not title or not body:
            continue
        normalized.append(HomeHowToStepOut(title=title[:120], body=body[:5000]))
    return normalized[:24]


def load_home_how_to_steps(db: Session) -> list[HomeHowToStepOut]:
    stored_value = load_text_system_setting(db, key=HOME_HOW_TO_USE_SETTING_KEY)
    if stored_value is None or not stored_value.strip():
        return home_how_to_default_steps()
    try:
        payload = json.loads(stored_value)
    except Exception:
        return home_how_to_default_steps()
    normalized = normalize_home_how_to_steps(payload)
    return normalized if normalized else home_how_to_default_steps()


def save_home_how_to_steps(db: Session, steps: list[HomeHowToStepOut]) -> list[HomeHowToStepOut]:
    normalized = normalize_home_how_to_steps([step.model_dump() for step in steps])
    if not normalized:
        raise HTTPException(400, "At least one valid step is required.")
    upsert_text_system_setting(
        db,
        key=HOME_HOW_TO_USE_SETTING_KEY,
        value=json.dumps([step.model_dump() for step in normalized], ensure_ascii=True),
    )
    return normalized


def normalize_text(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def season_progress_units_for_sport(sport: str | None) -> int:
    sport_code = (sport or "").strip().upper()
    return max(1, SPORT_SEASON_PROGRESS_UNITS.get(sport_code, DEFAULT_SEASON_PROGRESS_UNITS))


def is_mlb_starting_pitcher(player: Player) -> bool:
    return str(player.sport).strip().upper() == "MLB" and str(player.position).strip().upper() == "SP"


def season_progress_units_for_player(player: Player) -> int:
    if is_mlb_starting_pitcher(player):
        return max(1, MLB_STARTING_PITCHER_SEASON_STARTS)
    return season_progress_units_for_sport(player.sport)


def projection_replacement_units_for_player(player: Player, snapshot: PlayerStatsSnapshot) -> int:
    if is_mlb_starting_pitcher(player):
        rotation_games = max(1, MLB_STARTING_PITCHER_ROTATION_GAMES)
        actual_starts = max(0, int(snapshot.latest_week))
        expected_starts_elapsed = max(0, int(snapshot.team_games_played)) // rotation_games
        missed_start_failsafe = min(expected_starts_elapsed, actual_starts + 1)
        return max(actual_starts, missed_start_failsafe)
    return max(0, int(snapshot.team_games_played))


def game_label_mentions_team(game_label: object, team: object) -> bool:
    normalized_team = str(team or "").strip().upper()
    if not normalized_team:
        return True
    normalized_label = str(game_label or "").strip().upper()
    if not normalized_label:
        return True
    return re.search(rf"(^|[^A-Z0-9]){re.escape(normalized_team)}([^A-Z0-9]|$)", normalized_label) is not None


def detect_column(sample_row: dict[str, str], candidates: tuple[str, ...]) -> str:
    keys_by_normalized = {normalize_text(key): key for key in sample_row.keys()}
    for candidate in candidates:
        found = keys_by_normalized.get(normalize_text(candidate))
        if found:
            return found
    return ""


def parse_optional_float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = float(text)
    except ValueError:
        return None
    return parsed


def resolve_mlb_backfill_player(
    *,
    row: MlbIncomingStat,
    by_name_team: dict[tuple[str, str], Player],
    by_name: dict[str, list[Player]],
) -> Player | None:
    key_name = normalize_mlb_lookup_text(row.name)
    key_team = normalize_mlb_team_code(row.team)
    if key_name and key_team:
        direct = by_name_team.get((key_name, key_team))
        if direct:
            return direct

    matches = by_name.get(key_name, [])
    if len(matches) == 1:
        return matches[0]
    return None


def iter_inclusive_dates(start_date: date, end_date: date):
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


def parse_stats_csv(
    db: Session,
    csv_text: str,
    week_override: int | None,
) -> list[ParsedStatRow]:
    stream = io.StringIO(csv_text)
    reader = csv.DictReader(stream)
    rows = list(reader)
    if not rows:
        raise HTTPException(400, "CSV has no rows.")

    sample = rows[0]
    col_name = detect_column(sample, ("player_name", "name", "player"))
    col_team = detect_column(sample, ("team", "team_abbr", "team_code"))
    col_week = detect_column(sample, ("week",))
    col_points = detect_column(sample, ("fantasy_points", "points", "fpts", "half_ppr_points"))
    col_game_id = detect_column(sample, ("game_id", "live_game_id", "event_id"))
    col_game_label = detect_column(sample, ("game_label", "live_game_label", "matchup", "game"))
    col_game_status = detect_column(sample, ("game_status", "live_game_status", "status"))
    col_game_points = detect_column(
        sample,
        ("game_fantasy_points", "live_game_fantasy_points", "current_fantasy_points", "fantasy_points_game"),
    )
    col_season_points = detect_column(
        sample,
        ("season_fantasy_points", "points_to_date", "season_points", "total_points"),
    )

    if not col_name or not col_points:
        raise HTTPException(
            400,
            "CSV must include player name and fantasy points columns.",
        )

    players = db.execute(select(Player)).scalars().all()
    by_name_team: dict[tuple[str, str], Player] = {}
    by_name: dict[str, list[Player]] = {}
    for player in players:
        key_name = normalize_text(str(player.name))
        key_team = normalize_text(str(player.team))
        by_name_team[(key_name, key_team)] = player
        by_name.setdefault(key_name, []).append(player)

    parsed: list[ParsedStatRow] = []
    seen_import_rows: set[tuple[int, int, str | None]] = set()

    for row_number, row in enumerate(rows, start=2):
        input_name = str(row.get(col_name, "")).strip()
        input_team = str(row.get(col_team, "")).strip() if col_team else ""
        points_raw = str(row.get(col_points, "")).strip()
        game_id = normalize_optional_profile_field(row.get(col_game_id)) if col_game_id else None
        game_label = normalize_optional_profile_field(row.get(col_game_label)) if col_game_label else None
        game_status = normalize_optional_profile_field(row.get(col_game_status)) if col_game_status else None

        if not input_name or not points_raw:
            parsed.append(
                ParsedStatRow(
                    row_number=row_number,
                    status="SKIPPED",
                    input_name=input_name,
                    input_team=input_team or None,
                    player_id=None,
                    matched_name=None,
                    matched_team=None,
                    week=week_override,
                    fantasy_points=None,
                    existing_points=None,
                    delta_points=None,
                    game_id=game_id,
                    game_label=game_label,
                    game_status=game_status,
                    message="Missing player name or fantasy points.",
                )
            )
            continue

        row_week: int | None = week_override
        if row_week is None:
            if not col_week:
                parsed.append(
                    ParsedStatRow(
                        row_number=row_number,
                        status="ERROR",
                        input_name=input_name,
                        input_team=input_team or None,
                        player_id=None,
                        matched_name=None,
                        matched_team=None,
                        week=None,
                        fantasy_points=None,
                        existing_points=None,
                        delta_points=None,
                        game_id=game_id,
                        game_label=game_label,
                        game_status=game_status,
                        message="Missing week and no week override supplied.",
                    )
                )
                continue
            try:
                row_week = int(str(row.get(col_week, "")).strip())
                if row_week < 1:
                    raise ValueError
            except ValueError:
                parsed.append(
                    ParsedStatRow(
                        row_number=row_number,
                        status="ERROR",
                        input_name=input_name,
                        input_team=input_team or None,
                        player_id=None,
                        matched_name=None,
                        matched_team=None,
                        week=None,
                        fantasy_points=None,
                        existing_points=None,
                        delta_points=None,
                        game_id=game_id,
                        game_label=game_label,
                        game_status=game_status,
                        message="Invalid week value.",
                    )
                )
                continue

        try:
            fantasy_points = float(points_raw)
        except ValueError:
            parsed.append(
                ParsedStatRow(
                    row_number=row_number,
                    status="ERROR",
                    input_name=input_name,
                    input_team=input_team or None,
                    player_id=None,
                    matched_name=None,
                    matched_team=None,
                    week=row_week,
                    fantasy_points=None,
                    existing_points=None,
                    delta_points=None,
                    game_id=game_id,
                    game_label=game_label,
                    game_status=game_status,
                    message="Invalid fantasy points value.",
                )
            )
            continue

        game_fantasy_points = parse_optional_float(row.get(col_game_points)) if col_game_points else None
        season_fantasy_points = parse_optional_float(row.get(col_season_points)) if col_season_points else None
        if col_game_points and row.get(col_game_points) not in (None, "") and game_fantasy_points is None:
            parsed.append(
                ParsedStatRow(
                    row_number=row_number,
                    status="ERROR",
                    input_name=input_name,
                    input_team=input_team or None,
                    player_id=None,
                    matched_name=None,
                    matched_team=None,
                    week=row_week,
                    fantasy_points=float(fantasy_points),
                    existing_points=None,
                    delta_points=None,
                    game_id=game_id,
                    game_label=game_label,
                    game_status=game_status,
                    message="Invalid game fantasy points value.",
                )
            )
            continue
        if col_season_points and row.get(col_season_points) not in (None, "") and season_fantasy_points is None:
            parsed.append(
                ParsedStatRow(
                    row_number=row_number,
                    status="ERROR",
                    input_name=input_name,
                    input_team=input_team or None,
                    player_id=None,
                    matched_name=None,
                    matched_team=None,
                    week=row_week,
                    fantasy_points=float(fantasy_points),
                    existing_points=None,
                    delta_points=None,
                    game_id=game_id,
                    game_label=game_label,
                    game_status=game_status,
                    game_fantasy_points=game_fantasy_points,
                    message="Invalid season fantasy points value.",
                )
            )
            continue

        key_name = normalize_text(input_name)
        key_team = normalize_text(input_team)

        matched_player: Player | None = None
        if key_name and key_team:
            matched_player = by_name_team.get((key_name, key_team))

        if not matched_player:
            matches = by_name.get(key_name, [])
            if len(matches) == 1:
                matched_player = matches[0]

        if not matched_player:
            parsed.append(
                ParsedStatRow(
                    row_number=row_number,
                    status="ERROR",
                    input_name=input_name,
                    input_team=input_team or None,
                    player_id=None,
                    matched_name=None,
                    matched_team=None,
                    week=row_week,
                    fantasy_points=fantasy_points,
                    existing_points=None,
                    delta_points=None,
                    game_id=game_id,
                    game_label=game_label,
                    game_status=game_status,
                    game_fantasy_points=game_fantasy_points,
                    season_fantasy_points=season_fantasy_points,
                    message="No unique player match found.",
                )
            )
            continue

        dedupe_key = (int(matched_player.id), int(row_week), game_id)
        if dedupe_key in seen_import_rows:
            parsed.append(
                ParsedStatRow(
                    row_number=row_number,
                    status="ERROR",
                    input_name=input_name,
                    input_team=input_team or None,
                    player_id=int(matched_player.id),
                    matched_name=str(matched_player.name),
                    matched_team=str(matched_player.team),
                    week=row_week,
                    fantasy_points=fantasy_points,
                    existing_points=None,
                    delta_points=None,
                    game_id=game_id,
                    game_label=game_label,
                    game_status=game_status,
                    game_fantasy_points=game_fantasy_points,
                    season_fantasy_points=season_fantasy_points,
                    message=(
                        "Duplicate player/week/game row in CSV."
                        if game_id
                        else "Duplicate player/week row in CSV. Add a game_id to import multiple games in one week."
                    ),
                )
            )
            continue
        seen_import_rows.add(dedupe_key)

        existing_points: float | None = None
        if game_id:
            existing_game = db.execute(
                select(PlayerGamePoint).where(
                    PlayerGamePoint.player_id == matched_player.id,
                    PlayerGamePoint.game_id == game_id,
                )
            ).scalar_one_or_none()
            existing_points = float(existing_game.game_fantasy_points) if existing_game else None
        else:
            existing = db.execute(
                select(WeeklyStat).where(
                    WeeklyStat.player_id == matched_player.id,
                    WeeklyStat.week == row_week,
                )
            ).scalar_one_or_none()
            existing_points = float(existing.fantasy_points) if existing else None
        delta_points = (
            float((game_fantasy_points if game_id and game_fantasy_points is not None else fantasy_points) - existing_points)
            if existing_points is not None
            else float(game_fantasy_points if game_id and game_fantasy_points is not None else fantasy_points)
        )

        parsed.append(
            ParsedStatRow(
                row_number=row_number,
                status="READY",
                input_name=input_name,
                input_team=input_team or None,
                player_id=int(matched_player.id),
                matched_name=str(matched_player.name),
                matched_team=str(matched_player.team),
                week=row_week,
                fantasy_points=float(fantasy_points),
                existing_points=existing_points,
                delta_points=delta_points,
                game_id=game_id,
                game_label=game_label,
                game_status=game_status,
                game_fantasy_points=game_fantasy_points,
                season_fantasy_points=season_fantasy_points,
                message=None,
            )
        )

    return parsed


def parsed_rows_to_preview(rows: list[ParsedStatRow]) -> AdminStatsPreviewOut:
    ready_count = sum(1 for row in rows if row.status == "READY")
    skipped_count = sum(1 for row in rows if row.status == "SKIPPED")
    error_count = sum(1 for row in rows if row.status == "ERROR")
    return AdminStatsPreviewOut(
        total_rows=len(rows),
        ready_count=ready_count,
        skipped_count=skipped_count,
        error_count=error_count,
        rows=[
            AdminStatsPreviewRow(
                row_number=row.row_number,
                status=row.status,
                input_name=row.input_name,
                input_team=row.input_team,
                player_id=row.player_id,
                matched_name=row.matched_name,
                matched_team=row.matched_team,
                week=row.week,
                fantasy_points=row.fantasy_points,
                existing_points=row.existing_points,
                delta_points=row.delta_points,
                message=row.message,
            )
            for row in rows
        ],
    )


def get_stats_snapshot_by_player(
    db: Session,
    player_ids: list[int],
) -> dict[int, PlayerStatsSnapshot]:
    if not player_ids:
        return {}

    player_meta_rows = db.execute(
        select(Player.id, Player.sport, Player.team, Player.position).where(Player.id.in_(player_ids))
    ).all()
    team_key_by_player_id: dict[int, tuple[str, str]] = {}
    is_mlb_starting_pitcher_by_player_id: dict[int, bool] = {}
    team_keys: set[tuple[str, str]] = set()
    for player_id, sport, team, position in player_meta_rows:
        team_key = (str(sport).strip().upper(), str(team).strip().upper())
        team_key_by_player_id[int(player_id)] = team_key
        is_mlb_starting_pitcher_by_player_id[int(player_id)] = (
            str(sport).strip().upper() == "MLB" and str(position).strip().upper() == "SP"
        )
        team_keys.add(team_key)

    team_games_played_by_key: dict[tuple[str, str], int] = {}
    if team_keys:
        sports = sorted({sport for sport, _ in team_keys if sport})
        teams = sorted({team for _, team in team_keys if team})
        if sports and teams:
            team_game_rows = db.execute(
                select(Player.sport, Player.team, PlayerGamePoint.game_id, PlayerGamePoint.game_label)
                .join(Player, Player.id == PlayerGamePoint.player_id)
                .where(
                    Player.sport.in_(sports),
                    Player.team.in_(teams),
                )
                .distinct()
            ).all()
            games_by_team_key: dict[tuple[str, str], set[str]] = defaultdict(set)
            for sport, team, game_id, game_label in team_game_rows:
                team_key = (str(sport).strip().upper(), str(team).strip().upper())
                if team_key not in team_keys:
                    continue
                if not game_label_mentions_team(game_label, team):
                    continue
                normalized_game_id = str(game_id).strip()
                if not normalized_game_id:
                    continue
                games_by_team_key[team_key].add(normalized_game_id)
            team_games_played_by_key = {
                team_key: len(game_ids)
                for team_key, game_ids in games_by_team_key.items()
            }

    snapshots: dict[int, PlayerStatsSnapshot] = {}
    game_rows = db.execute(
        select(
            PlayerGamePoint.player_id,
            PlayerGamePoint.game_id,
            PlayerGamePoint.game_fantasy_points,
            PlayerGamePoint.season_fantasy_points,
        )
        .where(PlayerGamePoint.player_id.in_(player_ids))
        .order_by(PlayerGamePoint.player_id.asc(), PlayerGamePoint.recorded_at.asc(), PlayerGamePoint.id.asc())
    ).all()

    game_rows_by_player: dict[int, list[tuple[str, Decimal, Decimal]]] = defaultdict(list)
    for player_id, game_id, game_fantasy_points, season_fantasy_points in game_rows:
        game_rows_by_player[int(player_id)].append(
            (
                str(game_id),
                Decimal(str(game_fantasy_points)),
                Decimal(str(season_fantasy_points)),
            )
        )

    players_with_game_history = set(game_rows_by_player.keys())
    for player_id, stat_rows in game_rows_by_player.items():
        latest_game_id, _, season_points = stat_rows[-1]
        projection_rows = (
            [row for row in stat_rows if abs(row[1]) > Decimal("0.000001")]
            if is_mlb_starting_pitcher_by_player_id.get(player_id, False)
            else stat_rows
        )
        recent_rows = projection_rows[-RECENT_FORM_WINDOW:]
        recent_points = sum((game_points for _, game_points, _ in recent_rows), Decimal("0"))
        player_game_rows = len(projection_rows)
        team_key = team_key_by_player_id.get(player_id)
        team_games_played = (
            team_games_played_by_key.get(team_key, len(stat_rows))
            if team_key is not None
            else len(stat_rows)
        )
        team_games_played = max(team_games_played, len(stat_rows), player_game_rows)
        snapshots[player_id] = PlayerStatsSnapshot(
            points_to_date=season_points,
            latest_week=player_game_rows,
            recent_points=recent_points,
            recent_sample_size=len(recent_rows),
            latest_game_id=latest_game_id,
            uses_game_history=True,
            team_games_played=team_games_played,
        )

    remaining_player_ids = [player_id for player_id in player_ids if player_id not in players_with_game_history]
    if not remaining_player_ids:
        return snapshots

    weekly_rows = db.execute(
        select(
            WeeklyStat.player_id,
            WeeklyStat.week,
            WeeklyStat.fantasy_points,
        )
        .where(WeeklyStat.player_id.in_(remaining_player_ids))
        .order_by(WeeklyStat.player_id.asc(), WeeklyStat.week.asc(), WeeklyStat.id.asc())
    ).all()

    weekly_rows_by_player: dict[int, list[tuple[int, Decimal]]] = defaultdict(list)
    for player_id, week, fantasy_points in weekly_rows:
        weekly_rows_by_player[int(player_id)].append((int(week), Decimal(str(fantasy_points))))

    for player_id, stat_rows in weekly_rows_by_player.items():
        points_to_date = sum((points for _, points in stat_rows), Decimal("0"))
        latest_week = max((week for week, _ in stat_rows), default=0)
        recent_rows = stat_rows[-RECENT_FORM_WINDOW:]
        recent_points = sum((points for _, points in recent_rows), Decimal("0"))
        team_key = team_key_by_player_id.get(player_id)
        team_games_played = (
            team_games_played_by_key.get(team_key, latest_week)
            if team_key is not None
            else latest_week
        )
        team_games_played = max(team_games_played, latest_week)
        snapshots[player_id] = PlayerStatsSnapshot(
            points_to_date=points_to_date,
            latest_week=latest_week,
            recent_points=recent_points,
            recent_sample_size=len(recent_rows),
            latest_game_id=None,
            uses_game_history=False,
            team_games_played=team_games_played,
        )

    # Ensure players with no direct stat rows still inherit team game progress.
    # This allows projected value to decay as team games are missed (e.g. injuries/DNPs).
    for player_id in player_ids:
        if player_id in snapshots:
            continue
        team_key = team_key_by_player_id.get(player_id)
        team_games_played = (
            team_games_played_by_key.get(team_key, 0)
            if team_key is not None
            else 0
        )
        snapshots[player_id] = PlayerStatsSnapshot(
            points_to_date=Decimal("0"),
            latest_week=0,
            recent_points=Decimal("0"),
            recent_sample_size=0,
            latest_game_id=None,
            uses_game_history=False,
            team_games_played=max(0, int(team_games_played)),
        )

    return snapshots


def get_aggregate_holdings_by_player(
    db: Session,
    player_ids: list[int],
) -> dict[int, tuple[Decimal, Decimal]]:
    if not player_ids:
        return {}

    rows = db.execute(
        select(Holding.player_id, Holding.shares_owned).where(
            Holding.player_id.in_(player_ids),
            Holding.shares_owned != 0,
        )
    ).all()

    totals: dict[int, tuple[Decimal, Decimal]] = {}
    for player_id, shares_owned in rows:
        key = int(player_id)
        held_total, short_total = totals.get(key, (Decimal("0"), Decimal("0")))
        shares = Decimal(str(shares_owned))
        if shares > 0:
            held_total += shares
        elif shares < 0:
            short_total += -shares
        totals[key] = (held_total, short_total)

    return totals


def get_pricing_context(
    player: Player,
    stats_snapshot: dict[int, PlayerStatsSnapshot],
) -> tuple[Decimal, Decimal, int]:
    projected_points = Decimal(str(player.base_price))
    snapshot = stats_snapshot.get(
        player.id,
        PlayerStatsSnapshot(
            points_to_date=Decimal("0"),
            latest_week=0,
            recent_points=Decimal("0"),
            recent_sample_size=0,
            latest_game_id=None,
            uses_game_history=False,
        ),
    )
    points_to_date = snapshot.points_to_date
    latest_week = snapshot.latest_week
    live_game_id = normalize_optional_profile_field(player.live_game_id)

    if bool(player.live_now) and player.live_game_fantasy_points is not None:
        should_overlay_live_points = not snapshot.uses_game_history
        if snapshot.uses_game_history and live_game_id and snapshot.latest_game_id:
            should_overlay_live_points = live_game_id != snapshot.latest_game_id
        if should_overlay_live_points:
            live_points = Decimal(str(player.live_game_fantasy_points)) * LIVE_POINTS_WEIGHT
            points_to_date += live_points
            if player.live_week is not None:
                latest_week = max(latest_week, int(player.live_week))
    season_units = season_progress_units_for_player(player)
    projection_units_elapsed = projection_replacement_units_for_player(player, snapshot)
    clamped_projection_units = min(max(int(projection_units_elapsed), 0), season_units)
    removed_projection = Decimal(clamped_projection_units) * (projected_points / Decimal(season_units))
    fundamental = max(Decimal("1"), projected_points - removed_projection + points_to_date)
    return fundamental, points_to_date, latest_week


def player_live_to_out(player: Player) -> PlayerLiveOut | None:
    if not bool(getattr(player, "live_now", False)):
        return None
    return PlayerLiveOut(
        live_now=True,
        week=int(player.live_week) if player.live_week is not None else None,
        game_id=(str(player.live_game_id).strip() if player.live_game_id else None) or None,
        game_label=(str(player.live_game_label).strip() if player.live_game_label else None) or None,
        game_status=(str(player.live_game_status).strip() if player.live_game_status else None) or None,
        game_stat_line=(str(player.live_game_stat_line).strip() if player.live_game_stat_line else None) or None,
        game_fantasy_points=(
            float(player.live_game_fantasy_points)
            if player.live_game_fantasy_points is not None
            else None
        ),
        updated_at=player.live_updated_at,
    )


def player_to_out(
    player: Player,
    fundamental_price: Decimal,
    points_to_date: Decimal,
    latest_week: int,
    shares_held: Decimal = Decimal("0"),
    shares_short: Decimal = Decimal("0"),
) -> PlayerOut:
    spot = current_spot_price(player, fundamental_price=fundamental_price)
    return PlayerOut(
        id=player.id,
        sport=str(player.sport),
        name=player.name,
        team=player.team,
        position=player.position,
        base_price=float(player.base_price),
        fundamental_price=float(fundamental_price),
        points_to_date=float(points_to_date),
        latest_week=latest_week,
        k=float(player.k),
        total_shares=float(player.total_shares),
        shares_held=float(shares_held),
        shares_short=float(shares_short),
        spot_price=float(spot),
        live=player_live_to_out(player),
    )


def add_price_point(
    db: Session,
    player: Player,
    source: str,
    fundamental_price: Decimal,
    points_to_date: Decimal,
    latest_week: int,
) -> None:
    spot = current_spot_price(player, fundamental_price=fundamental_price)
    db.add(
        PricePoint(
            player_id=player.id,
            source=source,
            fundamental_price=float(fundamental_price),
            spot_price=float(spot),
            total_shares=float(player.total_shares),
            points_to_date=float(points_to_date),
            latest_week=latest_week,
        )
    )


def sp_price_point_looks_cratered(
    player: Player,
    *,
    fundamental_price: Decimal,
    points_to_date: Decimal,
    latest_week: int | None = None,
) -> bool:
    if str(player.sport).strip().upper() != "MLB":
        return False
    if is_mlb_starting_pitcher(player):
        return fundamental_price <= max(Decimal("1"), points_to_date + Decimal("1"))
    return False


def sp_price_point_looks_overdecayed(
    player: Player,
    *,
    fundamental_price: Decimal,
    points_to_date: Decimal,
    latest_week: int | None = None,
) -> bool:
    if not is_mlb_starting_pitcher(player):
        return False
    actual_starts = max(0, int(latest_week or 0))
    base_price = Decimal(str(player.base_price))
    season_starts = max(1, MLB_STARTING_PITCHER_SEASON_STARTS)
    max_elapsed_starts = min(season_starts, actual_starts + 1)
    maximum_allowed_projection_decay = Decimal(max_elapsed_starts) * (base_price / Decimal(season_starts))
    minimum_fundamental = max(Decimal("1"), base_price - maximum_allowed_projection_decay + points_to_date)
    return fundamental_price < minimum_fundamental - Decimal("0.000001")


def sp_price_point_needs_sanitizing(
    player: Player,
    *,
    fundamental_price: Decimal,
    points_to_date: Decimal,
    latest_week: int | None = None,
) -> bool:
    return sp_price_point_looks_cratered(
        player,
        fundamental_price=fundamental_price,
        points_to_date=points_to_date,
        latest_week=latest_week,
    ) or sp_price_point_looks_overdecayed(
        player,
        fundamental_price=fundamental_price,
        points_to_date=points_to_date,
        latest_week=latest_week,
    )


def current_price_context_by_player(
    db: Session,
    players: list[Player],
) -> dict[int, tuple[Decimal, Decimal, int, Decimal]]:
    if not players:
        return {}
    stats_snapshot = get_stats_snapshot_by_player(db, [int(player.id) for player in players])
    contexts: dict[int, tuple[Decimal, Decimal, int, Decimal]] = {}
    for player in players:
        fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        contexts[int(player.id)] = (
            fundamental,
            points_to_date,
            latest_week,
            current_spot_price(player, fundamental_price=fundamental),
        )
    return contexts


def is_mlb_no_direct_stats_context(player: Player, context: tuple[Decimal, Decimal, int, Decimal] | None) -> bool:
    if context is None:
        return False
    _fundamental, points_to_date, latest_week, _spot = context
    return (
        str(player.sport).strip().upper() == "MLB"
        and not is_mlb_starting_pitcher(player)
        and int(latest_week) == 0
        and points_to_date == 0
    )


def max_expected_progress_units_for_mover_window(player: Player, window_hours: int) -> int:
    days = max(1, (max(1, int(window_hours)) + 23) // 24)
    if str(player.sport).strip().upper() == "MLB":
        if is_mlb_starting_pitcher(player):
            return max(1, (days // max(1, MLB_STARTING_PITCHER_ROTATION_GAMES)) + 2)
        return days + 2
    return max(1, (max(1, int(window_hours)) // 168) + 1)


def mover_reference_progress_jump_is_implausible(
    player: Player,
    *,
    current_context: tuple[Decimal, Decimal, int, Decimal] | None,
    reference_latest_week: int | None,
    window_hours: int,
) -> bool:
    if current_context is None or reference_latest_week is None:
        return False
    _fundamental, _points_to_date, current_latest_week, _spot = current_context
    progress_delta = max(0, int(current_latest_week) - max(0, int(reference_latest_week)))
    return progress_delta > max_expected_progress_units_for_mover_window(player, window_hours)


def mover_reference_is_too_stale(reference_at: datetime, cutoff: datetime, window_hours: int) -> bool:
    max_reference_age = timedelta(hours=max(1, int(window_hours)))
    return reference_at < cutoff - max_reference_age


def record_price_points_for_players(
    db: Session,
    players: list[Player],
    source: str,
) -> None:
    if not players:
        return
    stats_snapshot = get_stats_snapshot_by_player(db, [player.id for player in players])
    for player in players:
        fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        add_price_point(
            db=db,
            player=player,
            source=source,
            fundamental_price=fundamental,
            points_to_date=points_to_date,
            latest_week=latest_week,
        )


def ensure_initial_price_history(db: Session) -> None:
    players = db.execute(select(Player)).scalars().all()
    if not players:
        return

    existing_player_ids = {
        int(player_id)
        for player_id in db.execute(select(PricePoint.player_id).distinct()).scalars().all()
    }
    players_missing_history = [player for player in players if player.id not in existing_player_ids]
    if not players_missing_history:
        return

    record_price_points_for_players(
        db=db,
        players=players_missing_history,
        source="SEED",
    )
    db.commit()


def build_market_mover_rows(
    db: Session,
    players: list[Player],
    window_hours: int,
) -> list[MarketMoverOut]:
    if not players:
        return []

    players_by_id = {int(player.id): player for player in players}
    player_ids = sorted(players_by_id.keys())
    cutoff = chicago_now() - timedelta(hours=window_hours)
    current_contexts = current_price_context_by_player(db, players)
    now = chicago_now()
    latest_by_player: dict[int, tuple[Decimal, datetime, int | None]] = {
        player_id: (context[3], now, int(context[2]))
        for player_id, context in current_contexts.items()
    }

    pre_cutoff_ranked = (
        select(
            PricePoint.player_id.label("player_id"),
            PricePoint.spot_price.label("spot_price"),
            PricePoint.fundamental_price.label("fundamental_price"),
            PricePoint.points_to_date.label("points_to_date"),
            PricePoint.latest_week.label("latest_week"),
            PricePoint.created_at.label("created_at"),
            func.row_number()
            .over(
                partition_by=PricePoint.player_id,
                order_by=[PricePoint.created_at.desc(), PricePoint.id.desc()],
            )
            .label("rn"),
        )
        .where(
            PricePoint.player_id.in_(player_ids),
            PricePoint.created_at <= cutoff,
        )
        .subquery()
    )
    pre_cutoff_rows = db.execute(
        select(
            pre_cutoff_ranked.c.player_id,
            pre_cutoff_ranked.c.spot_price,
            pre_cutoff_ranked.c.fundamental_price,
            pre_cutoff_ranked.c.points_to_date,
            pre_cutoff_ranked.c.latest_week,
            pre_cutoff_ranked.c.created_at,
        ).where(pre_cutoff_ranked.c.rn == 1)
    ).all()
    pre_cutoff_by_player: dict[int, tuple[Decimal, datetime, int | None]] = {}
    for row in pre_cutoff_rows:
        player_id = int(row.player_id)
        player = players_by_id[player_id]
        spot = Decimal(str(row.spot_price))
        latest_week = int(row.latest_week)
        if sp_price_point_needs_sanitizing(
            player,
            fundamental_price=Decimal(str(row.fundamental_price)),
            points_to_date=Decimal(str(row.points_to_date)),
            latest_week=latest_week,
        ):
            spot = latest_by_player.get(player_id, (spot, row.created_at, latest_week))[0]
        pre_cutoff_by_player[player_id] = (spot, row.created_at, latest_week)

    movers: list[MarketMoverOut] = []
    for player_id in player_ids:
        latest_row = latest_by_player.get(player_id)
        if not latest_row:
            continue
        current_spot, current_at, _current_latest_week = latest_row
        reference_row = pre_cutoff_by_player.get(player_id)
        if reference_row and mover_reference_is_too_stale(reference_row[1], cutoff, window_hours):
            reference_row = None
        if reference_row is None:
            reference_row = latest_row
        reference_spot, reference_at, reference_latest_week = reference_row
        player = players_by_id[player_id]
        current_context = current_contexts.get(player_id)
        if is_mlb_no_direct_stats_context(
            player,
            current_context,
        ) or mover_reference_progress_jump_is_implausible(
            player,
            current_context=current_context,
            reference_latest_week=reference_latest_week,
            window_hours=window_hours,
        ):
            reference_spot = current_spot
            reference_at = current_at
        safe_reference = reference_spot if reference_spot > Decimal("0") else current_spot
        if safe_reference > Decimal("0"):
            change_percent = ((current_spot - safe_reference) / safe_reference) * Decimal("100")
        else:
            change_percent = Decimal("0")
        change = current_spot - safe_reference
        movers.append(
            MarketMoverOut(
                player_id=player_id,
                sport=str(player.sport),
                name=str(player.name),
                team=str(player.team),
                position=str(player.position),
                spot_price=float(current_spot),
                reference_price=float(safe_reference),
                change=float(change),
                change_percent=float(change_percent),
                current_at=current_at,
                reference_at=reference_at,
            )
        )

    return movers


def min_market_bias_for_price_floor(
    *,
    player: Player,
    fundamental_price: Decimal,
) -> Decimal:
    return (MIN_SPOT_PRICE / fundamental_price - Decimal("1")) / effective_k(
        Decimal(str(player.k)),
        fundamental_price,
        live_now=bool(player.live_now),
    )


def max_sell_qty_before_price_floor(
    *,
    player: Player,
    market_bias: Decimal,
    fundamental_price: Decimal,
    spot_price_before: Decimal,
) -> Decimal:
    minimum_market_bias = min_market_bias_for_price_floor(
        player=player,
        fundamental_price=fundamental_price,
    )
    available_bias = market_bias - minimum_market_bias
    if available_bias <= 0:
        return Decimal("0")
    per_share_bias = market_impact_bias_delta_for_trade(
        qty=Decimal("1"),
        spot_price_before=spot_price_before,
        market_bias_before=market_bias,
    )
    if per_share_bias <= 0:
        return Decimal("0")
    return max(Decimal("0"), available_bias / per_share_bias)


def ensure_sell_side_allowed_or_raise(
    *,
    player: Player,
    market_bias: Decimal,
    qty: Decimal,
    fundamental_price: Decimal,
    spot_price_before: Decimal,
) -> None:
    max_qty = max_sell_qty_before_price_floor(
        player=player,
        market_bias=market_bias,
        fundamental_price=fundamental_price,
        spot_price_before=spot_price_before,
    )
    if qty > max_qty:
        raise HTTPException(
            400,
            (
                f"Trade would breach price floor ${float(MIN_SPOT_PRICE):.2f}. "
                f"Max sell/short size right now is {float(max_qty):.4f} shares."
            ),
        )


def ensure_open_position_cap_or_raise(
    current_abs_shares: Decimal,
    additional_shares: Decimal,
    spot_before: Decimal,
) -> None:
    safe_spot = max(spot_before, Decimal("0.000001"))
    max_abs_shares = MAX_POSITION_NOTIONAL_PER_PLAYER / safe_spot
    next_abs_shares = current_abs_shares + additional_shares
    tolerance = Decimal("0.000001")

    if next_abs_shares > max_abs_shares + tolerance:
        remaining_abs = max(Decimal("0"), max_abs_shares - current_abs_shares)
        raise HTTPException(
            400,
            (
                f"Per-player opening cap is ${float(MAX_POSITION_NOTIONAL_PER_PLAYER):,.2f}. "
                f"At current spot ${float(spot_before):.2f}, max additional size is {float(remaining_abs):.4f} shares."
            ),
        )


def build_account_risk_snapshot(
    db: Session,
    user: User,
    for_update: bool = False,
) -> AccountRiskSnapshot:
    holdings_stmt = select(Holding).where(
        Holding.user_id == user.id,
        Holding.shares_owned != 0,
    )
    if for_update:
        holdings_stmt = holdings_stmt.with_for_update()
    holdings = db.execute(holdings_stmt).scalars().all()

    cash_balance = Decimal(str(user.cash_balance))
    if not holdings:
        return AccountRiskSnapshot(
            cash_balance=cash_balance,
            equity=cash_balance,
            net_exposure=Decimal("0"),
            gross_exposure=Decimal("0"),
            margin_used=Decimal("0"),
            available_buying_power=max(Decimal("0"), cash_balance),
            margin_call=False,
            positions=[],
        )

    player_ids = [int(holding.player_id) for holding in holdings]
    players_stmt = select(Player).where(Player.id.in_(player_ids))
    if for_update:
        players_stmt = players_stmt.with_for_update()
    players = db.execute(players_stmt).scalars().all()
    players_by_id = {int(player.id): player for player in players}

    stats_snapshot = get_stats_snapshot_by_player(db, player_ids)

    positions: list[PositionRisk] = []
    net_exposure = Decimal("0")
    gross_exposure = Decimal("0")

    for holding in holdings:
        player = players_by_id.get(int(holding.player_id))
        if player is None:
            continue

        shares = Decimal(str(holding.shares_owned))
        if shares == 0:
            continue

        fundamental_price, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        basis_amount = holding_basis_amount(holding)
        entry_basis_amount = holding_entry_basis_amount(holding)
        mark_basis_amount = holding_mark_basis_amount(holding)
        average_entry_price = average_entry_price_for_position(
            basis_amount=mark_basis_amount if mark_basis_amount > 0 else (entry_basis_amount if entry_basis_amount > 0 else basis_amount),
            shares=shares,
        )
        market_bias = current_market_bias(player)
        spot = current_spot_price(
            player,
            fundamental_price=fundamental_price,
            market_bias=market_bias,
        )
        market_value = mark_to_market_value_for_position(
            shares=shares,
            mark_basis_amount=mark_basis_amount,
            spot_price=spot,
        )
        maintenance_margin_required = Decimal("0")

        net_exposure += market_value
        gross_exposure += abs(market_value)
        positions.append(
            PositionRisk(
                holding=holding,
                player=player,
                shares=shares,
                average_entry_price=average_entry_price,
                basis_amount=basis_amount,
                entry_basis_amount=entry_basis_amount,
                mark_basis_amount=mark_basis_amount,
                spot_price=spot,
                market_value=market_value,
                maintenance_margin_required=maintenance_margin_required,
                fundamental_price=fundamental_price,
                points_to_date=points_to_date,
                latest_week=latest_week,
            )
        )

    equity = cash_balance + net_exposure
    margin_used = Decimal("0")
    available_buying_power = max(Decimal("0"), cash_balance)
    margin_call = False

    return AccountRiskSnapshot(
        cash_balance=cash_balance,
        equity=equity,
        net_exposure=net_exposure,
        gross_exposure=gross_exposure,
        margin_used=margin_used,
        available_buying_power=available_buying_power,
        margin_call=margin_call,
        positions=positions,
    )


def enforce_margin_and_maybe_liquidate(
    db: Session,
    user: User,
) -> AccountRiskSnapshot:
    return build_account_risk_snapshot(
        db=db,
        user=user,
        for_update=True,
    )


@app.get("/sports", response_model=list[str])
def list_sports(db: Session = Depends(get_db)):
    cache_key = build_cache_key("sports")
    cached = get_cached_json(cache_key)
    if cached is not None:
        return cached
    sports = db.execute(
        select(Player.sport)
        .distinct()
        .order_by(Player.sport.asc())
    ).scalars().all()
    result = [str(sport).strip().upper() for sport in sports if str(sport).strip()]
    return set_cached_json(cache_key, result, ttl_seconds=60)


@app.get("/players", response_model=list[PlayerOut])
def list_players(
    sport: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    normalized_sport = normalize_sport_code(sport) if sport and sport.strip().upper() != "ALL" else "ALL"
    cache_key = build_cache_key("players", normalized_sport)
    cached = get_cached_json(cache_key)
    if cached is not None:
        return cached
    stmt = select(Player).where(Player.ipo_open.is_(True))
    if sport and sport.strip().upper() != "ALL":
        stmt = stmt.where(Player.sport == normalize_sport_code(sport))
    players = db.execute(stmt.order_by(Player.name)).scalars().all()
    visible_players = [p for p in players if not SYNTHETIC_PLAYER_NAME.match(p.name)]
    stats_snapshot = get_stats_snapshot_by_player(db, [p.id for p in visible_players])
    holdings_snapshot = get_aggregate_holdings_by_player(db, [p.id for p in visible_players])

    out: list[PlayerOut] = []
    for player in visible_players:
        fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        shares_held, shares_short = holdings_snapshot.get(player.id, (Decimal("0"), Decimal("0")))
        out.append(
            player_to_out(
                player=player,
                fundamental_price=fundamental,
                points_to_date=points_to_date,
                latest_week=latest_week,
                shares_held=shares_held,
                shares_short=shares_short,
            )
        )
    return set_cached_json(cache_key, out, ttl_seconds=60)


@app.get("/market/movers", response_model=MarketMoversOut)
def market_movers(
    limit: int = Query(default=25, ge=1, le=100),
    window_hours: int = Query(default=24, ge=1, le=168),
    sport: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    normalized_sport = normalize_sport_code(sport) if sport and sport.strip().upper() != "ALL" else "ALL"
    cache_key = build_cache_key("market_movers", limit, window_hours, normalized_sport)
    cached = get_cached_json(cache_key)
    if cached is not None:
        return cached
    stmt = select(Player).where(Player.ipo_open.is_(True))
    if sport and sport.strip().upper() != "ALL":
        stmt = stmt.where(Player.sport == normalize_sport_code(sport))

    players = db.execute(stmt.order_by(Player.name.asc())).scalars().all()
    visible_players = [player for player in players if not SYNTHETIC_PLAYER_NAME.match(str(player.name))]
    movers = build_market_mover_rows(
        db=db,
        players=visible_players,
        window_hours=window_hours,
    )

    gainers = sorted(
        movers,
        key=lambda row: (row.change_percent, row.change, row.name.lower()),
        reverse=True,
    )[:limit]
    losers = sorted(
        movers,
        key=lambda row: (row.change_percent, row.change, row.name.lower()),
    )[:limit]
    result = MarketMoversOut(
        generated_at=chicago_now(),
        window_hours=window_hours,
        gainers=gainers,
        losers=losers,
    )
    return set_cached_json(cache_key, result, ttl_seconds=30)


def live_game_player_points_for_team(players: list[LiveGamePlayerOut], team_code: str | None) -> float:
    normalized_team = str(team_code or "").strip().upper()
    if not normalized_team:
        return 0.0
    return float(
        sum(
            float(player.game_fantasy_points)
            for player in players
            if str(player.team or "").strip().upper() == normalized_team
        )
    )


def win_probability_point_to_out(point) -> LiveGameWinProbabilityPointOut:
    return LiveGameWinProbabilityPointOut(
        captured_at=point.captured_at,
        away_probability=float(point.away_probability),
        home_probability=float(point.home_probability),
        away_score=point.away_score,
        home_score=point.home_score,
        inning=point.inning,
        inning_half=point.inning_half,
        outs=point.outs,
        balls=point.balls,
        strikes=point.strikes,
        runner_on_first=point.runner_on_first,
        runner_on_second=point.runner_on_second,
        runner_on_third=point.runner_on_third,
        offense_team=point.offense_team,
        defense_team=point.defense_team,
        batter_name=point.batter_name,
        pitcher_name=point.pitcher_name,
        at_bat_index=point.at_bat_index,
    )


@app.get("/live/games", response_model=LiveGamesOut)
def list_live_games(
    sport: str | None = Query(default=None),
    requested_date: str | None = Query(default=None, alias="date"),
    _auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    normalized_sport = normalize_sport_code(sport) if sport and sport.strip().upper() != "ALL" else "ALL"
    parsed_requested_date: date | None = None
    requested_date_key: str | None = None
    raw_requested_date = (requested_date or "").strip()
    if raw_requested_date:
        try:
            parsed_requested_date = date.fromisoformat(raw_requested_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.") from exc
        requested_date_key = parsed_requested_date.isoformat()

    cache_key = build_cache_key("live_games", normalized_sport, requested_date_key or "auto")
    cached = get_cached_json(cache_key)
    if cached is not None:
        return cached

    # Keep completed games from the prior slate visible until 2:00 AM Chicago time.
    # For explicit date selection, use that calendar day in Chicago local time.
    if parsed_requested_date is None:
        start_of_day_chicago = chicago_rollover_start(rollover_hour=2)
        end_of_day_chicago: datetime | None = None
        schedule_date = start_of_day_chicago.date()
    else:
        start_of_day_chicago = datetime.combine(parsed_requested_date, datetime.min.time())
        end_of_day_chicago = start_of_day_chicago + timedelta(days=1)
        schedule_date = parsed_requested_date

    mlb_schedule_game_ids: list[str] = []
    if normalized_sport in {"ALL", "MLB"}:
        try:
            mlb_schedule_game_ids = fetch_mlb_schedule_game_pks(
                schedule_date=schedule_date,
                timeout=3.5,
            )
        except Exception as exc:
            logger.warning("Failed to fetch MLB schedule for live games: %s", exc)

    generated_at = chicago_now()

    grouped: dict[str, dict[str, object]] = {}
    live_players_count = 0

    if parsed_requested_date is None:
        stmt = select(Player).where(
            Player.ipo_open.is_(True),
            or_(
                Player.live_now.is_(True),
                and_(
                    Player.live_updated_at.is_not(None),
                    Player.live_updated_at >= start_of_day_chicago,
                    or_(
                        Player.live_game_id.is_not(None),
                        Player.live_game_label.is_not(None),
                    ),
                ),
            ),
        )
        if sport and sport.strip().upper() != "ALL":
            stmt = stmt.where(Player.sport == normalize_sport_code(sport))

        players = db.execute(
            stmt.order_by(
                Player.sport.asc(),
                Player.live_game_label.asc(),
                Player.live_game_status.asc(),
                Player.name.asc(),
            )
        ).scalars().all()

        live_players_count = sum(1 for player in players if bool(player.live_now))
        stats_snapshot = get_stats_snapshot_by_player(db, [player.id for player in players])

        for player in players:
            sport_code = str(player.sport).strip().upper()
            live_game_id = (str(player.live_game_id).strip() if player.live_game_id else "") or ""
            live_game_label = (str(player.live_game_label).strip() if player.live_game_label else "") or ""
            live_status = (str(player.live_game_status).strip() if player.live_game_status else "") or ""
            if live_game_id:
                group_key = f"id:{sport_code}:{live_game_id.lower()}"
                resolved_game_id = f"{sport_code}:{live_game_id}"
            elif live_game_label:
                normalized_label = normalize_text(live_game_label)
                group_key = f"label:{sport_code}:{normalized_label}"
                resolved_game_id = f"{sport_code}:{normalized_label.replace(' ', '-') or 'live'}"
            else:
                group_key = f"player:{sport_code}:{int(player.id)}"
                resolved_game_id = f"{sport_code}:player-{int(player.id)}"

            resolved_label = (
                live_game_label
                or (f"{player.team} Live Game" if player.team else f"{player.name} Live Game")
            )

            bucket = grouped.get(group_key)
            if bucket is None:
                bucket = {
                    "game_id": resolved_game_id,
                    "raw_game_id": live_game_id or None,
                    "sport": sport_code,
                    "game_label": resolved_label,
                    "game_status": live_status or None,
                    "week": int(player.live_week) if player.live_week is not None else None,
                    "is_live": bool(player.live_now),
                    "updated_at": player.live_updated_at,
                    "players": [],
                }
                grouped[group_key] = bucket
            else:
                if not bucket["raw_game_id"] and live_game_id:
                    bucket["raw_game_id"] = live_game_id
                incoming_week = int(player.live_week) if player.live_week is not None else None
                prior_week = bucket["week"]
                if incoming_week is not None and (prior_week is None or incoming_week > prior_week):
                    bucket["week"] = incoming_week
                incoming_updated_at = player.live_updated_at
                prior_updated_at = bucket["updated_at"]
                if live_status:
                    should_replace_status = (
                        not bucket["game_status"]
                        or (
                            incoming_updated_at is not None
                            and (prior_updated_at is None or incoming_updated_at >= prior_updated_at)
                        )
                    )
                    if should_replace_status:
                        bucket["game_status"] = live_status
                if incoming_updated_at and (prior_updated_at is None or incoming_updated_at > prior_updated_at):
                    bucket["updated_at"] = incoming_updated_at
                if bool(player.live_now):
                    bucket["is_live"] = True

            fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
            _ = latest_week
            spot = current_spot_price(player, fundamental_price=fundamental)
            game_points = (
                float(player.live_game_fantasy_points)
                if player.live_game_fantasy_points is not None
                else 0.0
            )
            bucket_players = bucket["players"]
            assert isinstance(bucket_players, list)
            bucket_players.append(
                LiveGamePlayerOut(
                    player_id=int(player.id),
                    name=str(player.name),
                    team=str(player.team),
                    position=str(player.position),
                    points_to_date=float(points_to_date),
                    game_fantasy_points=game_points,
                    game_stat_line=(str(player.live_game_stat_line).strip() if player.live_game_stat_line else None) or None,
                    spot_price=float(spot),
                    fundamental_price=float(fundamental),
                )
            )
    else:
        assert end_of_day_chicago is not None
        game_stmt = (
            select(Player, PlayerGamePoint)
            .join(PlayerGamePoint, PlayerGamePoint.player_id == Player.id)
            .where(
                Player.ipo_open.is_(True),
                PlayerGamePoint.recorded_at >= start_of_day_chicago,
                PlayerGamePoint.recorded_at < end_of_day_chicago,
            )
        )
        if sport and sport.strip().upper() != "ALL":
            game_stmt = game_stmt.where(Player.sport == normalize_sport_code(sport))

        game_rows = db.execute(
            game_stmt.order_by(
                Player.sport.asc(),
                PlayerGamePoint.game_label.asc(),
                PlayerGamePoint.game_status.asc(),
                Player.name.asc(),
            )
        ).all()
        player_ids = sorted({int(player.id) for player, _ in game_rows})
        live_players_count = len(player_ids)
        stats_snapshot = get_stats_snapshot_by_player(db, player_ids)

        for player, game_point in game_rows:
            sport_code = str(player.sport).strip().upper()
            raw_game_id = (str(game_point.game_id).strip() if game_point.game_id else "") or ""
            game_label = (str(game_point.game_label).strip() if game_point.game_label else "") or ""
            game_status = (str(game_point.game_status).strip() if game_point.game_status else "") or ""
            if raw_game_id:
                group_key = f"id:{sport_code}:{raw_game_id.lower()}"
                resolved_game_id = f"{sport_code}:{raw_game_id}"
            elif game_label:
                normalized_label = normalize_text(game_label)
                group_key = f"label:{sport_code}:{normalized_label}"
                resolved_game_id = f"{sport_code}:{normalized_label.replace(' ', '-') or 'history'}"
            else:
                group_key = f"player:{sport_code}:{int(player.id)}"
                resolved_game_id = f"{sport_code}:player-{int(player.id)}"

            resolved_label = game_label or (f"{player.team} Game" if player.team else f"{player.name} Game")
            incoming_updated_at = game_point.recorded_at
            bucket = grouped.get(group_key)
            if bucket is None:
                bucket = {
                    "game_id": resolved_game_id,
                    "raw_game_id": raw_game_id or None,
                    "sport": sport_code,
                    "game_label": resolved_label,
                    "game_status": game_status or None,
                    "week": int(player.live_week) if player.live_week is not None else None,
                    "is_live": False,
                    "updated_at": incoming_updated_at,
                    "players": [],
                }
                grouped[group_key] = bucket
            else:
                if not bucket["raw_game_id"] and raw_game_id:
                    bucket["raw_game_id"] = raw_game_id
                incoming_week = int(player.live_week) if player.live_week is not None else None
                prior_week = bucket["week"]
                if incoming_week is not None and (prior_week is None or incoming_week > prior_week):
                    bucket["week"] = incoming_week
                prior_updated_at = bucket["updated_at"]
                if game_status:
                    should_replace_status = (
                        not bucket["game_status"]
                        or (
                            incoming_updated_at is not None
                            and (prior_updated_at is None or incoming_updated_at >= prior_updated_at)
                        )
                    )
                    if should_replace_status:
                        bucket["game_status"] = game_status
                if incoming_updated_at and (prior_updated_at is None or incoming_updated_at > prior_updated_at):
                    bucket["updated_at"] = incoming_updated_at

            fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
            _ = latest_week
            spot = current_spot_price(player, fundamental_price=fundamental)
            season_points_to_date = (
                float(game_point.season_fantasy_points)
                if game_point.season_fantasy_points is not None
                else float(points_to_date)
            )
            game_points = (
                float(game_point.game_fantasy_points)
                if game_point.game_fantasy_points is not None
                else 0.0
            )
            bucket_players = bucket["players"]
            assert isinstance(bucket_players, list)
            bucket_players.append(
                LiveGamePlayerOut(
                    player_id=int(player.id),
                    name=str(player.name),
                    team=str(player.team),
                    position=str(player.position),
                    points_to_date=season_points_to_date,
                    game_fantasy_points=game_points,
                    game_stat_line=None,
                    spot_price=float(spot),
                    fundamental_price=float(fundamental),
                )
            )

    mlb_game_id_tokens: set[str] = set()
    mlb_existing_game_ids: set[str] = set()
    for group in grouped.values():
        if str(group["sport"]).upper() != "MLB":
            continue
        raw_game_id = (str(group["raw_game_id"]).strip() if group.get("raw_game_id") else "") or ""
        if raw_game_id:
            mlb_game_id_tokens.add(raw_game_id)
            normalized_raw = normalize_mlb_game_pk(raw_game_id)
            if normalized_raw:
                mlb_game_id_tokens.add(normalized_raw)
                mlb_existing_game_ids.add(normalized_raw)
        group_game_id = (str(group["game_id"]).strip() if group.get("game_id") else "") or ""
        game_id_suffix = group_game_id.split(":", 1)[1] if ":" in group_game_id else group_game_id
        normalized_suffix = normalize_mlb_game_pk(game_id_suffix)
        if normalized_suffix:
            mlb_game_id_tokens.add(normalized_suffix)
            mlb_existing_game_ids.add(normalized_suffix)
    for scheduled_game_id in mlb_schedule_game_ids:
        normalized_scheduled_id = normalize_mlb_game_pk(scheduled_game_id)
        if normalized_scheduled_id:
            mlb_game_id_tokens.add(normalized_scheduled_id)
    mlb_game_ids = sorted(mlb_game_id_tokens)
    mlb_states_by_game_id: dict[str, MlbGameState] = {}
    if mlb_game_ids:
        mlb_states_by_game_id = fetch_mlb_game_states(game_pks=mlb_game_ids, timeout=3.5)

    for scheduled_game_id in mlb_schedule_game_ids:
        normalized_scheduled_id = normalize_mlb_game_pk(scheduled_game_id)
        if not normalized_scheduled_id or normalized_scheduled_id in mlb_existing_game_ids:
            continue

        scheduled_state = mlb_states_by_game_id.get(normalized_scheduled_id)
        away_team = (scheduled_state.away_team if scheduled_state else None) or "Away"
        home_team = (scheduled_state.home_team if scheduled_state else None) or "Home"
        scheduled_status = None
        scheduled_is_live = False
        if scheduled_state is not None:
            if scheduled_state.detailed_state:
                scheduled_status = scheduled_state.detailed_state
            elif scheduled_state.abstract_state:
                scheduled_status = scheduled_state.abstract_state.title()
            if scheduled_state.is_live is not None:
                scheduled_is_live = bool(scheduled_state.is_live)
            if (
                (scheduled_state.abstract_state or "") in {"FINAL", "COMPLETED"}
                or game_status_is_terminal(scheduled_state.detailed_state)
            ):
                scheduled_is_live = False

        grouped[f"schedule:MLB:{normalized_scheduled_id}"] = {
            "game_id": f"MLB:{normalized_scheduled_id}",
            "raw_game_id": normalized_scheduled_id,
            "sport": "MLB",
            "game_label": f"{away_team} @ {home_team}",
            "game_status": scheduled_status,
            "week": None,
            "is_live": scheduled_is_live,
            "updated_at": None,
            "players": [],
        }
        mlb_existing_game_ids.add(normalized_scheduled_id)

    games: list[LiveGameOut] = []
    for group in grouped.values():
        group_players = group["players"]
        assert isinstance(group_players, list)
        sorted_players = sorted(
            group_players,
            key=lambda row: (float(row.game_fantasy_points), float(row.points_to_date), row.name),
            reverse=True,
        )
        total_game_points = float(sum(float(player.game_fantasy_points) for player in sorted_players))
        game_status_value = (str(group["game_status"]) if group["game_status"] else None)
        game_is_live = bool(group["is_live"])
        game_state_out: LiveGameStateOut | None = None
        at_bats_out: list[LiveGameAtBatOut] = []
        win_probability_out: LiveGameWinProbabilityPointOut | None = None
        win_probability_series_out: list[LiveGameWinProbabilityPointOut] = []
        if str(group["sport"]).upper() == "MLB":
            raw_game_id = (str(group["raw_game_id"]).strip() if group.get("raw_game_id") else "") or ""
            group_game_id = (str(group["game_id"]).strip() if group.get("game_id") else "") or ""
            game_id_suffix = group_game_id.split(":", 1)[1] if ":" in group_game_id else group_game_id
            candidates = [
                raw_game_id,
                raw_game_id.upper(),
                normalize_mlb_game_pk(raw_game_id),
                game_id_suffix,
                game_id_suffix.upper(),
                normalize_mlb_game_pk(game_id_suffix),
            ]
            mlb_state: MlbGameState | None = None
            for candidate in candidates:
                if not candidate:
                    continue
                found = mlb_states_by_game_id.get(candidate)
                if found is not None:
                    mlb_state = found
                    break

            if mlb_state is not None:
                if mlb_state.detailed_state:
                    game_status_value = mlb_state.detailed_state
                elif mlb_state.abstract_state:
                    game_status_value = mlb_state.abstract_state.title()
                if mlb_state.is_live is not None:
                    game_is_live = bool(mlb_state.is_live)
                if (
                    (mlb_state.abstract_state or "") in {"FINAL", "COMPLETED"}
                    or game_status_is_terminal(mlb_state.detailed_state)
                ):
                    game_is_live = False
                mlb_game_final = not game_is_live and (
                    (mlb_state.abstract_state or "") in {"FINAL", "COMPLETED"}
                    or game_status_is_terminal(mlb_state.detailed_state)
                )
                game_state_out = LiveGameStateOut(
                    home_team=mlb_state.home_team,
                    away_team=mlb_state.away_team,
                    first_pitch_at=mlb_state.first_pitch_at,
                    home_score=mlb_state.home_score,
                    away_score=mlb_state.away_score,
                    inning=mlb_state.inning,
                    inning_half=mlb_state.inning_half,
                    outs=mlb_state.outs,
                    balls=mlb_state.balls,
                    strikes=mlb_state.strikes,
                    runner_on_first=mlb_state.runner_on_first,
                    runner_on_second=mlb_state.runner_on_second,
                    runner_on_third=mlb_state.runner_on_third,
                    offense_team=mlb_state.offense_team,
                    defense_team=mlb_state.defense_team,
                    probable_home_pitcher_name=mlb_state.probable_home_pitcher_name,
                    probable_away_pitcher_name=mlb_state.probable_away_pitcher_name,
                )
                at_bats_out = [
                    LiveGameAtBatOut(
                        at_bat_index=int(at_bat.at_bat_index),
                        inning=int(at_bat.inning) if at_bat.inning is not None else None,
                        inning_half=at_bat.inning_half,
                        batter_name=at_bat.batter_name,
                        pitcher_name=at_bat.pitcher_name,
                        outs_after_play=(
                            int(at_bat.outs_after_play)
                            if at_bat.outs_after_play is not None
                            else None
                        ),
                        balls=int(at_bat.balls) if at_bat.balls is not None else None,
                        strikes=int(at_bat.strikes) if at_bat.strikes is not None else None,
                        runner_on_first=at_bat.runner_on_first,
                        runner_on_second=at_bat.runner_on_second,
                        runner_on_third=at_bat.runner_on_third,
                        away_score=int(at_bat.away_score) if at_bat.away_score is not None else None,
                        home_score=int(at_bat.home_score) if at_bat.home_score is not None else None,
                        event=at_bat.event,
                        event_type=at_bat.event_type,
                        description=at_bat.description,
                        occurred_at=at_bat.occurred_at,
                    )
                    for at_bat in mlb_state.at_bats
                ]
                fallback_away_points = live_game_player_points_for_team(sorted_players, mlb_state.away_team)
                fallback_home_points = live_game_player_points_for_team(sorted_players, mlb_state.home_team)
                current_win_probability = build_mlb_current_win_probability(
                    mlb_state,
                    fallback_away_points=fallback_away_points,
                    fallback_home_points=fallback_home_points,
                    final=mlb_game_final,
                )
                if current_win_probability is not None:
                    win_probability_out = win_probability_point_to_out(current_win_probability)
                win_probability_series_out = [
                    win_probability_point_to_out(point)
                    for point in build_mlb_win_probability_series(
                        mlb_state,
                        fallback_away_points=fallback_away_points,
                        fallback_home_points=fallback_home_points,
                        final=mlb_game_final,
                    )
                ]
        if game_status_is_terminal(game_status_value):
            game_is_live = False
        games.append(
            LiveGameOut(
                game_id=str(group["game_id"]),
                sport=str(group["sport"]),
                game_label=str(group["game_label"]),
                game_status=game_status_value,
                week=int(group["week"]) if group["week"] is not None else None,
                is_live=game_is_live,
                live_player_count=len(sorted_players),
                game_fantasy_points_total=total_game_points,
                state=game_state_out,
                at_bats=at_bats_out,
                win_probability=win_probability_out,
                win_probability_series=win_probability_series_out,
                updated_at=group["updated_at"],
                players=sorted_players,
            )
        )

    games.sort(key=lambda game: (game.sport, game.game_label.lower(), game.game_id.lower()))
    result = LiveGamesOut(
        generated_at=generated_at,
        requested_date=requested_date_key,
        live_games_count=len(games),
        live_players_count=live_players_count,
        games=games,
    )
    return set_cached_json(cache_key, result, ttl_seconds=15)


@app.get("/players/{player_id}", response_model=PlayerOut)
def get_player(player_id: int, db: Session = Depends(get_db)):
    cache_key = build_cache_key("player", player_id)
    cached = get_cached_json(cache_key)
    if cached is not None:
        return cached
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    if not player_is_listed(player):
        raise HTTPException(404, "Player not found")

    stats_snapshot = get_stats_snapshot_by_player(db, [player_id])
    holdings_snapshot = get_aggregate_holdings_by_player(db, [player_id])
    fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
    shares_held, shares_short = holdings_snapshot.get(player_id, (Decimal("0"), Decimal("0")))
    result = player_to_out(
        player=player,
        fundamental_price=fundamental,
        points_to_date=points_to_date,
        latest_week=latest_week,
        shares_held=shares_held,
        shares_short=shares_short,
    )
    return set_cached_json(cache_key, result, ttl_seconds=30)


@app.get("/players/{player_id}/history", response_model=list[PricePointOut])
def get_player_history(
    player_id: int,
    limit: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    cache_key = build_cache_key("player_history", player_id, limit)
    cached = get_cached_json(cache_key)
    if cached is not None:
        return cached
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    if not player_is_listed(player):
        raise HTTPException(404, "Player not found")

    points = db.execute(
        select(PricePoint)
        .where(PricePoint.player_id == player_id)
        .order_by(PricePoint.created_at.asc(), PricePoint.id.asc())
        .limit(limit)
    ).scalars().all()

    current_context = current_price_context_by_player(db, [player]).get(int(player.id))
    fallback_fundamental = current_context[0] if current_context else Decimal(str(player.base_price))
    current_points_to_date = current_context[1] if current_context else Decimal("0")
    current_latest_week = int(current_context[2]) if current_context else 0
    fallback_spot = current_context[3] if current_context else current_spot_price(
        player,
        fundamental_price=fallback_fundamental,
    )
    last_sane_fundamental: Decimal | None = None
    last_sane_spot: Decimal | None = None
    result: list[PricePointOut] = []
    for point in points:
        fundamental_price = Decimal(str(point.fundamental_price))
        spot = Decimal(str(point.spot_price))
        points_to_date = Decimal(str(point.points_to_date))
        if sp_price_point_needs_sanitizing(
            player,
            fundamental_price=fundamental_price,
            points_to_date=points_to_date,
            latest_week=int(point.latest_week),
        ):
            fundamental_price = last_sane_fundamental or fallback_fundamental
            spot = last_sane_spot or fallback_spot
        else:
            last_sane_fundamental = fundamental_price
            last_sane_spot = spot
        result.append(
            PricePointOut(
                player_id=point.player_id,
                source=point.source,
                fundamental_price=float(fundamental_price),
                spot_price=float(spot),
                total_shares=float(point.total_shares),
                points_to_date=float(point.points_to_date),
                latest_week=int(point.latest_week),
                created_at=point.created_at,
            )
        )
    latest_history = result[-1] if result else None
    if (
        latest_history is None
        or abs(Decimal(str(latest_history.fundamental_price)) - fallback_fundamental) > Decimal("0.000001")
        or abs(Decimal(str(latest_history.spot_price)) - fallback_spot) > Decimal("0.000001")
    ):
        result.append(
            PricePointOut(
                player_id=int(player.id),
                source="CURRENT",
                fundamental_price=float(fallback_fundamental),
                spot_price=float(fallback_spot),
                total_shares=float(player.total_shares),
                points_to_date=float(current_points_to_date),
                latest_week=current_latest_week,
                created_at=chicago_now(),
            )
        )
    return set_cached_json(cache_key, result, ttl_seconds=30)


@app.get("/players/{player_id}/game-history", response_model=list[PlayerGamePointOut])
def get_player_game_history(
    player_id: int,
    limit: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    cache_key = build_cache_key("player_game_history", player_id, limit)
    cached = get_cached_json(cache_key)
    if cached is not None:
        return cached
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    if not player_is_listed(player):
        raise HTTPException(404, "Player not found")

    rows = db.execute(
        select(PlayerGamePoint)
        .where(PlayerGamePoint.player_id == player_id)
        .order_by(PlayerGamePoint.recorded_at.asc(), PlayerGamePoint.id.asc())
        .limit(limit)
    ).scalars().all()

    if str(player.sport).strip().upper() == "MLB":
        team_game_rows = db.execute(
            select(
                PlayerGamePoint.game_id,
                func.min(PlayerGamePoint.recorded_at).label("recorded_at"),
                func.max(PlayerGamePoint.game_label).label("game_label"),
                func.max(PlayerGamePoint.game_status).label("game_status"),
            )
            .join(Player, Player.id == PlayerGamePoint.player_id)
            .where(
                Player.sport == str(player.sport),
                Player.team == str(player.team),
            )
            .group_by(PlayerGamePoint.game_id)
            .order_by(func.min(PlayerGamePoint.recorded_at).asc(), PlayerGamePoint.game_id.asc())
            .limit(limit)
        ).all()
        player_rows_by_game_id = {str(row.game_id): row for row in rows}
        carried_season_points = Decimal("0")
        result: list[PlayerGamePointOut] = []
        for game_id, recorded_at, game_label, game_status in team_game_rows:
            if not game_label_mentions_team(game_label, player.team):
                continue
            normalized_game_id = str(game_id)
            player_row = player_rows_by_game_id.get(normalized_game_id)
            if player_row is not None:
                game_points = Decimal(str(player_row.game_fantasy_points))
                carried_season_points = Decimal(str(player_row.season_fantasy_points))
                row_label = normalize_optional_profile_field(player_row.game_label)
                row_status = normalize_optional_profile_field(player_row.game_status)
                row_recorded_at = player_row.recorded_at
            else:
                game_points = Decimal("0")
                row_label = normalize_optional_profile_field(game_label)
                row_status = normalize_optional_profile_field(game_status)
                row_recorded_at = recorded_at
            result.append(
                PlayerGamePointOut(
                    player_id=int(player.id),
                    game_id=normalized_game_id,
                    game_label=row_label,
                    game_status=row_status,
                    game_fantasy_points=float(game_points),
                    season_fantasy_points=float(carried_season_points),
                    recorded_at=row_recorded_at,
                )
            )
        return set_cached_json(cache_key, result, ttl_seconds=30)

    result = [
        PlayerGamePointOut(
            player_id=int(row.player_id),
            game_id=str(row.game_id),
            game_label=normalize_optional_profile_field(row.game_label),
            game_status=normalize_optional_profile_field(row.game_status),
            game_fantasy_points=float(row.game_fantasy_points),
            season_fantasy_points=float(row.season_fantasy_points),
            recorded_at=row.recorded_at,
        )
        for row in rows
    ]
    return set_cached_json(cache_key, result, ttl_seconds=30)


def user_to_out(user: User) -> UserOut:
    profile_image_url = (str(user.profile_image_url).strip() if user.profile_image_url else None) or None
    bio = (str(user.bio).strip() if user.bio else None) or None
    email = (str(user.email).strip().lower() if user.email else None) or None
    is_admin = str(user.username).strip().lower() in ADMIN_USERNAMES
    return UserOut(
        id=user.id,
        username=str(user.username),
        email=email,
        cash_balance=float(user.cash_balance),
        profile_image_url=profile_image_url,
        bio=bio,
        is_admin=is_admin,
    )


def normalize_optional_profile_field(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def normalize_team_for_player(player: Player, value: str | None) -> str | None:
    normalized = normalize_optional_profile_field(value)
    if not normalized:
        return None
    condensed = "".join(ch for ch in normalized.upper() if ch.isalnum())
    if not condensed:
        return None
    if str(player.sport).strip().upper() == "MLB":
        condensed = normalize_mlb_team_code(condensed) or condensed
    if len(condensed) > 8:
        return None
    return condensed


TERMINAL_GAME_STATUS_TOKENS = (
    "FINAL",
    "GAME OVER",
    "POSTPONED",
    "CANCELLED",
    "SUSPENDED",
    "COMPLETE",
)


def game_status_is_terminal(status_value: str | None) -> bool:
    status = str(status_value or "").strip().upper()
    if not status:
        return False
    return any(token in status for token in TERMINAL_GAME_STATUS_TOKENS)


FRIENDSHIP_STATUS_SELF = "SELF"
FRIENDSHIP_STATUS_NONE = "NONE"
FRIENDSHIP_STATUS_PENDING_INCOMING = "PENDING_INCOMING"
FRIENDSHIP_STATUS_PENDING_OUTGOING = "PENDING_OUTGOING"
FRIENDSHIP_STATUS_FRIENDS = "FRIENDS"
FRIENDSHIP_STATUS_DECLINED = "DECLINED"
FRIENDSHIP_ROW_PENDING = "PENDING"
FRIENDSHIP_ROW_ACCEPTED = "ACCEPTED"
FRIENDSHIP_ROW_DECLINED = "DECLINED"
NOTIFICATION_TYPE_FRIEND_REQUEST = "FRIEND_REQUEST"
NOTIFICATION_TYPE_FRIEND_ACCEPTED = "FRIEND_ACCEPTED"
NOTIFICATION_TYPE_DIRECT_MESSAGE = "DIRECT_MESSAGE"
NOTIFICATION_TYPE_FORUM_REPLY = "FORUM_REPLY"
NOTIFICATION_TYPE_SEASON_ENDING_INJURY = "SEASON_ENDING_INJURY"
NOTIFICATION_ENTITY_TYPE_PLAYER = "PLAYER"
SEASON_ENDING_INJURY_NOTIFICATION_DEDUPE_HOURS = 24
SEASON_ENDING_INJURY_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bout for (the )?season\b", re.IGNORECASE),
    re.compile(r"\bseason[- ]ending\b", re.IGNORECASE),
    re.compile(r"\bplaced on (the )?(60[- ]day|season[- ]ending)\b", re.IGNORECASE),
    re.compile(r"\b(torn|ruptured)\s+(acl|achilles|labrum|ucl)\b", re.IGNORECASE),
    re.compile(r"\btommy john\b", re.IGNORECASE),
)


def friendship_pair(user_a_id: int, user_b_id: int) -> tuple[int, int]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)


def get_friendship_between_users(db: Session, user_a_id: int, user_b_id: int) -> Friendship | None:
    if int(user_a_id) == int(user_b_id):
        return None
    user_low_id, user_high_id = friendship_pair(int(user_a_id), int(user_b_id))
    return db.execute(
        select(Friendship).where(
            Friendship.user_low_id == user_low_id,
            Friendship.user_high_id == user_high_id,
        )
    ).scalar_one_or_none()


def friendship_status_for_users(db: Session, user_a_id: int, user_b_id: int) -> FriendshipStatusOut:
    if int(user_a_id) == int(user_b_id):
        return FriendshipStatusOut(status=FRIENDSHIP_STATUS_SELF, can_message=False)

    friendship = get_friendship_between_users(db, int(user_a_id), int(user_b_id))
    if friendship is None:
        return FriendshipStatusOut(status=FRIENDSHIP_STATUS_NONE, can_message=False)

    if str(friendship.status) == FRIENDSHIP_ROW_ACCEPTED:
        return FriendshipStatusOut(
            friendship_id=int(friendship.id),
            status=FRIENDSHIP_STATUS_FRIENDS,
            can_message=True,
        )

    if str(friendship.status) == FRIENDSHIP_ROW_PENDING:
        requested_by_user_id = int(friendship.requested_by_user_id)
        return FriendshipStatusOut(
            friendship_id=int(friendship.id),
            status=FRIENDSHIP_STATUS_PENDING_OUTGOING
            if requested_by_user_id == int(user_a_id)
            else FRIENDSHIP_STATUS_PENDING_INCOMING,
            can_message=False,
        )

    return FriendshipStatusOut(
        friendship_id=int(friendship.id),
        status=FRIENDSHIP_STATUS_DECLINED,
        can_message=False,
    )


def require_friendship_between_users(db: Session, user_a_id: int, user_b_id: int) -> Friendship:
    friendship = get_friendship_between_users(db, int(user_a_id), int(user_b_id))
    if friendship is None or str(friendship.status) != FRIENDSHIP_ROW_ACCEPTED:
        raise HTTPException(403, "Only friends can direct message each other.")
    return friendship


def user_profile_to_out(
    user: User,
    snapshot: AccountRiskSnapshot,
    *,
    friendship: FriendshipStatusOut | None = None,
    leaderboard_rank: int | None = None,
    community_posts: list[ForumPostSummaryOut] | None = None,
) -> UserProfileOut:
    holdings = sorted(snapshot.positions, key=lambda position: abs(position.market_value), reverse=True)
    baseline_cash = float(REGISTER_STARTING_CASH)
    equity = float(snapshot.equity)
    gross_exposure = float(snapshot.gross_exposure)
    return UserProfileOut(
        id=int(user.id),
        username=str(user.username),
        profile_image_url=normalize_optional_profile_field(user.profile_image_url),
        bio=normalize_optional_profile_field(user.bio),
        cash_balance=float(snapshot.cash_balance),
        holdings_value=float(snapshot.net_exposure),
        gross_exposure=gross_exposure,
        equity=equity,
        return_pct=((equity - baseline_cash) / baseline_cash) * 100 if baseline_cash > 0 else 0,
        leaderboard_rank=leaderboard_rank,
        holdings=[
            UserProfileHoldingOut(
                player_id=int(position.player.id),
                player_name=str(position.player.name),
                sport=str(position.player.sport),
                team=str(position.player.team),
                position=str(position.player.position),
                shares_owned=float(position.shares),
                average_entry_price=float(position.average_entry_price),
                basis_amount=float(position_display_basis_amount(position)),
                spot_price=float(position.spot_price),
                market_value=float(position.market_value),
                unrealized_pnl=float(position_unrealized_pnl(position)),
                unrealized_pnl_pct=float(
                    (position_unrealized_pnl(position) / position_display_basis_amount(position)) * Decimal("100")
                    if position_display_basis_amount(position) > 0
                    else Decimal("0")
                ),
                allocation_pct=float((abs(position.market_value) / snapshot.gross_exposure) * Decimal("100"))
                if snapshot.gross_exposure > 0
                else 0.0,
            )
            for position in holdings
        ],
        community_posts=community_posts or [],
        friendship=friendship or FriendshipStatusOut(status=FRIENDSHIP_STATUS_SELF, can_message=False),
    )


def forum_post_summaries_for_user(
    db: Session,
    *,
    user_id: int,
    author_username: str,
    limit: int = 10,
) -> list[ForumPostSummaryOut]:
    posts = db.execute(
        select(ForumPost)
        .where(ForumPost.user_id == int(user_id))
        .order_by(ForumPost.updated_at.desc(), ForumPost.id.desc())
        .limit(max(1, min(int(limit), 50)))
    ).scalars().all()
    if not posts:
        return []

    fetched_post_ids = [int(post.id) for post in posts]
    hidden_post_ids = hidden_content_id_set(db, MODERATION_CONTENT_FORUM_POST, fetched_post_ids)
    visible_posts = [post for post in posts if int(post.id) not in hidden_post_ids]
    if not visible_posts:
        return []

    visible_post_ids = [int(post.id) for post in visible_posts]
    comment_records = db.execute(
        select(ForumComment.id, ForumComment.post_id)
        .where(ForumComment.post_id.in_(visible_post_ids))
    ).all()
    comment_ids = [int(comment_id) for comment_id, _ in comment_records]
    hidden_comment_ids = hidden_content_id_set(db, MODERATION_CONTENT_FORUM_COMMENT, comment_ids)
    comment_count_by_post_id: dict[int, int] = {post_id: 0 for post_id in visible_post_ids}
    for comment_id, post_id in comment_records:
        if int(comment_id) in hidden_comment_ids:
            continue
        comment_count_by_post_id[int(post_id)] = comment_count_by_post_id.get(int(post_id), 0) + 1

    return [
        forum_post_summary_to_out(
            post=post,
            author_username=author_username,
            comment_count=comment_count_by_post_id.get(int(post.id), 0),
        )
        for post in visible_posts
    ]


def position_display_basis_amount(position: PositionRisk) -> Decimal:
    if position.mark_basis_amount > 0:
        return position.mark_basis_amount
    if position.entry_basis_amount > 0:
        return position.entry_basis_amount
    return position.basis_amount


def position_unrealized_pnl(position: PositionRisk) -> Decimal:
    display_basis = position_display_basis_amount(position)
    abs_shares = abs(position.shares)
    if display_basis <= 0 or abs_shares <= 0:
        return Decimal("0")
    current_notional = abs_shares * position.spot_price
    pnl = current_notional - display_basis if position.shares > 0 else display_basis - current_notional
    return Decimal("0") if abs(pnl) < Decimal("0.005") else pnl


def filtered_snapshot_for_sport(snapshot: AccountRiskSnapshot, sport: str) -> AccountRiskSnapshot:
    sport_code = normalize_sport_code(sport)
    positions = [position for position in snapshot.positions if str(position.player.sport).upper() == sport_code]
    net_exposure = sum((position.market_value for position in positions), Decimal("0"))
    gross_exposure = sum((abs(position.market_value) for position in positions), Decimal("0"))
    equity = snapshot.cash_balance + net_exposure
    return AccountRiskSnapshot(
        cash_balance=snapshot.cash_balance,
        equity=equity,
        net_exposure=net_exposure,
        gross_exposure=gross_exposure,
        margin_used=Decimal("0"),
        available_buying_power=max(Decimal("0"), snapshot.cash_balance),
        margin_call=False,
        positions=positions,
    )


def get_friend_user_ids(db: Session, current_user_id: int) -> set[int]:
    rows = db.execute(
        select(Friendship).where(
            Friendship.status == FRIENDSHIP_ROW_ACCEPTED,
            or_(
                Friendship.user_low_id == int(current_user_id),
                Friendship.user_high_id == int(current_user_id),
            ),
        )
    ).scalars().all()
    friend_ids: set[int] = set()
    for row in rows:
        if int(row.user_low_id) == int(current_user_id):
            friend_ids.add(int(row.user_high_id))
        else:
            friend_ids.add(int(row.user_low_id))
    return friend_ids


def build_leaderboard_entries(
    db: Session,
    *,
    current_user_id: int,
    scope: str,
    sport: str,
    limit: int,
) -> list[LeaderboardEntryOut]:
    all_users = db.execute(select(User).order_by(User.username.asc())).scalars().all()
    accepted_friend_ids = get_friend_user_ids(db, current_user_id)
    visible_user_ids = {int(current_user_id)}
    if scope == "friends":
        visible_user_ids.update(accepted_friend_ids)

    rows: list[LeaderboardEntryOut] = []
    for user in all_users:
        user_id = int(user.id)
        if scope == "friends" and user_id not in visible_user_ids:
            continue
        snapshot = build_account_risk_snapshot(db=db, user=user, for_update=False)
        filtered_snapshot = snapshot if sport == "ALL" else filtered_snapshot_for_sport(snapshot, sport)
        equity = float(filtered_snapshot.equity)
        cash_balance = float(filtered_snapshot.cash_balance)
        holdings_value = float(filtered_snapshot.net_exposure)
        baseline_cash = float(REGISTER_STARTING_CASH)
        return_pct = ((equity - baseline_cash) / baseline_cash) * 100 if baseline_cash > 0 else 0
        rows.append(
            LeaderboardEntryOut(
                user_id=user_id,
                username=str(user.username),
                profile_image_url=normalize_optional_profile_field(user.profile_image_url),
                equity=equity,
                cash_balance=cash_balance,
                holdings_value=holdings_value,
                return_pct=return_pct,
                rank=0,
                is_current_user=user_id == int(current_user_id),
                is_friend=user_id in accepted_friend_ids,
            )
        )

    sorted_rows = sorted(
        rows,
        key=lambda row: (row.equity, row.return_pct, row.holdings_value, row.username.lower()),
        reverse=True,
    )
    for index, row in enumerate(sorted_rows, start=1):
        row.rank = index
    return sorted_rows[:limit]


def leaderboard_rank_for_user(db: Session, *, user_id: int) -> int | None:
    rows = build_leaderboard_entries(
        db,
        current_user_id=int(user_id),
        scope="global",
        sport="ALL",
        limit=10_000,
    )
    for row in rows:
        if int(row.user_id) == int(user_id):
            return int(row.rank)
    return None


def notification_href(notification_type: str, *, actor_username: str | None, entity_id: int | None) -> str | None:
    if notification_type == NOTIFICATION_TYPE_DIRECT_MESSAGE and entity_id is not None:
        return f"/inbox?thread={int(entity_id)}"
    if notification_type == NOTIFICATION_TYPE_FORUM_REPLY and entity_id is not None:
        return f"/community/{int(entity_id)}"
    if notification_type == NOTIFICATION_TYPE_SEASON_ENDING_INJURY and entity_id is not None:
        return f"/player/{int(entity_id)}"
    if notification_type in {NOTIFICATION_TYPE_FRIEND_REQUEST, NOTIFICATION_TYPE_FRIEND_ACCEPTED} and actor_username:
        return f"/profile/{actor_username}"
    return None


def notification_to_out(
    db: Session,
    notification: Notification,
    *,
    actor: User | None = None,
) -> NotificationOut:
    resolved_actor = actor
    if resolved_actor is None and notification.actor_user_id is not None:
        resolved_actor = db.get(User, int(notification.actor_user_id))
    actor_username = str(resolved_actor.username) if resolved_actor else None
    return NotificationOut(
        id=int(notification.id),
        type=str(notification.type),
        message=str(notification.message),
        actor_username=actor_username,
        actor_profile_image_url=normalize_optional_profile_field(resolved_actor.profile_image_url) if resolved_actor else None,
        entity_type=normalize_optional_profile_field(notification.entity_type),
        entity_id=int(notification.entity_id) if notification.entity_id is not None else None,
        href=notification_href(
            str(notification.type),
            actor_username=actor_username,
            entity_id=int(notification.entity_id) if notification.entity_id is not None else None,
        ),
        read_at=notification.read_at,
        created_at=notification.created_at,
    )


def create_notification(
    db: Session,
    *,
    user_id: int,
    notification_type: str,
    message: str,
    actor_user_id: int | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
) -> Notification:
    notification = Notification(
        user_id=int(user_id),
        type=str(notification_type),
        actor_user_id=int(actor_user_id) if actor_user_id is not None else None,
        entity_type=normalize_optional_profile_field(entity_type),
        entity_id=int(entity_id) if entity_id is not None else None,
        message=str(message).strip(),
    )
    db.add(notification)
    return notification


def season_ending_injury_reason_from_text(*texts: str | None) -> str | None:
    merged_text = " | ".join(
        str(value).strip()
        for value in texts
        if value is not None and str(value).strip()
    )
    if not merged_text:
        return None

    # Suppress common non-season-ending statuses that include injury context.
    if any(token in merged_text.lower() for token in ("day-to-day", "questionable", "probable", "game-time decision")):
        return None

    for pattern in SEASON_ENDING_INJURY_PATTERNS:
        match = pattern.search(merged_text)
        if match:
            return match.group(0)
    return None


def create_season_ending_injury_notifications(
    db: Session,
    *,
    player: Player,
    matched_reason: str,
    headline: str | None = None,
    source: str | None = None,
) -> int:
    admin_rows = db.execute(
        select(User.id, User.username).where(func.lower(User.username).in_(sorted(ADMIN_USERNAMES)))
    ).all()
    if not admin_rows:
        return 0

    created_count = 0
    dedupe_start = chicago_now() - timedelta(hours=SEASON_ENDING_INJURY_NOTIFICATION_DEDUPE_HOURS)
    for admin_user_id, _admin_username in admin_rows:
        existing = db.execute(
            select(Notification.id)
            .where(
                Notification.user_id == int(admin_user_id),
                Notification.type == NOTIFICATION_TYPE_SEASON_ENDING_INJURY,
                Notification.entity_type == NOTIFICATION_ENTITY_TYPE_PLAYER,
                Notification.entity_id == int(player.id),
                Notification.created_at >= dedupe_start,
            )
            .limit(1)
        ).scalar_one_or_none()
        if existing is not None:
            continue

        create_notification(
            db=db,
            user_id=int(admin_user_id),
            notification_type=NOTIFICATION_TYPE_SEASON_ENDING_INJURY,
            message=(
                f"Potential season-ending injury alert: {player.name} ({player.team} {player.position}) "
                f"- {(normalize_optional_profile_field(headline) or matched_reason)}"
                + (f" [{normalize_optional_profile_field(source)}]" if normalize_optional_profile_field(source) else "")
                + ". Review and close out if needed."
            ),
            entity_type=NOTIFICATION_ENTITY_TYPE_PLAYER,
            entity_id=int(player.id),
        )
        created_count += 1
    return created_count


def watchlist_player_to_out(
    player: Player,
    *,
    added_at: datetime,
    stats_snapshot: dict[int, PlayerStatsSnapshot],
) -> WatchlistPlayerOut:
    fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
    player_out = player_to_out(
        player=player,
        fundamental_price=fundamental,
        points_to_date=points_to_date,
        latest_week=latest_week,
        shares_held=Decimal("0"),
        shares_short=Decimal("0"),
    )
    return WatchlistPlayerOut(
        player_id=int(player.id),
        sport=str(player.sport),
        name=str(player.name),
        team=str(player.team),
        position=str(player.position),
        spot_price=float(player_out.spot_price),
        base_price=float(player.base_price),
        live=player_out.live,
        added_at=added_at,
    )


def normalize_forum_text(value: str, field_name: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise HTTPException(400, f"{field_name} is required")
    return normalized


def forum_body_preview(body: str, max_len: int = 220) -> str:
    compact = " ".join((body or "").strip().split())
    if len(compact) <= max_len:
        return compact
    return f"{compact[: max_len - 3].rstrip()}..."


def normalize_direct_message_body(value: str | None) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise HTTPException(400, "Message body is required.")
    return normalized


def direct_thread_pair(user_a_id: int, user_b_id: int) -> tuple[int, int]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)


def direct_thread_counterpart_user_id(thread: DirectThread, current_user_id: int) -> int:
    if int(thread.user_one_id) == current_user_id:
        return int(thread.user_two_id)
    if int(thread.user_two_id) == current_user_id:
        return int(thread.user_one_id)
    raise HTTPException(403, "Direct thread access denied.")


def direct_thread_last_read_at(thread: DirectThread, current_user_id: int) -> datetime | None:
    if int(thread.user_one_id) == current_user_id:
        return thread.user_one_last_read_at
    if int(thread.user_two_id) == current_user_id:
        return thread.user_two_last_read_at
    raise HTTPException(403, "Direct thread access denied.")


def mark_direct_thread_read(thread: DirectThread, current_user_id: int, at_time: datetime) -> None:
    if int(thread.user_one_id) == current_user_id:
        thread.user_one_last_read_at = at_time
        return
    if int(thread.user_two_id) == current_user_id:
        thread.user_two_last_read_at = at_time
        return
    raise HTTPException(403, "Direct thread access denied.")


def get_direct_thread_for_user_or_raise(
    db: Session,
    *,
    thread_id: int,
    user_id: int,
    for_update: bool = False,
) -> DirectThread:
    stmt = select(DirectThread).where(
        DirectThread.id == int(thread_id),
        or_(
            DirectThread.user_one_id == int(user_id),
            DirectThread.user_two_id == int(user_id),
        ),
    )
    if for_update:
        stmt = stmt.with_for_update()
    thread = db.execute(stmt).scalar_one_or_none()
    if not thread:
        raise HTTPException(404, "Direct thread not found.")
    return thread


def direct_message_preview(body: str, max_len: int = 120) -> str:
    return forum_body_preview(body, max_len=max_len)


def build_direct_thread_summaries(
    db: Session,
    *,
    current_user_id: int,
    threads: list[DirectThread],
) -> list[DirectThreadSummaryOut]:
    if not threads:
        return []

    thread_by_id = {int(thread.id): thread for thread in threads}
    counterpart_user_ids = {
        direct_thread_counterpart_user_id(thread, current_user_id)
        for thread in threads
    }
    counterpart_users = db.execute(
        select(User).where(User.id.in_(counterpart_user_ids))
    ).scalars().all()
    users_by_id = {int(user.id): user for user in counterpart_users}

    message_rows = db.execute(
        select(DirectMessage, User.username)
        .join(User, DirectMessage.sender_user_id == User.id)
        .where(DirectMessage.thread_id.in_(list(thread_by_id.keys())))
        .order_by(DirectMessage.created_at.desc(), DirectMessage.id.desc())
    ).all()

    last_message_by_thread: dict[int, DirectMessage] = {}
    last_sender_by_thread: dict[int, str] = {}
    message_count_by_thread: dict[int, int] = defaultdict(int)
    unread_count_by_thread: dict[int, int] = defaultdict(int)

    for message, sender_username in message_rows:
        thread_id = int(message.thread_id)
        if thread_id not in last_message_by_thread:
            last_message_by_thread[thread_id] = message
            last_sender_by_thread[thread_id] = str(sender_username)
        message_count_by_thread[thread_id] += 1

        if int(message.sender_user_id) == current_user_id:
            continue

        thread = thread_by_id[thread_id]
        last_read_at = direct_thread_last_read_at(thread, current_user_id)
        if last_read_at is None or message.created_at > last_read_at:
            unread_count_by_thread[thread_id] += 1

    summaries: list[DirectThreadSummaryOut] = []
    for thread in threads:
        thread_id = int(thread.id)
        counterpart_id = direct_thread_counterpart_user_id(thread, current_user_id)
        counterpart = users_by_id.get(counterpart_id)
        if counterpart is None:
            continue
        last_message = last_message_by_thread.get(thread_id)
        summaries.append(
            DirectThreadSummaryOut(
                id=thread_id,
                counterpart_user_id=counterpart_id,
                counterpart_username=str(counterpart.username),
                counterpart_profile_image_url=normalize_optional_profile_field(counterpart.profile_image_url),
                created_at=thread.created_at,
                updated_at=thread.updated_at,
                last_message_at=thread.last_message_at,
                last_message_preview=direct_message_preview(str(last_message.body)) if last_message else None,
                last_message_sender_username=last_sender_by_thread.get(thread_id),
                message_count=int(message_count_by_thread.get(thread_id, 0)),
                unread_count=int(unread_count_by_thread.get(thread_id, 0)),
            )
        )
    return summaries


def build_friends_dashboard(db: Session, *, current_user_id: int) -> FriendsDashboardOut:
    friendship_rows = db.execute(
        select(Friendship).where(
            or_(
                Friendship.user_low_id == int(current_user_id),
                Friendship.user_high_id == int(current_user_id),
            )
        )
    ).scalars().all()

    related_user_ids: set[int] = set()
    for friendship in friendship_rows:
        counterpart_id = (
            int(friendship.user_high_id)
            if int(friendship.user_low_id) == int(current_user_id)
            else int(friendship.user_low_id)
        )
        related_user_ids.add(counterpart_id)

    users_by_id: dict[int, User] = {}
    if related_user_ids:
        users = db.execute(select(User).where(User.id.in_(related_user_ids))).scalars().all()
        users_by_id = {int(user.id): user for user in users}

    friends: list[FriendSummaryOut] = []
    incoming_requests: list[FriendRequestOut] = []
    outgoing_requests: list[FriendRequestOut] = []

    for friendship in friendship_rows:
        counterpart_id = (
            int(friendship.user_high_id)
            if int(friendship.user_low_id) == int(current_user_id)
            else int(friendship.user_low_id)
        )
        counterpart = users_by_id.get(counterpart_id)
        if counterpart is None:
            continue

        if str(friendship.status) == FRIENDSHIP_ROW_ACCEPTED:
            friends.append(
                FriendSummaryOut(
                    friendship_id=int(friendship.id),
                    user_id=counterpart_id,
                    username=str(counterpart.username),
                    profile_image_url=normalize_optional_profile_field(counterpart.profile_image_url),
                    since=friendship.responded_at or friendship.updated_at or friendship.created_at,
                )
            )
            continue

        if str(friendship.status) != FRIENDSHIP_ROW_PENDING:
            continue

        request = FriendRequestOut(
            friendship_id=int(friendship.id),
            user_id=counterpart_id,
            username=str(counterpart.username),
            profile_image_url=normalize_optional_profile_field(counterpart.profile_image_url),
            requested_at=friendship.created_at,
            requested_by_user_id=int(friendship.requested_by_user_id),
            direction="outgoing"
            if int(friendship.requested_by_user_id) == int(current_user_id)
            else "incoming",
        )
        if request.direction == "incoming":
            incoming_requests.append(request)
        else:
            outgoing_requests.append(request)

    friends.sort(key=lambda row: row.username.lower())
    incoming_requests.sort(key=lambda row: row.requested_at, reverse=True)
    outgoing_requests.sort(key=lambda row: row.requested_at, reverse=True)
    return FriendsDashboardOut(
        friends=friends,
        incoming_requests=incoming_requests,
        outgoing_requests=outgoing_requests,
    )


def forum_comment_to_out(comment: ForumComment, author_username: str) -> ForumCommentOut:
    return ForumCommentOut(
        id=int(comment.id),
        post_id=int(comment.post_id),
        body=str(comment.body),
        author_username=author_username,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


def forum_post_summary_to_out(
    post: ForumPost,
    author_username: str,
    comment_count: int,
) -> ForumPostSummaryOut:
    return ForumPostSummaryOut(
        id=int(post.id),
        title=str(post.title),
        body_preview=forum_body_preview(str(post.body)),
        author_username=author_username,
        comment_count=comment_count,
        view_count=int(post.view_count or 0),
        created_at=post.created_at,
        updated_at=post.updated_at,
    )


def normalize_moderation_content_type(raw_value: str) -> str:
    content_type = (raw_value or "").strip().upper()
    if content_type not in MODERATION_CONTENT_TYPES:
        allowed = ", ".join(sorted(MODERATION_CONTENT_TYPES))
        raise HTTPException(400, f"content_type must be one of: {allowed}")
    return content_type


def normalize_moderation_report_status(raw_value: str, *, allow_open: bool = True) -> str:
    status = (raw_value or "").strip().upper()
    if status not in MODERATION_REPORT_STATUSES:
        allowed = ", ".join(sorted(MODERATION_REPORT_STATUSES))
        raise HTTPException(400, f"status must be one of: {allowed}")
    if not allow_open and status == MODERATION_REPORT_STATUS_OPEN:
        raise HTTPException(400, "status must be RESOLVED or DISMISSED for this action.")
    return status


def normalize_moderation_action(raw_value: str) -> str:
    action = (raw_value or MODERATION_ACTION_NONE).strip().upper()
    if action not in MODERATION_ACTIONS:
        allowed = ", ".join(sorted(MODERATION_ACTIONS))
        raise HTTPException(400, f"action must be one of: {allowed}")
    return action


def hidden_content_id_set(db: Session, content_type: str, content_ids: list[int]) -> set[int]:
    if not content_ids:
        return set()
    rows = db.execute(
        select(ContentModeration.content_id).where(
            ContentModeration.content_type == content_type,
            ContentModeration.action == CONTENT_MODERATION_ACTION_HIDDEN,
            ContentModeration.content_id.in_(content_ids),
        )
    ).all()
    return {int(content_id) for (content_id,) in rows}


def is_content_hidden(db: Session, content_type: str, content_id: int) -> bool:
    row = db.execute(
        select(ContentModeration.id).where(
            ContentModeration.content_type == content_type,
            ContentModeration.content_id == int(content_id),
            ContentModeration.action == CONTENT_MODERATION_ACTION_HIDDEN,
        )
    ).scalar_one_or_none()
    return bool(row)


def ensure_moderation_target_exists_or_raise(db: Session, content_type: str, content_id: int) -> None:
    if content_type == MODERATION_CONTENT_FORUM_POST:
        target = db.get(ForumPost, int(content_id))
    elif content_type == MODERATION_CONTENT_FORUM_COMMENT:
        target = db.get(ForumComment, int(content_id))
    else:
        target = None
    if not target:
        raise HTTPException(404, "Report target not found.")


def moderation_report_to_out(report: ContentReport) -> ModerationReportOut:
    return ModerationReportOut(
        id=int(report.id),
        content_type=str(report.content_type),
        content_id=int(report.content_id),
        reason=str(report.reason),
        details=normalize_optional_profile_field(report.details),
        page_path=normalize_optional_profile_field(report.page_path),
        status=str(report.status),
        action_taken=str(report.action_taken or MODERATION_ACTION_NONE),
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


def admin_moderation_report_to_out(
    report: ContentReport,
    *,
    reporter_username: str,
    reviewed_by_username: str | None,
    target_preview: str | None,
    target_exists: bool,
    is_hidden: bool,
) -> AdminModerationReportOut:
    base = moderation_report_to_out(report)
    return AdminModerationReportOut(
        **base.model_dump(),
        reporter_user_id=int(report.reporter_user_id),
        reporter_username=reporter_username,
        reviewed_by_user_id=int(report.reviewed_by_user_id) if report.reviewed_by_user_id is not None else None,
        reviewed_by_username=reviewed_by_username,
        moderator_note=normalize_optional_profile_field(report.moderator_note),
        reviewed_at=report.reviewed_at,
        target_preview=target_preview,
        target_exists=target_exists,
        is_content_hidden=is_hidden,
    )


def create_auth_session_out(db: Session, user: User) -> AuthSessionOut:
    token = generate_session_token()
    expires_at = session_expiry_from_now()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_session_token(token),
            expires_at=expires_at,
        )
    )
    return AuthSessionOut(
        access_token=token,
        expires_at=expires_at,
        user=user_to_out(user),
    )


def admin_audit_session_to_out(
    session: UserSession,
    *,
    username: str,
    email: str | None,
    now: datetime,
) -> AdminAuditSessionOut:
    status_label = "ACTIVE"
    if session.revoked_at is not None:
        status_label = "REVOKED"
    elif session.expires_at <= now:
        status_label = "EXPIRED"
    return AdminAuditSessionOut(
        id=int(session.id),
        user_id=int(session.user_id),
        username=str(username),
        email=normalize_optional_profile_field(email.lower() if email else None),
        created_at=session.created_at,
        expires_at=session.expires_at,
        revoked_at=session.revoked_at,
        status=status_label,
    )


def admin_audit_trade_to_out(
    transaction: Transaction,
    *,
    username: str,
    player: Player | None,
) -> AdminAuditTradeOut:
    return AdminAuditTradeOut(
        id=int(transaction.id),
        user_id=int(transaction.user_id),
        username=str(username),
        player_id=int(transaction.player_id) if transaction.player_id is not None else None,
        player_name=str(player.name) if player is not None else None,
        sport=str(player.sport) if player is not None else None,
        team=str(player.team) if player is not None else None,
        position=str(player.position) if player is not None else None,
        trade_type=str(transaction.type),
        shares=float(transaction.shares),
        unit_price=float(transaction.unit_price),
        amount=float(transaction.amount),
        created_at=transaction.created_at,
    )


def admin_audit_direct_message_to_out(
    message: DirectMessage,
    *,
    sender_username: str,
    recipient_user_id: int,
    recipient_username: str,
) -> AdminAuditDirectMessageOut:
    return AdminAuditDirectMessageOut(
        id=int(message.id),
        thread_id=int(message.thread_id),
        sender_user_id=int(message.sender_user_id),
        sender_username=str(sender_username),
        recipient_user_id=int(recipient_user_id),
        recipient_username=str(recipient_username),
        body_preview=direct_message_preview(str(message.body), max_len=140),
        created_at=message.created_at,
    )


def bot_profile_to_out(db: Session, profile: BotProfile) -> AdminBotProfileOut:
    account_exists = db.execute(
        select(exists().where(User.username == str(profile.username)))
    ).scalar_one()
    return AdminBotProfileOut(
        id=int(profile.id),
        name=str(profile.name),
        username=str(profile.username),
        persona=str(profile.persona),
        is_active=bool(profile.is_active),
        account_exists=bool(account_exists),
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def bot_profiles_to_simulation_config(profiles: list[BotProfile]) -> list[dict[str, str]]:
    return [
        {
            "name": str(profile.name),
            "username": str(profile.username),
            "persona": str(profile.persona),
        }
        for profile in profiles
    ]


def write_bot_simulation_config(run_stamp: str, profiles: list[BotProfile]) -> tuple[Path, int]:
    BOT_SIMULATION_RUN_DIR.mkdir(parents=True, exist_ok=True)
    config_path = BOT_SIMULATION_RUN_DIR / f"bot-config-{run_stamp}.json"
    payload = bot_profiles_to_simulation_config(profiles)
    config_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return config_path, len(payload)


def bot_simulation_api_base() -> str:
    configured = (os.environ.get("BOT_SIMULATION_API_BASE") or "").strip().rstrip("/")
    if configured:
        return configured
    port = (os.environ.get("PORT") or "8000").strip() or "8000"
    return f"http://127.0.0.1:{port}"


def start_bot_simulation_process(
    *,
    admin_username: str,
    profiles: list[BotProfile],
    payload: AdminBotSimulationStartIn,
) -> AdminBotSimulationStatusOut:
    BOT_SIMULATION_STATE.refresh()
    if BOT_SIMULATION_STATE.process is not None and BOT_SIMULATION_STATE.process.poll() is None:
        raise HTTPException(409, "A bot simulation is already running.")

    if not profiles:
        raise HTTPException(400, "No active bot profiles are available to simulate.")

    try:
        BOT_SIMULATION_RUN_DIR.mkdir(parents=True, exist_ok=True)
        run_stamp = chicago_now().strftime("%Y%m%d-%H%M%S")
        config_path, active_bot_count = write_bot_simulation_config(run_stamp, profiles)
        summary_path = BOT_SIMULATION_RUN_DIR / f"bot-summary-{run_stamp}.json"
        log_path = BOT_SIMULATION_RUN_DIR / f"bot-run-{run_stamp}.log"
        script_path = Path(__file__).resolve().parent.parent / "scripts" / "simulate_users.py"

        command = [
            sys.executable,
            str(script_path),
            "--base-url",
            bot_simulation_api_base(),
            "--bot-config-file",
            str(config_path),
            "--duration-seconds",
            str(int(payload.duration_seconds)),
            "--min-delay-ms",
            str(int(payload.min_delay_ms)),
            "--max-delay-ms",
            str(int(payload.max_delay_ms)),
            "--startup-stagger-ms",
            str(int(payload.startup_stagger_ms)),
            "--summary-file",
            str(summary_path),
        ]
        if payload.reuse_existing:
            command.append("--reuse-existing")
        if payload.spoof_forwarded_for:
            command.append("--spoof-forwarded-for")

        log_handle = open(log_path, "a", encoding="utf-8")
        process = subprocess.Popen(
            command,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            cwd=str(Path(__file__).resolve().parent.parent.parent),
        )
    except Exception as exc:
        BOT_SIMULATION_STATE.process = None
        BOT_SIMULATION_STATE.completed_at = chicago_now()
        BOT_SIMULATION_STATE.exit_code = 1
        BOT_SIMULATION_STATE.message = f"Unable to start bot simulation: {exc}"
        raise HTTPException(500, BOT_SIMULATION_STATE.message) from exc

    BOT_SIMULATION_STATE.process = process
    BOT_SIMULATION_STATE.started_at = chicago_now()
    BOT_SIMULATION_STATE.completed_at = None
    BOT_SIMULATION_STATE.requested_by_username = admin_username
    BOT_SIMULATION_STATE.duration_seconds = int(payload.duration_seconds)
    BOT_SIMULATION_STATE.min_delay_ms = int(payload.min_delay_ms)
    BOT_SIMULATION_STATE.max_delay_ms = int(payload.max_delay_ms)
    BOT_SIMULATION_STATE.startup_stagger_ms = int(payload.startup_stagger_ms)
    BOT_SIMULATION_STATE.active_bot_count = int(active_bot_count)
    BOT_SIMULATION_STATE.config_file = str(config_path)
    BOT_SIMULATION_STATE.summary_file = str(summary_path)
    BOT_SIMULATION_STATE.log_file = str(log_path)
    BOT_SIMULATION_STATE.exit_code = None
    BOT_SIMULATION_STATE.message = f"Started bot simulation with {active_bot_count} active bot profile(s)."
    BOT_SIMULATION_STATE._log_handle = log_handle
    return BOT_SIMULATION_STATE.status_out()


def stop_bot_simulation_process(*, force: bool = False) -> AdminBotSimulationStatusOut:
    BOT_SIMULATION_STATE.refresh()
    process = BOT_SIMULATION_STATE.process
    if process is None or process.poll() is not None:
        BOT_SIMULATION_STATE.message = "No bot simulation is currently running."
        return BOT_SIMULATION_STATE.status_out()

    if force:
        process.kill()
        BOT_SIMULATION_STATE.message = "Bot simulation force-stopped."
    else:
        process.terminate()
        BOT_SIMULATION_STATE.message = "Bot simulation stop requested."
    BOT_SIMULATION_STATE.completed_at = chicago_now()
    return BOT_SIMULATION_STATE.status_out()


@app.post("/auth/register", response_model=AuthSessionOut)
def register(
    payload: AuthRegisterIn,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_ip_rate_limit(
        request,
        bucket="auth:register",
        limit=RATE_LIMIT_AUTH_REGISTER,
        window_seconds=RATE_LIMIT_AUTH_REGISTER_WINDOW_SECONDS,
        label="auth register",
    )
    username = normalize_username(payload.username)
    username_key = username_lookup_key(username)
    email = normalize_email(payload.email)
    enforce_rate_limit(
        key=f"auth:register:username:{username_key}",
        limit=RATE_LIMIT_AUTH_REGISTER,
        window_seconds=RATE_LIMIT_AUTH_REGISTER_WINDOW_SECONDS,
        label="auth register",
    )
    validate_registration_request(payload)
    existing = db.execute(select(User).where(func.lower(User.username) == username_key)).scalar_one_or_none()
    existing_by_email = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing_by_email and existing and existing_by_email.id != existing.id:
        raise HTTPException(409, "That email is already in use.")
    if existing_by_email and not existing:
        if existing_by_email.password_hash:
            raise HTTPException(409, "That email is already in use.")
        raise HTTPException(409, "That email is already reserved by another account.")
    if existing and existing.password_hash:
        raise HTTPException(409, f"User '{existing.username}' already exists.")
    if existing and not existing.password_hash:
        if existing.email and str(existing.email).strip().lower() != email:
            raise HTTPException(409, "That username is already reserved with a different email.")
        existing.email = email
        existing.password_hash = hash_password(payload.password)
        out = create_auth_session_out(db=db, user=existing)
        db.commit()
        return out

    user = User(
        username=username,
        email=email,
        cash_balance=float(REGISTER_STARTING_CASH),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()

    out = create_auth_session_out(db=db, user=user)
    db.commit()
    return out


@app.post("/auth/login", response_model=AuthSessionOut)
def login(
    payload: AuthLoginIn,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_ip_rate_limit(
        request,
        bucket="auth:login",
        limit=RATE_LIMIT_AUTH_LOGIN,
        window_seconds=RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS,
        label="auth login",
    )
    identifier = normalize_login_identifier(payload.username)
    enforce_rate_limit(
        key=f"auth:login:identifier:{identifier}",
        limit=RATE_LIMIT_AUTH_LOGIN,
        window_seconds=RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS,
        label="auth login",
    )
    if "@" in identifier:
        user = db.execute(select(User).where(User.email == identifier)).scalar_one_or_none()
    else:
        user = db.execute(select(User).where(func.lower(User.username) == identifier)).scalar_one_or_none()
    if user and not user.password_hash:
        raise auth_exception("Account has no password yet. Register once to set credentials.")
    if not user or not verify_password(payload.password, user.password_hash):
        raise auth_exception("Invalid username or password.")

    out = create_auth_session_out(db=db, user=user)
    db.commit()
    return out


@app.post("/auth/logout", response_model=AuthLogoutOut)
def logout(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    auth.session.revoked_at = chicago_now()
    db.commit()
    return AuthLogoutOut(ok=True)


@app.get("/auth/me", response_model=UserOut)
def auth_me(auth: AuthContext = Depends(get_auth_context)):
    return user_to_out(auth.user)


@app.post("/auth/password", response_model=AuthPasswordUpdateOut)
def auth_update_password(
    payload: AuthPasswordUpdateIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=True,
    )
    if not user.password_hash:
        raise HTTPException(400, "No password is set for this account.")
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect.")
    if payload.current_password == payload.new_password:
        raise HTTPException(400, "New password must be different from current password.")

    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return AuthPasswordUpdateOut(ok=True)


@app.post("/auth/password-reset/request", response_model=AuthPasswordResetRequestOut)
def auth_password_reset_request(
    payload: AuthPasswordResetRequestIn,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_ip_rate_limit(
        request,
        bucket="auth:password-reset-request",
        limit=RATE_LIMIT_AUTH_PASSWORD_RESET_REQUEST,
        window_seconds=RATE_LIMIT_AUTH_PASSWORD_RESET_REQUEST_WINDOW_SECONDS,
        label="password reset request",
    )
    email = normalize_email(payload.email)
    enforce_rate_limit(
        key=f"auth:password-reset-request:email:{email}",
        limit=RATE_LIMIT_AUTH_PASSWORD_RESET_REQUEST,
        window_seconds=RATE_LIMIT_AUTH_PASSWORD_RESET_REQUEST_WINDOW_SECONDS,
        label="password reset request",
    )

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or not user.password_hash:
        return AuthPasswordResetRequestOut(ok=True)

    now = chicago_now()
    revoke_password_reset_tokens_for_user(db, user.id, used_at=now)

    raw_token = generate_session_token()
    expires_at = now + timedelta(minutes=PASSWORD_RESET_TTL_MINUTES)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_session_token(raw_token),
            expires_at=expires_at,
        )
    )
    db.commit()

    email_sent = send_password_reset_email(to_email=email, token=raw_token)
    if not PASSWORD_RESET_PREVIEW_ENABLED:
        return AuthPasswordResetRequestOut(ok=True)

    return AuthPasswordResetRequestOut(
        ok=True,
        expires_at=expires_at,
        preview_token=raw_token if not email_sent else None,
        preview_url=password_reset_preview_url(raw_token) if not email_sent else None,
    )


@app.post("/auth/password-reset/confirm", response_model=AuthPasswordResetConfirmOut)
def auth_password_reset_confirm(
    payload: AuthPasswordResetConfirmIn,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_ip_rate_limit(
        request,
        bucket="auth:password-reset-confirm",
        limit=RATE_LIMIT_AUTH_PASSWORD_RESET_CONFIRM,
        window_seconds=RATE_LIMIT_AUTH_PASSWORD_RESET_CONFIRM_WINDOW_SECONDS,
        label="password reset confirm",
    )

    raw_token = normalize_password_reset_token(payload.token)
    hashed_token = hash_session_token(raw_token)
    now = chicago_now()
    reset_token = db.execute(
        select(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == hashed_token,
            PasswordResetToken.used_at.is_(None),
        )
        .with_for_update()
    ).scalar_one_or_none()
    if not reset_token or reset_token.expires_at < now:
        raise HTTPException(400, "Invalid or expired reset token.")

    user = get_user_by_id_or_raise(
        db=db,
        user_id=reset_token.user_id,
        for_update=True,
    )
    user.password_hash = hash_password(payload.new_password)
    reset_token.used_at = now
    revoke_password_reset_tokens_for_user(db, user.id, used_at=now)
    revoke_active_sessions_for_user(db, user.id, revoked_at=now)
    db.commit()
    return AuthPasswordResetConfirmOut(ok=True)


@app.get("/users/me/profile", response_model=UserProfileOut)
def users_me_profile(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=False,
    )
    snapshot = build_account_risk_snapshot(
        db=db,
        user=user,
        for_update=False,
    )
    return user_profile_to_out(
        user=user,
        snapshot=snapshot,
        friendship=FriendshipStatusOut(status=FRIENDSHIP_STATUS_SELF, can_message=False),
        leaderboard_rank=leaderboard_rank_for_user(db, user_id=int(user.id)),
        community_posts=forum_post_summaries_for_user(
            db,
            user_id=int(user.id),
            author_username=str(user.username),
        ),
    )


@app.patch("/users/me/profile", response_model=UserProfileOut)
def users_me_profile_update(
    payload: UserProfileUpdateIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=True,
    )
    user.profile_image_url = normalize_optional_profile_field(payload.profile_image_url)
    user.bio = normalize_optional_profile_field(payload.bio)
    db.flush()

    snapshot = build_account_risk_snapshot(
        db=db,
        user=user,
        for_update=False,
    )
    out = user_profile_to_out(
        user=user,
        snapshot=snapshot,
        friendship=FriendshipStatusOut(status=FRIENDSHIP_STATUS_SELF, can_message=False),
        leaderboard_rank=leaderboard_rank_for_user(db, user_id=int(user.id)),
        community_posts=forum_post_summaries_for_user(
            db,
            user_id=int(user.id),
            author_username=str(user.username),
        ),
    )
    db.commit()
    return out


@app.get("/users/{username}/profile", response_model=UserProfileOut)
def users_profile_by_username(
    username: str,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    normalized_username = normalize_username(username)
    user = get_user_by_username_or_raise(
        db=db,
        username=normalized_username,
        for_update=False,
    )
    snapshot = build_account_risk_snapshot(
        db=db,
        user=user,
        for_update=False,
    )
    friendship = friendship_status_for_users(db, int(auth.user.id), int(user.id))
    return user_profile_to_out(
        user=user,
        snapshot=snapshot,
        friendship=friendship,
        leaderboard_rank=leaderboard_rank_for_user(db, user_id=int(user.id)),
        community_posts=forum_post_summaries_for_user(
            db,
            user_id=int(user.id),
            author_username=str(user.username),
        ),
    )


@app.get("/friends", response_model=FriendsDashboardOut)
def friends_dashboard(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    return build_friends_dashboard(db, current_user_id=int(auth.user.id))


@app.post("/friends/requests", response_model=FriendshipStatusOut)
def friends_request_create(
    payload: FriendshipRequestCreateIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    requester = get_user_by_id_or_raise(db=db, user_id=auth.user.id, for_update=False)
    target = get_user_by_username_or_raise(
        db=db,
        username=normalize_username(payload.username),
        for_update=True,
    )
    if int(requester.id) == int(target.id):
        raise HTTPException(400, "You cannot send yourself a friend request.")

    user_low_id, user_high_id = friendship_pair(int(requester.id), int(target.id))
    friendship = db.execute(
        select(Friendship)
        .where(
            Friendship.user_low_id == user_low_id,
            Friendship.user_high_id == user_high_id,
        )
        .with_for_update()
    ).scalar_one_or_none()

    now = chicago_now()
    if friendship is None:
        friendship = Friendship(
            user_low_id=user_low_id,
            user_high_id=user_high_id,
            requested_by_user_id=int(requester.id),
            status=FRIENDSHIP_ROW_PENDING,
            created_at=now,
            updated_at=now,
        )
        db.add(friendship)
        create_notification(
            db,
            user_id=int(target.id),
            notification_type=NOTIFICATION_TYPE_FRIEND_REQUEST,
            actor_user_id=int(requester.id),
            entity_type="USER",
            entity_id=int(requester.id),
            message=f"{requester.username} sent you a friend request.",
        )
        db.commit()
        db.refresh(friendship)
        return friendship_status_for_users(db, int(requester.id), int(target.id))

    status_value = str(friendship.status)
    if status_value == FRIENDSHIP_ROW_ACCEPTED:
        raise HTTPException(409, "You are already friends with this user.")
    if status_value == FRIENDSHIP_ROW_PENDING and int(friendship.requested_by_user_id) == int(requester.id):
        raise HTTPException(409, "A friend request is already pending.")
    if status_value == FRIENDSHIP_ROW_PENDING and int(friendship.requested_by_user_id) == int(target.id):
        friendship.status = FRIENDSHIP_ROW_ACCEPTED
        friendship.responded_at = now
        friendship.updated_at = now
        create_notification(
            db,
            user_id=int(target.id),
            notification_type=NOTIFICATION_TYPE_FRIEND_ACCEPTED,
            actor_user_id=int(requester.id),
            entity_type="USER",
            entity_id=int(requester.id),
            message=f"{requester.username} accepted your friend request.",
        )
        db.commit()
        return friendship_status_for_users(db, int(requester.id), int(target.id))

    friendship.requested_by_user_id = int(requester.id)
    friendship.status = FRIENDSHIP_ROW_PENDING
    friendship.responded_at = None
    friendship.updated_at = now
    create_notification(
        db,
        user_id=int(target.id),
        notification_type=NOTIFICATION_TYPE_FRIEND_REQUEST,
        actor_user_id=int(requester.id),
        entity_type="USER",
        entity_id=int(requester.id),
        message=f"{requester.username} sent you a friend request.",
    )
    db.commit()
    return friendship_status_for_users(db, int(requester.id), int(target.id))


@app.post("/friends/requests/{friendship_id}/accept", response_model=FriendshipStatusOut)
def friends_request_accept(
    friendship_id: int,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    friendship = db.execute(
        select(Friendship)
        .where(Friendship.id == int(friendship_id))
        .with_for_update()
    ).scalar_one_or_none()
    if not friendship:
        raise HTTPException(404, "Friend request not found.")
    if str(friendship.status) != FRIENDSHIP_ROW_PENDING:
        raise HTTPException(400, "This friend request is no longer pending.")

    current_user_id = int(auth.user.id)
    if current_user_id == int(friendship.requested_by_user_id):
        raise HTTPException(403, "You cannot accept your own outgoing request.")
    if current_user_id not in {int(friendship.user_low_id), int(friendship.user_high_id)}:
        raise HTTPException(403, "Friend request access denied.")

    friendship.status = FRIENDSHIP_ROW_ACCEPTED
    friendship.responded_at = chicago_now()
    friendship.updated_at = friendship.responded_at
    create_notification(
        db,
        user_id=int(friendship.requested_by_user_id),
        notification_type=NOTIFICATION_TYPE_FRIEND_ACCEPTED,
        actor_user_id=current_user_id,
        entity_type="USER",
        entity_id=current_user_id,
        message=f"{auth.user.username} accepted your friend request.",
    )
    db.commit()
    counterpart_id = (
        int(friendship.user_high_id)
        if int(friendship.user_low_id) == current_user_id
        else int(friendship.user_low_id)
    )
    return friendship_status_for_users(db, current_user_id, counterpart_id)


@app.post("/friends/requests/{friendship_id}/decline", response_model=FriendshipStatusOut)
def friends_request_decline(
    friendship_id: int,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    friendship = db.execute(
        select(Friendship)
        .where(Friendship.id == int(friendship_id))
        .with_for_update()
    ).scalar_one_or_none()
    if not friendship:
        raise HTTPException(404, "Friend request not found.")
    if str(friendship.status) != FRIENDSHIP_ROW_PENDING:
        raise HTTPException(400, "This friend request is no longer pending.")

    current_user_id = int(auth.user.id)
    if current_user_id == int(friendship.requested_by_user_id):
        raise HTTPException(403, "You cannot decline your own outgoing request.")
    if current_user_id not in {int(friendship.user_low_id), int(friendship.user_high_id)}:
        raise HTTPException(403, "Friend request access denied.")

    friendship.status = FRIENDSHIP_ROW_DECLINED
    friendship.responded_at = chicago_now()
    friendship.updated_at = friendship.responded_at
    db.commit()
    counterpart_id = (
        int(friendship.user_high_id)
        if int(friendship.user_low_id) == current_user_id
        else int(friendship.user_low_id)
    )
    return friendship_status_for_users(db, current_user_id, counterpart_id)


@app.get("/inbox/threads", response_model=list[DirectThreadSummaryOut])
def inbox_threads(
    limit: int = Query(default=100, ge=1, le=500),
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    current_user_id = int(auth.user.id)
    threads = db.execute(
        select(DirectThread)
        .where(
            or_(
                DirectThread.user_one_id == current_user_id,
                DirectThread.user_two_id == current_user_id,
            )
        )
        .order_by(
            func.coalesce(
                DirectThread.last_message_at,
                DirectThread.updated_at,
                DirectThread.created_at,
            ).desc(),
            DirectThread.id.desc(),
        )
        .limit(limit)
    ).scalars().all()
    return build_direct_thread_summaries(
        db,
        current_user_id=current_user_id,
        threads=threads,
    )


@app.post("/inbox/threads", response_model=DirectThreadSummaryOut)
def inbox_open_thread(
    payload: DirectThreadCreateIn,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    enforce_user_rate_limit(
        int(auth.user.id),
        bucket="direct:thread:create",
        limit=RATE_LIMIT_DIRECT_THREAD_CREATE,
        window_seconds=RATE_LIMIT_DIRECT_THREAD_CREATE_WINDOW_SECONDS,
        label="direct thread creation",
    )
    enforce_ip_rate_limit(
        request,
        bucket="direct:thread:create",
        limit=RATE_LIMIT_DIRECT_THREAD_CREATE,
        window_seconds=RATE_LIMIT_DIRECT_THREAD_CREATE_WINDOW_SECONDS,
        label="direct thread creation",
    )

    current_user = get_user_by_id_or_raise(db, int(auth.user.id), for_update=False)
    target_username = normalize_username(payload.username)
    if target_username == str(current_user.username).strip().lower():
        raise HTTPException(400, "You cannot start a direct thread with yourself.")
    target_user = get_user_by_username_or_raise(db, target_username, for_update=False)
    require_friendship_between_users(db, int(current_user.id), int(target_user.id))
    user_one_id, user_two_id = direct_thread_pair(int(current_user.id), int(target_user.id))

    thread = db.execute(
        select(DirectThread).where(
            DirectThread.user_one_id == user_one_id,
            DirectThread.user_two_id == user_two_id,
        )
    ).scalar_one_or_none()
    if thread is None:
        thread = DirectThread(
            user_one_id=user_one_id,
            user_two_id=user_two_id,
        )
        db.add(thread)
        db.flush()

    initial_message = normalize_optional_profile_field(payload.initial_message)
    if initial_message:
        enforce_user_rate_limit(
            int(auth.user.id),
            bucket="direct:message:create",
            limit=RATE_LIMIT_DIRECT_MESSAGE_CREATE,
            window_seconds=RATE_LIMIT_DIRECT_MESSAGE_CREATE_WINDOW_SECONDS,
            label="direct message creation",
        )
        enforce_ip_rate_limit(
            request,
            bucket="direct:message:create",
            limit=RATE_LIMIT_DIRECT_MESSAGE_CREATE,
            window_seconds=RATE_LIMIT_DIRECT_MESSAGE_CREATE_WINDOW_SECONDS,
            label="direct message creation",
        )
        created_at = chicago_now()
        db.add(
            DirectMessage(
                thread_id=int(thread.id),
                sender_user_id=int(current_user.id),
                body=normalize_direct_message_body(initial_message),
                created_at=created_at,
            )
        )
        thread.last_message_at = created_at
        thread.updated_at = created_at
        mark_direct_thread_read(thread, int(current_user.id), created_at)
        db.flush()

    summary = build_direct_thread_summaries(
        db,
        current_user_id=int(current_user.id),
        threads=[thread],
    )
    db.commit()
    if not summary:
        raise HTTPException(500, "Unable to load direct thread.")
    return summary[0]


@app.get("/inbox/threads/{thread_id}", response_model=DirectThreadDetailOut)
def inbox_thread_detail(
    thread_id: int,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    current_user_id = int(auth.user.id)
    thread = get_direct_thread_for_user_or_raise(
        db,
        thread_id=int(thread_id),
        user_id=current_user_id,
        for_update=True,
    )
    now = chicago_now()
    mark_direct_thread_read(thread, current_user_id, now)
    db.flush()

    summaries = build_direct_thread_summaries(
        db,
        current_user_id=current_user_id,
        threads=[thread],
    )
    if not summaries:
        raise HTTPException(500, "Unable to load direct thread.")
    summary = summaries[0]

    message_rows = db.execute(
        select(DirectMessage, User.username)
        .join(User, DirectMessage.sender_user_id == User.id)
        .where(DirectMessage.thread_id == int(thread.id))
        .order_by(DirectMessage.created_at.asc(), DirectMessage.id.asc())
    ).all()

    out = DirectThreadDetailOut(
        **summary.model_dump(),
        messages=[
            DirectMessageOut(
                id=int(message.id),
                thread_id=int(message.thread_id),
                sender_user_id=int(message.sender_user_id),
                sender_username=str(sender_username),
                body=str(message.body),
                created_at=message.created_at,
                own_message=int(message.sender_user_id) == current_user_id,
            )
            for message, sender_username in message_rows
        ],
    )
    db.commit()
    return out


@app.post("/inbox/threads/{thread_id}/messages", response_model=DirectMessageOut)
def inbox_send_message(
    thread_id: int,
    payload: DirectMessageCreateIn,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    enforce_user_rate_limit(
        int(auth.user.id),
        bucket="direct:message:create",
        limit=RATE_LIMIT_DIRECT_MESSAGE_CREATE,
        window_seconds=RATE_LIMIT_DIRECT_MESSAGE_CREATE_WINDOW_SECONDS,
        label="direct message creation",
    )
    enforce_ip_rate_limit(
        request,
        bucket="direct:message:create",
        limit=RATE_LIMIT_DIRECT_MESSAGE_CREATE,
        window_seconds=RATE_LIMIT_DIRECT_MESSAGE_CREATE_WINDOW_SECONDS,
        label="direct message creation",
    )
    thread = get_direct_thread_for_user_or_raise(
        db,
        thread_id=int(thread_id),
        user_id=int(auth.user.id),
        for_update=True,
    )
    counterpart_user_id = direct_thread_counterpart_user_id(thread, int(auth.user.id))
    require_friendship_between_users(db, int(auth.user.id), counterpart_user_id)
    created_at = chicago_now()
    message = DirectMessage(
        thread_id=int(thread.id),
        sender_user_id=int(auth.user.id),
        body=normalize_direct_message_body(payload.body),
        created_at=created_at,
    )
    db.add(message)
    thread.last_message_at = created_at
    thread.updated_at = created_at
    mark_direct_thread_read(thread, int(auth.user.id), created_at)
    db.flush()
    create_notification(
        db,
        user_id=counterpart_user_id,
        notification_type=NOTIFICATION_TYPE_DIRECT_MESSAGE,
        actor_user_id=int(auth.user.id),
        entity_type="DIRECT_THREAD",
        entity_id=int(thread.id),
        message=f"New message from {auth.user.username}.",
    )
    out = DirectMessageOut(
        id=int(message.id),
        thread_id=int(message.thread_id),
        sender_user_id=int(message.sender_user_id),
        sender_username=str(auth.user.username),
        body=str(message.body),
        created_at=message.created_at,
        own_message=True,
    )
    db.commit()
    return out


@app.get("/search", response_model=list[SearchResultOut])
def global_search(
    query: str = Query(..., min_length=1, max_length=64),
    limit: int = Query(default=10, ge=1, le=25),
    sport: str | None = Query(default=None),
    _auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    normalized_query = " ".join(query.strip().lower().split())
    if not normalized_query:
        return []

    like_pattern = f"%{normalized_query}%"
    fetch_limit = max(limit * 2, 12)

    players_stmt = (
        select(Player)
        .where(
            Player.ipo_open.is_(True),
            or_(
                func.lower(Player.name).like(like_pattern),
                func.lower(Player.team).like(like_pattern),
            )
        )
        .limit(fetch_limit)
    )
    if sport and sport.strip().upper() != "ALL":
        players_stmt = players_stmt.where(Player.sport == normalize_sport_code(sport))
    players = db.execute(players_stmt).scalars().all()

    users = db.execute(
        select(User)
        .where(func.lower(User.username).like(like_pattern))
        .limit(fetch_limit)
    ).scalars().all()

    scored_results: list[tuple[int, int, SearchResultOut]] = []
    for player in players:
        player_name = str(player.name).strip().lower()
        player_team = str(player.team).strip().lower()
        if player_name.startswith(normalized_query):
            score = 0
        elif player_team.startswith(normalized_query):
            score = 1
        elif normalized_query in player_name:
            score = 2
        else:
            score = 3
        scored_results.append(
            (
                score,
                0,
                SearchResultOut(
                    kind="player",
                    label=str(player.name),
                    subtitle=f"{str(player.sport)} - {str(player.team)} {str(player.position)}",
                    href=f"/player/{int(player.id)}",
                ),
            )
        )

    for user in users:
        username = str(user.username).strip().lower()
        score = 0 if username.startswith(normalized_query) else 2
        scored_results.append(
            (
                score,
                1,
                SearchResultOut(
                    kind="user",
                    label=str(user.username),
                    subtitle="User profile",
                    href=f"/profile/{str(user.username)}",
                ),
            )
        )

    scored_results.sort(key=lambda row: (row[0], row[1], row[2].label.lower()))
    return [row[2] for row in scored_results[:limit]]


@app.get("/leaderboard", response_model=LeaderboardOut)
def leaderboard(
    scope: str = Query(default="global"),
    sport: str = Query(default="ALL"),
    limit: int = Query(default=100, ge=1, le=500),
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    normalized_scope = (scope or "global").strip().lower()
    if normalized_scope not in {"global", "friends"}:
        raise HTTPException(400, "scope must be one of: global, friends")
    normalized_sport = normalize_sport_code(sport) if sport and sport.strip().upper() != "ALL" else "ALL"
    entries = build_leaderboard_entries(
        db,
        current_user_id=int(auth.user.id),
        scope=normalized_scope,
        sport=normalized_sport,
        limit=limit,
    )
    return LeaderboardOut(
        scope=normalized_scope,
        sport=normalized_sport,
        generated_at=chicago_now(),
        entries=entries,
    )


@app.get("/watchlist/players", response_model=list[WatchlistPlayerOut])
def watchlist_players(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(PlayerWatchlist, Player)
        .join(Player, PlayerWatchlist.player_id == Player.id)
        .where(PlayerWatchlist.user_id == int(auth.user.id))
        .order_by(PlayerWatchlist.created_at.desc(), PlayerWatchlist.id.desc())
    ).all()
    if not rows:
        return []
    stats_snapshot = get_stats_snapshot_by_player(db, [int(player.id) for _, player in rows])
    return [
        watchlist_player_to_out(
            player=player,
            added_at=watch.created_at,
            stats_snapshot=stats_snapshot,
        )
        for watch, player in rows
        if player_is_listed(player)
    ]


@app.post("/watchlist/players/{player_id}", response_model=list[WatchlistPlayerOut])
def watchlist_add_player(
    player_id: int,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    player = db.get(Player, int(player_id))
    if not player or not player_is_listed(player):
        raise HTTPException(404, "Player not found")
    existing = db.execute(
        select(PlayerWatchlist).where(
            PlayerWatchlist.user_id == int(auth.user.id),
            PlayerWatchlist.player_id == int(player_id),
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            PlayerWatchlist(
                user_id=int(auth.user.id),
                player_id=int(player_id),
            )
        )
        db.commit()
    return watchlist_players(auth=auth, db=db)


@app.delete("/watchlist/players/{player_id}", response_model=list[WatchlistPlayerOut])
def watchlist_remove_player(
    player_id: int,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    existing = db.execute(
        select(PlayerWatchlist).where(
            PlayerWatchlist.user_id == int(auth.user.id),
            PlayerWatchlist.player_id == int(player_id),
        )
    ).scalar_one_or_none()
    if existing is not None:
        db.delete(existing)
        db.commit()
    return watchlist_players(auth=auth, db=db)


@app.get("/notifications", response_model=NotificationListOut)
def notifications_list(
    limit: int = Query(default=50, ge=1, le=200),
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Notification)
        .where(Notification.user_id == int(auth.user.id))
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    ).scalars().all()
    unread_count = int(
        db.execute(
            select(func.count(Notification.id)).where(
                Notification.user_id == int(auth.user.id),
                Notification.read_at.is_(None),
            )
        ).scalar_one()
        or 0
    )
    actor_ids = sorted({int(row.actor_user_id) for row in rows if row.actor_user_id is not None})
    actors = {
        int(user.id): user
        for user in db.execute(select(User).where(User.id.in_(actor_ids))).scalars().all()
    } if actor_ids else {}
    return NotificationListOut(
        unread_count=unread_count,
        items=[
            notification_to_out(db, row, actor=actors.get(int(row.actor_user_id)) if row.actor_user_id is not None else None)
            for row in rows
        ],
    )


@app.post("/notifications/read", response_model=NotificationListOut)
def notifications_mark_read(
    payload: NotificationReadIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    notification_ids = sorted({int(notification_id) for notification_id in payload.ids if int(notification_id) > 0})
    if notification_ids:
        rows = db.execute(
            select(Notification).where(
                Notification.user_id == int(auth.user.id),
                Notification.id.in_(notification_ids),
            )
        ).scalars().all()
        timestamp = chicago_now()
        for row in rows:
            if row.read_at is None:
                row.read_at = timestamp
        db.commit()
    return notifications_list(limit=50, auth=auth, db=db)


@app.post("/notifications/read-all", response_model=NotificationListOut)
def notifications_mark_all_read(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Notification).where(
            Notification.user_id == int(auth.user.id),
            Notification.read_at.is_(None),
        )
    ).scalars().all()
    if rows:
        timestamp = chicago_now()
        for row in rows:
            row.read_at = timestamp
        db.commit()
    return notifications_list(limit=50, auth=auth, db=db)


@app.get("/trading/status", response_model=TradingStatusOut)
def trading_status(
    db: Session = Depends(get_db),
):
    status_out = build_trading_status_out(db)
    db.commit()
    return status_out


@app.post("/feedback", response_model=FeedbackOut)
def create_feedback(
    payload: FeedbackCreateIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    message = normalize_forum_text(payload.message, "message")
    page_path = normalize_optional_profile_field(payload.page_path)
    row = FeedbackMessage(
        user_id=int(auth.user.id),
        page_path=page_path,
        message=message,
        status="NEW",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return FeedbackOut(
        id=int(row.id),
        page_path=normalize_optional_profile_field(row.page_path),
        message=str(row.message),
        status=str(row.status),
        created_at=row.created_at,
    )


@app.get("/admin/trading/halt", response_model=TradingStatusOut)
def admin_trading_halt_status(
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    status_out = build_trading_status_out(db)
    db.commit()
    return status_out


@app.post("/admin/trading/halt/global", response_model=TradingStatusOut)
def admin_update_global_trading_halt(
    payload: AdminTradingHaltUpdateIn,
    admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    global_row = ensure_trading_control_row(
        db=db,
        sport=GLOBAL_TRADING_CONTROL_SPORT,
        for_update=True,
    )
    global_row.halted = bool(payload.halted)
    global_row.reason = normalize_optional_profile_field(payload.reason) if payload.halted else None
    global_row.updated_by_user_id = int(admin.user.id)
    global_row.updated_at = chicago_now()
    db.flush()
    status_out = build_trading_status_out(db)
    db.commit()
    return status_out


@app.post("/admin/trading/halt/sport", response_model=TradingStatusOut)
def admin_update_sport_trading_halt(
    payload: AdminSportTradingHaltUpdateIn,
    admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    sport_code = normalize_sport_code(payload.sport)
    row = ensure_trading_control_row(
        db=db,
        sport=sport_code,
        for_update=True,
    )
    row.halted = bool(payload.halted)
    row.reason = normalize_optional_profile_field(payload.reason) if payload.halted else None
    row.updated_by_user_id = int(admin.user.id)
    row.updated_at = chicago_now()
    db.flush()
    status_out = build_trading_status_out(db)
    db.commit()
    return status_out


@app.get("/admin/feedback", response_model=list[AdminFeedbackOut])
def admin_feedback_list(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=200, ge=1, le=1000),
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    stmt = (
        select(FeedbackMessage, User.username)
        .join(User, FeedbackMessage.user_id == User.id)
        .order_by(FeedbackMessage.created_at.desc(), FeedbackMessage.id.desc())
        .limit(limit)
    )
    normalized_status = (status_filter or "").strip().upper()
    if normalized_status:
        stmt = stmt.where(FeedbackMessage.status == normalized_status)

    rows = db.execute(stmt).all()
    return [
        AdminFeedbackOut(
            id=int(feedback.id),
            user_id=int(feedback.user_id),
            username=str(username),
            page_path=normalize_optional_profile_field(feedback.page_path),
            message=str(feedback.message),
            status=str(feedback.status),
            created_at=feedback.created_at,
        )
        for feedback, username in rows
    ]


@app.patch("/admin/feedback/{feedback_id}", response_model=AdminFeedbackOut)
def admin_feedback_update(
    feedback_id: int,
    payload: AdminFeedbackUpdateIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    normalized_status = payload.status.strip().upper()
    if normalized_status not in {"NEW", "ACK", "DONE"}:
        raise HTTPException(status_code=400, detail="Feedback status must be NEW, ACK, or DONE.")

    row = db.get(FeedbackMessage, feedback_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Feedback message not found.")

    row.status = normalized_status
    db.flush()

    username = db.execute(select(User.username).where(User.id == row.user_id)).scalar_one()
    db.commit()
    db.refresh(row)
    return AdminFeedbackOut(
        id=int(row.id),
        user_id=int(row.user_id),
        username=str(username),
        page_path=normalize_optional_profile_field(row.page_path),
        message=str(row.message),
        status=str(row.status),
        created_at=row.created_at,
    )


@app.get("/admin/bots/personas", response_model=list[AdminBotPersonaOut])
def admin_bot_personas(_admin: AuthContext = Depends(get_admin_context)):
    return [
        AdminBotPersonaOut(
            key=key,
            label=str(meta["label"]),
            description=str(meta["description"]),
            market_maker=bool(meta["market_maker"]),
        )
        for key, meta in BOT_PERSONA_CATALOG.items()
    ]


@app.get("/admin/bots", response_model=list[AdminBotProfileOut])
def admin_bot_list(
    active_only: bool = Query(default=False),
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    stmt = select(BotProfile).order_by(BotProfile.is_active.desc(), BotProfile.updated_at.desc(), BotProfile.id.desc())
    if active_only:
        stmt = stmt.where(BotProfile.is_active.is_(True))
    profiles = db.execute(stmt).scalars().all()
    return [bot_profile_to_out(db, profile) for profile in profiles]


@app.post("/admin/bots", response_model=AdminBotProfileOut)
def admin_bot_create(
    payload: AdminBotProfileCreateIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    name = normalize_bot_name(payload.name)
    persona = normalize_bot_persona(payload.persona)
    username = normalize_username(payload.username) if payload.username else unique_bot_username(db, name)

    existing = db.execute(select(BotProfile).where(BotProfile.username == username)).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Bot username '{username}' already exists.")

    profile = BotProfile(
        name=name,
        username=username,
        persona=persona,
        is_active=bool(payload.is_active),
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return bot_profile_to_out(db, profile)


@app.patch("/admin/bots/{bot_id}", response_model=AdminBotProfileOut)
def admin_bot_update(
    bot_id: int,
    payload: AdminBotProfileUpdateIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    profile = db.get(BotProfile, int(bot_id))
    if not profile:
        raise HTTPException(404, "Bot not found.")

    profile.name = normalize_bot_name(payload.name)
    profile.persona = normalize_bot_persona(payload.persona)
    profile.is_active = bool(payload.is_active)
    profile.updated_at = chicago_now()
    db.commit()
    db.refresh(profile)
    return bot_profile_to_out(db, profile)


@app.get("/admin/bots/run/status", response_model=AdminBotSimulationStatusOut)
def admin_bot_run_status(_admin: AuthContext = Depends(get_admin_context)):
    return BOT_SIMULATION_STATE.status_out()


@app.post("/admin/bots/run/start", response_model=AdminBotSimulationStatusOut)
def admin_bot_run_start(
    payload: AdminBotSimulationStartIn,
    admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    profiles = db.execute(
        select(BotProfile)
        .where(BotProfile.is_active.is_(True))
        .order_by(BotProfile.updated_at.desc(), BotProfile.id.desc())
    ).scalars().all()
    return start_bot_simulation_process(
        admin_username=str(admin.user.username),
        profiles=profiles,
        payload=payload,
    )


@app.post("/admin/bots/run/stop", response_model=AdminBotSimulationStatusOut)
def admin_bot_run_stop(
    force: bool = Query(default=False),
    _admin: AuthContext = Depends(get_admin_context),
):
    return stop_bot_simulation_process(force=bool(force))


@app.get("/admin/activity", response_model=AdminActivityAuditOut)
def admin_activity_audit(
    limit: int = Query(default=20, ge=1, le=100),
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    now = chicago_now()

    active_sessions_count = int(
        db.execute(
            select(func.count(UserSession.id)).where(
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > now,
            )
        ).scalar_one()
        or 0
    )

    active_session_rows = db.execute(
        select(UserSession, User.username, User.email)
        .join(User, UserSession.user_id == User.id)
        .where(
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now,
        )
        .order_by(UserSession.created_at.desc(), UserSession.id.desc())
        .limit(limit)
    ).all()
    recent_session_rows = db.execute(
        select(UserSession, User.username, User.email)
        .join(User, UserSession.user_id == User.id)
        .order_by(UserSession.created_at.desc(), UserSession.id.desc())
        .limit(limit)
    ).all()

    comment_count_sq = (
        select(ForumComment.post_id, func.count(ForumComment.id).label("comment_count"))
        .group_by(ForumComment.post_id)
        .subquery()
    )
    recent_post_rows = db.execute(
        select(ForumPost, User.username, func.coalesce(comment_count_sq.c.comment_count, 0))
        .join(User, ForumPost.user_id == User.id)
        .outerjoin(comment_count_sq, comment_count_sq.c.post_id == ForumPost.id)
        .order_by(ForumPost.created_at.desc(), ForumPost.id.desc())
        .limit(limit)
    ).all()
    recent_comment_rows = db.execute(
        select(ForumComment, User.username, ForumPost.title)
        .join(User, ForumComment.user_id == User.id)
        .join(ForumPost, ForumComment.post_id == ForumPost.id)
        .order_by(ForumComment.created_at.desc(), ForumComment.id.desc())
        .limit(limit)
    ).all()
    recent_transaction_rows = db.execute(
        select(Transaction, User.username, Player)
        .join(User, Transaction.user_id == User.id)
        .outerjoin(Player, Transaction.player_id == Player.id)
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .limit(limit)
    ).all()
    recent_direct_message_rows = db.execute(
        select(DirectMessage, DirectThread, User.username)
        .join(DirectThread, DirectMessage.thread_id == DirectThread.id)
        .join(User, DirectMessage.sender_user_id == User.id)
        .order_by(DirectMessage.created_at.desc(), DirectMessage.id.desc())
        .limit(limit)
    ).all()
    direct_message_recipient_ids = {
        int(thread.user_two_id) if int(message.sender_user_id) == int(thread.user_one_id) else int(thread.user_one_id)
        for message, thread, _sender_username in recent_direct_message_rows
    }
    recipient_users_by_id = {
        int(user.id): user
        for user in db.execute(
            select(User).where(User.id.in_(direct_message_recipient_ids))
        ).scalars().all()
    } if direct_message_recipient_ids else {}

    return AdminActivityAuditOut(
        generated_at=now,
        active_sessions_count=active_sessions_count,
        active_sessions=[
            admin_audit_session_to_out(session, username=str(username), email=email, now=now)
            for session, username, email in active_session_rows
        ],
        recent_sessions=[
            admin_audit_session_to_out(session, username=str(username), email=email, now=now)
            for session, username, email in recent_session_rows
        ],
        recent_transactions=[
            admin_audit_trade_to_out(transaction, username=str(username), player=player)
            for transaction, username, player in recent_transaction_rows
        ],
        recent_forum_posts=[
            AdminAuditForumPostOut(
                id=int(post.id),
                user_id=int(post.user_id),
                username=str(username),
                title=str(post.title),
                comment_count=int(comment_count or 0),
                view_count=int(post.view_count),
                created_at=post.created_at,
                updated_at=post.updated_at,
            )
            for post, username, comment_count in recent_post_rows
        ],
        recent_forum_comments=[
            AdminAuditForumCommentOut(
                id=int(comment.id),
                post_id=int(comment.post_id),
                post_title=str(post_title),
                user_id=int(comment.user_id),
                username=str(username),
                body_preview=forum_body_preview(str(comment.body), 140),
                created_at=comment.created_at,
                updated_at=comment.updated_at,
            )
            for comment, username, post_title in recent_comment_rows
        ],
        recent_direct_messages=[
            admin_audit_direct_message_to_out(
                message,
                sender_username=str(sender_username),
                recipient_user_id=recipient_id,
                recipient_username=str(recipient_users_by_id[recipient_id].username),
            )
            for message, thread, sender_username in recent_direct_message_rows
            for recipient_id in [
                int(thread.user_two_id) if int(message.sender_user_id) == int(thread.user_one_id) else int(thread.user_one_id)
            ]
            if recipient_id in recipient_users_by_id
        ],
        direct_messages_supported=True,
        direct_messages_note=None,
    )


@app.post("/moderation/reports", response_model=ModerationReportOut)
def create_moderation_report(
    payload: ModerationReportCreateIn,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    enforce_user_rate_limit(
        int(auth.user.id),
        bucket="moderation:report:create",
        limit=RATE_LIMIT_MODERATION_REPORT_CREATE,
        window_seconds=RATE_LIMIT_MODERATION_REPORT_CREATE_WINDOW_SECONDS,
        label="moderation report creation",
    )
    enforce_ip_rate_limit(
        request,
        bucket="moderation:report:create",
        limit=RATE_LIMIT_MODERATION_REPORT_CREATE,
        window_seconds=RATE_LIMIT_MODERATION_REPORT_CREATE_WINDOW_SECONDS,
        label="moderation report creation",
    )
    content_type = normalize_moderation_content_type(payload.content_type)
    content_id = int(payload.content_id)
    ensure_moderation_target_exists_or_raise(db, content_type, content_id)
    if is_content_hidden(db, content_type, content_id):
        raise HTTPException(400, "This content is already hidden by moderation.")

    existing_open = db.execute(
        select(ContentReport).where(
            ContentReport.reporter_user_id == int(auth.user.id),
            ContentReport.content_type == content_type,
            ContentReport.content_id == content_id,
            ContentReport.status == MODERATION_REPORT_STATUS_OPEN,
        )
    ).scalar_one_or_none()
    if existing_open:
        return moderation_report_to_out(existing_open)

    report = ContentReport(
        reporter_user_id=int(auth.user.id),
        content_type=content_type,
        content_id=content_id,
        reason=normalize_forum_text(payload.reason, "reason"),
        details=normalize_optional_profile_field(payload.details),
        page_path=normalize_optional_profile_field(payload.page_path),
        status=MODERATION_REPORT_STATUS_OPEN,
        action_taken=MODERATION_ACTION_NONE,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return moderation_report_to_out(report)


@app.get("/admin/moderation/reports", response_model=list[AdminModerationReportOut])
def admin_moderation_reports(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=200, ge=1, le=1000),
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    stmt = select(ContentReport).order_by(ContentReport.created_at.desc(), ContentReport.id.desc()).limit(limit)
    if status_filter:
        stmt = stmt.where(ContentReport.status == normalize_moderation_report_status(status_filter))

    reports = db.execute(stmt).scalars().all()
    if not reports:
        return []

    user_ids = {
        int(report.reporter_user_id)
        for report in reports
    }
    user_ids.update(
        int(report.reviewed_by_user_id)
        for report in reports
        if report.reviewed_by_user_id is not None
    )
    user_rows = db.execute(select(User.id, User.username).where(User.id.in_(sorted(user_ids)))).all()
    username_by_id = {int(user_id): str(username) for user_id, username in user_rows}

    post_ids = sorted(
        {int(report.content_id) for report in reports if str(report.content_type) == MODERATION_CONTENT_FORUM_POST}
    )
    comment_ids = sorted(
        {int(report.content_id) for report in reports if str(report.content_type) == MODERATION_CONTENT_FORUM_COMMENT}
    )
    posts_by_id = {
        int(post.id): post
        for post in db.execute(select(ForumPost).where(ForumPost.id.in_(post_ids))).scalars().all()
    } if post_ids else {}
    comments_by_id = {
        int(comment.id): comment
        for comment in db.execute(select(ForumComment).where(ForumComment.id.in_(comment_ids))).scalars().all()
    } if comment_ids else {}

    hidden_post_ids = hidden_content_id_set(db, MODERATION_CONTENT_FORUM_POST, post_ids)
    hidden_comment_ids = hidden_content_id_set(db, MODERATION_CONTENT_FORUM_COMMENT, comment_ids)

    out: list[AdminModerationReportOut] = []
    for report in reports:
        content_type = str(report.content_type)
        content_id = int(report.content_id)
        if content_type == MODERATION_CONTENT_FORUM_POST:
            post = posts_by_id.get(content_id)
            target_preview = f"Post: {str(post.title)}" if post else None
            target_exists = post is not None
            is_hidden = content_id in hidden_post_ids
        else:
            comment = comments_by_id.get(content_id)
            target_preview = f"Comment: {forum_body_preview(str(comment.body), 120)}" if comment else None
            target_exists = comment is not None
            is_hidden = content_id in hidden_comment_ids

        out.append(
            admin_moderation_report_to_out(
                report,
                reporter_username=username_by_id.get(int(report.reporter_user_id), "unknown"),
                reviewed_by_username=(
                    username_by_id.get(int(report.reviewed_by_user_id))
                    if report.reviewed_by_user_id is not None
                    else None
                ),
                target_preview=target_preview,
                target_exists=target_exists,
                is_hidden=is_hidden,
            )
        )
    return out


@app.post("/admin/moderation/reports/{report_id}/resolve", response_model=AdminModerationReportOut)
def admin_resolve_moderation_report(
    report_id: int,
    payload: AdminModerationResolveIn,
    admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    report = db.get(ContentReport, report_id)
    if not report:
        raise HTTPException(404, "Moderation report not found.")
    if str(report.status) != MODERATION_REPORT_STATUS_OPEN:
        raise HTTPException(400, "Report has already been reviewed.")

    status_value = normalize_moderation_report_status(payload.status, allow_open=False)
    action_value = normalize_moderation_action(payload.action)
    if action_value == MODERATION_ACTION_HIDE_CONTENT and status_value != MODERATION_REPORT_STATUS_RESOLVED:
        raise HTTPException(400, "HIDE_CONTENT action requires RESOLVED status.")

    content_type = normalize_moderation_content_type(str(report.content_type))
    ensure_moderation_target_exists_or_raise(db, content_type, int(report.content_id))

    if action_value == MODERATION_ACTION_HIDE_CONTENT:
        moderation_row = db.execute(
            select(ContentModeration).where(
                ContentModeration.content_type == content_type,
                ContentModeration.content_id == int(report.content_id),
            )
        ).scalar_one_or_none()
        if not moderation_row:
            moderation_row = ContentModeration(
                content_type=content_type,
                content_id=int(report.content_id),
                action=CONTENT_MODERATION_ACTION_HIDDEN,
            )
            db.add(moderation_row)
        moderation_row.action = CONTENT_MODERATION_ACTION_HIDDEN
        moderation_row.reason = normalize_optional_profile_field(payload.moderator_note) or str(report.reason)
        moderation_row.source_report_id = int(report.id)
        moderation_row.moderator_user_id = int(admin.user.id)
        moderation_row.updated_at = chicago_now()

    report.status = status_value
    report.action_taken = action_value
    report.moderator_note = normalize_optional_profile_field(payload.moderator_note)
    report.reviewed_by_user_id = int(admin.user.id)
    report.reviewed_at = chicago_now()
    report.updated_at = chicago_now()
    db.flush()

    reporter_user = db.get(User, int(report.reporter_user_id))
    reviewed_by_user = db.get(User, int(report.reviewed_by_user_id))
    is_hidden = is_content_hidden(db, content_type, int(report.content_id))

    target_preview: str | None = None
    target_exists = True
    if content_type == MODERATION_CONTENT_FORUM_POST:
        post = db.get(ForumPost, int(report.content_id))
        if post:
            target_preview = f"Post: {str(post.title)}"
        else:
            target_exists = False
    elif content_type == MODERATION_CONTENT_FORUM_COMMENT:
        comment = db.get(ForumComment, int(report.content_id))
        if comment:
            target_preview = f"Comment: {forum_body_preview(str(comment.body), 120)}"
        else:
            target_exists = False

    out = admin_moderation_report_to_out(
        report,
        reporter_username=str(reporter_user.username) if reporter_user else "unknown",
        reviewed_by_username=str(reviewed_by_user.username) if reviewed_by_user else None,
        target_preview=target_preview,
        target_exists=target_exists,
        is_hidden=is_hidden,
    )
    db.commit()
    return out


@app.post("/admin/moderation/content/unhide", response_model=AdminModerationUnhideOut)
def admin_unhide_moderated_content(
    payload: AdminModerationUnhideIn,
    admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    content_type = normalize_moderation_content_type(payload.content_type)
    content_id = int(payload.content_id)
    moderation_row = db.execute(
        select(ContentModeration).where(
            ContentModeration.content_type == content_type,
            ContentModeration.content_id == content_id,
        )
    ).scalar_one_or_none()
    if not moderation_row:
        raise HTTPException(404, "No moderation action found for this content.")

    moderation_row.action = "VISIBLE"
    moderation_row.moderator_user_id = int(admin.user.id)
    moderation_row.updated_at = chicago_now()
    db.commit()
    return AdminModerationUnhideOut(ok=True)


@app.get("/forum/posts", response_model=list[ForumPostSummaryOut])
def forum_list_posts(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: str = Query(default="new"),
    popular_window: str = Query(default="day"),
    db: Session = Depends(get_db),
):
    sort_mode = (sort or "new").strip().lower()
    if sort_mode not in {"new", "popular"}:
        raise HTTPException(400, "sort must be one of: new, popular")

    popular_window_mode = (popular_window or "day").strip().lower()
    if popular_window_mode not in {"hour", "day", "week"}:
        raise HTTPException(400, "popular_window must be one of: hour, day, week")

    posts_stmt = select(ForumPost)
    if sort_mode == "popular":
        now = chicago_now()
        if popular_window_mode == "hour":
            cutoff = now - timedelta(hours=1)
        elif popular_window_mode == "day":
            cutoff = now - timedelta(hours=24)
        else:
            cutoff = now - timedelta(days=7)

        comment_count_subquery = (
            select(
                ForumComment.post_id.label("post_id"),
                func.count(ForumComment.id).label("comment_count"),
            )
            .where(ForumComment.created_at >= cutoff)
            .group_by(ForumComment.post_id)
            .subquery()
        )
        view_count_subquery = (
            select(
                ForumPostView.post_id.label("post_id"),
                func.count(ForumPostView.id).label("view_count"),
            )
            .where(ForumPostView.created_at >= cutoff)
            .group_by(ForumPostView.post_id)
            .subquery()
        )
        posts_stmt = (
            posts_stmt
            .outerjoin(comment_count_subquery, comment_count_subquery.c.post_id == ForumPost.id)
            .outerjoin(view_count_subquery, view_count_subquery.c.post_id == ForumPost.id)
            .order_by(
                func.coalesce(comment_count_subquery.c.comment_count, 0).desc(),
                func.coalesce(view_count_subquery.c.view_count, 0).desc(),
                ForumPost.updated_at.desc(),
                ForumPost.id.desc(),
            )
        )
    else:
        posts_stmt = posts_stmt.order_by(ForumPost.updated_at.desc(), ForumPost.id.desc())

    posts = db.execute(
        posts_stmt
        .offset(offset)
        .limit(limit)
    ).scalars().all()
    if not posts:
        return []

    fetched_post_ids = [int(post.id) for post in posts]
    hidden_post_ids = hidden_content_id_set(db, MODERATION_CONTENT_FORUM_POST, fetched_post_ids)
    visible_posts = [post for post in posts if int(post.id) not in hidden_post_ids]
    if not visible_posts:
        return []

    author_ids = sorted({int(post.user_id) for post in visible_posts})
    author_rows = db.execute(select(User.id, User.username).where(User.id.in_(author_ids))).all()
    author_by_id = {int(user_id): str(username) for user_id, username in author_rows}

    visible_post_ids = [int(post.id) for post in visible_posts]
    comment_records = db.execute(
        select(ForumComment.id, ForumComment.post_id)
        .where(ForumComment.post_id.in_(visible_post_ids))
    ).all()
    comment_ids = [int(comment_id) for comment_id, _ in comment_records]
    hidden_comment_ids = hidden_content_id_set(db, MODERATION_CONTENT_FORUM_COMMENT, comment_ids)
    comment_count_by_post_id: dict[int, int] = {post_id: 0 for post_id in visible_post_ids}
    for comment_id, post_id in comment_records:
        if int(comment_id) in hidden_comment_ids:
            continue
        comment_count_by_post_id[int(post_id)] = comment_count_by_post_id.get(int(post_id), 0) + 1

    return [
        forum_post_summary_to_out(
            post=post,
            author_username=author_by_id.get(int(post.user_id), "unknown"),
            comment_count=comment_count_by_post_id.get(int(post.id), 0),
        )
        for post in visible_posts
    ]


@app.post("/forum/posts", response_model=ForumPostSummaryOut)
def forum_create_post(
    payload: ForumPostCreateIn,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    enforce_user_rate_limit(
        int(auth.user.id),
        bucket="forum:post:create",
        limit=RATE_LIMIT_FORUM_POST_CREATE,
        window_seconds=RATE_LIMIT_FORUM_POST_CREATE_WINDOW_SECONDS,
        label="forum post creation",
    )
    enforce_ip_rate_limit(
        request,
        bucket="forum:post:create",
        limit=RATE_LIMIT_FORUM_POST_CREATE,
        window_seconds=RATE_LIMIT_FORUM_POST_CREATE_WINDOW_SECONDS,
        label="forum post creation",
    )
    title = normalize_forum_text(payload.title, "title")
    body = normalize_forum_text(payload.body, "body")

    post = ForumPost(
        user_id=int(auth.user.id),
        title=title,
        body=body,
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    return forum_post_summary_to_out(
        post=post,
        author_username=str(auth.user.username),
        comment_count=0,
    )


@app.get("/forum/posts/{post_id}", response_model=ForumPostDetailOut)
def forum_get_post(
    post_id: int,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    post = db.get(ForumPost, post_id)
    if not post or is_content_hidden(db, MODERATION_CONTENT_FORUM_POST, int(post_id)):
        raise HTTPException(404, "Forum post not found")

    post.view_count = int(post.view_count or 0) + 1
    db.add(
        ForumPostView(
            post_id=int(post.id),
            user_id=int(auth.user.id),
        )
    )
    db.flush()

    post_author = db.get(User, int(post.user_id))
    post_author_username = str(post_author.username) if post_author else "unknown"

    comments = db.execute(
        select(ForumComment)
        .where(ForumComment.post_id == post.id)
        .order_by(ForumComment.created_at.asc(), ForumComment.id.asc())
    ).scalars().all()
    hidden_comment_ids = hidden_content_id_set(
        db,
        MODERATION_CONTENT_FORUM_COMMENT,
        [int(comment.id) for comment in comments],
    )
    comments = [comment for comment in comments if int(comment.id) not in hidden_comment_ids]

    if comments:
        comment_author_ids = sorted({int(comment.user_id) for comment in comments})
        comment_author_rows = db.execute(
            select(User.id, User.username).where(User.id.in_(comment_author_ids))
        ).all()
        comment_author_by_id = {int(user_id): str(username) for user_id, username in comment_author_rows}
    else:
        comment_author_by_id = {}

    comments_out = [
        forum_comment_to_out(
            comment=comment,
            author_username=comment_author_by_id.get(int(comment.user_id), "unknown"),
        )
        for comment in comments
    ]

    out = ForumPostDetailOut(
        id=int(post.id),
        title=str(post.title),
        body=str(post.body),
        author_username=post_author_username,
        comment_count=len(comments_out),
        view_count=int(post.view_count or 0),
        created_at=post.created_at,
        updated_at=post.updated_at,
        comments=comments_out,
    )
    db.commit()
    return out


@app.post("/forum/posts/{post_id}/comments", response_model=ForumCommentOut)
def forum_create_comment(
    post_id: int,
    payload: ForumCommentCreateIn,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    enforce_user_rate_limit(
        int(auth.user.id),
        bucket="forum:comment:create",
        limit=RATE_LIMIT_FORUM_COMMENT_CREATE,
        window_seconds=RATE_LIMIT_FORUM_COMMENT_CREATE_WINDOW_SECONDS,
        label="forum comment creation",
    )
    enforce_ip_rate_limit(
        request,
        bucket="forum:comment:create",
        limit=RATE_LIMIT_FORUM_COMMENT_CREATE,
        window_seconds=RATE_LIMIT_FORUM_COMMENT_CREATE_WINDOW_SECONDS,
        label="forum comment creation",
    )
    post = db.get(ForumPost, post_id)
    if not post or is_content_hidden(db, MODERATION_CONTENT_FORUM_POST, int(post_id)):
        raise HTTPException(404, "Forum post not found")

    body = normalize_forum_text(payload.body, "comment")
    comment = ForumComment(
        post_id=int(post.id),
        user_id=int(auth.user.id),
        body=body,
    )
    post.updated_at = chicago_now()
    db.add(comment)
    if int(post.user_id) != int(auth.user.id):
        create_notification(
            db,
            user_id=int(post.user_id),
            notification_type=NOTIFICATION_TYPE_FORUM_REPLY,
            actor_user_id=int(auth.user.id),
            entity_type="FORUM_POST",
            entity_id=int(post.id),
            message=f"{auth.user.username} replied to your post.",
        )
    db.commit()
    db.refresh(comment)

    return forum_comment_to_out(
        comment=comment,
        author_username=str(auth.user.username),
    )


@app.get("/portfolio", response_model=PortfolioOut)
def portfolio(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=False,
    )
    snapshot = build_account_risk_snapshot(
        db=db,
        user=user,
        for_update=False,
    )
    return PortfolioOut(
        cash_balance=float(user.cash_balance),
        equity=float(snapshot.equity),
        net_exposure=float(snapshot.net_exposure),
        gross_exposure=float(snapshot.gross_exposure),
        holdings=[
            PortfolioHolding(
                player_id=position.player.id,
                shares_owned=float(position.shares),
                average_entry_price=float(position.average_entry_price),
                basis_amount=float(position_display_basis_amount(position)),
                spot_price=float(position.spot_price),
                market_value=float(position.market_value),
                unrealized_pnl=float(position_unrealized_pnl(position)),
                unrealized_pnl_pct=float(
                    (position_unrealized_pnl(position) / position_display_basis_amount(position)) * Decimal("100")
                    if position_display_basis_amount(position) > 0
                    else Decimal("0")
                ),
            )
            for position in sorted(snapshot.positions, key=lambda position: abs(position.market_value), reverse=True)
        ],
    )


@app.get("/transactions/me", response_model=list[AdminAuditTradeOut])
def list_my_transactions(
    limit: int = Query(default=100, ge=1, le=500),
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Transaction, Player)
        .outerjoin(Player, Transaction.player_id == Player.id)
        .where(Transaction.user_id == int(auth.user.id))
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .limit(limit)
    ).all()
    return [
        admin_audit_trade_to_out(
            transaction=transaction,
            username=str(auth.user.username),
            player=player,
        )
        for transaction, player in rows
    ]


@app.post("/quote/buy", response_model=QuoteOut)
def quote_buy(
    trade: TradeIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=False,
    )
    player = db.get(Player, trade.player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    ensure_player_is_listed_or_raise(player)
    ensure_trading_allowed_or_raise(db, str(player.sport))

    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    holding = db.execute(
        select(Holding).where(Holding.user_id == user.id, Holding.player_id == player.id)
    ).scalar_one_or_none()
    net_shares = Decimal(str(holding.shares_owned)) if holding else Decimal("0")
    if net_shares < 0:
        raise HTTPException(400, "You are short this player. Use /quote/cover.")

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id])
    fundamental, _, _ = get_pricing_context(player, stats_snapshot)

    market_bias = current_market_bias(player)
    spot_before = current_spot_price(
        player,
        fundamental_price=fundamental,
        market_bias=market_bias,
    )
    ensure_open_position_cap_or_raise(
        current_abs_shares=max(Decimal("0"), net_shares),
        additional_shares=qty,
        spot_before=spot_before,
    )
    market_impact_delta = market_impact_bias_delta_for_trade(
        qty=qty,
        spot_price_before=spot_before,
        market_bias_before=market_bias,
    )
    spot_after = canonical_executed_spot_price(
        player=player,
        fundamental_price=fundamental,
        next_market_bias=market_bias + market_impact_delta,
    )
    raw_cost = trade_execution_notional_after_move(qty=qty, spot_price_after=spot_after)
    total_cost = raw_cost + calculate_open_position_fee(raw_cost)
    average_price = spot_after

    return QuoteOut(
        player_id=player.id,
        shares=float(qty),
        spot_price_before=float(spot_before),
        spot_price_after=float(spot_after),
        average_price=float(average_price),
        total=float(total_cost),
    )


@app.post("/quote/sell", response_model=QuoteOut)
def quote_sell(
    trade: TradeIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=False,
    )
    player = db.get(Player, trade.player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    ensure_player_is_listed_or_raise(player)
    ensure_trading_allowed_or_raise(db, str(player.sport))

    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    holding = db.execute(
        select(Holding).where(Holding.user_id == user.id, Holding.player_id == player.id)
    ).scalar_one_or_none()
    owned = Decimal(str(holding.shares_owned)) if holding else Decimal("0")
    if qty > owned:
        raise HTTPException(400, f"Trying to sell {float(qty):.4f} but only own {float(owned):.4f}")

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id])
    fundamental, _, _ = get_pricing_context(player, stats_snapshot)

    market_bias = current_market_bias(player)
    spot_before = current_spot_price(
        player,
        fundamental_price=fundamental,
        market_bias=market_bias,
    )
    ensure_sell_side_allowed_or_raise(
        player=player,
        market_bias=market_bias,
        qty=qty,
        fundamental_price=fundamental,
        spot_price_before=spot_before,
    )
    market_impact_delta = market_impact_bias_delta_for_trade(
        qty=qty,
        spot_price_before=spot_before,
        market_bias_before=market_bias,
    )
    spot_after = canonical_executed_spot_price(
        player=player,
        fundamental_price=fundamental,
        next_market_bias=market_bias - market_impact_delta,
    )
    proceeds = trade_execution_notional_after_move(qty=qty, spot_price_after=spot_after)
    average_price = spot_after

    return QuoteOut(
        player_id=player.id,
        shares=float(qty),
        spot_price_before=float(spot_before),
        spot_price_after=float(spot_after),
        average_price=float(average_price),
        total=float(proceeds),
    )


@app.post("/quote/short", response_model=QuoteOut)
def quote_short(
    trade: TradeIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=False,
    )
    player = db.get(Player, trade.player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    ensure_player_is_listed_or_raise(player)
    ensure_trading_allowed_or_raise(db, str(player.sport))

    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    holding = db.execute(
        select(Holding).where(Holding.user_id == user.id, Holding.player_id == player.id)
    ).scalar_one_or_none()
    net_shares = Decimal(str(holding.shares_owned)) if holding else Decimal("0")
    if net_shares > 0:
        raise HTTPException(400, "You are long this player. Use /quote/sell until flat before shorting.")

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id])
    fundamental, _, _ = get_pricing_context(player, stats_snapshot)

    market_bias = current_market_bias(player)
    spot_before = current_spot_price(
        player,
        fundamental_price=fundamental,
        market_bias=market_bias,
    )
    ensure_sell_side_allowed_or_raise(
        player=player,
        market_bias=market_bias,
        qty=qty,
        fundamental_price=fundamental,
        spot_price_before=spot_before,
    )
    ensure_open_position_cap_or_raise(
        current_abs_shares=abs(min(Decimal("0"), net_shares)),
        additional_shares=qty,
        spot_before=spot_before,
    )
    market_impact_delta = market_impact_bias_delta_for_trade(
        qty=qty,
        spot_price_before=spot_before,
        market_bias_before=market_bias,
    )
    spot_after = canonical_executed_spot_price(
        player=player,
        fundamental_price=fundamental,
        next_market_bias=market_bias - market_impact_delta,
    )
    raw_notional = trade_execution_notional_after_move(qty=qty, spot_price_after=spot_after)
    total_cost = raw_notional + calculate_open_position_fee(raw_notional)
    average_price = spot_after

    return QuoteOut(
        player_id=player.id,
        shares=float(qty),
        spot_price_before=float(spot_before),
        spot_price_after=float(spot_after),
        average_price=float(average_price),
        total=float(total_cost),
    )


@app.post("/quote/cover", response_model=QuoteOut)
def quote_cover(
    trade: TradeIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=False,
    )
    player = db.get(Player, trade.player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    ensure_player_is_listed_or_raise(player)
    ensure_trading_allowed_or_raise(db, str(player.sport))

    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    holding = db.execute(
        select(Holding).where(Holding.user_id == user.id, Holding.player_id == player.id)
    ).scalar_one_or_none()
    net_shares = Decimal(str(holding.shares_owned)) if holding else Decimal("0")
    if net_shares >= 0:
        raise HTTPException(400, "No short position to cover.")

    short_size = -net_shares
    if qty > short_size:
        raise HTTPException(400, f"Trying to cover {float(qty):.4f} but short size is {float(short_size):.4f}")

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id])
    fundamental, _, _ = get_pricing_context(player, stats_snapshot)

    market_bias = current_market_bias(player)
    spot_before = current_spot_price(
        player,
        fundamental_price=fundamental,
        market_bias=market_bias,
    )
    basis_amount = holding_basis_amount(holding)
    closed_basis_amount = basis_amount_closed_pro_rata(
        basis_amount=basis_amount,
        shares_before=net_shares,
        shares_closed=qty,
    )
    market_impact_delta = market_impact_bias_delta_for_trade(
        qty=qty,
        spot_price_before=spot_before,
        market_bias_before=market_bias,
    )
    spot_after = canonical_executed_spot_price(
        player=player,
        fundamental_price=fundamental,
        next_market_bias=market_bias + market_impact_delta,
    )
    proceeds = short_position_close_value(
        qty=qty,
        basis_amount=closed_basis_amount,
        executed_spot_price=spot_after,
    )
    average_price = spot_after

    return QuoteOut(
        player_id=player.id,
        shares=float(qty),
        spot_price_before=float(spot_before),
        spot_price_after=float(spot_after),
        average_price=float(average_price),
        total=float(proceeds),
    )


@app.post("/trade/buy", response_model=TradeOut)
def buy(
    trade: TradeIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=True,
    )
    player = db.execute(
        select(Player).where(Player.id == trade.player_id).with_for_update()
    ).scalar_one_or_none()
    if not player:
        raise HTTPException(404, "Player not found")
    ensure_player_is_listed_or_raise(player)
    ensure_trading_allowed_or_raise(db, str(player.sport))

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id])
    fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)

    total_shares = Decimal(str(player.total_shares))

    holding = db.execute(
        select(Holding)
        .where(Holding.user_id == user.id, Holding.player_id == player.id)
        .with_for_update()
    ).scalar_one_or_none()
    net_shares = Decimal(str(holding.shares_owned)) if holding else Decimal("0")
    if net_shares < 0:
        raise HTTPException(400, "You are short this player. Use /trade/cover.")

    market_bias = current_market_bias(player)
    spot_before = current_spot_price(
        player,
        fundamental_price=fundamental,
        market_bias=market_bias,
    )
    ensure_open_position_cap_or_raise(
        current_abs_shares=max(Decimal("0"), net_shares),
        additional_shares=qty,
        spot_before=spot_before,
    )
    market_impact_delta = market_impact_bias_delta_for_trade(
        qty=qty,
        spot_price_before=spot_before,
        market_bias_before=market_bias,
    )

    if not holding:
        holding = Holding(
            user_id=user.id,
            player_id=player.id,
            shares_owned=0,
            basis_amount=0,
            entry_basis_amount=0,
            mark_basis_amount=0,
        )
        db.add(holding)

    previous_basis_amount = holding_basis_amount(holding)
    next_market_bias = market_bias + market_impact_delta
    spot_after = canonical_executed_spot_price(
        player=player,
        fundamental_price=fundamental,
        next_market_bias=next_market_bias,
    )
    raw_cost = trade_execution_notional_after_move(qty=qty, spot_price_after=spot_after)
    total_cost = raw_cost + calculate_open_position_fee(raw_cost)
    cash = Decimal(str(user.cash_balance))

    if total_cost > cash:
        raise HTTPException(400, f"Insufficient cash. Need {float(total_cost):.2f}, have {float(cash):.2f}")

    user.cash_balance = float(cash - total_cost)
    next_shares_owned = Decimal(str(holding.shares_owned)) + qty
    holding.shares_owned = float(next_shares_owned)
    holding.basis_amount = float(previous_basis_amount + total_cost)
    player.total_shares = float(total_shares + qty)
    set_market_bias(player, bias=next_market_bias)
    remark_open_holding_to_current_spot(
        holding=holding,
        shares_owned=next_shares_owned,
        current_spot=current_spot_price(
            player,
            fundamental_price=fundamental,
        ),
    )

    unit_estimate = spot_after
    db.add(
        Transaction(
            user_id=user.id,
            player_id=player.id,
            type="BUY",
            shares=float(qty),
            unit_price=float(unit_estimate),
            amount=float(-total_cost),
        )
    )
    add_price_point(
        db=db,
        player=player,
        source="TRADE_BUY",
        fundamental_price=fundamental,
        points_to_date=points_to_date,
        latest_week=latest_week,
    )
    enforce_margin_and_maybe_liquidate(
        db=db,
        user=user,
    )

    db.commit()
    invalidate_market_read_cache(
        player_ids={int(player.id)},
        sports={str(player.sport)},
    )
    return TradeOut(
        player_id=player.id,
        shares=float(qty),
        unit_price_estimate=float(unit_estimate),
        total_cost_or_proceeds=float(total_cost),
        new_cash_balance=float(user.cash_balance),
        new_total_shares=float(player.total_shares),
    )


@app.post("/trade/sell", response_model=TradeOut)
def sell(
    trade: TradeIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=True,
    )
    player = db.execute(
        select(Player).where(Player.id == trade.player_id).with_for_update()
    ).scalar_one_or_none()
    if not player:
        raise HTTPException(404, "Player not found")
    ensure_player_is_listed_or_raise(player)
    ensure_trading_allowed_or_raise(db, str(player.sport))

    holding = db.execute(
        select(Holding)
        .where(Holding.user_id == user.id, Holding.player_id == player.id)
        .with_for_update()
    ).scalar_one_or_none()
    if not holding or Decimal(str(holding.shares_owned)) <= 0:
        raise HTTPException(400, "No shares to sell")

    owned = Decimal(str(holding.shares_owned))
    if qty > owned:
        raise HTTPException(400, f"Trying to sell {float(qty):.4f} but only own {float(owned):.4f}")

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id])
    fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)

    total_shares = Decimal(str(player.total_shares))
    market_bias = current_market_bias(player)
    spot_before = current_spot_price(
        player,
        fundamental_price=fundamental,
        market_bias=market_bias,
    )
    ensure_sell_side_allowed_or_raise(
        player=player,
        market_bias=market_bias,
        qty=qty,
        fundamental_price=fundamental,
        spot_price_before=spot_before,
    )
    market_impact_delta = market_impact_bias_delta_for_trade(
        qty=qty,
        spot_price_before=spot_before,
        market_bias_before=market_bias,
    )
    next_market_bias = market_bias - market_impact_delta
    spot_after = canonical_executed_spot_price(
        player=player,
        fundamental_price=fundamental,
        next_market_bias=next_market_bias,
    )
    proceeds = trade_execution_notional_after_move(qty=qty, spot_price_after=spot_after)

    cash = Decimal(str(user.cash_balance))
    user.cash_balance = float(cash + proceeds)

    previous_basis_amount = holding_basis_amount(holding)
    previous_entry_basis_amount = holding_entry_basis_amount(holding)
    previous_mark_basis_amount = holding_mark_basis_amount(holding)
    holding.shares_owned = float(owned - qty)
    holding.basis_amount = float(
        reduce_basis_pro_rata(
            basis_amount=previous_basis_amount,
            shares_before=owned,
            shares_closed=qty,
        )
    )
    holding.entry_basis_amount = float(
        reduce_basis_pro_rata(
            basis_amount=previous_entry_basis_amount,
            shares_before=owned,
            shares_closed=qty,
        )
    )
    holding.mark_basis_amount = float(
        reduce_basis_pro_rata(
            basis_amount=previous_mark_basis_amount,
            shares_before=owned,
            shares_closed=qty,
        )
    )
    player.total_shares = float(total_shares - qty)
    set_market_bias(player, bias=next_market_bias)

    unit_estimate = spot_after
    db.add(
        Transaction(
            user_id=user.id,
            player_id=player.id,
            type="SELL",
            shares=float(qty),
            unit_price=float(unit_estimate),
            amount=float(proceeds),
        )
    )
    add_price_point(
        db=db,
        player=player,
        source="TRADE_SELL",
        fundamental_price=fundamental,
        points_to_date=points_to_date,
        latest_week=latest_week,
    )
    enforce_margin_and_maybe_liquidate(
        db=db,
        user=user,
    )

    db.commit()
    invalidate_market_read_cache(
        player_ids={int(player.id)},
        sports={str(player.sport)},
    )
    return TradeOut(
        player_id=player.id,
        shares=float(qty),
        unit_price_estimate=float(unit_estimate),
        total_cost_or_proceeds=float(proceeds),
        new_cash_balance=float(user.cash_balance),
        new_total_shares=float(player.total_shares),
    )


@app.post("/trade/short", response_model=TradeOut)
def short(
    trade: TradeIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=True,
    )
    player = db.execute(
        select(Player).where(Player.id == trade.player_id).with_for_update()
    ).scalar_one_or_none()
    if not player:
        raise HTTPException(404, "Player not found")
    ensure_player_is_listed_or_raise(player)
    ensure_trading_allowed_or_raise(db, str(player.sport))

    holding = db.execute(
        select(Holding)
        .where(Holding.user_id == user.id, Holding.player_id == player.id)
        .with_for_update()
    ).scalar_one_or_none()
    if not holding:
        holding = Holding(
            user_id=user.id,
            player_id=player.id,
            shares_owned=0,
            basis_amount=0,
            entry_basis_amount=0,
            mark_basis_amount=0,
        )
        db.add(holding)

    net_shares = Decimal(str(holding.shares_owned))
    if net_shares > 0:
        raise HTTPException(400, "You are long this player. Sell until flat before shorting.")

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id])
    fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)

    total_shares = Decimal(str(player.total_shares))
    market_bias = current_market_bias(player)
    spot_before = current_spot_price(
        player,
        fundamental_price=fundamental,
        market_bias=market_bias,
    )
    ensure_sell_side_allowed_or_raise(
        player=player,
        market_bias=market_bias,
        qty=qty,
        fundamental_price=fundamental,
        spot_price_before=spot_before,
    )
    ensure_open_position_cap_or_raise(
        current_abs_shares=abs(min(Decimal("0"), net_shares)),
        additional_shares=qty,
        spot_before=spot_before,
    )

    market_impact_delta = market_impact_bias_delta_for_trade(
        qty=qty,
        spot_price_before=spot_before,
        market_bias_before=market_bias,
    )
    next_market_bias = market_bias - market_impact_delta
    spot_after = canonical_executed_spot_price(
        player=player,
        fundamental_price=fundamental,
        next_market_bias=next_market_bias,
    )
    raw_notional = trade_execution_notional_after_move(qty=qty, spot_price_after=spot_after)
    total_cost = raw_notional + calculate_open_position_fee(raw_notional)

    cash = Decimal(str(user.cash_balance))
    if total_cost > cash:
        raise HTTPException(400, f"Insufficient cash. Need {float(total_cost):.2f}, have {float(cash):.2f}")
    user.cash_balance = float(cash - total_cost)

    previous_basis_amount = holding_basis_amount(holding)
    next_shares_owned = net_shares - qty
    holding.shares_owned = float(next_shares_owned)
    holding.basis_amount = float(previous_basis_amount + raw_notional)
    player.total_shares = float(total_shares - qty)
    set_market_bias(player, bias=next_market_bias)
    remark_open_holding_to_current_spot(
        holding=holding,
        shares_owned=next_shares_owned,
        current_spot=current_spot_price(
            player,
            fundamental_price=fundamental,
        ),
    )

    unit_estimate = spot_after
    db.add(
        Transaction(
            user_id=user.id,
            player_id=player.id,
            type="SHORT",
            shares=float(qty),
            unit_price=float(unit_estimate),
            amount=float(-total_cost),
        )
    )
    add_price_point(
        db=db,
        player=player,
        source="TRADE_SHORT",
        fundamental_price=fundamental,
        points_to_date=points_to_date,
        latest_week=latest_week,
    )
    enforce_margin_and_maybe_liquidate(
        db=db,
        user=user,
    )

    db.commit()
    invalidate_market_read_cache(
        player_ids={int(player.id)},
        sports={str(player.sport)},
    )
    return TradeOut(
        player_id=player.id,
        shares=float(qty),
        unit_price_estimate=float(unit_estimate),
        total_cost_or_proceeds=float(total_cost),
        new_cash_balance=float(user.cash_balance),
        new_total_shares=float(player.total_shares),
    )


@app.post("/trade/cover", response_model=TradeOut)
def cover(
    trade: TradeIn,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    qty = Decimal(str(trade.shares))
    if qty <= 0:
        raise HTTPException(400, "shares must be > 0")

    user = get_user_by_id_or_raise(
        db=db,
        user_id=auth.user.id,
        for_update=True,
    )
    player = db.execute(
        select(Player).where(Player.id == trade.player_id).with_for_update()
    ).scalar_one_or_none()
    if not player:
        raise HTTPException(404, "Player not found")
    ensure_player_is_listed_or_raise(player)
    ensure_trading_allowed_or_raise(db, str(player.sport))

    holding = db.execute(
        select(Holding)
        .where(Holding.user_id == user.id, Holding.player_id == player.id)
        .with_for_update()
    ).scalar_one_or_none()
    if not holding:
        raise HTTPException(400, "No short position to cover")

    net_shares = Decimal(str(holding.shares_owned))
    if net_shares >= 0:
        raise HTTPException(400, "No short position to cover")

    short_size = -net_shares
    if qty > short_size:
        raise HTTPException(400, f"Trying to cover {float(qty):.4f} but short size is {float(short_size):.4f}")

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id])
    fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)

    total_shares = Decimal(str(player.total_shares))
    market_bias = current_market_bias(player)
    previous_basis_amount = holding_basis_amount(holding)
    previous_entry_basis_amount = holding_entry_basis_amount(holding)
    previous_mark_basis_amount = holding_mark_basis_amount(holding)
    closed_basis_amount = basis_amount_closed_pro_rata(
        basis_amount=previous_basis_amount,
        shares_before=net_shares,
        shares_closed=qty,
    )
    spot_before = current_spot_price(
        player,
        fundamental_price=fundamental,
        market_bias=market_bias,
    )
    market_impact_delta = market_impact_bias_delta_for_trade(
        qty=qty,
        spot_price_before=spot_before,
        market_bias_before=market_bias,
    )
    next_market_bias = market_bias + market_impact_delta
    executed_spot_price = canonical_executed_spot_price(
        player=player,
        fundamental_price=fundamental,
        next_market_bias=next_market_bias,
    )
    proceeds = short_position_close_value(
        qty=qty,
        basis_amount=closed_basis_amount,
        executed_spot_price=executed_spot_price,
    )

    cash = Decimal(str(user.cash_balance))
    user.cash_balance = float(cash + proceeds)

    holding.shares_owned = float(net_shares + qty)
    holding.basis_amount = float(
        reduce_basis_pro_rata(
            basis_amount=previous_basis_amount,
            shares_before=net_shares,
            shares_closed=qty,
        )
    )
    holding.entry_basis_amount = float(
        reduce_basis_pro_rata(
            basis_amount=previous_entry_basis_amount,
            shares_before=net_shares,
            shares_closed=qty,
        )
    )
    holding.mark_basis_amount = float(
        reduce_basis_pro_rata(
            basis_amount=previous_mark_basis_amount,
            shares_before=net_shares,
            shares_closed=qty,
        )
    )
    player.total_shares = float(total_shares + qty)
    set_market_bias(player, bias=next_market_bias)

    unit_estimate = executed_spot_price
    db.add(
        Transaction(
            user_id=user.id,
            player_id=player.id,
            type="COVER",
            shares=float(qty),
            unit_price=float(unit_estimate),
            amount=float(proceeds),
        )
    )
    add_price_point(
        db=db,
        player=player,
        source="TRADE_COVER",
        fundamental_price=fundamental,
        points_to_date=points_to_date,
        latest_week=latest_week,
    )
    enforce_margin_and_maybe_liquidate(
        db=db,
        user=user,
    )

    db.commit()
    invalidate_market_read_cache(
        player_ids={int(player.id)},
        sports={str(player.sport)},
    )
    return TradeOut(
        player_id=player.id,
        shares=float(qty),
        unit_price_estimate=float(unit_estimate),
        total_cost_or_proceeds=float(proceeds),
        new_cash_balance=float(user.cash_balance),
        new_total_shares=float(player.total_shares),
    )


def apply_live_snapshot_from_stat(
    player: Player,
    stat: StatIn,
) -> bool:
    has_live_payload = any(
        value is not None
        for value in (
            stat.live_now,
            stat.live_week,
            stat.live_game_id,
            stat.live_game_label,
            stat.live_game_status,
            stat.live_game_stat_line,
            stat.live_game_fantasy_points,
            stat.team,
        )
    )
    if not has_live_payload:
        return False

    changed = False

    def assign_if_changed(attribute: str, value: object) -> None:
        nonlocal changed
        if getattr(player, attribute) != value:
            setattr(player, attribute, value)
            changed = True

    if stat.live_now is not None:
        assign_if_changed("live_now", bool(stat.live_now))
    if stat.live_week is not None:
        assign_if_changed("live_week", int(stat.live_week))
    if stat.live_game_id is not None:
        assign_if_changed("live_game_id", normalize_optional_profile_field(stat.live_game_id))
    if stat.live_game_label is not None:
        assign_if_changed("live_game_label", normalize_optional_profile_field(stat.live_game_label))
    if stat.live_game_status is not None:
        assign_if_changed("live_game_status", normalize_optional_profile_field(stat.live_game_status))
    if stat.live_game_stat_line is not None:
        assign_if_changed("live_game_stat_line", normalize_optional_profile_field(stat.live_game_stat_line))
    if stat.live_game_fantasy_points is not None:
        assign_if_changed("live_game_fantasy_points", float(stat.live_game_fantasy_points))
    if stat.team is not None:
        normalized_team = normalize_team_for_player(player, stat.team)
        if normalized_team is not None:
            assign_if_changed("team", normalized_team)

    if stat.live_now is False:
        if stat.live_week is None:
            assign_if_changed("live_week", None)
        if stat.live_game_id is None:
            assign_if_changed("live_game_id", None)
        if stat.live_game_label is None:
            assign_if_changed("live_game_label", None)
        if stat.live_game_status is None:
            assign_if_changed("live_game_status", None)
        if stat.live_game_stat_line is None:
            assign_if_changed("live_game_stat_line", None)
        if stat.live_game_fantasy_points is None:
            assign_if_changed("live_game_fantasy_points", 0.0)

    if changed:
        player.live_updated_at = chicago_now()

    return changed


def upsert_player_game_point_from_stat(
    db: Session,
    *,
    player: Player,
    stat: StatIn,
) -> bool:
    game_id = normalize_optional_profile_field(stat.live_game_id)
    if not game_id:
        return False

    return upsert_player_game_point(
        db=db,
        player_id=int(player.id),
        game_id=game_id,
        game_label=normalize_optional_profile_field(stat.live_game_label),
        game_status=normalize_optional_profile_field(stat.live_game_status),
        game_fantasy_points=float(stat.live_game_fantasy_points or 0.0),
        season_fantasy_points=float(stat.fantasy_points),
        recorded_at=chicago_now(),
    )


def upsert_player_game_point(
    db: Session,
    *,
    player_id: int,
    game_id: str,
    game_label: str | None,
    game_status: str | None,
    game_fantasy_points: float,
    season_fantasy_points: float,
    recorded_at: datetime,
) -> bool:
    if not game_id:
        return False

    existing = db.execute(
        select(PlayerGamePoint).where(
            PlayerGamePoint.player_id == int(player_id),
            PlayerGamePoint.game_id == game_id,
        )
    ).scalar_one_or_none()

    if existing is None:
        existing = PlayerGamePoint(
            player_id=int(player_id),
            game_id=game_id,
        )
        db.add(existing)

    changed = False

    def assign_if_changed(attribute: str, value: object) -> None:
        nonlocal changed
        if getattr(existing, attribute) != value:
            setattr(existing, attribute, value)
            changed = True

    assign_if_changed("game_label", game_label)
    assign_if_changed("game_status", game_status)
    assign_if_changed("game_fantasy_points", float(game_fantasy_points))
    assign_if_changed("season_fantasy_points", float(season_fantasy_points))
    assign_if_changed("recorded_at", recorded_at)
    return changed


def upsert_weekly_stat_for_player(
    db: Session,
    player: Player,
    week: int,
    fantasy_points: float,
) -> tuple[str, bool]:
    for pending in db.new:
        if (
            isinstance(pending, WeeklyStat)
            and int(pending.player_id) == int(player.id)
            and int(pending.week) == int(week)
        ):
            current_points = float(pending.fantasy_points)
            if abs(current_points - float(fantasy_points)) <= 0.000001:
                return "updated", False
            pending.fantasy_points = fantasy_points
            return "updated", True

    existing = db.execute(
        select(WeeklyStat).where(
            WeeklyStat.player_id == player.id,
            WeeklyStat.week == week,
        )
    ).scalar_one_or_none()

    if existing:
        current_points = float(existing.fantasy_points)
        if abs(current_points - float(fantasy_points)) <= 0.000001:
            return "updated", False
        existing.fantasy_points = fantasy_points
        return "updated", True

    db.add(
        WeeklyStat(
            player_id=player.id,
            week=week,
            fantasy_points=fantasy_points,
        )
    )
    return "created", True


def refresh_players_after_stats_update(
    db: Session,
    player_ids: set[int],
    source: str,
) -> None:
    if not player_ids:
        return

    players = db.execute(
        select(Player).where(Player.id.in_(sorted(player_ids)))
    ).scalars().all()
    stats_snapshot = get_stats_snapshot_by_player(db, [player.id for player in players])

    for player in players:
        fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        add_price_point(
            db=db,
            player=player,
            source=source,
            fundamental_price=fundamental,
            points_to_date=points_to_date,
            latest_week=latest_week,
        )

    affected_user_ids = db.execute(
        select(Holding.user_id)
        .where(Holding.player_id.in_(sorted(player_ids)))
        .distinct()
    ).scalars().all()
    for user_id in affected_user_ids:
        enforce_margin_and_maybe_liquidate(
            db=db,
            user=get_user_by_id_or_raise(
                db=db,
                user_id=int(user_id),
                for_update=True,
            ),
        )


def build_admin_ipo_summaries(players: list[Player]) -> list[AdminIpoSportOut]:
    by_sport: dict[str, list[Player]] = {}
    for player in players:
        sport = str(player.sport).strip().upper()
        by_sport.setdefault(sport, []).append(player)

    summaries: list[AdminIpoSportOut] = []
    for sport in sorted(by_sport.keys()):
        sport_players = by_sport[sport]
        listed_players = [player for player in sport_players if player_is_listed(player)]
        ipo_seasons = {int(player.ipo_season) for player in listed_players if player.ipo_season is not None}
        ipo_opened_values = [player.ipo_opened_at for player in listed_players if player.ipo_opened_at is not None]
        summaries.append(
            AdminIpoSportOut(
                sport=sport,
                total_players=len(sport_players),
                listed_players=len(listed_players),
                ipo_open=len(listed_players) > 0,
                ipo_season=max(ipo_seasons) if ipo_seasons else None,
                ipo_opened_at=max(ipo_opened_values) if ipo_opened_values else None,
            )
        )

    return summaries


def build_admin_ipo_suggestions(
    *,
    db: Session,
    sport: str | None,
    lookback_hours: int,
    limit: int,
) -> AdminIpoSuggestionsOut:
    now = chicago_now()
    lookback_start = now - timedelta(hours=lookback_hours)
    normalized_sport = None if sport is None or sport == "ALL" else normalize_sport_code(sport)
    resolved_sport = "ALL" if normalized_sport is None else normalized_sport

    hidden_stmt = select(Player).where(Player.ipo_open.is_(False))
    if normalized_sport is not None:
        hidden_stmt = hidden_stmt.where(Player.sport == normalized_sport)
    hidden_players = db.execute(
        hidden_stmt.order_by(Player.sport.asc(), Player.name.asc())
    ).scalars().all()
    if not hidden_players:
        return AdminIpoSuggestionsOut(
            sport=resolved_sport,
            lookback_hours=lookback_hours,
            total_candidates=0,
            suggestions=[],
        )

    player_ids = [int(player.id) for player in hidden_players]

    latest_week_rows = db.execute(
        select(WeeklyStat.player_id, func.max(WeeklyStat.week))
        .where(WeeklyStat.player_id.in_(player_ids))
        .group_by(WeeklyStat.player_id)
    ).all()
    latest_week_by_player_id = {
        int(player_id): int(latest_week)
        for player_id, latest_week in latest_week_rows
        if latest_week is not None
    }

    last_game_rows = db.execute(
        select(PlayerGamePoint.player_id, func.max(PlayerGamePoint.recorded_at))
        .where(PlayerGamePoint.player_id.in_(player_ids))
        .group_by(PlayerGamePoint.player_id)
    ).all()
    last_game_recorded_by_player_id = {
        int(player_id): recorded_at
        for player_id, recorded_at in last_game_rows
        if recorded_at is not None
    }

    recent_game_rows = db.execute(
        select(PlayerGamePoint.player_id, func.count(PlayerGamePoint.id))
        .where(
            PlayerGamePoint.player_id.in_(player_ids),
            PlayerGamePoint.recorded_at >= lookback_start,
        )
        .group_by(PlayerGamePoint.player_id)
    ).all()
    recent_game_count_by_player_id = {
        int(player_id): int(count or 0)
        for player_id, count in recent_game_rows
    }
    total_game_rows = db.execute(
        select(PlayerGamePoint.player_id, func.count(PlayerGamePoint.id))
        .where(PlayerGamePoint.player_id.in_(player_ids))
        .group_by(PlayerGamePoint.player_id)
    ).all()
    total_game_appearance_by_player_id = {
        int(player_id): int(count or 0)
        for player_id, count in total_game_rows
    }

    candidate_players: list[Player] = []
    for player in hidden_players:
        player_id = int(player.id)
        has_recent_live = player.live_updated_at is not None and player.live_updated_at >= lookback_start
        has_playing_time = total_game_appearance_by_player_id.get(player_id, 0) > 0
        if has_recent_live or has_playing_time:
            candidate_players.append(player)

    if not candidate_players:
        return AdminIpoSuggestionsOut(
            sport=resolved_sport,
            lookback_hours=lookback_hours,
            total_candidates=0,
            suggestions=[],
        )

    candidate_ids = [int(player.id) for player in candidate_players]
    stats_snapshot = get_stats_snapshot_by_player(db, candidate_ids)
    candidate_rows: list[tuple[tuple[int, float, float, str], AdminIpoSuggestionOut]] = []
    for player in candidate_players:
        player_id = int(player.id)
        fundamental_price, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        last_game_recorded_at = last_game_recorded_by_player_id.get(player_id)
        live_updated_at = player.live_updated_at
        recent_activity_at = max(
            [value for value in [last_game_recorded_at, live_updated_at] if value is not None],
            default=None,
        )
        recent_game_updates = recent_game_count_by_player_id.get(player_id, 0)
        total_game_appearances = total_game_appearance_by_player_id.get(player_id, 0)
        latest_week_value = latest_week_by_player_id.get(player_id, int(latest_week))

        suggestion = AdminIpoSuggestionOut(
            id=player_id,
            sport=str(player.sport),
            name=str(player.name),
            team=str(player.team),
            position=str(player.position),
            base_price=float(player.base_price),
            suggested_base_price=round(max(10.0, float(fundamental_price)), 2),
            suggested_k=float(player.k),
            points_to_date=float(points_to_date),
            latest_week=max(0, int(latest_week_value)),
            total_game_appearances=max(0, int(total_game_appearances)),
            recent_game_updates=max(0, int(recent_game_updates)),
            last_game_recorded_at=last_game_recorded_at,
            live_updated_at=live_updated_at,
            recent_activity_at=recent_activity_at,
        )
        recent_rank = 1 if (recent_game_updates > 0 or live_updated_at is not None) else 0
        sort_timestamp = recent_activity_at.timestamp() if recent_activity_at is not None else -1.0
        candidate_rows.append(
            (
                (
                    recent_rank,
                    float(total_game_appearances),
                    sort_timestamp,
                    float(recent_game_updates),
                    str(player.name).lower(),
                ),
                suggestion,
            )
        )

    candidate_rows.sort(key=lambda row: row[0], reverse=True)
    suggestions = [row[1] for row in candidate_rows[:limit]]
    return AdminIpoSuggestionsOut(
        sport=resolved_sport,
        lookback_hours=lookback_hours,
        total_candidates=len(candidate_rows),
        suggestions=suggestions,
    )


def close_out_single_player_holdings(
    *,
    db: Session,
    player: Player,
    long_payout_price: Decimal,
    short_payout_price: Decimal,
    tx_type_prefix: str,
) -> tuple[int, Decimal, int, Decimal]:
    holdings = db.execute(
        select(Holding)
        .where(
            Holding.player_id == int(player.id),
            Holding.shares_owned != 0,
        )
        .order_by(Holding.user_id.asc(), Holding.id.asc())
        .with_for_update()
    ).scalars().all()
    if not holdings:
        return 0, Decimal("0"), 0, Decimal("0")

    user_ids = sorted({int(holding.user_id) for holding in holdings})
    users = db.execute(
        select(User)
        .where(User.id.in_(user_ids))
        .order_by(User.id.asc())
        .with_for_update()
    ).scalars().all()
    users_by_id = {int(user.id): user for user in users}

    closed_positions = 0
    closed_shares = Decimal("0")
    total_payout = Decimal("0")
    credited_users: set[int] = set()

    for holding in holdings:
        user = users_by_id.get(int(holding.user_id))
        if user is None:
            continue

        shares = Decimal(str(holding.shares_owned))
        if shares == 0:
            continue
        qty = abs(shares)

        if shares < 0:
            amount = short_position_close_value(
                qty=qty,
                basis_amount=holding_basis_amount(holding),
                executed_spot_price=short_payout_price,
            )
            tx_type = f"{tx_type_prefix}_COVER"
            unit_price = short_payout_price
        else:
            amount = qty * long_payout_price
            tx_type = f"{tx_type_prefix}_SELL"
            unit_price = long_payout_price

        user.cash_balance = float(Decimal(str(user.cash_balance)) + amount)
        holding.shares_owned = 0.0
        holding.basis_amount = 0.0
        holding.entry_basis_amount = 0.0
        holding.mark_basis_amount = 0.0

        closed_positions += 1
        closed_shares += qty
        total_payout += amount
        credited_users.add(int(user.id))

        db.add(
            Transaction(
                user_id=user.id,
                player_id=player.id,
                type=tx_type,
                shares=float(qty),
                unit_price=float(unit_price),
                amount=float(amount),
            )
        )

    return closed_positions, closed_shares, len(credited_users), total_payout


def close_out_sport_holdings_for_ipo_hide(
    db: Session,
    players: list[Player],
) -> tuple[int, Decimal]:
    if not players:
        return 0, Decimal("0")

    players_by_id = {int(player.id): player for player in players}
    player_ids = sorted(players_by_id.keys())
    holdings = db.execute(
        select(Holding)
        .where(
            Holding.player_id.in_(player_ids),
            Holding.shares_owned != 0,
        )
        .order_by(Holding.player_id.asc(), Holding.user_id.asc(), Holding.id.asc())
        .with_for_update()
    ).scalars().all()
    if not holdings:
        return 0, Decimal("0")

    user_ids = sorted({int(holding.user_id) for holding in holdings})
    users = db.execute(
        select(User)
        .where(User.id.in_(user_ids))
        .order_by(User.id.asc())
        .with_for_update()
    ).scalars().all()
    users_by_id = {int(user.id): user for user in users}

    stats_snapshot = get_stats_snapshot_by_player(db, player_ids)
    holdings_by_player: dict[int, list[Holding]] = {}
    for holding in holdings:
        holdings_by_player.setdefault(int(holding.player_id), []).append(holding)

    closed_positions = 0
    closed_shares = Decimal("0")

    for player_id in player_ids:
        player = players_by_id[player_id]
        player_holdings = holdings_by_player.get(player_id, [])
        if not player_holdings:
            continue

        fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        short_holdings = [holding for holding in player_holdings if Decimal(str(holding.shares_owned)) < 0]
        long_holdings = [holding for holding in player_holdings if Decimal(str(holding.shares_owned)) > 0]

        # Close shorts first so forced closeout does not push curve depth downward.
        for holding in [*short_holdings, *long_holdings]:
            user = users_by_id.get(int(holding.user_id))
            if user is None:
                continue

            shares = Decimal(str(holding.shares_owned))
            if shares == 0:
                continue

            total_shares = Decimal(str(player.total_shares))
            market_bias = current_market_bias(player)

            if shares < 0:
                qty = -shares
                basis_amount = holding_basis_amount(holding)
                spot_before = current_spot_price(
                    player,
                    fundamental_price=fundamental,
                    market_bias=market_bias,
                )
                market_impact_delta = market_impact_bias_delta_for_trade(
                    qty=qty,
                    spot_price_before=spot_before,
                    market_bias_before=market_bias,
                )
                next_market_bias = market_bias + market_impact_delta
                executed_spot_price = canonical_executed_spot_price(
                    player=player,
                    fundamental_price=fundamental,
                    next_market_bias=next_market_bias,
                )
                proceeds = short_position_close_value(
                    qty=qty,
                    basis_amount=basis_amount,
                    executed_spot_price=executed_spot_price,
                )
                user.cash_balance = float(Decimal(str(user.cash_balance)) + proceeds)
                player.total_shares = float(total_shares + qty)
                set_market_bias(player, bias=next_market_bias)
                unit_price = executed_spot_price if qty > 0 else Decimal("0")
                amount = proceeds
                tx_type = "IPO_HIDE_COVER"
            else:
                qty = shares
                spot_before = current_spot_price(
                    player,
                    fundamental_price=fundamental,
                    market_bias=market_bias,
                )
                market_impact_delta = market_impact_bias_delta_for_trade(
                    qty=qty,
                    spot_price_before=spot_before,
                    market_bias_before=market_bias,
                )
                next_market_bias = market_bias - market_impact_delta
                executed_spot_price = canonical_executed_spot_price(
                    player=player,
                    fundamental_price=fundamental,
                    next_market_bias=next_market_bias,
                )
                proceeds = trade_execution_notional_after_move(qty=qty, spot_price_after=executed_spot_price)
                user.cash_balance = float(Decimal(str(user.cash_balance)) + proceeds)
                player.total_shares = float(total_shares - qty)
                set_market_bias(player, bias=next_market_bias)
                unit_price = executed_spot_price if qty > 0 else Decimal("0")
                amount = proceeds
                tx_type = "IPO_HIDE_SELL"

            holding.shares_owned = 0.0
            holding.basis_amount = 0.0
            closed_positions += 1
            closed_shares += qty
            db.add(
                Transaction(
                    user_id=user.id,
                    player_id=player.id,
                    type=tx_type,
                    shares=float(qty),
                    unit_price=float(unit_price),
                    amount=float(amount),
                )
            )

        add_price_point(
            db=db,
            player=player,
            source="IPO_HIDE_CLOSEOUT",
            fundamental_price=fundamental,
            points_to_date=points_to_date,
            latest_week=latest_week,
        )

    return closed_positions, closed_shares


@app.get("/admin/ipo/sports", response_model=list[AdminIpoSportOut])
def admin_ipo_sports(
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    players = db.execute(
        select(Player).order_by(Player.sport.asc(), Player.name.asc())
    ).scalars().all()
    return build_admin_ipo_summaries(players)


@app.get("/admin/ipo/players", response_model=AdminIpoPlayersOut)
def admin_ipo_players(
    sport: str = Query(..., min_length=2, max_length=16),
    limit: int = Query(default=300, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    sport_code = normalize_sport_code(sport)
    all_players = db.execute(
        select(Player)
        .where(Player.sport == sport_code)
        .order_by(Player.ipo_open.desc(), Player.name.asc())
    ).scalars().all()
    if not all_players:
        raise HTTPException(404, f"No players found for sport '{sport_code}'.")

    listed_count = sum(1 for player in all_players if player_is_listed(player))
    rows = all_players[offset : offset + limit]
    return AdminIpoPlayersOut(
        sport=sport_code,
        total_players=len(all_players),
        listed_players=listed_count,
        players=[
            AdminIpoPlayerOut(
                id=int(player.id),
                sport=str(player.sport),
                name=str(player.name),
                team=str(player.team),
                position=str(player.position),
                listed=player_is_listed(player),
                ipo_season=int(player.ipo_season) if player.ipo_season is not None else None,
                ipo_opened_at=player.ipo_opened_at,
                base_price=float(player.base_price),
            )
            for player in rows
        ],
    )


@app.get("/admin/ipo/suggestions", response_model=AdminIpoSuggestionsOut)
def admin_ipo_suggestions(
    sport: str = Query(default="ALL", min_length=2, max_length=16),
    lookback_hours: int = Query(default=72, ge=1, le=24 * 30),
    limit: int = Query(default=25, ge=1, le=200),
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    normalized_sport = None if sport.strip().upper() == "ALL" else normalize_sport_code(sport)
    return build_admin_ipo_suggestions(
        db=db,
        sport=normalized_sport,
        lookback_hours=lookback_hours,
        limit=limit,
    )


@app.post("/admin/ipo/player/create", response_model=AdminIpoPlayerCreateOut)
def admin_ipo_create_player(
    payload: AdminIpoPlayerCreateIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    sport_code = normalize_sport_code(payload.sport)
    player_name = normalize_player_name(payload.name)
    team_code = normalize_player_team_code(sport_code=sport_code, raw_team=payload.team)
    position_code = normalize_player_position_code(payload.position)
    should_list = bool(payload.list_immediately)
    resolved_season = int(payload.season) if payload.season is not None else chicago_now().year
    opened_at = chicago_now() if should_list else None

    existing = db.execute(
        select(Player)
        .where(
            Player.sport == sport_code,
            func.lower(Player.name) == player_name.lower(),
            Player.team == team_code,
            Player.position == position_code,
        )
        .order_by(Player.id.asc())
        .limit(1)
        .with_for_update()
    ).scalars().first()

    created = False
    if existing is None:
        player = Player(
            sport=sport_code,
            name=player_name,
            team=team_code,
            position=position_code,
            base_price=float(payload.base_price),
            k=float(payload.k),
            total_shares=0.0,
            market_bias=0.0,
            market_bias_updated_at=None,
            ipo_open=should_list,
            ipo_season=resolved_season if should_list else None,
            ipo_opened_at=opened_at,
            live_now=False,
            live_week=None,
            live_game_id=None,
            live_game_label=None,
            live_game_status=None,
            live_game_stat_line=None,
            live_game_fantasy_points=0.0,
            live_updated_at=None,
        )
        db.add(player)
        db.flush()
        created = True
    else:
        player = existing
        player.name = player_name
        player.team = team_code
        player.position = position_code
        player.base_price = float(payload.base_price)
        player.k = float(payload.k)
        if should_list:
            player.ipo_open = True
            player.ipo_season = resolved_season
            player.ipo_opened_at = opened_at

    db.flush()
    record_price_points_for_players(
        db=db,
        players=[player],
        source="ADMIN_IPO_PLAYER_CREATE" if created else "ADMIN_IPO_PLAYER_UPDATE",
    )
    db.commit()
    invalidate_market_read_cache(
        player_ids={int(player.id)},
        sports={sport_code},
        include_sports_catalog=True,
    )

    listed = player_is_listed(player)
    action_verb = "Created" if created else "Updated"
    listing_phrase = (
        f" and listed for season {int(player.ipo_season) if player.ipo_season is not None else resolved_season}"
        if listed
        else " as hidden (not listed yet)"
    )
    message = f"{action_verb} {player_name} ({team_code} {position_code}){listing_phrase}."
    return AdminIpoPlayerCreateOut(
        player_id=int(player.id),
        sport=sport_code,
        name=str(player.name),
        team=str(player.team),
        position=str(player.position),
        listed=listed,
        ipo_season=int(player.ipo_season) if player.ipo_season is not None else None,
        ipo_opened_at=player.ipo_opened_at,
        base_price=float(player.base_price),
        k=float(player.k),
        created=created,
        message=message,
    )


@app.post("/admin/ipo/launch", response_model=AdminIpoActionOut)
def admin_ipo_launch(
    payload: AdminIpoLaunchIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    sport_code = normalize_sport_code(payload.sport)
    players = db.execute(
        select(Player).where(Player.sport == sport_code).with_for_update()
    ).scalars().all()
    if not players:
        raise HTTPException(404, f"No players found for sport '{sport_code}'.")

    opened_at = chicago_now()
    updated_count = 0
    for player in players:
        was_listed = player_is_listed(player)
        prior_season = int(player.ipo_season) if player.ipo_season is not None else None
        if not was_listed or prior_season != int(payload.season):
            updated_count += 1
        player.ipo_open = True
        player.ipo_season = int(payload.season)
        player.ipo_opened_at = opened_at

    db.flush()
    record_price_points_for_players(
        db=db,
        players=players,
        source=f"IPO_LAUNCH_{sport_code}",
    )
    db.commit()
    invalidate_market_read_cache(
        player_ids={int(player.id) for player in players},
        sports={sport_code},
        include_sports_catalog=True,
    )

    return AdminIpoActionOut(
        sport=sport_code,
        season=int(payload.season),
        total_players=len(players),
        listed_players=len(players),
        players_updated=updated_count,
        ipo_opened_at=opened_at,
        message=f"{sport_code} IPO launched for season {int(payload.season)}.",
    )


@app.post("/admin/ipo/hide", response_model=AdminIpoActionOut)
def admin_ipo_hide(
    payload: AdminIpoHideIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    sport_code = normalize_sport_code(payload.sport)
    players = db.execute(
        select(Player).where(Player.sport == sport_code).with_for_update()
    ).scalars().all()
    if not players:
        raise HTTPException(404, f"No players found for sport '{sport_code}'.")

    closed_positions, closed_shares = close_out_sport_holdings_for_ipo_hide(
        db=db,
        players=players,
    )

    updated_count = 0
    for player in players:
        if player_is_listed(player) or player.ipo_season is not None or player.ipo_opened_at is not None:
            updated_count += 1
        player.ipo_open = False
        player.ipo_season = None
        player.ipo_opened_at = None
        player.market_bias = 0.0
        player.market_bias_updated_at = None

    record_price_points_for_players(
        db=db,
        players=players,
        source=f"IPO_HIDE_{sport_code}",
    )
    db.commit()
    invalidate_market_read_cache(
        player_ids={int(player.id) for player in players},
        sports={sport_code},
        include_sports_catalog=True,
    )
    closeout_msg = (
        f" Closed out {closed_positions} position(s), {float(closed_shares):.4f} shares total."
        if closed_positions > 0
        else ""
    )
    return AdminIpoActionOut(
        sport=sport_code,
        season=None,
        total_players=len(players),
        listed_players=0,
        players_updated=updated_count,
        ipo_opened_at=None,
        message=f"{sport_code} IPO hidden.{closeout_msg} Players are no longer visible in market listings.",
    )


@app.post("/admin/ipo/player/season-ending-closeout", response_model=AdminSeasonEndingCloseoutOut)
def admin_ipo_player_season_ending_closeout(
    payload: AdminSeasonEndingCloseoutIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    player = db.execute(
        select(Player).where(Player.id == int(payload.player_id)).with_for_update()
    ).scalar_one_or_none()
    if player is None:
        raise HTTPException(404, "Player not found.")

    stats_snapshot = get_stats_snapshot_by_player(db, [int(player.id)])
    fundamental_price, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
    default_long_payout_price = current_spot_price(player, fundamental_price=fundamental_price)
    long_payout_price = (
        Decimal(str(payload.payout_price))
        if payload.payout_price is not None
        else default_long_payout_price
    )
    long_payout_price = max(Decimal("0"), long_payout_price)
    short_payout_price = max(Decimal("0"), points_to_date)

    positions_closed, shares_closed, users_credited, total_payout = close_out_single_player_holdings(
        db=db,
        player=player,
        long_payout_price=long_payout_price,
        short_payout_price=short_payout_price,
        tx_type_prefix="SEI",
    )

    player.total_shares = 0.0
    set_market_bias(player, bias=Decimal("0"))
    player.live_now = False
    player.live_week = None
    player.live_game_id = None
    player.live_game_label = None
    player.live_game_stat_line = None
    player.live_game_fantasy_points = 0.0
    reason = normalize_optional_profile_field(payload.reason)
    player.live_game_status = reason[:64] if reason else "SEASON_ENDING_INJURY"
    player.live_updated_at = chicago_now()

    if payload.delist:
        player.ipo_open = False
        player.ipo_season = None
        player.ipo_opened_at = None

    add_price_point(
        db=db,
        player=player,
        source="ADMIN_SEI_CLOSEOUT",
        fundamental_price=fundamental_price,
        points_to_date=points_to_date,
        latest_week=latest_week,
    )
    db.commit()
    invalidate_market_read_cache(
        player_ids={int(player.id)},
        sports={str(player.sport)},
        include_sports_catalog=bool(payload.delist),
    )

    message = (
        f"Closed out {str(player.name)}. Longs paid at ${float(long_payout_price):,.2f}, "
        f"shorts covered at earnings ${float(short_payout_price):,.2f}. "
        f"{positions_closed} position(s), {float(shares_closed):.4f} shares, "
        f"{users_credited} user(s) credited."
    )
    if payload.delist:
        message += " Player was delisted."
    return AdminSeasonEndingCloseoutOut(
        player_id=int(player.id),
        sport=str(player.sport),
        player_name=str(player.name),
        payout_price=float(long_payout_price),
        short_payout_price=float(short_payout_price),
        positions_closed=positions_closed,
        shares_closed=float(shares_closed),
        users_credited=users_credited,
        total_payout=float(total_payout),
        listed_after=player_is_listed(player),
        message=message,
    )


@app.post("/admin/injuries/alert", response_model=dict)
def admin_injury_alert(
    payload: AdminInjuryAlertIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    player = db.get(Player, int(payload.player_id))
    if player is None:
        raise HTTPException(404, "Player not found")

    matched_reason = season_ending_injury_reason_from_text(
        normalize_optional_profile_field(payload.headline),
        normalize_optional_profile_field(payload.summary),
    )
    if matched_reason is None:
        return {
            "ok": True,
            "alerted": False,
            "alerts_created": 0,
            "reason": "No season-ending injury signal found in supplied injury news.",
        }

    alerts_created = create_season_ending_injury_notifications(
        db=db,
        player=player,
        matched_reason=matched_reason,
        headline=normalize_optional_profile_field(payload.headline),
        source=normalize_optional_profile_field(payload.source),
    )
    db.commit()
    return {
        "ok": True,
        "alerted": alerts_created > 0,
        "alerts_created": int(alerts_created),
    }


@app.post("/admin/stats/clear-sport", response_model=AdminStatsClearSportOut)
def admin_clear_sport_stats(
    payload: AdminStatsClearSportIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    sport_code = normalize_sport_code(payload.sport)
    players = db.execute(
        select(Player).where(Player.sport == sport_code)
    ).scalars().all()
    if not players:
        raise HTTPException(404, f"No players found for sport '{sport_code}'.")

    player_ids = {int(player.id) for player in players}
    deleted_stats = int(
        db.execute(
            delete(WeeklyStat).where(WeeklyStat.player_id.in_(player_ids))
        ).rowcount
        or 0
    )
    db.execute(
        delete(PlayerGamePoint).where(PlayerGamePoint.player_id.in_(player_ids))
    )

    for player in players:
        player.live_now = False
        player.live_week = None
        player.live_game_id = None
        player.live_game_label = None
        player.live_game_status = None
        player.live_game_stat_line = None
        player.live_game_fantasy_points = 0.0
        player.live_updated_at = None

    db.flush()
    refresh_players_after_stats_update(
        db=db,
        player_ids=player_ids,
        source="ADMIN_CLEAR_STATS",
    )
    db.commit()
    invalidate_market_read_cache(
        player_ids=player_ids,
        sports={sport_code},
        include_sports_catalog=True,
    )
    return AdminStatsClearSportOut(
        sport=sport_code,
        players_affected=len(player_ids),
        stats_deleted=deleted_stats,
        price_points_created=len(player_ids),
        message=f"Cleared imported {sport_code} stats and reset live snapshots.",
    )


@app.post("/admin/stats/backfill-mlb", response_model=AdminStatsBackfillMlbOut)
def admin_backfill_mlb_stats(
    payload: AdminStatsBackfillMlbIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    start_date = payload.start_date
    end_date = payload.end_date or start_date
    if end_date < start_date:
        raise HTTPException(400, "end_date must be on or after start_date.")

    players = db.execute(
        select(Player).where(Player.sport == "MLB")
    ).scalars().all()
    if not players:
        raise HTTPException(404, "No MLB players found.")

    allowed_game_types = parse_mlb_allowed_game_types(payload.mlb_allowed_game_types)
    by_name_team: dict[tuple[str, str], Player] = {}
    by_name: dict[str, list[Player]] = {}
    for player in players:
        key_name = normalize_mlb_lookup_text(str(player.name))
        key_team = normalize_mlb_team_code(str(player.team))
        by_name_team[(key_name, key_team)] = player
        by_name.setdefault(key_name, []).append(player)

    dates_processed = 0
    source_games = 0
    source_rows = 0
    matched_rows = 0
    unmatched_rows = 0
    applied_rows = 0
    changed_rows = 0
    unchanged_rows = 0
    failed_rows = 0
    touched_player_ids: set[int] = set()
    unmatched_examples: list[str] = []

    try:
        for target_date in iter_inclusive_dates(start_date, end_date):
            rows, game_count = fetch_mlb_statsapi_rows(
                schedule_date=target_date,
                week=int(payload.week),
                timeout=25.0,
                allowed_game_types=allowed_game_types,
            )
            dates_processed += 1
            source_games += int(game_count)
            source_rows += len(rows)

            for row in rows:
                player = resolve_mlb_backfill_player(
                    row=row,
                    by_name_team=by_name_team,
                    by_name=by_name,
                )
                if not player:
                    unmatched_rows += 1
                    if len(unmatched_examples) < 12:
                        team = normalize_mlb_team_code(row.team) or "--"
                        unmatched_examples.append(f"{row.name} ({team}) on {target_date.isoformat()}")
                    continue

                matched_rows += 1
                try:
                    stat_payload = StatIn(
                        player_id=int(player.id),
                        week=int(payload.week),
                        fantasy_points=float(row.fantasy_points),
                        team=row.team,
                        live_now=row.live_now,
                        live_week=int(row.live_week or payload.week),
                        live_game_id=row.live_game_id,
                        live_game_label=row.live_game_label,
                        live_game_status=row.live_game_status,
                        live_game_stat_line=row.live_game_stat_line,
                        live_game_fantasy_points=(
                            float(row.live_game_fantasy_points)
                            if row.live_game_fantasy_points is not None
                            else None
                        ),
                    )
                    _status_label, stat_changed = upsert_weekly_stat_for_player(
                        db=db,
                        player=player,
                        week=stat_payload.week,
                        fantasy_points=float(stat_payload.fantasy_points),
                    )
                    live_changed = False
                    live_changed = apply_live_snapshot_from_stat(player=player, stat=stat_payload)
                    game_point_changed = upsert_player_game_point_from_stat(
                        db=db,
                        player=player,
                        stat=stat_payload,
                    )
                except Exception:
                    failed_rows += 1
                    continue

                applied_rows += 1
                if stat_changed or live_changed or game_point_changed:
                    changed_rows += 1
                    touched_player_ids.add(int(player.id))
                else:
                    unchanged_rows += 1

        db.flush()
        if touched_player_ids:
            refresh_players_after_stats_update(
                db=db,
                player_ids=touched_player_ids,
                source="ADMIN_MLB_BACKFILL",
            )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(502, f"Failed MLB backfill run: {exc}") from exc

    if touched_player_ids:
        invalidate_market_read_cache(
            player_ids=touched_player_ids,
            sports={"MLB"},
            include_sports_catalog=True,
        )

    return AdminStatsBackfillMlbOut(
        start_date=start_date,
        end_date=end_date,
        week=int(payload.week),
        dates_processed=dates_processed,
        source_games=source_games,
        source_rows=source_rows,
        matched_rows=matched_rows,
        unmatched_rows=unmatched_rows,
        applied_rows=applied_rows,
        changed_rows=changed_rows,
        unchanged_rows=unchanged_rows,
        failed_rows=failed_rows,
        players_touched=len(touched_player_ids),
        unmatched_examples=unmatched_examples,
        message=(
            f"MLB backfill completed for {start_date.isoformat()} through {end_date.isoformat()}. "
            f"Applied {applied_rows} row(s) and refreshed {len(touched_player_ids)} player price snapshot(s)."
        ),
    )


@app.post("/admin/site/reset", response_model=AdminSiteResetOut)
def admin_site_reset(
    payload: AdminSiteResetIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    hide_sports = {
        normalize_sport_code(value)
        for value in payload.hide_sports
        if str(value).strip()
    }
    player_ids = {int(player_id) for player_id in db.execute(select(Player.id)).scalars().all()}
    sports = {str(sport) for sport in db.execute(select(Player.sport)).scalars().all()}
    result = execute_site_reset(
        db,
        starting_cash=Decimal(str(payload.starting_cash)),
        hide_sports=hide_sports,
    )
    invalidate_market_read_cache(
        player_ids=player_ids,
        sports=sports,
        include_sports_catalog=True,
    )
    hidden_sports_label = ", ".join(result.hidden_sports)
    return AdminSiteResetOut(
        users_reset=result.users_reset,
        players_reset=result.players_reset,
        holdings_cleared=result.holdings_cleared,
        transactions_cleared=result.transactions_cleared,
        weekly_stats_cleared=result.weekly_stats_cleared,
        price_points_cleared=result.price_points_cleared,
        player_game_points_cleared=result.player_game_points_cleared,
        settled_weeks_cleared=result.settled_weeks_cleared,
        season_closes_cleared=result.season_closes_cleared,
        season_resets_cleared=result.season_resets_cleared,
        archived_weekly_stats_cleared=result.archived_weekly_stats_cleared,
        archived_holdings_cleared=result.archived_holdings_cleared,
        forum_posts_cleared=result.forum_posts_cleared,
        forum_comments_cleared=result.forum_comments_cleared,
        forum_post_views_cleared=result.forum_post_views_cleared,
        hidden_sports=result.hidden_sports,
        starting_cash=result.starting_cash,
        message=(
            f"Site reset complete. Reset {result.users_reset} users to ${result.starting_cash:,.2f}"
            + (f" and hid IPO for {hidden_sports_label}." if hidden_sports_label else ".")
        ),
    )


@app.post("/admin/holdings/normalize-current", response_model=AdminNormalizeHoldingsOut)
def admin_normalize_open_holdings_to_current_spot(
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    holdings = db.execute(
        select(Holding).where(Holding.shares_owned != 0)
    ).scalars().all()

    if not holdings:
        return AdminNormalizeHoldingsOut(
            users_affected=0,
            holdings_updated=0,
            message="No open holdings to normalize.",
        )

    player_ids = sorted({int(holding.player_id) for holding in holdings})
    players = db.execute(select(Player).where(Player.id.in_(player_ids))).scalars().all()
    players_by_id = {int(player.id): player for player in players}
    stats_snapshot = get_stats_snapshot_by_player(db, player_ids)

    touched_users: set[int] = set()
    touched_players: set[int] = set()
    holdings_updated = 0

    for holding in holdings:
        player = players_by_id.get(int(holding.player_id))
        if player is None:
            continue

        shares = Decimal(str(holding.shares_owned or 0))
        if shares == 0:
            continue

        fundamental_price, _, _ = get_pricing_context(player, stats_snapshot)
        spot = current_spot_price(
            player,
            fundamental_price=fundamental_price,
        )
        normalized_basis = abs(shares) * spot
        holding.basis_amount = float(normalized_basis)
        holding.entry_basis_amount = float(normalized_basis)
        holding.mark_basis_amount = float(normalized_basis)
        touched_users.add(int(holding.user_id))
        touched_players.add(int(holding.player_id))
        holdings_updated += 1

    db.commit()
    invalidate_market_read_cache(
        player_ids=touched_players,
        sports={str(player.sport) for player in players if int(player.id) in touched_players},
    )
    return AdminNormalizeHoldingsOut(
        users_affected=len(touched_users),
        holdings_updated=holdings_updated,
        message=(
            f"Flattened {holdings_updated} open position(s) across {len(touched_users)} user(s) "
            "to current spot so purchase price now matches current price."
        ),
    )


@app.get("/admin/pricing/config", response_model=AdminPricingConfigOut)
def admin_get_pricing_config(
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    configured_value = load_decimal_system_setting(
        db,
        key=PRICE_IMPACT_SETTING_KEY,
        default=DEFAULT_PRICE_IMPACT_MULTIPLIER,
    )
    runtime_value = set_price_impact_multiplier(configured_value)
    return AdminPricingConfigOut(
        price_impact_multiplier=float(runtime_value),
        default_price_impact_multiplier=float(DEFAULT_PRICE_IMPACT_MULTIPLIER),
        message="Loaded current pricing controls.",
    )


@app.post("/admin/pricing/config", response_model=AdminPricingConfigOut)
def admin_update_pricing_config(
    payload: AdminPricingConfigUpdateIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    normalized_value = upsert_decimal_system_setting(
        db,
        key=PRICE_IMPACT_SETTING_KEY,
        value=Decimal(str(payload.price_impact_multiplier)),
    )
    db.commit()
    runtime_value = set_price_impact_multiplier(normalized_value)
    invalidate_market_read_cache()
    return AdminPricingConfigOut(
        price_impact_multiplier=float(runtime_value),
        default_price_impact_multiplier=float(DEFAULT_PRICE_IMPACT_MULTIPLIER),
        message=f"Trade impact multiplier updated to {float(runtime_value):.2f}.",
    )


@app.get("/home/how-to-use", response_model=HomeHowToContentOut)
def home_how_to_use_content(
    db: Session = Depends(get_db),
):
    return HomeHowToContentOut(steps=load_home_how_to_steps(db))


@app.get("/admin/home/how-to-use", response_model=HomeHowToContentOut)
def admin_get_home_how_to_use_content(
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    return HomeHowToContentOut(steps=load_home_how_to_steps(db))


@app.post("/admin/home/how-to-use", response_model=HomeHowToContentOut)
def admin_update_home_how_to_use_content(
    payload: AdminHomeHowToContentUpdateIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    normalized = save_home_how_to_steps(db, payload.steps)
    db.commit()
    return HomeHowToContentOut(steps=normalized)


@app.get("/admin/users/{username}/equity", response_model=AdminUserEquityOut)
def admin_user_equity_snapshot(
    username: str,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    normalized_username = normalize_username(username)
    user = db.execute(
        select(User).where(func.lower(User.username) == normalized_username)
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(404, "User not found")

    snapshot = build_account_risk_snapshot(
        db=db,
        user=user,
        for_update=False,
    )
    baseline_cash = float(REGISTER_STARTING_CASH)
    equity = float(snapshot.equity)
    unrealized_pnl = float(sum((position_unrealized_pnl(position) for position in snapshot.positions), Decimal("0")))
    cash_balance = float(snapshot.cash_balance)
    cash_vs_starting_cash = cash_balance - baseline_cash
    return AdminUserEquityOut(
        user_id=int(user.id),
        username=str(user.username),
        cash_balance=cash_balance,
        holdings_value=float(snapshot.net_exposure),
        gross_exposure=float(snapshot.gross_exposure),
        equity=equity,
        return_pct=((equity - baseline_cash) / baseline_cash) * 100 if baseline_cash > 0 else 0,
        cash_vs_starting_cash=cash_vs_starting_cash,
        unrealized_pnl=unrealized_pnl,
        implied_realized_pnl=(equity - baseline_cash) - unrealized_pnl,
    )


@app.get("/admin/users", response_model=list[AdminUserListItemOut])
def admin_list_users(
    q: str | None = Query(default=None, min_length=0, max_length=64),
    limit: int = Query(default=250, ge=1, le=1000),
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    stmt = select(User).order_by(func.lower(User.username).asc(), User.id.asc()).limit(limit)
    normalized_query = normalize_username(q) if q and q.strip() else ""
    if normalized_query:
        stmt = stmt.where(func.lower(User.username).contains(normalized_query))
    users = db.execute(stmt).scalars().all()
    return [
        AdminUserListItemOut(
            user_id=int(user.id),
            username=str(user.username),
            email=str(user.email) if user.email else None,
        )
        for user in users
    ]


@app.post("/admin/users/{username}/flatten-equity", response_model=AdminFlattenUserEquityOut)
def admin_flatten_user_equity(
    username: str,
    payload: AdminFlattenUserEquityIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    normalized_username = normalize_username(username)
    user = db.execute(
        select(User).where(func.lower(User.username) == normalized_username)
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(404, "User not found")

    snapshot = build_account_risk_snapshot(
        db=db,
        user=user,
        for_update=True,
    )
    target_equity = Decimal(str(payload.target_equity))
    holdings_value = snapshot.net_exposure
    previous_cash_balance = snapshot.cash_balance
    previous_equity = snapshot.equity
    baseline_cash = Decimal(str(REGISTER_STARTING_CASH))
    new_cash_balance = target_equity - holdings_value
    user.cash_balance = float(new_cash_balance)
    db.commit()

    refreshed_snapshot = build_account_risk_snapshot(
        db=db,
        user=user,
        for_update=False,
    )
    refreshed_equity = refreshed_snapshot.equity
    return AdminFlattenUserEquityOut(
        user_id=int(user.id),
        username=str(user.username),
        target_equity=float(target_equity),
        holdings_value=float(holdings_value),
        previous_cash_balance=float(previous_cash_balance),
        new_cash_balance=float(refreshed_snapshot.cash_balance),
        previous_equity=float(previous_equity),
        new_equity=float(refreshed_equity),
        previous_return_pct=(
            float(((previous_equity - baseline_cash) / baseline_cash) * 100)
            if baseline_cash > 0
            else 0
        ),
        new_return_pct=(
            float(((refreshed_equity - baseline_cash) / baseline_cash) * 100)
            if baseline_cash > 0
            else 0
        ),
        message=(
            f"Flattened {user.username} to ${float(refreshed_equity):,.2f} total equity "
            f"by setting cash to ${float(refreshed_snapshot.cash_balance):,.2f}."
        ),
    )


@app.delete("/admin/users/{username}", response_model=AdminDeleteUserOut)
def admin_delete_user(
    username: str,
    admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    normalized_username = normalize_username(username)
    user = db.execute(
        select(User).where(func.lower(User.username) == normalized_username)
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(404, "User not found")
    if int(user.id) == int(admin.user.id):
        raise HTTPException(400, "You cannot delete the currently signed-in admin user.")

    user_id = int(user.id)
    username_value = str(user.username)
    affected_player_ids = set(
        int(player_id)
        for player_id in db.execute(
            select(Holding.player_id).where(
                Holding.user_id == user_id,
                Holding.player_id.is_not(None),
            )
        ).scalars().all()
    )
    post_ids = db.execute(
        select(ForumPost.id).where(ForumPost.user_id == user_id)
    ).scalars().all()
    thread_ids = db.execute(
        select(DirectThread.id).where(
            or_(DirectThread.user_one_id == user_id, DirectThread.user_two_id == user_id)
        )
    ).scalars().all()

    forum_post_views_deleted = 0
    forum_comments_deleted = 0
    messages_deleted = 0
    reports_deleted = 0
    moderation_rows_deleted = 0

    if post_ids:
        forum_post_views_deleted += db.execute(
            delete(ForumPostView).where(ForumPostView.post_id.in_(post_ids))
        ).rowcount or 0
        forum_comments_deleted += db.execute(
            delete(ForumComment).where(ForumComment.post_id.in_(post_ids))
        ).rowcount or 0
    if thread_ids:
        messages_deleted += db.execute(
            delete(DirectMessage).where(DirectMessage.thread_id.in_(thread_ids))
        ).rowcount or 0

    report_ids = db.execute(
        select(ContentReport.id).where(ContentReport.reporter_user_id == user_id)
    ).scalars().all()
    if report_ids:
        moderation_rows_deleted += db.execute(
            delete(ContentModeration).where(ContentModeration.source_report_id.in_(report_ids))
        ).rowcount or 0
        reports_deleted += db.execute(
            delete(ContentReport).where(ContentReport.id.in_(report_ids))
        ).rowcount or 0

    db.execute(
        update(ContentReport)
        .where(ContentReport.reviewed_by_user_id == user_id)
        .values(reviewed_by_user_id=None)
    )
    db.execute(
        update(TradingControl)
        .where(TradingControl.updated_by_user_id == user_id)
        .values(updated_by_user_id=None)
    )

    forum_post_views_deleted += db.execute(
        delete(ForumPostView).where(ForumPostView.user_id == user_id)
    ).rowcount or 0
    forum_comments_deleted += db.execute(
        delete(ForumComment).where(ForumComment.user_id == user_id)
    ).rowcount or 0
    forum_posts_deleted = db.execute(
        delete(ForumPost).where(ForumPost.user_id == user_id)
    ).rowcount or 0

    messages_deleted += db.execute(
        delete(DirectMessage).where(DirectMessage.sender_user_id == user_id)
    ).rowcount or 0
    threads_deleted = db.execute(
        delete(DirectThread).where(
            or_(DirectThread.user_one_id == user_id, DirectThread.user_two_id == user_id)
        )
    ).rowcount or 0

    sessions_deleted = db.execute(
        delete(UserSession).where(UserSession.user_id == user_id)
    ).rowcount or 0
    holdings_deleted = db.execute(
        delete(Holding).where(Holding.user_id == user_id)
    ).rowcount or 0
    transactions_deleted = db.execute(
        delete(Transaction).where(Transaction.user_id == user_id)
    ).rowcount or 0
    watchlist_rows_deleted = db.execute(
        delete(PlayerWatchlist).where(PlayerWatchlist.user_id == user_id)
    ).rowcount or 0
    notifications_deleted = db.execute(
        delete(Notification).where(
            or_(Notification.user_id == user_id, Notification.actor_user_id == user_id)
        )
    ).rowcount or 0
    db.execute(
        delete(PasswordResetToken).where(PasswordResetToken.user_id == user_id)
    )
    friendships_deleted = db.execute(
        delete(Friendship).where(
            or_(
                Friendship.user_low_id == user_id,
                Friendship.user_high_id == user_id,
                Friendship.requested_by_user_id == user_id,
            )
        )
    ).rowcount or 0
    feedback_deleted = db.execute(
        delete(FeedbackMessage).where(FeedbackMessage.user_id == user_id)
    ).rowcount or 0
    moderation_rows_deleted += db.execute(
        delete(ContentModeration).where(ContentModeration.moderator_user_id == user_id)
    ).rowcount or 0
    db.execute(
        delete(ArchivedHolding).where(ArchivedHolding.user_id == user_id)
    )

    touched_players, touched_sports = rebuild_players_from_open_holdings(
        db,
        player_ids=affected_player_ids,
        source="ADMIN_USER_DELETE_REBUILD",
    )
    db.delete(user)
    db.commit()
    invalidate_market_read_cache(
        player_ids=touched_players,
        sports=touched_sports,
    )

    return AdminDeleteUserOut(
        user_id=user_id,
        username=username_value,
        holdings_deleted=holdings_deleted,
        transactions_deleted=transactions_deleted,
        sessions_deleted=sessions_deleted,
        threads_deleted=threads_deleted,
        messages_deleted=messages_deleted,
        friendships_deleted=friendships_deleted,
        notifications_deleted=notifications_deleted,
        watchlist_rows_deleted=watchlist_rows_deleted,
        forum_posts_deleted=forum_posts_deleted,
        forum_comments_deleted=forum_comments_deleted,
        forum_post_views_deleted=forum_post_views_deleted,
        feedback_deleted=feedback_deleted,
        reports_deleted=reports_deleted,
        moderation_rows_deleted=moderation_rows_deleted,
        message=f"Deleted user {username_value} and related account data.",
    )


@app.post("/admin/stats/preview", response_model=AdminStatsPreviewOut)
def admin_stats_preview(
    payload: AdminStatsPreviewIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    rows = parse_stats_csv(
        db=db,
        csv_text=payload.csv_text,
        week_override=payload.week_override,
    )
    return parsed_rows_to_preview(rows)


@app.post("/admin/stats/publish", response_model=AdminStatsPublishOut)
def admin_stats_publish(
    payload: AdminStatsPreviewIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    parsed_rows = parse_stats_csv(
        db=db,
        csv_text=payload.csv_text,
        week_override=payload.week_override,
    )

    ready_rows = [
        row
        for row in parsed_rows
        if row.status == "READY" and row.player_id and row.week and row.fantasy_points is not None
    ]
    skipped_count = sum(1 for row in parsed_rows if row.status == "SKIPPED")
    error_count = sum(1 for row in parsed_rows if row.status == "ERROR")

    created_count = 0
    updated_count = 0
    touched_player_ids: set[int] = set()
    weekly_totals: dict[tuple[int, int], float] = defaultdict(float)
    players_by_id: dict[int, Player] = {}
    game_rows_by_player: dict[int, list[ParsedStatRow]] = defaultdict(list)

    for row in ready_rows:
        player = players_by_id.get(int(row.player_id))
        if player is None:
            player = db.get(Player, int(row.player_id))
            if not player:
                error_count += 1
                continue
            players_by_id[int(row.player_id)] = player
        normalized_team = normalize_team_for_player(player, row.input_team)
        if normalized_team is not None and str(player.team).strip().upper() != normalized_team:
            player.team = normalized_team
            touched_player_ids.add(int(row.player_id))
        weekly_totals[(int(row.player_id), int(row.week))] += float(row.fantasy_points)
        if row.game_id:
            game_rows_by_player[int(row.player_id)].append(row)

    for (player_id, week), fantasy_points in weekly_totals.items():
        player = players_by_id[player_id]
        status_label, stat_changed = upsert_weekly_stat_for_player(
            db=db,
            player=player,
            week=week,
            fantasy_points=float(fantasy_points),
        )
        if status_label == "created":
            created_count += 1
        else:
            updated_count += 1
        if stat_changed:
            touched_player_ids.add(player_id)

    if game_rows_by_player:
        player_ids = sorted(game_rows_by_player.keys())
        existing_rows = db.execute(
            select(WeeklyStat.player_id, WeeklyStat.week, WeeklyStat.fantasy_points).where(
                WeeklyStat.player_id.in_(player_ids)
            )
        ).all()
        final_week_totals: dict[int, dict[int, float]] = defaultdict(dict)
        for player_id, week, fantasy_points in existing_rows:
            final_week_totals[int(player_id)][int(week)] = float(fantasy_points)
        for (player_id, week), fantasy_points in weekly_totals.items():
            final_week_totals[player_id][week] = float(fantasy_points)

        for player_id, rows in game_rows_by_player.items():
            cumulative_before_week: dict[int, float] = {}
            running_total = 0.0
            for week in sorted(final_week_totals[player_id]):
                cumulative_before_week[week] = running_total
                running_total += float(final_week_totals[player_id][week])

            running_within_week = 0.0
            active_week: int | None = None
            for row in sorted(rows, key=lambda item: (int(item.week or 0), int(item.row_number))):
                week = int(row.week or 0)
                if week != active_week:
                    active_week = week
                    running_within_week = 0.0
                game_points = (
                    float(row.game_fantasy_points)
                    if row.game_fantasy_points is not None
                    else float(row.fantasy_points or 0.0)
                )
                running_within_week += float(row.fantasy_points or 0.0)
                season_points = (
                    float(row.season_fantasy_points)
                    if row.season_fantasy_points is not None
                    else float(cumulative_before_week.get(week, 0.0) + running_within_week)
                )
                game_changed = upsert_player_game_point(
                    db=db,
                    player_id=player_id,
                    game_id=str(row.game_id),
                    game_label=row.game_label,
                    game_status=row.game_status,
                    game_fantasy_points=game_points,
                    season_fantasy_points=season_points,
                    recorded_at=chicago_now(),
                )
                if game_changed:
                    touched_player_ids.add(player_id)

    db.flush()
    refresh_players_after_stats_update(
        db=db,
        player_ids=touched_player_ids,
        source="STAT_UPDATE_BULK",
    )
    db.commit()
    invalidate_market_read_cache(
        player_ids=touched_player_ids,
        sports={str(player.sport) for player in players_by_id.values()},
    )

    applied_count = created_count + updated_count
    return AdminStatsPublishOut(
        total_rows=len(parsed_rows),
        applied_count=applied_count,
        created_count=created_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        error_count=error_count,
    )


@app.post("/stats", response_model=dict)
def upsert_weekly_stat(
    stat: StatIn,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    player = db.get(Player, stat.player_id)
    if not player:
        raise HTTPException(404, "Player not found")

    status_label, stat_changed = upsert_weekly_stat_for_player(
        db=db,
        player=player,
        week=stat.week,
        fantasy_points=stat.fantasy_points,
    )
    previous_team = str(player.team).strip().upper()
    live_changed = apply_live_snapshot_from_stat(player=player, stat=stat)
    team_changed = str(player.team).strip().upper() != previous_team
    game_point_changed = upsert_player_game_point_from_stat(
        db=db,
        player=player,
        stat=stat,
    )
    injury_notifications_created = 0

    db.flush()
    if stat_changed or game_point_changed or team_changed:
        refresh_players_after_stats_update(
            db=db,
            player_ids={int(player.id)},
            source="STAT_UPDATE",
        )

    db.commit()
    if stat_changed or live_changed or game_point_changed:
        invalidate_market_read_cache(
            player_ids={int(player.id)},
            sports={str(player.sport)},
        )
    return {
        "ok": True,
        "status": status_label,
        "stats_updated": stat_changed,
        "live_updated": live_changed,
        "game_points_updated": game_point_changed,
        "injury_alerted": injury_notifications_created > 0,
        "injury_alerts_created": int(injury_notifications_created),
    }


@app.post("/settlement/week/{week}", response_model=SettlementOut, deprecated=True)
def settle_week(week: int, db: Session = Depends(get_db)):
    _ = week
    _ = db
    raise HTTPException(
        status_code=410,
        detail="Weekly dividends are deprecated. Use POST /season/close/{season}.",
    )


@app.post("/season/close/{season}", response_model=SeasonCloseOut)
def close_season(
    season: int,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    if season <= 0:
        raise HTTPException(400, "season must be a positive integer")

    already_closed = db.execute(
        select(SeasonClose).where(SeasonClose.season == season)
    ).scalar_one_or_none()
    if already_closed:
        return SeasonCloseOut(
            season=season,
            total_payout=0.0,
            users_credited=0,
            positions_closed=0,
            already_closed=True,
        )

    players = db.execute(select(Player)).scalars().all()
    total_payout, users_credited, positions_closed = run_season_closeout(
        db,
        payout_per_point=SEASON_CLOSE_PAYOUT_PER_POINT,
    )
    record_price_points_for_players(
        db=db,
        players=players,
        source="SEASON_CLOSE",
    )
    db.add(SeasonClose(season=season))

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return SeasonCloseOut(
            season=season,
            total_payout=0.0,
            users_credited=0,
            positions_closed=0,
            already_closed=True,
        )

    invalidate_market_read_cache(
        player_ids={int(player.id) for player in players},
        sports={str(player.sport) for player in players},
        include_sports_catalog=True,
    )

    return SeasonCloseOut(
        season=season,
        total_payout=float(total_payout),
        users_credited=users_credited,
        positions_closed=positions_closed,
        already_closed=False,
    )


@app.post("/season/reset/{season}", response_model=SeasonResetOut)
def reset_season(
    season: int,
    _admin: AuthContext = Depends(get_admin_context),
    db: Session = Depends(get_db),
):
    if season <= 0:
        raise HTTPException(400, "season must be a positive integer")

    prior_reset = db.execute(
        select(SeasonReset).where(SeasonReset.season == season)
    ).scalar_one_or_none()
    if prior_reset:
        return SeasonResetOut(
            season=season,
            archived_stats=prior_reset.archived_stats_count,
            archived_holdings=prior_reset.archived_holdings_count,
            cleared_stats=0,
            cleared_holdings=0,
            players_reset=0,
            already_reset=True,
        )

    close_record = db.execute(
        select(SeasonClose).where(SeasonClose.season == season)
    ).scalar_one_or_none()
    if not close_record:
        raise HTTPException(400, "Season must be closed before reset. Call POST /season/close/{season} first.")

    weekly_stats = db.execute(select(WeeklyStat)).scalars().all()
    holdings = db.execute(select(Holding)).scalars().all()
    users = db.execute(select(User)).scalars().all()
    user_cash_by_id = {user.id: float(user.cash_balance) for user in users}

    for stat in weekly_stats:
        db.add(
            ArchivedWeeklyStat(
                season=season,
                player_id=stat.player_id,
                week=stat.week,
                fantasy_points=float(stat.fantasy_points),
            )
        )

    for holding in holdings:
        db.add(
            ArchivedHolding(
                season=season,
                user_id=holding.user_id,
                player_id=holding.player_id,
                shares_owned=float(holding.shares_owned),
                user_cash_balance=user_cash_by_id.get(holding.user_id, 0.0),
            )
        )

    archived_stats = len(weekly_stats)
    archived_holdings = len(holdings)

    db.execute(delete(WeeklyStat))
    db.execute(delete(Holding))

    players = db.execute(select(Player)).scalars().all()
    players_reset = 0
    for player in players:
        if Decimal(str(player.total_shares)) != Decimal("0"):
            players_reset += 1
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

    db.flush()
    record_price_points_for_players(
        db=db,
        players=players,
        source="SEASON_RESET",
    )

    db.add(
        SeasonReset(
            season=season,
            archived_stats_count=archived_stats,
            archived_holdings_count=archived_holdings,
        )
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return SeasonResetOut(
            season=season,
            archived_stats=0,
            archived_holdings=0,
            cleared_stats=0,
            cleared_holdings=0,
            players_reset=0,
            already_reset=True,
        )

    invalidate_market_read_cache(
        player_ids={int(player.id) for player in players},
        sports={str(player.sport) for player in players},
        include_sports_catalog=True,
    )

    return SeasonResetOut(
        season=season,
        archived_stats=archived_stats,
        archived_holdings=archived_holdings,
        cleared_stats=archived_stats,
        cleared_holdings=archived_holdings,
        players_reset=players_reset,
        already_reset=False,
    )

