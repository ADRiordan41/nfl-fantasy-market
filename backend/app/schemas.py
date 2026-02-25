from datetime import datetime
from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: int
    username: str
    cash_balance: float
    profile_image_url: str | None = None
    bio: str | None = None
    is_admin: bool = False


class UserCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class AuthRegisterIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class AuthLoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class AuthSessionOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserOut


class AuthLogoutOut(BaseModel):
    ok: bool = True


class AuthPasswordUpdateIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AuthPasswordUpdateOut(BaseModel):
    ok: bool = True


class ForumPostCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=10000)


class ForumCommentCreateIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class ForumCommentOut(BaseModel):
    id: int
    post_id: int
    body: str
    author_username: str
    created_at: datetime
    updated_at: datetime


class ForumPostSummaryOut(BaseModel):
    id: int
    title: str
    body_preview: str
    author_username: str
    comment_count: int
    view_count: int
    created_at: datetime
    updated_at: datetime


class ForumPostDetailOut(BaseModel):
    id: int
    title: str
    body: str
    author_username: str
    comment_count: int
    view_count: int
    created_at: datetime
    updated_at: datetime
    comments: list[ForumCommentOut]


class UserProfileHoldingOut(BaseModel):
    player_id: int
    player_name: str
    sport: str
    team: str
    position: str
    shares_owned: float
    spot_price: float
    market_value: float


class UserProfileOut(BaseModel):
    id: int
    username: str
    profile_image_url: str | None = None
    bio: str | None = None
    cash_balance: float
    holdings_value: float
    equity: float
    holdings: list[UserProfileHoldingOut]


class UserProfileUpdateIn(BaseModel):
    profile_image_url: str | None = Field(default=None, max_length=512)
    bio: str | None = Field(default=None, max_length=1000)


class SearchResultOut(BaseModel):
    kind: str
    label: str
    subtitle: str | None = None
    href: str


class PlayerLiveOut(BaseModel):
    live_now: bool
    week: int | None = None
    game_id: str | None = None
    game_label: str | None = None
    game_status: str | None = None
    game_stat_line: str | None = None
    game_fantasy_points: float | None = None
    updated_at: datetime | None = None


class PlayerOut(BaseModel):
    id: int
    sport: str
    name: str
    team: str
    position: str
    base_price: float  # projected season fantasy points
    fundamental_price: float  # projected points adjusted by in-season performance
    points_to_date: float
    latest_week: int
    k: float
    total_shares: float
    shares_held: float
    shares_short: float
    spot_price: float
    live: PlayerLiveOut | None = None


class PricePointOut(BaseModel):
    player_id: int
    source: str
    fundamental_price: float
    spot_price: float
    total_shares: float
    points_to_date: float
    latest_week: int
    created_at: datetime


class MarketMoverOut(BaseModel):
    player_id: int
    sport: str
    name: str
    team: str
    position: str
    spot_price: float
    reference_price: float
    change: float
    change_percent: float
    current_at: datetime
    reference_at: datetime | None = None


class MarketMoversOut(BaseModel):
    generated_at: datetime
    window_hours: int
    gainers: list[MarketMoverOut]
    losers: list[MarketMoverOut]


class PortfolioHolding(BaseModel):
    player_id: int
    shares_owned: float
    spot_price: float
    market_value: float
    maintenance_margin_required: float

class PortfolioOut(BaseModel):
    cash_balance: float
    equity: float
    net_exposure: float
    gross_exposure: float
    margin_used: float
    available_buying_power: float
    margin_call: bool
    holdings: list[PortfolioHolding]

class TradeIn(BaseModel):
    player_id: int
    shares: int = Field(gt=0)

class TradeOut(BaseModel):
    player_id: int
    shares: float
    unit_price_estimate: float
    total_cost_or_proceeds: float
    new_cash_balance: float
    new_total_shares: float

class StatIn(BaseModel):
    player_id: int
    week: int = Field(ge=1)
    fantasy_points: float = Field(ge=0)
    live_now: bool | None = None
    live_week: int | None = Field(default=None, ge=1)
    live_game_id: str | None = Field(default=None, max_length=64)
    live_game_label: str | None = Field(default=None, max_length=96)
    live_game_status: str | None = Field(default=None, max_length=64)
    live_game_stat_line: str | None = Field(default=None, max_length=512)
    live_game_fantasy_points: float | None = Field(default=None, ge=0)


class LiveGamePlayerOut(BaseModel):
    player_id: int
    name: str
    team: str
    position: str
    points_to_date: float
    game_fantasy_points: float
    game_stat_line: str | None = None
    spot_price: float
    fundamental_price: float


class LiveGameOut(BaseModel):
    game_id: str
    sport: str
    game_label: str
    game_status: str | None = None
    week: int | None = None
    live_player_count: int
    game_fantasy_points_total: float
    updated_at: datetime | None = None
    players: list[LiveGamePlayerOut]


class LiveGamesOut(BaseModel):
    generated_at: datetime
    live_games_count: int
    live_players_count: int
    games: list[LiveGameOut]

class SettlementOut(BaseModel):
    week: int
    dividends_paid_total: float
    users_credited: int
    already_settled: bool = False

class QuoteOut(BaseModel):
    player_id: int
    shares: float
    spot_price_before: float
    spot_price_after: float
    average_price: float
    total: float  # buy cost or sell proceeds


class SeasonCloseOut(BaseModel):
    season: int
    total_payout: float
    users_credited: int
    positions_closed: int
    already_closed: bool = False


class SeasonResetOut(BaseModel):
    season: int
    archived_stats: int
    archived_holdings: int
    cleared_stats: int
    cleared_holdings: int
    players_reset: int
    already_reset: bool = False


class AdminStatsPreviewIn(BaseModel):
    csv_text: str = Field(min_length=1)
    week_override: int | None = Field(default=None, ge=1)


class AdminStatsPreviewRow(BaseModel):
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


class AdminStatsPreviewOut(BaseModel):
    total_rows: int
    ready_count: int
    skipped_count: int
    error_count: int
    rows: list[AdminStatsPreviewRow]


class AdminStatsPublishOut(BaseModel):
    total_rows: int
    applied_count: int
    created_count: int
    updated_count: int
    skipped_count: int
    error_count: int


class AdminIpoSportOut(BaseModel):
    sport: str
    total_players: int
    listed_players: int
    ipo_open: bool
    ipo_season: int | None = None
    ipo_opened_at: datetime | None = None


class AdminIpoPlayerOut(BaseModel):
    id: int
    sport: str
    name: str
    team: str
    position: str
    listed: bool
    ipo_season: int | None = None
    ipo_opened_at: datetime | None = None
    base_price: float


class AdminIpoPlayersOut(BaseModel):
    sport: str
    total_players: int
    listed_players: int
    players: list[AdminIpoPlayerOut]


class AdminIpoLaunchIn(BaseModel):
    sport: str = Field(min_length=2, max_length=16)
    season: int = Field(ge=1900, le=2500)


class AdminIpoHideIn(BaseModel):
    sport: str = Field(min_length=2, max_length=16)


class AdminIpoActionOut(BaseModel):
    sport: str
    season: int | None = None
    total_players: int
    listed_players: int
    players_updated: int
    ipo_opened_at: datetime | None = None
    message: str
