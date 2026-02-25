import type { Page, Route } from "@playwright/test";

type TradeSide = "buy" | "sell" | "short" | "cover";

type MarketPlayer = {
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
  live: null;
};

type TradeCall = {
  phase: "quote" | "trade";
  side: TradeSide;
  playerId: number;
  shares: number;
};

type SetupOptions = {
  initialSharesOwned?: number;
};

type SetupResult = {
  playerId: number;
  playerName: string;
  tradeCalls: TradeCall[];
};

const API_ORIGIN = "http://localhost:8000";
const ACCESS_TOKEN = "trade-e2e-token";

function json(route: Route, payload: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

export async function setupMarketTradeMockApi(page: Page, options: SetupOptions = {}): Promise<SetupResult> {
  const playerId = 5001;
  const playerName = "Aaron Judge";
  const spotPrice = 300;
  const initialSharesOwned = options.initialSharesOwned ?? 0;

  const players: MarketPlayer[] = [
    {
      id: playerId,
      sport: "MLB",
      name: playerName,
      team: "NYY",
      position: "OF",
      base_price: 280,
      fundamental_price: 286,
      points_to_date: 90,
      latest_week: 12,
      k: 0.0025,
      total_shares: initialSharesOwned,
      shares_held: Math.max(initialSharesOwned, 0),
      shares_short: Math.max(-initialSharesOwned, 0),
      spot_price: spotPrice,
      live: null,
    },
  ];

  const holdings = new Map<number, number>();
  if (initialSharesOwned !== 0) {
    holdings.set(playerId, initialSharesOwned);
  }

  let cashBalance = 100000;
  const tradeCalls: TradeCall[] = [];

  function computePortfolio() {
    const holdingRows = [...holdings.entries()]
      .filter(([, sharesOwned]) => sharesOwned !== 0)
      .map(([holdingPlayerId, sharesOwned]) => {
        const player = players.find((row) => row.id === holdingPlayerId);
        const price = player?.spot_price ?? spotPrice;
        const marketValue = sharesOwned * price;
        return {
          player_id: holdingPlayerId,
          shares_owned: sharesOwned,
          spot_price: price,
          market_value: marketValue,
          maintenance_margin_required: 0,
        };
      });

    const netExposure = holdingRows.reduce((sum, row) => sum + row.market_value, 0);
    const grossExposure = holdingRows.reduce((sum, row) => sum + Math.abs(row.market_value), 0);
    const equity = cashBalance + netExposure;

    return {
      cash_balance: cashBalance,
      equity,
      net_exposure: netExposure,
      gross_exposure: grossExposure,
      margin_used: 0,
      available_buying_power: equity,
      margin_call: false,
      holdings: holdingRows,
    };
  }

  function syncAggregates() {
    for (const player of players) {
      const shares = holdings.get(player.id) ?? 0;
      player.shares_held = Math.max(0, shares);
      player.shares_short = Math.max(0, -shares);
      player.total_shares = shares;
    }
  }

  function quotePayload(side: TradeSide, shares: number) {
    const total = shares * spotPrice;
    return {
      player_id: playerId,
      shares,
      spot_price_before: spotPrice,
      spot_price_after: spotPrice,
      average_price: spotPrice,
      total,
      side,
    };
  }

  function applyTrade(side: TradeSide, shares: number, nextPlayerId: number) {
    const existing = holdings.get(nextPlayerId) ?? 0;
    const notional = shares * spotPrice;

    if (side === "buy") {
      holdings.set(nextPlayerId, existing + shares);
      cashBalance -= notional;
    } else if (side === "sell") {
      holdings.set(nextPlayerId, existing - shares);
      cashBalance += notional;
    } else if (side === "short") {
      holdings.set(nextPlayerId, existing - shares);
      cashBalance += notional;
    } else {
      holdings.set(nextPlayerId, existing + shares);
      cashBalance -= notional;
    }

    if ((holdings.get(nextPlayerId) ?? 0) === 0) {
      holdings.delete(nextPlayerId);
    }

    syncAggregates();
  }

  syncAggregates();

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
        username: "foreverhopeful",
        cash_balance: cashBalance,
        profile_image_url: null,
        bio: null,
        is_admin: true,
      });
    }

    if (method === "GET" && pathname === "/players") {
      return json(route, players);
    }

    if (method === "GET" && pathname === "/portfolio") {
      return json(route, computePortfolio());
    }

    if (method === "GET" && pathname === "/market/movers") {
      return json(route, {
        generated_at: "2026-02-25T00:00:00Z",
        window_hours: 24,
        gainers: [
          {
            player_id: playerId,
            sport: "MLB",
            name: playerName,
            team: "NYY",
            position: "OF",
            spot_price: spotPrice,
            reference_price: spotPrice - 10,
            change: 10,
            change_percent: 3.45,
            current_at: "2026-02-25T00:00:00Z",
            reference_at: "2026-02-24T00:00:00Z",
          },
        ],
        losers: [],
      });
    }

    if (method === "GET" && pathname === "/search") {
      return json(route, []);
    }

    if (method === "POST" && pathname.startsWith("/quote/")) {
      const side = pathname.replace("/quote/", "") as TradeSide;
      const body = request.postDataJSON() as { player_id: number; shares: number };
      tradeCalls.push({
        phase: "quote",
        side,
        playerId: Number(body.player_id),
        shares: Number(body.shares),
      });
      return json(route, quotePayload(side, Number(body.shares)));
    }

    if (method === "POST" && pathname.startsWith("/trade/")) {
      const side = pathname.replace("/trade/", "") as TradeSide;
      const body = request.postDataJSON() as { player_id: number; shares: number };
      tradeCalls.push({
        phase: "trade",
        side,
        playerId: Number(body.player_id),
        shares: Number(body.shares),
      });
      applyTrade(side, Number(body.shares), Number(body.player_id));
      const sharesNow = holdings.get(Number(body.player_id)) ?? 0;
      return json(route, {
        player_id: Number(body.player_id),
        shares: Number(body.shares),
        unit_price_estimate: spotPrice,
        total_cost_or_proceeds: Number(body.shares) * spotPrice,
        new_cash_balance: cashBalance,
        new_total_shares: sharesNow,
      });
    }

    return json(route, { detail: `No mock configured for ${method} ${pathname}` }, 404);
  });

  return {
    playerId,
    playerName,
    tradeCalls,
  };
}
