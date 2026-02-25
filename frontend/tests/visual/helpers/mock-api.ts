import type { Page, Route } from "@playwright/test";

const API_ORIGIN = "http://localhost:8000";
const VISUAL_TOKEN = "visual-regression-token";

const PLAYERS = [
  {
    id: 101,
    sport: "MLB",
    name: "Aaron Judge",
    team: "NYY",
    position: "OF",
    base_price: 301.2,
    fundamental_price: 306.4,
    points_to_date: 96.0,
    latest_week: 12,
    k: 0.0025,
    total_shares: 220.0,
    shares_held: 184.0,
    shares_short: 39.0,
    spot_price: 318.4,
    live: null,
  },
  {
    id: 102,
    sport: "MLB",
    name: "Ronald Acuna Jr.",
    team: "ATL",
    position: "OF",
    base_price: 278.9,
    fundamental_price: 281.3,
    points_to_date: 88.0,
    latest_week: 12,
    k: 0.0025,
    total_shares: 94.0,
    shares_held: 121.0,
    shares_short: 28.0,
    spot_price: 287.9,
    live: null,
  },
  {
    id: 103,
    sport: "MLB",
    name: "Mookie Betts",
    team: "LAD",
    position: "OF",
    base_price: 265.6,
    fundamental_price: 269.1,
    points_to_date: 80.0,
    latest_week: 12,
    k: 0.0025,
    total_shares: -46.0,
    shares_held: 92.0,
    shares_short: 110.0,
    spot_price: 258.4,
    live: null,
  },
  {
    id: 104,
    sport: "NFL",
    name: "Jalen Hurts",
    team: "PHI",
    position: "QB",
    base_price: 322.0,
    fundamental_price: 322.0,
    points_to_date: 0.0,
    latest_week: 0,
    k: 0.0025,
    total_shares: 18.0,
    shares_held: 54.0,
    shares_short: 12.0,
    spot_price: 328.9,
    live: null,
  },
];

const PORTFOLIO = {
  cash_balance: 98765.43,
  equity: 101234.11,
  net_exposure: 2145.62,
  gross_exposure: 4120.55,
  margin_used: 0,
  available_buying_power: 101234.11,
  margin_call: false,
  holdings: [
    { player_id: 101, shares_owned: 14, spot_price: 318.4, market_value: 4457.6, maintenance_margin_required: 0 },
    { player_id: 102, shares_owned: 9, spot_price: 287.9, market_value: 2591.1, maintenance_margin_required: 0 },
    { player_id: 103, shares_owned: -6, spot_price: 258.4, market_value: -1550.4, maintenance_margin_required: 0 },
  ],
};

const FORUM_POSTS = [
  {
    id: 1,
    title: "MLB Opening Week Ideas",
    body_preview: "Who are your top long picks for week one?",
    author_username: "foreverhopeful",
    comment_count: 8,
    view_count: 120,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T12:00:00Z",
  },
  {
    id: 2,
    title: "Short candidates this month",
    body_preview: "Looking for overvalued names before the next stat refresh.",
    author_username: "sandbox",
    comment_count: 5,
    view_count: 77,
    created_at: "2026-02-02T00:00:00Z",
    updated_at: "2026-02-02T09:30:00Z",
  },
];

const MARKET_MOVERS = {
  generated_at: "2026-02-25T00:00:00Z",
  window_hours: 24,
  gainers: [
    {
      player_id: 101,
      sport: "MLB",
      name: "Aaron Judge",
      team: "NYY",
      position: "OF",
      spot_price: 318.4,
      reference_price: 301.6,
      change: 16.8,
      change_percent: 5.57,
      current_at: "2026-02-25T00:00:00Z",
      reference_at: "2026-02-24T00:00:00Z",
    },
    {
      player_id: 102,
      sport: "MLB",
      name: "Ronald Acuna Jr.",
      team: "ATL",
      position: "OF",
      spot_price: 287.9,
      reference_price: 276.0,
      change: 11.9,
      change_percent: 4.31,
      current_at: "2026-02-25T00:00:00Z",
      reference_at: "2026-02-24T00:00:00Z",
    },
  ],
  losers: [
    {
      player_id: 103,
      sport: "MLB",
      name: "Mookie Betts",
      team: "LAD",
      position: "OF",
      spot_price: 258.4,
      reference_price: 266.2,
      change: -7.8,
      change_percent: -2.93,
      current_at: "2026-02-25T00:00:00Z",
      reference_at: "2026-02-24T00:00:00Z",
    },
  ],
};

