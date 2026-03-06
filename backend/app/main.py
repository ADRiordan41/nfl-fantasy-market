import csv
import io
import os
import re
from collections import defaultdict, deque
from datetime import datetime, timedelta
from dataclasses import dataclass
from decimal import Decimal
from threading import Lock
from time import monotonic

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import and_, delete, exists, func, or_, select
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
from .models import (
    ArchivedHolding,
    ArchivedWeeklyStat,
    ContentModeration,
    ContentReport,
    FeedbackMessage,
    ForumComment,
    ForumPost,
    ForumPostView,
    Holding,
    Player,
    PricePoint,
    SeasonClose,
    SeasonReset,
    TradingControl,
    Transaction,
    User,
    UserSession,
    WeeklyStat,
)
from .pricing import adjusted_base_price, cost_to_buy, effective_k, proceeds_to_sell, spot_price
from .schemas import (
    AdminIpoActionOut,
    AdminIpoHideIn,
    AdminIpoLaunchIn,
    AdminIpoPlayerOut,
    AdminIpoPlayersOut,
    AdminIpoSportOut,
    AdminStatsPreviewIn,
    AdminStatsPreviewOut,
    AdminStatsPreviewRow,
    AdminStatsPublishOut,
    AdminModerationReportOut,
    AdminModerationResolveIn,
    AdminModerationUnhideIn,
    AdminModerationUnhideOut,
    AdminFeedbackOut,
    AdminSportTradingHaltUpdateIn,
    AdminTradingHaltUpdateIn,
    FeedbackCreateIn,
    FeedbackOut,
    ForumCommentCreateIn,
    ForumCommentOut,
    ForumPostCreateIn,
    ForumPostDetailOut,
    ForumPostSummaryOut,
    AuthLoginIn,
    AuthLogoutOut,
    AuthPasswordUpdateIn,
    AuthPasswordUpdateOut,
    AuthRegisterIn,
    AuthSessionOut,
    LiveGameOut,
    LiveGamePlayerOut,
    LiveGamesOut,
    MarketMoverOut,
    MarketMoversOut,
    ModerationReportCreateIn,
    ModerationReportOut,
    PlayerLiveOut,
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
)
from .seed import init_db, seed
from .settlement import run_season_closeout

app = FastAPI(title="MatchupMarket (Sandbox)")
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


@app.get("/")
def root():
    return {"ok": True, "service": "MatchupMarket API", "docs": "/docs", "health": "/healthz"}


@app.get("/healthz")
def healthz():
    return {"ok": True}


SYNTHETIC_PLAYER_NAME = re.compile(r"^[A-Z]{2,3} (QB|RB|WR|TE)\d$")
VALID_USERNAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
VALID_SPORT_CODE = re.compile(r"^[A-Z0-9_-]{2,16}$")

SEASON_WEEKS = int(os.environ.get("SEASON_WEEKS", "18"))
PERFORMANCE_WEIGHT = Decimal(os.environ.get("PERFORMANCE_WEIGHT", "1.0"))
SEASON_CLOSE_PAYOUT_PER_POINT = Decimal(os.environ.get("SEASON_CLOSE_PAYOUT_PER_POINT", "1.0"))
MIN_SPOT_PRICE = Decimal(os.environ.get("MIN_SPOT_PRICE", "1.0"))
MAINTENANCE_MARGIN_LONG = Decimal(os.environ.get("MAINTENANCE_MARGIN_LONG", "0.0"))
MAINTENANCE_MARGIN_SHORT = Decimal(os.environ.get("MAINTENANCE_MARGIN_SHORT", "0.0"))
MAX_POSITION_NOTIONAL_PER_PLAYER = Decimal(os.environ.get("MAX_POSITION_NOTIONAL_PER_PLAYER", "10000"))
REGISTER_STARTING_CASH = Decimal("100000")
RAW_SANDBOX_USERNAME = (os.environ.get("SANDBOX_USERNAME") or "").strip().lower()
DEFAULT_SANDBOX_USERNAME = RAW_SANDBOX_USERNAME or "foreverhopeful"
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
RATE_LIMIT_FORUM_POST_CREATE = int(os.environ.get("RATE_LIMIT_FORUM_POST_CREATE", "8"))
RATE_LIMIT_FORUM_POST_CREATE_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_FORUM_POST_CREATE_WINDOW_SECONDS", "600")
)
RATE_LIMIT_FORUM_COMMENT_CREATE = int(os.environ.get("RATE_LIMIT_FORUM_COMMENT_CREATE", "30"))
RATE_LIMIT_FORUM_COMMENT_CREATE_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_FORUM_COMMENT_CREATE_WINDOW_SECONDS", "600")
)
RATE_LIMIT_MODERATION_REPORT_CREATE = int(os.environ.get("RATE_LIMIT_MODERATION_REPORT_CREATE", "20"))
RATE_LIMIT_MODERATION_REPORT_CREATE_WINDOW_SECONDS = int(
    os.environ.get("RATE_LIMIT_MODERATION_REPORT_CREATE_WINDOW_SECONDS", "3600")
)


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, *, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            window = self._events[key]
            while window and window[0] <= cutoff:
                window.popleft()
            if len(window) >= limit:
                retry_after = max(1, int(window[0] + window_seconds - now))
                return False, retry_after
            window.append(now)
            return True, 0


