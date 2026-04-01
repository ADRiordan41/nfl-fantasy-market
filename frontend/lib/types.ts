export type PlayerLive = {
  live_now: boolean;
  week: number | null;
  game_id: string | null;
  game_label: string | null;
  game_status: string | null;
  game_stat_line: string | null;
  game_fantasy_points: number | null;
  updated_at: string | null;
};

export type Player = {
  id: number;
  sport: string;
  name: string;
  team: string;
  position: string;
  base_price: number;
  fundamental_price: number;
  points_to_date: number;
  latest_week: number;
  k: number;
  total_shares: number;
  shares_held: number;
  shares_short: number;
  spot_price: number;
  live: PlayerLive | null;
};

export type LiveGamePlayer = {
  player_id: number;
  name: string;
  team: string;
  position: string;
  points_to_date: number;
  game_fantasy_points: number;
  game_stat_line: string | null;
  spot_price: number;
  fundamental_price: number;
};

export type LiveGameState = {
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  inning: number | null;
  inning_half: string | null;
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  runner_on_first: boolean | null;
  runner_on_second: boolean | null;
  runner_on_third: boolean | null;
  offense_team: string | null;
  defense_team: string | null;
};

export type LiveGameAtBat = {
  at_bat_index: number;
  inning: number | null;
  inning_half: string | null;
  outs_after_play: number | null;
  balls: number | null;
  strikes: number | null;
  runner_on_first: boolean | null;
  runner_on_second: boolean | null;
  runner_on_third: boolean | null;
  away_score: number | null;
  home_score: number | null;
  event: string | null;
  event_type: string | null;
  description: string | null;
  occurred_at: string | null;
};

export type LiveGame = {
  game_id: string;
  sport: string;
  game_label: string;
  game_status: string | null;
  week: number | null;
  live_player_count: number;
  game_fantasy_points_total: number;
  state: LiveGameState | null;
  at_bats: LiveGameAtBat[];
  updated_at: string | null;
  players: LiveGamePlayer[];
};

export type LiveGames = {
  generated_at: string;
  live_games_count: number;
  live_players_count: number;
  games: LiveGame[];
};

export type Portfolio = {
  cash_balance: number;
  equity: number;
  net_exposure: number;
  gross_exposure: number;
  holdings: {
    player_id: number;
    shares_owned: number;
    average_entry_price: number;
    basis_amount: number;
    spot_price: number;
    market_value: number;
    unrealized_pnl: number;
    unrealized_pnl_pct: number;
  }[];
};

export type Quote = {
  player_id: number;
  shares: number;
  spot_price_before: number;
  spot_price_after: number;
  average_price: number;
  total: number;
};

export type PricePoint = {
  player_id: number;
  source: string;
  fundamental_price: number;
  spot_price: number;
  total_shares: number;
  points_to_date: number;
  latest_week: number;
  created_at: string;
};

export type PlayerGamePoint = {
  player_id: number;
  game_id: string;
  game_label: string | null;
  game_status: string | null;
  game_fantasy_points: number;
  season_fantasy_points: number;
  recorded_at: string;
};

export type MarketMover = {
  player_id: number;
  sport: string;
  name: string;
  team: string;
  position: string;
  spot_price: number;
  reference_price: number;
  change: number;
  change_percent: number;
  current_at: string;
  reference_at: string | null;
};

export type MarketMovers = {
  generated_at: string;
  window_hours: number;
  gainers: MarketMover[];
  losers: MarketMover[];
};

export type UserAccount = {
  id: number;
  username: string;
  email: string | null;
  cash_balance: number;
  profile_image_url?: string | null;
  bio?: string | null;
  is_admin: boolean;
};

export type AuthSession = {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: UserAccount;
};

export type ForumPostSummary = {
  id: number;
  title: string;
  body_preview: string;
  author_username: string;
  comment_count: number;
  view_count: number;
  created_at: string;
  updated_at: string;
};

export type ForumComment = {
  id: number;
  post_id: number;
  body: string;
  author_username: string;
  created_at: string;
  updated_at: string;
};

export type ForumPostDetail = {
  id: number;
  title: string;
  body: string;
  author_username: string;
  comment_count: number;
  view_count: number;
  created_at: string;
  updated_at: string;
  comments: ForumComment[];
};

export type DirectMessage = {
  id: number;
  thread_id: number;
  sender_user_id: number;
  sender_username: string;
  body: string;
  created_at: string;
  own_message: boolean;
};

export type DirectThreadSummary = {
  id: number;
  counterpart_user_id: number;
  counterpart_username: string;
  counterpart_profile_image_url: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_username: string | null;
  message_count: number;
  unread_count: number;
};

export type DirectThreadDetail = DirectThreadSummary & {
  messages: DirectMessage[];
};