const LIVE_GAMES = {
  generated_at: "2026-02-25T01:30:00Z",
  live_games_count: 2,
  live_players_count: 4,
  games: [
    {
      game_id: "mlb-nyy-bos-1",
      sport: "MLB",
      game_label: "NYY @ BOS",
      game_status: "Top 7th",
      week: 12,
      live_player_count: 2,
      game_fantasy_points_total: 31.2,
      updated_at: "2026-02-25T01:29:00Z",
      players: [
        {
          player_id: 101,
          name: "Aaron Judge",
          team: "NYY",
          position: "OF",
          points_to_date: 96.0,
          game_fantasy_points: 17.4,
          game_stat_line: "2-3, HR, 3 RBI, BB",
          spot_price: 318.4,
          fundamental_price: 306.4,
        },
        {
          player_id: 103,
          name: "Mookie Betts",
          team: "LAD",
          position: "OF",
          points_to_date: 80.0,
          game_fantasy_points: 13.8,
          game_stat_line: "1-4, 2B, R",
          spot_price: 258.4,
          fundamental_price: 269.1,
        },
      ],
    },
    {
      game_id: "nfl-phi-dal-1",
      sport: "NFL",
      game_label: "PHI vs DAL",
      game_status: "Q3 08:12",
      week: 12,
      live_player_count: 2,
      game_fantasy_points_total: 40.5,
      updated_at: "2026-02-25T01:29:00Z",
      players: [
        {
          player_id: 104,
          name: "Jalen Hurts",
          team: "PHI",
          position: "QB",
          points_to_date: 0.0,
          game_fantasy_points: 24.1,
          game_stat_line: "18/24, 232 yds, 2 TD, 38 rush yds",
          spot_price: 328.9,
          fundamental_price: 322.0,
        },
        {
          player_id: 102,
          name: "Ronald Acuna Jr.",
          team: "ATL",
          position: "OF",
          points_to_date: 88.0,
          game_fantasy_points: 16.4,
          game_stat_line: "Simulated live feed",
          spot_price: 287.9,
          fundamental_price: 281.3,
        },
      ],
    },
  ],
};

const PLAYER_HISTORY_BY_ID: Record<number, Array<{
  player_id: number;
  source: string;
  fundamental_price: number;
  spot_price: number;
  total_shares: number;
  points_to_date: number;
  latest_week: number;
  created_at: string;
}>> = {
  101: [
    {
      player_id: 101,
      source: "STAT_UPDATE",
      fundamental_price: 296.4,
      spot_price: 301.2,
      total_shares: 140.0,
      points_to_date: 80.0,
      latest_week: 10,
      created_at: "2026-02-20T00:00:00Z",
    },
    {
      player_id: 101,
      source: "TRADE",
      fundamental_price: 299.0,
      spot_price: 307.5,
      total_shares: 165.0,
      points_to_date: 84.0,
      latest_week: 11,
      created_at: "2026-02-22T00:00:00Z",
    },
    {
      player_id: 101,
      source: "TRADE",
      fundamental_price: 306.4,
      spot_price: 318.4,
      total_shares: 220.0,
      points_to_date: 96.0,
      latest_week: 12,
      created_at: "2026-02-25T00:00:00Z",
    },
  ],
};

function json(route: Route, payload: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function mockApi(page: Page, authEnabled: boolean): Promise<void> {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());

    if (pathname === "/players") return json(route, PLAYERS);
    if (pathname.startsWith("/players/")) {
      const playerPathParts = pathname.split("/").filter(Boolean);
      const playerId = Number(playerPathParts[1]);
      const isHistoryPath = playerPathParts.length >= 3 && playerPathParts[2] === "history";
      if (!Number.isFinite(playerId) || playerId <= 0) {
        return json(route, { detail: "Player not found" }, 404);
      }
      if (isHistoryPath) {
        return json(route, PLAYER_HISTORY_BY_ID[playerId] ?? []);
      }
      const player = PLAYERS.find((row) => row.id === playerId);
      if (!player) return json(route, { detail: "Player not found" }, 404);
      return json(route, player);
    }
    if (pathname === "/portfolio") return authEnabled ? json(route, PORTFOLIO) : json(route, { detail: "Authentication required." }, 401);
    if (pathname === "/market/movers") return json(route, MARKET_MOVERS);
    if (pathname === "/live/games") return authEnabled ? json(route, LIVE_GAMES) : json(route, { detail: "Authentication required." }, 401);
    if (pathname === "/forum/posts") return json(route, FORUM_POSTS);
    if (pathname === "/users/me/profile") {
      if (!authEnabled) return json(route, { detail: "Authentication required." }, 401);
      return json(route, {
        id: 1,
        username: "foreverhopeful",
        profile_image_url: "https://example.com/avatar.png",
        bio: "Long volatility, short hype.",
        cash_balance: 98765.43,
        holdings_value: 5498.3,
        equity: 104263.73,
        holdings: [
          {
            player_id: 101,
            player_name: "Aaron Judge",
            sport: "MLB",
            team: "NYY",
            position: "OF",
            shares_owned: 14,
            spot_price: 318.4,
            market_value: 4457.6,
          },
          {
            player_id: 102,
            player_name: "Ronald Acuna Jr.",
            sport: "MLB",
            team: "ATL",
            position: "OF",
            shares_owned: 9,
            spot_price: 287.9,
            market_value: 2591.1,
          },
        ],
      });
    }
    if (pathname === "/auth/me") {
      if (!authEnabled) return json(route, { detail: "Authentication required." }, 401);
      return json(route, {
        id: 1,
        username: "foreverhopeful",
        cash_balance: 98765.43,
        profile_image_url: null,
        bio: null,
        is_admin: true,
      });
    }
    if (pathname === "/search") return json(route, []);

    return json(route, { detail: `No mock configured for ${pathname}` }, 404);
  });
}

export async function mockGuestApi(page: Page): Promise<void> {
  await mockApi(page, false);
}

export async function mockAuthedApi(page: Page): Promise<void> {
  await page.addInitScript((token) => {
    window.localStorage.setItem("fsm_access_token", token);
  }, VISUAL_TOKEN);
  await mockApi(page, true);
}

export async function stabilizeUi(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
}
