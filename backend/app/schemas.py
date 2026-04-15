from datetime import date, datetime
from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None = None
    cash_balance: float
    profile_image_url: str | None = None
    bio: str | None = None
    is_admin: bool = False


class UserCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class AuthRegisterIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    form_started_at_ms: int | None = None
    contact_email: str | None = Field(default=None, max_length=256)


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


class AuthPasswordResetRequestIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class AuthPasswordResetRequestOut(BaseModel):
    ok: bool = True
    expires_at: datetime | None = None
    preview_token: str | None = None
    preview_url: str | None = None


class AuthPasswordResetConfirmIn(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


class AuthPasswordResetConfirmOut(BaseModel):
    ok: bool = True


class TradingHaltStateOut(BaseModel):
    sport: str
    halted: bool
    reason: str | None = None
    updated_at: datetime


class TradingStatusOut(BaseModel):
    global_halt: TradingHaltStateOut
    sport_halts: list[TradingHaltStateOut]


class AdminTradingHaltUpdateIn(BaseModel):
    halted: bool
    reason: str | None = Field(default=None, max_length=280)


class AdminSportTradingHaltUpdateIn(BaseModel):
    sport: str = Field(min_length=2, max_length=16)
    halted: bool
    reason: str | None = Field(default=None, max_length=280)


class FeedbackCreateIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    page_path: str | None = Field(default=None, max_length=256)


class FeedbackOut(BaseModel):
    id: int
    page_path: str | None = None
    message: str
    status: str
    created_at: datetime


class AdminFeedbackOut(FeedbackOut):
    user_id: int
    username: str


class AdminFeedbackUpdateIn(BaseModel):
    status: str = Field(min_length=3, max_length=16)


class AdminBotPersonaOut(BaseModel):
    key: str
    label: str
    description: str
    market_maker: bool = False


class AdminBotProfileCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    username: str | None = Field(default=None, min_length=1, max_length=64)
    persona: str = Field(min_length=2, max_length=48)
    is_active: bool = True


class AdminBotProfileUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    persona: str = Field(min_length=2, max_length=48)
    is_active: bool


class AdminBotProfileOut(BaseModel):
    id: int
    name: str
    username: str
    persona: str
    is_active: bool
    account_exists: bool
    created_at: datetime
    updated_at: datetime


class AdminBotSimulationStartIn(BaseModel):
    duration_seconds: int = Field(default=300, ge=10, le=86_400)
    min_delay_ms: int = Field(default=800, ge=0, le=60_000)
    max_delay_ms: int = Field(default=2400, ge=0, le=60_000)
    startup_stagger_ms: int = Field(default=250, ge=0, le=60_000)
    reuse_existing: bool = True
    spoof_forwarded_for: bool = True


class AdminBotSimulationStatusOut(BaseModel):
    running: bool
    pid: int | None = None
    started_at: datetime | None = None
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
    completed_at: datetime | None = None
    message: str | None = None


class AdminAuditSessionOut(BaseModel):
    id: int
    user_id: int
    username: str
    email: str | None = None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None
    status: str


class AdminAuditTradeOut(BaseModel):
    id: int
    user_id: int
    username: str
    player_id: int | None = None
    player_name: str | None = None
    sport: str | None = None
    team: str | None = None
    position: str | None = None
    trade_type: str
    shares: float
    unit_price: float
    amount: float
    created_at: datetime


class AdminAuditForumPostOut(BaseModel):
    id: int
    user_id: int
    username: str
    title: str
    comment_count: int
    view_count: int
    created_at: datetime
    updated_at: datetime


class AdminAuditForumCommentOut(BaseModel):
    id: int
    post_id: int
    post_title: str
    user_id: int
    username: str
    body_preview: str
    created_at: datetime
    updated_at: datetime


class AdminAuditDirectMessageOut(BaseModel):
    id: int
    thread_id: int
    sender_user_id: int
    sender_username: str
    recipient_user_id: int
    recipient_username: str
    body_preview: str
    created_at: datetime


class AdminActivityAuditOut(BaseModel):
    generated_at: datetime
    active_sessions_count: int
    active_sessions: list[AdminAuditSessionOut]
    recent_sessions: list[AdminAuditSessionOut]
    recent_transactions: list[AdminAuditTradeOut]
    recent_forum_posts: list[AdminAuditForumPostOut]
    recent_forum_comments: list[AdminAuditForumCommentOut]
    recent_direct_messages: list[AdminAuditDirectMessageOut]
    direct_messages_supported: bool = True
    direct_messages_note: str | None = None


class ModerationReportCreateIn(BaseModel):
    content_type: str = Field(min_length=2, max_length=24)
    content_id: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=96)
    details: str | None = Field(default=None, max_length=2000)
    page_path: str | None = Field(default=None, max_length=256)


