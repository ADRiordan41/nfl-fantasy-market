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
  bid_price: number;
  ask_price: number;
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

export type LiveGame = {
  game_id: string;
  sport: string;
  game_label: string;
  game_status: string | null;
  week: number | null;
  live_player_count: number;
  game_fantasy_points_total: number;
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
  margin_used: number;
  available_buying_power: number;
  margin_call: boolean;
  holdings: {
    player_id: number;
    shares_owned: number;
    average_entry_price: number;
    basis_amount: number;
    spot_price: number;
    market_value: number;
    maintenance_margin_required: number;
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

export type UserProfileHolding = {
  player_id: number;
  player_name: string;
  sport: string;
  team: string;
  position: string;
  shares_owned: number;
  spot_price: number;
  market_value: number;
};

export type UserProfile = {
  id: number;
  username: string;
  profile_image_url: string | null;
  bio: string | null;
  cash_balance: number;
  holdings_value: number;
  equity: number;
  holdings: UserProfileHolding[];
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