export type FriendshipStatus = {
  friendship_id: number | null;
  status: string;
  can_message: boolean;
};

export type FriendSummary = {
  friendship_id: number;
  user_id: number;
  username: string;
  profile_image_url: string | null;
  since: string;
};

export type FriendRequest = {
  friendship_id: number;
  user_id: number;
  username: string;
  profile_image_url: string | null;
  requested_at: string;
  requested_by_user_id: number;
  direction: string;
};

export type FriendsDashboard = {
  friends: FriendSummary[];
  incoming_requests: FriendRequest[];
  outgoing_requests: FriendRequest[];
};

export type LeaderboardEntry = {
  user_id: number;
  username: string;
  profile_image_url: string | null;
  equity: number;
  cash_balance: number;
  holdings_value: number;
  return_pct: number;
  rank: number;
  is_current_user: boolean;
  is_friend: boolean;
};

export type LeaderboardResponse = {
  scope: string;
  sport: string;
  generated_at: string;
  entries: LeaderboardEntry[];
};

export type UserProfileHolding = {
  player_id: number;
  player_name: string;
  sport: string;
  team: string;
  position: string;
  shares_owned: number;
  average_entry_price: number;
  basis_amount: number;
  spot_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  allocation_pct: number;
};

export type UserProfile = {
  id: number;
  username: string;
  profile_image_url: string | null;
  bio: string | null;
  cash_balance: number;
  holdings_value: number;
  gross_exposure: number;
  equity: number;
  return_pct: number;
  leaderboard_rank: number | null;
  holdings: UserProfileHolding[];
  friendship: FriendshipStatus;
};

export type SearchResult = {
  kind: "player" | "user";
  label: string;
  subtitle: string | null;
  href: string;
};

export type AdminStatsPreviewRow = {
  row_number: number;
  status: "READY" | "SKIPPED" | "ERROR";
  input_name: string;
  input_team: string | null;
  player_id: number | null;
  matched_name: string | null;
  matched_team: string | null;
  week: number | null;
  fantasy_points: number | null;
  existing_points: number | null;
  delta_points: number | null;
  message: string | null;
};

export type AdminStatsPreview = {
  total_rows: number;
  ready_count: number;
  skipped_count: number;
  error_count: number;
  rows: AdminStatsPreviewRow[];
};

export type AdminStatsPublishResult = {
  total_rows: number;
  applied_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
};

export type AdminStatsClearSportResult = {
  sport: string;
  players_affected: number;
  stats_deleted: number;
  price_points_created: number;
  message: string;
};

export type AdminStatsBackfillMlbResult = {
  start_date: string;
  end_date: string;
  week: number;
  dates_processed: number;
  source_games: number;
  source_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  applied_rows: number;
  changed_rows: number;
  unchanged_rows: number;
  failed_rows: number;
  players_touched: number;
  unmatched_examples: string[];
  message: string;
};

export type AdminSiteResetResult = {
  users_reset: number;
  players_reset: number;
  holdings_cleared: number;
  transactions_cleared: number;
  weekly_stats_cleared: number;
  price_points_cleared: number;
  player_game_points_cleared: number;
  settled_weeks_cleared: number;
  season_closes_cleared: number;
  season_resets_cleared: number;
  archived_weekly_stats_cleared: number;
  archived_holdings_cleared: number;
  hidden_sports: string[];
  starting_cash: number;
  message: string;
};

export type AdminNormalizeHoldingsResult = {
  users_affected: number;
  holdings_updated: number;
  message: string;
};

export type AdminPricingConfig = {
  price_impact_multiplier: number;
  default_price_impact_multiplier: number;
  message: string | null;
};

export type AdminUserEquity = {
  user_id: number;
  username: string;
  cash_balance: number;
  holdings_value: number;
  gross_exposure: number;
  equity: number;
  return_pct: number;
  cash_vs_starting_cash: number;
  unrealized_pnl: number;
  implied_realized_pnl: number;
};

export type AdminUserListItem = {
  user_id: number;
  username: string;
  email: string | null;
};

export type AdminFlattenUserEquityResult = {
  user_id: number;
  username: string;
  target_equity: number;
  holdings_value: number;
  previous_cash_balance: number;
  new_cash_balance: number;
  previous_equity: number;
  new_equity: number;
  previous_return_pct: number;
  new_return_pct: number;
  message: string;
};

export type AdminDeleteUserResult = {
  user_id: number;
  username: string;
  holdings_deleted: number;
  transactions_deleted: number;
  sessions_deleted: number;
  threads_deleted: number;
  messages_deleted: number;
  friendships_deleted: number;
  notifications_deleted: number;
  watchlist_rows_deleted: number;
  forum_posts_deleted: number;
  forum_comments_deleted: number;
  forum_post_views_deleted: number;
  feedback_deleted: number;
  reports_deleted: number;
  moderation_rows_deleted: number;
  message: string;
};