class ModerationReportOut(BaseModel):
    id: int
    content_type: str
    content_id: int
    reason: str
    details: str | None = None
    page_path: str | None = None
    status: str
    action_taken: str
    created_at: datetime
    updated_at: datetime


class AdminModerationReportOut(ModerationReportOut):
    reporter_user_id: int
    reporter_username: str
    reviewed_by_user_id: int | None = None
    reviewed_by_username: str | None = None
    moderator_note: str | None = None
    reviewed_at: datetime | None = None
    target_preview: str | None = None
    target_exists: bool = True
    is_content_hidden: bool = False


class AdminModerationResolveIn(BaseModel):
    status: str = Field(min_length=4, max_length=16)
    action: str = Field(default="NONE", min_length=2, max_length=24)
    moderator_note: str | None = Field(default=None, max_length=1000)


class AdminModerationUnhideIn(BaseModel):
    content_type: str = Field(min_length=2, max_length=24)
    content_id: int = Field(ge=1)


class AdminModerationUnhideOut(BaseModel):
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


class DirectThreadCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    initial_message: str | None = Field(default=None, max_length=5000)


class DirectMessageCreateIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class DirectMessageOut(BaseModel):
    id: int
    thread_id: int
    sender_user_id: int
    sender_username: str
    body: str
    created_at: datetime
    own_message: bool


class DirectThreadSummaryOut(BaseModel):
    id: int
    counterpart_user_id: int
    counterpart_username: str
    counterpart_profile_image_url: str | None = None
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime | None = None
    last_message_preview: str | None = None
    last_message_sender_username: str | None = None
    message_count: int
    unread_count: int


class DirectThreadDetailOut(DirectThreadSummaryOut):
    messages: list[DirectMessageOut]


class FriendshipRequestCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class FriendshipStatusOut(BaseModel):
    friendship_id: int | None = None
    status: str
    can_message: bool = False


class FriendSummaryOut(BaseModel):
    friendship_id: int
    user_id: int
    username: str
    profile_image_url: str | None = None
    since: datetime


class FriendRequestOut(BaseModel):
    friendship_id: int
    user_id: int
    username: str
    profile_image_url: str | None = None
    requested_at: datetime
    requested_by_user_id: int
    direction: str


class FriendsDashboardOut(BaseModel):
    friends: list[FriendSummaryOut]
    incoming_requests: list[FriendRequestOut]
    outgoing_requests: list[FriendRequestOut]


class LeaderboardEntryOut(BaseModel):
    user_id: int
    username: str
    profile_image_url: str | None = None
    equity: float
    cash_balance: float
    holdings_value: float
    return_pct: float
    rank: int
    is_current_user: bool = False
    is_friend: bool = False


class LeaderboardOut(BaseModel):
    scope: str
    sport: str
    generated_at: datetime
    entries: list[LeaderboardEntryOut]


class UserProfileHoldingOut(BaseModel):
    player_id: int
    player_name: str
    sport: str
    team: str
    position: str
    shares_owned: float
    average_entry_price: float
    basis_amount: float
    spot_price: float
    market_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    allocation_pct: float


class UserProfileOut(BaseModel):
    id: int
    username: str
    profile_image_url: str | None = None
    bio: str | None = None
    cash_balance: float
    holdings_value: float
    gross_exposure: float
    equity: float
    return_pct: float = 0
    leaderboard_rank: int | None = None
    holdings: list[UserProfileHoldingOut]
    community_posts: list[ForumPostSummaryOut] = Field(default_factory=list)
    friendship: FriendshipStatusOut = Field(default_factory=lambda: FriendshipStatusOut(status="SELF", can_message=False))


class UserProfileUpdateIn(BaseModel):
    profile_image_url: str | None = Field(default=None, max_length=512)
    bio: str | None = Field(default=None, max_length=1000)


class SearchResultOut(BaseModel):
    kind: str
    label: str
    subtitle: str | None = None
    href: str


class WatchlistPlayerOut(BaseModel):
    player_id: int
    sport: str
    name: str
    team: str
    position: str
    spot_price: float
    base_price: float
    live: "PlayerLiveOut | None" = None
    added_at: datetime


class NotificationOut(BaseModel):
    id: int
    type: str
    message: str
    actor_username: str | None = None
    actor_profile_image_url: str | None = None
    entity_type: str | None = None
    entity_id: int | None = None
    href: str | None = None
    read_at: datetime | None = None
    created_at: datetime


