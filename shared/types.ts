export type PlayerLive = {
  isLive: boolean;
  gameLabel: string | null;
  league: string | null;
  gameClock: string | null;
  gameStatus: string | null;
};

export type Player = {
  id: number;
  name: string;
  team: string;
  position: string;
  sport: string;
  slot?: string | null;
  price: number;
  spread: number;
  changePct: number;
  totalGainPct?: number;
  bid?: number;
  ask?: number;
  ask_price?: number;
  sharesHeld?: number;
  sharesShort?: number;
  volume?: number;
  marketCap?: number;
  live?: PlayerLive | null;
};

export type PortfolioHolding = {
  playerId: number;
  playerName: string;
  sport: string;
  position: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  gainLoss: number;
  gainLossPct: number;
  marketValue: number;
  side?: "LONG" | "SHORT";
};

export type Portfolio = {
  cash: number;
  holdingsValue: number;
  totalValue: number;
  realizedPnL: number;
  unrealizedPnL: number;
  holdings: PortfolioHolding[];
};

export type Quote = {
  playerId: number;
  side: "BUY" | "SELL" | "SHORT" | "COVER";
  quantity: number;
  estimatedPrice: number;
  estimatedTotal: number;
  fee: number;
};

export type MarketMover = {
  id: number;
  name: string;
  team: string;
  position: string;
  sport: string;
  price: number;
  changePct: number;
};

export type MarketMovers = {
  topGainers: MarketMover[];
  topLosers: MarketMover[];
};

export type TradingHaltState = {
  active: boolean;
  reason: string | null;
  until: string | null;
};

export type TradingStatus = {
  enabled: boolean;
  halt: TradingHaltState | null;
  nextOpenAt: string | null;
};

export type UserAccount = {
  id: number;
  username: string;
  email?: string;
  is_admin: boolean;
  avatar_url?: string | null;
};

export type AuthSession = {
  token: string;
  user: UserAccount;
};

export type ForumPostSummary = {
  id: number;
  title: string;
  body: string;
  authorUsername: string;
  createdAt: string;
  commentCount: number;
  likeCount?: number;
  viewerReacted?: boolean;
};

export type ForumComment = {
  id: number;
  body: string;
  authorUsername: string;
  createdAt: string;
  likeCount?: number;
  viewerReacted?: boolean;
};

export type ForumPostDetail = ForumPostSummary & {
  comments: ForumComment[];
};

export type LiveGamePlayer = {
  playerId: number;
  name: string;
  team: string;
  position: string;
  fantasyPoints: number;
};

export type LiveGame = {
  id: string;
  league: string;
  label: string;
  status: string;
  clock?: string | null;
  players: LiveGamePlayer[];
};

export type LiveGames = {
  games: LiveGame[];
};

export type WatchlistPlayer = {
  playerId: number;
  sport: string;
  name: string;
  team: string;
  position: string;
  spotPrice: number;
  basePrice?: number;
  live?: boolean;
  addedAt: string;
};

export type LeaderboardEntry = {
  userId: number;
  username: string;
  profileImageUrl?: string | null;
  equity: number;
  cashBalance: number;
  holdingsValue: number;
  returnPct: number;
  rank: number;
  isFriend?: boolean;
};

export type LeaderboardResponse = {
  scope: "global" | "friends";
  sport: string;
  season: string;
  generatedAt: string;
  entries: LeaderboardEntry[];
};

export type AppNotification = {
  id: number;
  type: string;
  message: string;
  actorUsername?: string | null;
  actorProfileImageUrl?: string | null;
  entityType?: string | null;
  entityId?: number | string | null;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
};

export type NotificationList = {
  unreadCount: number;
  items: AppNotification[];
};

export type DirectMessage = {
  id: number;
  threadId: number;
  senderUserId: number;
  senderUsername: string;
  body: string;
  createdAt: string;
  ownMessage: boolean;
};

export type DirectThreadSummary = {
  id: number;
  counterpartUserId: number;
  counterpartUsername: string;
  counterpartProfileImageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastMessageSenderUsername?: string | null;
  messageCount: number;
  unreadCount: number;
};

export type DirectThreadDetail = DirectThreadSummary & {
  messages: DirectMessage[];
};

export type FriendSummary = {
  friendshipId: number;
  userId: number;
  username: string;
  profileImageUrl?: string | null;
  since: string;
};

export type FriendRequest = {
  friendshipId: number;
  userId: number;
  username: string;
  profileImageUrl?: string | null;
  requestedAt: string;
  requestedByUserId: number;
  direction: "incoming" | "outgoing";
};

export type FriendsDashboard = {
  friends: FriendSummary[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
};