RATE_LIMITER = SlidingWindowRateLimiter()


@dataclass
class PositionRisk:
    holding: Holding
    player: Player
    shares: Decimal
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
    message: str | None


@app.on_event("startup")
def on_startup():
    init_db()
    db = SessionLocal()
    try:
        seed(db)
        ensure_initial_price_history(db)
    finally:
        db.close()


def normalize_username(raw_username: str | None) -> str:
    username = (raw_username or "").strip().lower()
    if not username:
        raise HTTPException(400, "username is required")
    if not VALID_USERNAME.match(username):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid username. Use lowercase letters, numbers, underscore, or hyphen "
                "(max 64 chars)."
            ),
        )
    return username


def normalize_sport_code(raw_sport: str | None, default: str = "NFL") -> str:
    sport = (raw_sport or default).strip().upper()
    if not sport:
        return default
    if not VALID_SPORT_CODE.match(sport):
        raise HTTPException(400, "Invalid sport code.")
    return sport


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

    now = datetime.utcnow()
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
        updated_at=row.updated_at or datetime.utcnow(),
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
    stmt = select(User).where(User.username == username)
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
            UserSession.expires_at > datetime.utcnow(),
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


def normalize_text(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def detect_column(sample_row: dict[str, str], candidates: tuple[str, ...]) -> str:
    keys_by_normalized = {normalize_text(key): key for key in sample_row.keys()}
    for candidate in candidates:
        found = keys_by_normalized.get(normalize_text(candidate))
        if found:
            return found
    return ""


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
    seen_player_week: set[tuple[int, int]] = set()

    for row_number, row in enumerate(rows, start=2):
        input_name = str(row.get(col_name, "")).strip()
        input_team = str(row.get(col_team, "")).strip() if col_team else ""
        points_raw = str(row.get(col_points, "")).strip()

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
                        message="Invalid week value.",
                    )
                )
                continue

        try:
            fantasy_points = float(points_raw)
            if fantasy_points < 0:
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
                    week=row_week,
                    fantasy_points=None,
                    existing_points=None,
                    delta_points=None,
                    message="Invalid fantasy points value.",
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
                    message="No unique player match found.",
                )
            )
            continue

        dedupe_key = (int(matched_player.id), int(row_week))
        if dedupe_key in seen_player_week:
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
                    message="Duplicate player/week row in CSV.",
                )
            )
            continue
        seen_player_week.add(dedupe_key)

        existing = db.execute(
            select(WeeklyStat).where(
                WeeklyStat.player_id == matched_player.id,
                WeeklyStat.week == row_week,
            )
        ).scalar_one_or_none()
        existing_points = float(existing.fantasy_points) if existing else None
        delta_points = (
            float(fantasy_points - existing_points)
            if existing_points is not None
            else float(fantasy_points)
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
) -> dict[int, tuple[Decimal, int]]:
    if not player_ids:
        return {}

    rows = db.execute(
        select(
            WeeklyStat.player_id,
            func.coalesce(func.sum(WeeklyStat.fantasy_points), 0),
            func.coalesce(func.max(WeeklyStat.week), 0),
        )
        .where(WeeklyStat.player_id.in_(player_ids))
        .group_by(WeeklyStat.player_id)
    ).all()

    return {
        int(player_id): (Decimal(str(points_to_date)), int(latest_week))
        for player_id, points_to_date, latest_week in rows
    }


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
    stats_snapshot: dict[int, tuple[Decimal, int]],
) -> tuple[Decimal, Decimal, int]:
    projected_points = Decimal(str(player.base_price))
    points_to_date, latest_week = stats_snapshot.get(player.id, (Decimal("0"), 0))
    fundamental = adjusted_base_price(
        projected_points=projected_points,
        points_to_date=points_to_date,
        latest_week=latest_week,
        season_weeks=SEASON_WEEKS,
        performance_weight=PERFORMANCE_WEIGHT,
    )
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
    spot = spot_price(
        fundamental_price,
        Decimal(str(player.k)),
        Decimal(str(player.total_shares)),
    )
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
    spot = spot_price(
        fundamental_price,
        Decimal(str(player.k)),
        Decimal(str(player.total_shares)),
    )
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
    cutoff = datetime.utcnow() - timedelta(hours=window_hours)

    latest_ranked = (
        select(
            PricePoint.player_id.label("player_id"),
            PricePoint.spot_price.label("spot_price"),
            PricePoint.created_at.label("created_at"),
            func.row_number()
            .over(
                partition_by=PricePoint.player_id,
                order_by=[PricePoint.created_at.desc(), PricePoint.id.desc()],
            )
            .label("rn"),
        )
        .where(PricePoint.player_id.in_(player_ids))
        .subquery()
    )
    latest_rows = db.execute(
        select(
            latest_ranked.c.player_id,
            latest_ranked.c.spot_price,
            latest_ranked.c.created_at,
        ).where(latest_ranked.c.rn == 1)
    ).all()
    latest_by_player = {
        int(row.player_id): (
            Decimal(str(row.spot_price)),
            row.created_at,
        )
        for row in latest_rows
    }

    pre_cutoff_ranked = (
        select(
            PricePoint.player_id.label("player_id"),
            PricePoint.spot_price.label("spot_price"),
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
            pre_cutoff_ranked.c.created_at,
        ).where(pre_cutoff_ranked.c.rn == 1)
    ).all()
    pre_cutoff_by_player = {
        int(row.player_id): (
            Decimal(str(row.spot_price)),
            row.created_at,
        )
        for row in pre_cutoff_rows
    }

    post_cutoff_ranked = (
        select(
            PricePoint.player_id.label("player_id"),
            PricePoint.spot_price.label("spot_price"),
            PricePoint.created_at.label("created_at"),
            func.row_number()
            .over(
                partition_by=PricePoint.player_id,
                order_by=[PricePoint.created_at.asc(), PricePoint.id.asc()],
            )
            .label("rn"),
        )
        .where(
            PricePoint.player_id.in_(player_ids),
            PricePoint.created_at > cutoff,
        )
        .subquery()
    )
    post_cutoff_rows = db.execute(
        select(
            post_cutoff_ranked.c.player_id,
            post_cutoff_ranked.c.spot_price,
            post_cutoff_ranked.c.created_at,
        ).where(post_cutoff_ranked.c.rn == 1)
    ).all()
    post_cutoff_by_player = {
        int(row.player_id): (
            Decimal(str(row.spot_price)),
            row.created_at,
        )
        for row in post_cutoff_rows
    }

    missing_player_ids = [player_id for player_id in player_ids if player_id not in latest_by_player]
    if missing_player_ids:
        stats_snapshot = get_stats_snapshot_by_player(db, missing_player_ids)
        now = datetime.utcnow()
        for player_id in missing_player_ids:
            player = players_by_id[player_id]
            fundamental, _, _ = get_pricing_context(player, stats_snapshot)
            latest_by_player[player_id] = (
                spot_price(
                    fundamental,
                    Decimal(str(player.k)),
                    Decimal(str(player.total_shares)),
                ),
                now,
            )

    movers: list[MarketMoverOut] = []
    for player_id in player_ids:
        latest_row = latest_by_player.get(player_id)
        if not latest_row:
            continue
        current_spot, current_at = latest_row
        reference_row = (
            pre_cutoff_by_player.get(player_id)
            or post_cutoff_by_player.get(player_id)
            or latest_row
        )
        reference_spot, reference_at = reference_row
        safe_reference = reference_spot if reference_spot > Decimal("0") else current_spot
        if safe_reference > Decimal("0"):
            change_percent = ((current_spot - safe_reference) / safe_reference) * Decimal("100")
        else:
            change_percent = Decimal("0")
        change = current_spot - safe_reference
        player = players_by_id[player_id]
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