class NotificationListOut(BaseModel):
    unread_count: int
    items: list[NotificationOut]


class NotificationReadIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=200)


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


class PlayerGamePointOut(BaseModel):
    player_id: int
    game_id: str
    game_label: str | None = None
    game_status: str | None = None
    game_fantasy_points: float
    season_fantasy_points: float
    recorded_at: datetime


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
    average_entry_price: float
    basis_amount: float
    spot_price: float
    market_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float

class PortfolioOut(BaseModel):
    cash_balance: float
    equity: float
    net_exposure: float
    gross_exposure: float
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
    fantasy_points: float
    team: str | None = None
    live_now: bool | None = None
    live_week: int | None = Field(default=None, ge=1)
    live_game_id: str | None = Field(default=None, max_length=64)
    live_game_label: str | None = Field(default=None, max_length=96)
    live_game_status: str | None = Field(default=None, max_length=64)
    live_game_stat_line: str | None = Field(default=None, max_length=512)
    live_game_fantasy_points: float | None = None


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


class LiveGameStateOut(BaseModel):
    home_team: str | None = None
    away_team: str | None = None
    first_pitch_at: datetime | None = None
    home_score: int | None = None
    away_score: int | None = None
    inning: int | None = Field(default=None, ge=1)
    inning_half: str | None = None
    outs: int | None = Field(default=None, ge=0, le=3)
    balls: int | None = Field(default=None, ge=0, le=4)
    strikes: int | None = Field(default=None, ge=0, le=3)
    runner_on_first: bool | None = None
    runner_on_second: bool | None = None
    runner_on_third: bool | None = None
    offense_team: str | None = None
    defense_team: str | None = None


class LiveGameAtBatOut(BaseModel):
    at_bat_index: int
    inning: int | None = Field(default=None, ge=1)
    inning_half: str | None = None
    batter_name: str | None = None
    pitcher_name: str | None = None
    outs_after_play: int | None = Field(default=None, ge=0, le=3)
    balls: int | None = Field(default=None, ge=0, le=4)
    strikes: int | None = Field(default=None, ge=0, le=3)
    runner_on_first: bool | None = None
    runner_on_second: bool | None = None
    runner_on_third: bool | None = None
    away_score: int | None = Field(default=None, ge=0)
    home_score: int | None = Field(default=None, ge=0)
    event: str | None = None
    event_type: str | None = None
    description: str | None = None
    occurred_at: datetime | None = None


class LiveGameOut(BaseModel):
    game_id: str
    sport: str
    game_label: str
    game_status: str | None = None
    week: int | None = None
    is_live: bool = False
    live_player_count: int
    game_fantasy_points_total: float
    state: LiveGameStateOut | None = None
    at_bats: list[LiveGameAtBatOut] = Field(default_factory=list)
    updated_at: datetime | None = None
    players: list[LiveGamePlayerOut]


class LiveGamesOut(BaseModel):
    generated_at: datetime
    requested_date: str | None = None
    live_games_count: int
    live_players_count: int
    games: list[LiveGameOut]


class TeamSummaryPlayerOut(BaseModel):
    player_id: int
    name: str
    position: str
    spot_price: float
    points_to_date: float
    live_now: bool


class TeamGameSummaryOut(BaseModel):
    game_id: str
    game_label: str | None = None
    game_status: str | None = None
    game_fantasy_points_total: float
    players_count: int
    recorded_at: datetime | None = None


class TeamPageOut(BaseModel):
    sport: str
    team: str
    players_count: int
    live_players_count: int
    total_points_to_date: float
    average_spot_price: float
    players: list[TeamSummaryPlayerOut]
    games: list[TeamGameSummaryOut]


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


class AdminStatsClearSportIn(BaseModel):
    sport: str = Field(min_length=2, max_length=16)


class AdminStatsClearSportOut(BaseModel):
    sport: str
    players_affected: int
    stats_deleted: int
    price_points_created: int
    message: str


class AdminStatsBackfillMlbIn(BaseModel):
    start_date: date
    end_date: date | None = None
    week: int = Field(default=1, ge=1)
    mlb_allowed_game_types: str = Field(default="R,F,D,L,W,S", min_length=1, max_length=64)


class AdminStatsBackfillMlbOut(BaseModel):
    start_date: date
    end_date: date
    week: int
    dates_processed: int
    source_games: int
    source_rows: int
    matched_rows: int
    unmatched_rows: int
    applied_rows: int
    changed_rows: int
    unchanged_rows: int
    failed_rows: int
    players_touched: int
    unmatched_examples: list[str]
    message: str


class AdminSiteResetIn(BaseModel):
    starting_cash: float = Field(default=100000.0, ge=0)
    hide_sports: list[str] = Field(default_factory=list, max_length=16)


