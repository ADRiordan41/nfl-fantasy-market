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