def min_total_shares_for_price_floor(
    fundamental_price: Decimal,
    k: Decimal,
) -> Decimal:
    return (MIN_SPOT_PRICE / fundamental_price - Decimal("1")) / effective_k(k)


def max_sell_qty_before_price_floor(
    total_shares: Decimal,
    fundamental_price: Decimal,
    k: Decimal,
) -> Decimal:
    minimum_total_shares = min_total_shares_for_price_floor(
        fundamental_price=fundamental_price,
        k=k,
    )
    available = total_shares - minimum_total_shares
    return max(Decimal("0"), available)


def ensure_sell_side_allowed_or_raise(
    total_shares: Decimal,
    qty: Decimal,
    fundamental_price: Decimal,
    k: Decimal,
) -> None:
    max_qty = max_sell_qty_before_price_floor(
        total_shares=total_shares,
        fundamental_price=fundamental_price,
        k=k,
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
    margin_used = Decimal("0")

    for holding in holdings:
        player = players_by_id.get(int(holding.player_id))
        if player is None:
            continue

        shares = Decimal(str(holding.shares_owned))
        if shares == 0:
            continue

        fundamental_price, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        spot = spot_price(
            fundamental_price,
            Decimal(str(player.k)),
            Decimal(str(player.total_shares)),
        )
        market_value = shares * spot
        maintenance_rate = MAINTENANCE_MARGIN_LONG if shares > 0 else MAINTENANCE_MARGIN_SHORT
        maintenance_margin_required = abs(market_value) * maintenance_rate

        net_exposure += market_value
        gross_exposure += abs(market_value)
        margin_used += maintenance_margin_required
        positions.append(
            PositionRisk(
                holding=holding,
                player=player,
                shares=shares,
                spot_price=spot,
                market_value=market_value,
                maintenance_margin_required=maintenance_margin_required,
                fundamental_price=fundamental_price,
                points_to_date=points_to_date,
                latest_week=latest_week,
            )
        )

    equity = cash_balance + net_exposure
    available_buying_power = max(Decimal("0"), equity - margin_used)
    margin_call = margin_used > 0 and equity < margin_used

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
    for _ in range(64):
        snapshot = build_account_risk_snapshot(
            db=db,
            user=user,
            for_update=True,
        )
        if not snapshot.margin_call:
            return snapshot
        if not snapshot.positions:
            return snapshot

        long_positions = sorted(
            [position for position in snapshot.positions if position.shares > 0],
            key=lambda position: abs(position.market_value),
            reverse=True,
        )
        short_positions = sorted(
            [position for position in snapshot.positions if position.shares < 0],
            key=lambda position: abs(position.market_value),
            reverse=True,
        )
        liquidation_candidates = [*long_positions, *short_positions]

        progressed = False
        for position in liquidation_candidates:
            player = position.player
            holding = position.holding
            k = Decimal(str(player.k))
            total_shares = Decimal(str(player.total_shares))

            if position.shares > 0:
                qty = position.shares
                try:
                    ensure_sell_side_allowed_or_raise(
                        total_shares=total_shares,
                        qty=qty,
                        fundamental_price=position.fundamental_price,
                        k=k,
                    )
                except HTTPException:
                    continue

                proceeds = proceeds_to_sell(position.fundamental_price, k, total_shares, qty)
                user.cash_balance = float(Decimal(str(user.cash_balance)) + proceeds)
                holding.shares_owned = 0.0
                player.total_shares = float(total_shares - qty)
                db.add(
                    Transaction(
                        user_id=user.id,
                        player_id=player.id,
                        type="LIQUIDATE_SELL",
                        shares=float(qty),
                        unit_price=float((proceeds / qty) if qty > 0 else Decimal("0")),
                        amount=float(proceeds),
                    )
                )
                add_price_point(
                    db=db,
                    player=player,
                    source="MARGIN_LIQUIDATION_SELL",
                    fundamental_price=position.fundamental_price,
                    points_to_date=position.points_to_date,
                    latest_week=position.latest_week,
                )
                progressed = True
                break

            qty = -position.shares
            total_cost = cost_to_buy(position.fundamental_price, k, total_shares, qty)
            user.cash_balance = float(Decimal(str(user.cash_balance)) - total_cost)
            holding.shares_owned = 0.0
            player.total_shares = float(total_shares + qty)
            db.add(
                Transaction(
                    user_id=user.id,
                    player_id=player.id,
                    type="LIQUIDATE_COVER",
                    shares=float(qty),
                    unit_price=float((total_cost / qty) if qty > 0 else Decimal("0")),
                    amount=float(-total_cost),
                )
            )
            add_price_point(
                db=db,
                player=player,
                source="MARGIN_LIQUIDATION_COVER",
                fundamental_price=position.fundamental_price,
                points_to_date=position.points_to_date,
                latest_week=position.latest_week,
            )
            progressed = True
            break

        if not progressed:
            return snapshot

    return build_account_risk_snapshot(
        db=db,
        user=user,
        for_update=True,
    )


@app.get("/sports", response_model=list[str])
def list_sports(db: Session = Depends(get_db)):
    sports = db.execute(
        select(Player.sport)
        .distinct()
        .order_by(Player.sport.asc())
    ).scalars().all()
    return [str(sport).strip().upper() for sport in sports if str(sport).strip()]


@app.get("/players", response_model=list[PlayerOut])
def list_players(
    sport: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
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
    return out


@app.get("/market/movers", response_model=MarketMoversOut)
def market_movers(
    limit: int = Query(default=25, ge=1, le=100),
    window_hours: int = Query(default=24, ge=1, le=168),
    sport: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
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
    return MarketMoversOut(
        generated_at=datetime.utcnow(),
        window_hours=window_hours,
        gainers=gainers,
        losers=losers,
    )


@app.get("/live/games", response_model=LiveGamesOut)
def list_live_games(
    sport: str | None = Query(default=None),
    _auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    stmt = select(Player).where(
        Player.ipo_open.is_(True),
        Player.live_now.is_(True),
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
    generated_at = datetime.utcnow()
    if not players:
        return LiveGamesOut(
            generated_at=generated_at,
            live_games_count=0,
            live_players_count=0,
            games=[],
        )

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id for player in players])
    grouped: dict[str, dict[str, object]] = {}

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
                "sport": sport_code,
                "game_label": resolved_label,
                "game_status": live_status or None,
                "week": int(player.live_week) if player.live_week is not None else None,
                "updated_at": player.live_updated_at,
                "players": [],
            }
            grouped[group_key] = bucket
        else:
            if not bucket["game_status"] and live_status:
                bucket["game_status"] = live_status
            incoming_week = int(player.live_week) if player.live_week is not None else None
            prior_week = bucket["week"]
            if incoming_week is not None and (prior_week is None or incoming_week > prior_week):
                bucket["week"] = incoming_week
            incoming_updated_at = player.live_updated_at
            prior_updated_at = bucket["updated_at"]
            if incoming_updated_at and (prior_updated_at is None or incoming_updated_at > prior_updated_at):
                bucket["updated_at"] = incoming_updated_at

        fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
        _ = latest_week
        spot = spot_price(
            fundamental,
            Decimal(str(player.k)),
            Decimal(str(player.total_shares)),
        )
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
        games.append(
            LiveGameOut(
                game_id=str(group["game_id"]),
                sport=str(group["sport"]),
                game_label=str(group["game_label"]),
                game_status=(str(group["game_status"]) if group["game_status"] else None),
                week=int(group["week"]) if group["week"] is not None else None,
                live_player_count=len(sorted_players),
                game_fantasy_points_total=total_game_points,
                updated_at=group["updated_at"],
                players=sorted_players,
            )
        )

    games.sort(key=lambda game: (game.sport, game.game_label.lower(), game.game_id.lower()))
    return LiveGamesOut(
        generated_at=generated_at,
        live_games_count=len(games),
        live_players_count=len(players),
        games=games,
    )


@app.get("/players/{player_id}", response_model=PlayerOut)
def get_player(player_id: int, db: Session = Depends(get_db)):
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    if not player_is_listed(player):
        raise HTTPException(404, "Player not found")

    stats_snapshot = get_stats_snapshot_by_player(db, [player_id])
    holdings_snapshot = get_aggregate_holdings_by_player(db, [player_id])
    fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)
    shares_held, shares_short = holdings_snapshot.get(player_id, (Decimal("0"), Decimal("0")))
    return player_to_out(
        player=player,
        fundamental_price=fundamental,
        points_to_date=points_to_date,
        latest_week=latest_week,
        shares_held=shares_held,
        shares_short=shares_short,
    )


@app.get("/players/{player_id}/history", response_model=list[PricePointOut])
def get_player_history(
    player_id: int,
    limit: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
):
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

    return [
        PricePointOut(
            player_id=point.player_id,
            source=point.source,
            fundamental_price=float(point.fundamental_price),
            spot_price=float(point.spot_price),
            total_shares=float(point.total_shares),
            points_to_date=float(point.points_to_date),
            latest_week=int(point.latest_week),
            created_at=point.created_at,
        )
        for point in points
    ]


def user_to_out(user: User) -> UserOut:
    profile_image_url = (str(user.profile_image_url).strip() if user.profile_image_url else None) or None
    bio = (str(user.bio).strip() if user.bio else None) or None
    is_admin = str(user.username).strip().lower() in ADMIN_USERNAMES
    return UserOut(
        id=user.id,
        username=str(user.username),
        cash_balance=float(user.cash_balance),
        profile_image_url=profile_image_url,
        bio=bio,
        is_admin=is_admin,
    )


def normalize_optional_profile_field(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def user_profile_to_out(user: User, snapshot: AccountRiskSnapshot) -> UserProfileOut:
    holdings = sorted(snapshot.positions, key=lambda position: abs(position.market_value), reverse=True)
    return UserProfileOut(
        id=int(user.id),
        username=str(user.username),
        profile_image_url=normalize_optional_profile_field(user.profile_image_url),
        bio=normalize_optional_profile_field(user.bio),
        cash_balance=float(snapshot.cash_balance),
        holdings_value=float(snapshot.net_exposure),
        equity=float(snapshot.equity),
        holdings=[
            UserProfileHoldingOut(
                player_id=int(position.player.id),
                player_name=str(position.player.name),
                sport=str(position.player.sport),
                team=str(position.player.team),
                position=str(position.player.position),
                shares_owned=float(position.shares),
                spot_price=float(position.spot_price),
                market_value=float(position.market_value),
            )
            for position in holdings
        ],
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
    enforce_rate_limit(
        key=f"auth:register:username:{username}",
        limit=RATE_LIMIT_AUTH_REGISTER,
        window_seconds=RATE_LIMIT_AUTH_REGISTER_WINDOW_SECONDS,
        label="auth register",
    )
    existing = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if existing and existing.password_hash:
        raise HTTPException(400, f"User '{username}' already exists.")
    if existing and not existing.password_hash:
        existing.password_hash = hash_password(payload.password)
        out = create_auth_session_out(db=db, user=existing)
        db.commit()
        return out

    user = User(
        username=username,
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
    username = normalize_username(payload.username)
    enforce_rate_limit(
        key=f"auth:login:username:{username}",
        limit=RATE_LIMIT_AUTH_LOGIN,
        window_seconds=RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS,
        label="auth login",
    )
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
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
    auth.session.revoked_at = datetime.utcnow()
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
    return user_profile_to_out(user=user, snapshot=snapshot)


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
    out = user_profile_to_out(user=user, snapshot=snapshot)
    db.commit()
    return out


@app.get("/users/{username}/profile", response_model=UserProfileOut)
def users_profile_by_username(
    username: str,
    _auth: AuthContext = Depends(get_auth_context),
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
    return user_profile_to_out(user=user, snapshot=snapshot)


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
    global_row.updated_at = datetime.utcnow()
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
    row.updated_at = datetime.utcnow()
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
        moderation_row.updated_at = datetime.utcnow()

    report.status = status_value
    report.action_taken = action_value
    report.moderator_note = normalize_optional_profile_field(payload.moderator_note)
    report.reviewed_by_user_id = int(admin.user.id)
    report.reviewed_at = datetime.utcnow()
    report.updated_at = datetime.utcnow()
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
    moderation_row.updated_at = datetime.utcnow()
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
        now = datetime.utcnow()
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
    post.updated_at = datetime.utcnow()
    db.add(comment)
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
        margin_used=float(snapshot.margin_used),
        available_buying_power=float(snapshot.available_buying_power),
        margin_call=snapshot.margin_call,
        holdings=[
            PortfolioHolding(
                player_id=position.player.id,
                shares_owned=float(position.shares),
                spot_price=float(position.spot_price),
                market_value=float(position.market_value),
                maintenance_margin_required=float(position.maintenance_margin_required),
            )
            for position in sorted(snapshot.positions, key=lambda position: abs(position.market_value), reverse=True)
        ],
    )


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

    k = Decimal(str(player.k))
    total_shares = Decimal(str(player.total_shares))

    spot_before = spot_price(fundamental, k, total_shares)
    ensure_open_position_cap_or_raise(
        current_abs_shares=max(Decimal("0"), net_shares),
        additional_shares=qty,
        spot_before=spot_before,
    )
    total_cost = cost_to_buy(fundamental, k, total_shares, qty)
    spot_after = spot_price(fundamental, k, total_shares + qty)
    average_price = (total_cost / qty) if qty > 0 else Decimal("0")

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

    k = Decimal(str(player.k))
    total_shares = Decimal(str(player.total_shares))
    ensure_sell_side_allowed_or_raise(
        total_shares=total_shares,
        qty=qty,
        fundamental_price=fundamental,
        k=k,
    )

    spot_before = spot_price(fundamental, k, total_shares)
    proceeds = proceeds_to_sell(fundamental, k, total_shares, qty)
    spot_after = spot_price(fundamental, k, total_shares - qty)
    average_price = (proceeds / qty) if qty > 0 else Decimal("0")

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

    k = Decimal(str(player.k))
    total_shares = Decimal(str(player.total_shares))
    ensure_sell_side_allowed_or_raise(
        total_shares=total_shares,
        qty=qty,
        fundamental_price=fundamental,
        k=k,
    )

    spot_before = spot_price(fundamental, k, total_shares)
    ensure_open_position_cap_or_raise(
        current_abs_shares=abs(min(Decimal("0"), net_shares)),
        additional_shares=qty,
        spot_before=spot_before,
    )
    proceeds = proceeds_to_sell(fundamental, k, total_shares, qty)
    spot_after = spot_price(fundamental, k, total_shares - qty)
    average_price = (proceeds / qty) if qty > 0 else Decimal("0")

    return QuoteOut(
        player_id=player.id,
        shares=float(qty),
        spot_price_before=float(spot_before),
        spot_price_after=float(spot_after),
        average_price=float(average_price),
        total=float(proceeds),
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

    k = Decimal(str(player.k))
    total_shares = Decimal(str(player.total_shares))

    spot_before = spot_price(fundamental, k, total_shares)
    total_cost = cost_to_buy(fundamental, k, total_shares, qty)
    spot_after = spot_price(fundamental, k, total_shares + qty)
    average_price = (total_cost / qty) if qty > 0 else Decimal("0")

    return QuoteOut(
        player_id=player.id,
        shares=float(qty),
        spot_price_before=float(spot_before),
        spot_price_after=float(spot_after),
        average_price=float(average_price),
        total=float(total_cost),
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

    k = Decimal(str(player.k))
    total_shares = Decimal(str(player.total_shares))

    holding = db.execute(
        select(Holding)
        .where(Holding.user_id == user.id, Holding.player_id == player.id)
        .with_for_update()
    ).scalar_one_or_none()
    net_shares = Decimal(str(holding.shares_owned)) if holding else Decimal("0")
    if net_shares < 0:
        raise HTTPException(400, "You are short this player. Use /trade/cover.")

    spot_before = spot_price(fundamental, k, total_shares)
    ensure_open_position_cap_or_raise(
        current_abs_shares=max(Decimal("0"), net_shares),
        additional_shares=qty,
        spot_before=spot_before,
    )

    total_cost = cost_to_buy(fundamental, k, total_shares, qty)
    cash = Decimal(str(user.cash_balance))

    if total_cost > cash:
        raise HTTPException(400, f"Insufficient cash. Need {float(total_cost):.2f}, have {float(cash):.2f}")

    user.cash_balance = float(cash - total_cost)

    if not holding:
        holding = Holding(user_id=user.id, player_id=player.id, shares_owned=0)
        db.add(holding)

    holding.shares_owned = float(Decimal(str(holding.shares_owned)) + qty)
    player.total_shares = float(total_shares + qty)

    unit_estimate = (total_cost / qty) if qty > 0 else Decimal("0")
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

    k = Decimal(str(player.k))
    total_shares = Decimal(str(player.total_shares))
    ensure_sell_side_allowed_or_raise(
        total_shares=total_shares,
        qty=qty,
        fundamental_price=fundamental,
        k=k,
    )

    spot_before = spot_price(fundamental, k, total_shares)

    proceeds = proceeds_to_sell(fundamental, k, total_shares, qty)

    cash = Decimal(str(user.cash_balance))
    user.cash_balance = float(cash + proceeds)

    holding.shares_owned = float(owned - qty)
    player.total_shares = float(total_shares - qty)

    unit_estimate = (proceeds / qty) if qty > 0 else Decimal("0")
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
        holding = Holding(user_id=user.id, player_id=player.id, shares_owned=0)
        db.add(holding)

    net_shares = Decimal(str(holding.shares_owned))
    if net_shares > 0:
        raise HTTPException(400, "You are long this player. Sell until flat before shorting.")

    stats_snapshot = get_stats_snapshot_by_player(db, [player.id])
    fundamental, points_to_date, latest_week = get_pricing_context(player, stats_snapshot)

    k = Decimal(str(player.k))
    total_shares = Decimal(str(player.total_shares))
    ensure_sell_side_allowed_or_raise(
        total_shares=total_shares,
        qty=qty,
        fundamental_price=fundamental,
        k=k,
    )

    spot_before = spot_price(fundamental, k, total_shares)
    ensure_open_position_cap_or_raise(
        current_abs_shares=abs(min(Decimal("0"), net_shares)),
        additional_shares=qty,
        spot_before=spot_before,
    )

    proceeds = proceeds_to_sell(fundamental, k, total_shares, qty)

    cash = Decimal(str(user.cash_balance))
    user.cash_balance = float(cash + proceeds)

    holding.shares_owned = float(net_shares - qty)
    player.total_shares = float(total_shares - qty)

    unit_estimate = (proceeds / qty) if qty > 0 else Decimal("0")
    db.add(
        Transaction(
            user_id=user.id,
            player_id=player.id,
            type="SHORT",
            shares=float(qty),
            unit_price=float(unit_estimate),
            amount=float(proceeds),
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
    return TradeOut(
        player_id=player.id,
        shares=float(qty),
        unit_price_estimate=float(unit_estimate),
        total_cost_or_proceeds=float(proceeds),
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

    k = Decimal(str(player.k))
    total_shares = Decimal(str(player.total_shares))
    total_cost = cost_to_buy(fundamental, k, total_shares, qty)

    cash = Decimal(str(user.cash_balance))
    if total_cost > cash:
        raise HTTPException(400, f"Insufficient cash. Need {float(total_cost):.2f}, have {float(cash):.2f}")

    user.cash_balance = float(cash - total_cost)

    holding.shares_owned = float(net_shares + qty)
    player.total_shares = float(total_shares + qty)

    unit_estimate = (total_cost / qty) if qty > 0 else Decimal("0")
    db.add(
        Transaction(
            user_id=user.id,
            player_id=player.id,
            type="COVER",
            shares=float(qty),
            unit_price=float(unit_estimate),
            amount=float(-total_cost),
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
    return TradeOut(
        player_id=player.id,
        shares=float(qty),
        unit_price_estimate=float(unit_estimate),
        total_cost_or_proceeds=float(total_cost),
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
        player.live_updated_at = datetime.utcnow()

    return changed


def upsert_weekly_stat_for_player(
    db: Session,
    player: Player,
    week: int,
    fantasy_points: float,
) -> tuple[str, bool]:
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
        k = Decimal(str(player.k))
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

            if shares < 0:
                qty = -shares
                total_cost = cost_to_buy(fundamental, k, total_shares, qty)
                user.cash_balance = float(Decimal(str(user.cash_balance)) - total_cost)
                player.total_shares = float(total_shares + qty)
                unit_price = (total_cost / qty) if qty > 0 else Decimal("0")
                amount = -total_cost
                tx_type = "IPO_HIDE_COVER"
            else:
                qty = shares
                proceeds = proceeds_to_sell(fundamental, k, total_shares, qty)
                user.cash_balance = float(Decimal(str(user.cash_balance)) + proceeds)
                player.total_shares = float(total_shares - qty)
                unit_price = (proceeds / qty) if qty > 0 else Decimal("0")
                amount = proceeds
                tx_type = "IPO_HIDE_SELL"

            holding.shares_owned = 0.0
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

    opened_at = datetime.utcnow()
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

    record_price_points_for_players(
        db=db,
        players=players,
        source=f"IPO_HIDE_{sport_code}",
    )
    db.commit()
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

    ready_rows = [row for row in parsed_rows if row.status == "READY" and row.player_id and row.week and row.fantasy_points is not None]
    skipped_count = sum(1 for row in parsed_rows if row.status == "SKIPPED")
    error_count = sum(1 for row in parsed_rows if row.status == "ERROR")

    created_count = 0
    updated_count = 0
    touched_player_ids: set[int] = set()

    for row in ready_rows:
        player = db.get(Player, int(row.player_id))
        if not player:
            error_count += 1
            continue
        status_label, stat_changed = upsert_weekly_stat_for_player(
            db=db,
            player=player,
            week=int(row.week),
            fantasy_points=float(row.fantasy_points),
        )
        if status_label == "created":
            created_count += 1
        else:
            updated_count += 1
        if stat_changed:
            touched_player_ids.add(int(player.id))

    db.flush()
    refresh_players_after_stats_update(
        db=db,
        player_ids=touched_player_ids,
        source="STAT_UPDATE_BULK",
    )
    db.commit()

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
    live_changed = apply_live_snapshot_from_stat(player=player, stat=stat)

    db.flush()
    if stat_changed:
        refresh_players_after_stats_update(
            db=db,
            player_ids={int(player.id)},
            source="STAT_UPDATE",
        )

    db.commit()
    return {"ok": True, "status": status_label, "stats_updated": stat_changed, "live_updated": live_changed}


@app.post("/settlement/week/{week}", response_model=SettlementOut, deprecated=True)
def settle_week(week: int, db: Session = Depends(get_db)):
    _ = week
    _ = db
    raise HTTPException(
        status_code=410,
        detail="Weekly dividends are deprecated. Use POST /season/close/{season}.",
    )


@app.post("/season/close/{season}", response_model=SeasonCloseOut)
def close_season(season: int, db: Session = Depends(get_db)):
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

    total_payout, users_credited, positions_closed = run_season_closeout(
        db,
        payout_per_point=SEASON_CLOSE_PAYOUT_PER_POINT,
    )
    record_price_points_for_players(
        db=db,
        players=db.execute(select(Player)).scalars().all(),
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

    return SeasonCloseOut(
        season=season,
        total_payout=float(total_payout),
        users_credited=users_credited,
        positions_closed=positions_closed,
        already_closed=False,
    )


@app.post("/season/reset/{season}", response_model=SeasonResetOut)
def reset_season(season: int, db: Session = Depends(get_db)):
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

    return SeasonResetOut(
        season=season,
        archived_stats=archived_stats,
        archived_holdings=archived_holdings,
        cleared_stats=archived_stats,
        cleared_holdings=archived_holdings,
        players_reset=players_reset,
        already_reset=False,
    )