class AdminSiteResetOut(BaseModel):
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
    forum_posts_cleared: int
    forum_comments_cleared: int
    forum_post_views_cleared: int
    hidden_sports: list[str]
    starting_cash: float
    message: str


class AdminNormalizeHoldingsOut(BaseModel):
    users_affected: int
    holdings_updated: int
    message: str


class AdminUserEquityOut(BaseModel):
    user_id: int
    username: str
    cash_balance: float
    holdings_value: float
    gross_exposure: float
    equity: float
    return_pct: float
    cash_vs_starting_cash: float
    unrealized_pnl: float
    implied_realized_pnl: float


class AdminUserListItemOut(BaseModel):
    user_id: int
    username: str
    email: str | None = None


class AdminFlattenUserEquityIn(BaseModel):
    target_equity: float = Field(default=100000.0, ge=0)


class AdminFlattenUserEquityOut(BaseModel):
    user_id: int
    username: str
    target_equity: float
    holdings_value: float
    previous_cash_balance: float
    new_cash_balance: float
    previous_equity: float
    new_equity: float
    previous_return_pct: float
    new_return_pct: float
    message: str


class AdminDeleteUserOut(BaseModel):
    user_id: int
    username: str
    holdings_deleted: int
    transactions_deleted: int
    sessions_deleted: int
    threads_deleted: int
    messages_deleted: int
    friendships_deleted: int
    notifications_deleted: int
    watchlist_rows_deleted: int
    forum_posts_deleted: int
    forum_comments_deleted: int
    forum_post_views_deleted: int
    feedback_deleted: int
    reports_deleted: int
    moderation_rows_deleted: int
    message: str


class AdminPricingConfigOut(BaseModel):
    price_impact_multiplier: float
    default_price_impact_multiplier: float
    message: str | None = None


class AdminPricingConfigUpdateIn(BaseModel):
    price_impact_multiplier: float = Field(ge=0.000001, le=5.0)


class HomeHowToStepOut(BaseModel):
    title: str
    body: str


class HomeHowToContentOut(BaseModel):
    steps: list[HomeHowToStepOut]


class AdminHomeHowToContentUpdateIn(BaseModel):
    steps: list[HomeHowToStepOut] = Field(min_length=1, max_length=24)


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


class AdminIpoSuggestionOut(BaseModel):
    id: int
    sport: str
    name: str
    team: str
    position: str
    base_price: float
    suggested_base_price: float
    suggested_k: float
    points_to_date: float
    latest_week: int
    total_game_appearances: int
    recent_game_updates: int
    last_game_recorded_at: datetime | None = None
    live_updated_at: datetime | None = None
    recent_activity_at: datetime | None = None


class AdminIpoSuggestionsOut(BaseModel):
    sport: str
    lookback_hours: int
    total_candidates: int
    suggestions: list[AdminIpoSuggestionOut]


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


class AdminIpoPlayerCreateIn(BaseModel):
    sport: str = Field(min_length=2, max_length=16)
    name: str = Field(min_length=1, max_length=128)
    team: str = Field(min_length=1, max_length=8)
    position: str = Field(min_length=1, max_length=8)
    base_price: float = Field(default=10.0, ge=0)
    k: float = Field(default=0.0025, gt=0, le=1.0)
    list_immediately: bool = True
    season: int | None = Field(default=None, ge=1900, le=2500)


class AdminIpoPlayerCreateOut(BaseModel):
    player_id: int
    sport: str
    name: str
    team: str
    position: str
    listed: bool
    ipo_season: int | None = None
    ipo_opened_at: datetime | None = None
    base_price: float
    k: float
    created: bool
    message: str


class AdminSeasonEndingCloseoutIn(BaseModel):
    player_id: int = Field(ge=1)
    payout_price: float | None = Field(default=None, ge=0)
    delist: bool = True
    reason: str | None = Field(default="SEASON_ENDING_INJURY", max_length=64)


class AdminInjuryAlertIn(BaseModel):
    player_id: int = Field(ge=1)
    headline: str = Field(min_length=3, max_length=512)
    summary: str | None = Field(default=None, max_length=1024)
    source: str | None = Field(default=None, max_length=64)
    published_at: str | None = Field(default=None, max_length=64)
    external_id: str | None = Field(default=None, max_length=128)


class AdminSeasonEndingCloseoutOut(BaseModel):
    player_id: int
    sport: str
    player_name: str
    payout_price: float
    short_payout_price: float
    positions_closed: int
    shares_closed: float
    users_credited: int
    total_payout: float
    listed_after: bool
    message: str