export type AdminIpoSport = {
  sport: string;
  total_players: number;
  listed_players: number;
  ipo_open: boolean;
  ipo_season: number | null;
  ipo_opened_at: string | null;
};

export type AdminIpoPlayer = {
  id: number;
  sport: string;
  name: string;
  team: string;
  position: string;
  listed: boolean;
  ipo_season: number | null;
  ipo_opened_at: string | null;
  base_price: number;
};

export type AdminIpoPlayers = {
  sport: string;
  total_players: number;
  listed_players: number;
  players: AdminIpoPlayer[];
};

export type AdminIpoActionResult = {
  sport: string;
  season: number | null;
  total_players: number;
  listed_players: number;
  players_updated: number;
  ipo_opened_at: string | null;
  message: string;
};

export type TradingHaltState = {
  sport: string;
  halted: boolean;
  reason: string | null;
  updated_at: string;
};

export type TradingStatus = {
  global_halt: TradingHaltState;
  sport_halts: TradingHaltState[];
};

export type WatchlistPlayer = {
  player_id: number;
  sport: string;
  name: string;
  team: string;
  position: string;
  spot_price: number;
  base_price: number;
  live: PlayerLive | null;
  added_at: string;
};

export type AppNotification = {
  id: number;
  type: string;
  message: string;
  actor_username: string | null;
  actor_profile_image_url: string | null;
  entity_type: string | null;
  entity_id: number | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationList = {
  unread_count: number;
  items: AppNotification[];
};

export type FeedbackMessage = {
  id: number;
  page_path: string | null;
  message: string;
  status: string;
  created_at: string;
};

export type AdminFeedbackMessage = FeedbackMessage & {
  user_id: number;
  username: string;
};

export type AdminBotPersona = {
  key: string;
  label: string;
  description: string;
  market_maker: boolean;
};

export type AdminBotProfile = {
  id: number;
  name: string;
  username: string;
  persona: string;
  is_active: boolean;
  account_exists: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminBotSimulationStatus = {
  running: boolean;
  pid: number | null;
  started_at: string | null;
  requested_by_username: string | null;
  duration_seconds: number | null;
  min_delay_ms: number | null;
  max_delay_ms: number | null;
  startup_stagger_ms: number | null;
  active_bot_count: number;
  config_file: string | null;
  summary_file: string | null;
  log_file: string | null;
  exit_code: number | null;
  completed_at: string | null;
  message: string | null;
};

export type ModerationReport = {
  id: number;
  content_type: string;
  content_id: number;
  reason: string;
  details: string | null;
  page_path: string | null;
  status: string;
  action_taken: string;
  created_at: string;
  updated_at: string;
};

export type AdminModerationReport = ModerationReport & {
  reporter_user_id: number;
  reporter_username: string;
  reviewed_by_user_id: number | null;
  reviewed_by_username: string | null;
  moderator_note: string | null;
  reviewed_at: string | null;
  target_preview: string | null;
  target_exists: boolean;
  is_content_hidden: boolean;
};

export type AdminAuditSession = {
  id: number;
  user_id: number;
  username: string;
  email: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: string;
};

export type AdminAuditTrade = {
  id: number;
  user_id: number;
  username: string;
  player_id: number | null;
  player_name: string | null;
  sport: string | null;
  team: string | null;
  position: string | null;
  trade_type: string;
  shares: number;
  unit_price: number;
  amount: number;
  created_at: string;
};

export type AdminAuditForumPost = {
  id: number;
  user_id: number;
  username: string;
  title: string;
  comment_count: number;
  view_count: number;
  created_at: string;
  updated_at: string;
};

export type AdminAuditForumComment = {
  id: number;
  post_id: number;
  post_title: string;
  user_id: number;
  username: string;
  body_preview: string;
  created_at: string;
  updated_at: string;
};

export type AdminAuditDirectMessage = {
  id: number;
  thread_id: number;
  sender_user_id: number;
  sender_username: string;
  recipient_user_id: number;
  recipient_username: string;
  body_preview: string;
  created_at: string;
};

export type AdminActivityAudit = {
  generated_at: string;
  active_sessions_count: number;
  active_sessions: AdminAuditSession[];
  recent_sessions: AdminAuditSession[];
  recent_transactions: AdminAuditTrade[];
  recent_forum_posts: AdminAuditForumPost[];
  recent_forum_comments: AdminAuditForumComment[];
  recent_direct_messages: AdminAuditDirectMessage[];
  direct_messages_supported: boolean;
  direct_messages_note: string | null;
};
