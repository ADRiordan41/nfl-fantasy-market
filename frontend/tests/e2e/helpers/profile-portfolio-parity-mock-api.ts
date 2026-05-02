import type { Page, Route } from "@playwright/test";

const API_ORIGIN = "http://localhost:8000";
const ACCESS_TOKEN = "parity-e2e-token";

function json(route: Route, payload: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

export async function setupProfilePortfolioParityMockApi(page: Page): Promise<void> {
  const sharedCommunityPosts = [
    {
      id: 1001,
      title: "Momentum names for next slate",
      body_preview: "Sharing a few ideas that looked underpriced this morning.",
      author_username: "teammate",
      comment_count: 4,
      view_count: 41,
      created_at: "2026-03-01T09:00:00Z",
      updated_at: "2026-03-01T12:30:00Z",
    },
    {
      id: 1002,
      title: "Risk sizing notes",
      body_preview: "How I size longs vs shorts when volatility spikes.",
      author_username: "teammate",
      comment_count: 7,
      view_count: 66,
      created_at: "2026-03-02T10:00:00Z",
      updated_at: "2026-03-02T15:15:00Z",
    },
  ];

  const players = [
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
  ];

  const portfolio = {
    cash_balance: 98765.43,
    equity: 101234.11,
    net_exposure: 2145.62,
    gross_exposure: 4120.55,
    holdings: [
      {
        player_id: 101,
        shares_owned: 14,
        average_entry_price: 300,
        basis_amount: 4200,
        spot_price: 318.4,
        market_value: 4457.6,
        unrealized_pnl: 257.6,
        unrealized_pnl_pct: 6.13,
      },
    ],
  };

  const meProfile = {
    id: 1,
    username: "ForeverHopeful",
    profile_image_url: null,
    bio: "Long volatility.",
    cash_balance: 98765.43,
    holdings_value: 4457.6,
    gross_exposure: 4457.6,
    equity: 103223.03,
    return_pct: 3.22,
    leaderboard_rank: 7,
    holdings: [
      {
        player_id: 101,
        player_name: "Aaron Judge",
        sport: "MLB",
        team: "NYY",
        position: "OF",
        shares_owned: 14,
        average_entry_price: 300,
        basis_amount: 4200,
        spot_price: 318.4,
        market_value: 4457.6,
        unrealized_pnl: 257.6,
        unrealized_pnl_pct: 6.13,
        allocation_pct: 100,
      },
    ],
    community_posts: sharedCommunityPosts,
    friendship: {
      friendship_id: null,
      status: "SELF",
      can_message: false,
    },
  };

  const publicProfile = {
    ...meProfile,
    id: 2,
    username: "teammate",
    friendship: {
      friendship_id: 21,
      status: "FRIENDS",
      can_message: true,
    },
  };

  await page.addInitScript((token) => {
    window.localStorage.setItem("fsm_access_token", token);
  }, ACCESS_TOKEN);

  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());

    if (method === "GET" && pathname === "/auth/me") {
      return json(route, {
        id: 1,
        username: "ForeverHopeful",
        cash_balance: portfolio.cash_balance,
        profile_image_url: null,
        bio: null,
        is_admin: false,
      });
    }
    if (method === "GET" && pathname === "/portfolio") return json(route, portfolio);
    if (method === "GET" && pathname === "/players") return json(route, players);
    if (method === "GET" && pathname === "/transactions/me") return json(route, []);
    if (method === "GET" && pathname === "/market/movers") {
      return json(route, {
        generated_at: "2026-03-01T00:00:00Z",
        window_hours: 24,
        gainers: [],
        losers: [],
      });
    }
    if (method === "GET" && pathname === "/trading/status") {
      return json(route, {
        global_halt: { sport: "ALL", halted: false, reason: null, updated_at: "2026-03-01T00:00:00Z" },
        sport_halts: [],
      });
    }
    if (method === "GET" && pathname === "/users/me/profile") return json(route, meProfile);
    if (method === "GET" && pathname === "/users/teammate/profile") return json(route, publicProfile);
    if (method === "GET" && pathname === "/watchlist/players") return json(route, []);
    if (method === "GET" && pathname === "/search") return json(route, []);

    return json(route, { detail: `No mock configured for ${method} ${pathname}` }, 404);
  });
}
