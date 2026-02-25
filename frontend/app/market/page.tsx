"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost, isUnauthorizedError } from "@/lib/api";
import { formatCurrency, formatNumber, formatSignedPercent } from "@/lib/format";
import type { MarketMovers, Player, Portfolio, Quote, UserAccount } from "@/lib/types";

type TradeSide = "BUY" | "SELL" | "SHORT" | "COVER";
type MarketSortColumn =
  | "name"
  | "team"
  | "position"
  | "spot_price"
  | "change_pct"
  | "change_24h_pct";
type SortDirection = "asc" | "desc";

const MAX_POSITION_NOTIONAL_PER_PLAYER = 10000;
const SPORT_FILTER_BUTTONS = ["MLB", "NFL", "NBA", "NHL"] as const;
type SportFilter = (typeof SPORT_FILTER_BUTTONS)[number];
const SORT_DEFAULT_DIRECTION: Record<MarketSortColumn, SortDirection> = {
  name: "asc",
  team: "asc",
  position: "asc",
  spot_price: "desc",
  change_pct: "desc",
  change_24h_pct: "desc",
};
const MARKET_SORT_STORAGE_PREFIX = "fsm_market_sort_v1";
const MARKET_SORT_COLUMN_SET = new Set<MarketSortColumn>([
  "name",
  "team",
  "position",
  "spot_price",
  "change_pct",
  "change_24h_pct",
]);

type MarketRow = {
  player: Player;
  sharesHeld: number;
  sharesShort: number;
  totalChangePct: number;
  change24hPct: number;
  buyRemaining: number;
  shortRemaining: number;
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getSignedPercent(base: number, spot: number): number {
  if (!base) return 0;
  return ((spot - base) / base) * 100;
}

function isCostSide(side: TradeSide): boolean {
  return side === "BUY" || side === "COVER";
}

function parseWholeShares(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

function isMarketSortColumn(value: unknown): value is MarketSortColumn {
  return typeof value === "string" && MARKET_SORT_COLUMN_SET.has(value as MarketSortColumn);
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}

function isSportFilter(value: string): value is SportFilter {
  return (SPORT_FILTER_BUTTONS as readonly string[]).includes(value);
}

export default function MarketPage() {
  const router = useRouter();
  const marketShellRef = useRef<HTMLElement | null>(null);
  const marketTablePanelRef = useRef<HTMLElement | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [sideById, setSideById] = useState<Record<number, TradeSide>>({});
  const [qtyById, setQtyById] = useState<Record<number, string>>({});
  const [quoteById, setQuoteById] = useState<Record<number, Quote | null>>({});
  const [change24hById, setChange24hById] = useState<Record<number, number>>({});
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [placingId, setPlacingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [activeSport, setActiveSport] = useState<SportFilter>("MLB");
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [sortColumn, setSortColumn] = useState<MarketSortColumn>("spot_price");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [hydratedSortKey, setHydratedSortKey] = useState("");
  const [error, setError] = useState("");

  const handleRequestError = useCallback(
    (err: unknown) => {
      if (isUnauthorizedError(err)) {
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    },
    [router],
  );

  const load = useCallback(async () => {
    try {
      const [playersData, portfolioData, moversData] = await Promise.all([
        apiGet<Player[]>("/players"),
        apiGet<Portfolio>("/portfolio"),
        apiGet<MarketMovers>(`/market/movers?limit=100&window_hours=24&sport=${encodeURIComponent(activeSport)}`).catch(
          () => null,
        ),
      ]);
      setPlayers(playersData);
      setPortfolio(portfolioData);
      const next24hById: Record<number, number> = {};
      if (moversData) {
        for (const row of [...moversData.gainers, ...moversData.losers]) {
          const existing = next24hById[row.player_id];
          if (existing === undefined || Math.abs(row.change_percent) > Math.abs(existing)) {
            next24hById[row.player_id] = row.change_percent;
          }
        }
      }
      setChange24hById(next24hById);
      setError("");
    } catch (err: unknown) {
      handleRequestError(err);
    }
  }, [activeSport, handleRequestError]);

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentUser() {
      try {
        const me = await apiGet<UserAccount>("/auth/me");
        if (!cancelled) setCurrentUserId(me.id);
      } catch (err: unknown) {
        if (!cancelled) handleRequestError(err);
      }
    }

    void loadCurrentUser();
    return () => {
      cancelled = true;
    };
  }, [handleRequestError]);

  const sortStorageKey = useMemo(
    () => (currentUserId ? `${MARKET_SORT_STORAGE_PREFIX}:${currentUserId}` : ""),
    [currentUserId],
  );

  useEffect(() => {
    if (!sortStorageKey || typeof window === "undefined") {
      setHydratedSortKey("");
      return;
    }
    try {
      const raw = window.localStorage.getItem(sortStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { column?: unknown; direction?: unknown };
        if (isMarketSortColumn(parsed.column)) setSortColumn(parsed.column);
        if (isSortDirection(parsed.direction)) setSortDirection(parsed.direction);
      }
    } catch {
      // Ignore malformed local storage payloads and continue with defaults.
    } finally {
      setHydratedSortKey(sortStorageKey);
    }
  }, [sortStorageKey]);

  useEffect(() => {
    if (!sortStorageKey || hydratedSortKey !== sortStorageKey || typeof window === "undefined") return;
    const payload = JSON.stringify({
      column: sortColumn,
      direction: sortDirection,
    });
    window.localStorage.setItem(sortStorageKey, payload);
  }, [hydratedSortKey, sortColumn, sortDirection, sortStorageKey]);

  useEffect(() => {
    if (sortColumn === "team" || sortColumn === "position") {
      setSortColumn("name");
      setSortDirection("asc");
    }
  }, [sortColumn]);

  useEffect(() => {
    const shell = marketShellRef.current;
    const tablePanel = marketTablePanelRef.current;
    if (!shell || !tablePanel) return;

    const syncLaneWidth = () => {
      const width = Math.ceil(tablePanel.getBoundingClientRect().width);
      if (width > 0) shell.style.setProperty("--market-lane-width", `${width}px`);
    };

    syncLaneWidth();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      syncLaneWidth();
    });
    observer.observe(tablePanel);
    window.addEventListener("resize", syncLaneWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncLaneWidth);
      shell.style.removeProperty("--market-lane-width");
    };
  }, [activeSport, players.length, positionFilter, query]);

  const ownedById = useMemo(() => {
    const owned: Record<number, number> = {};
    for (const holding of portfolio?.holdings ?? []) owned[holding.player_id] = holding.shares_owned;
    return owned;
  }, [portfolio]);

  const positions = useMemo(() => {
    const source = players.filter((player) => player.sport === activeSport);
    return ["ALL", ...Array.from(new Set(source.map((player) => player.position))).sort()];
  }, [activeSport, players]);
  const ipoActiveSports = useMemo(() => {
    return Array.from(new Set(players.map((player) => player.sport)))
      .filter(isSportFilter)
      .sort();
  }, [players]);

  useEffect(() => {
    if (!ipoActiveSports.length) return;
    if (!ipoActiveSports.includes(activeSport)) {
      setActiveSport(ipoActiveSports[0]);
    }
  }, [activeSport, ipoActiveSports]);

  useEffect(() => {
    if (positionFilter !== "ALL" && !positions.includes(positionFilter)) {
      setPositionFilter("ALL");
    }
  }, [positionFilter, positions]);

  const selectSport = useCallback((sport: SportFilter) => {
    setActiveSport(sport);
  }, []);
  const toggleSort = useCallback(
    (column: MarketSortColumn) => {
      if (sortColumn === column) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
        return;
      }
      setSortColumn(column);
      setSortDirection(SORT_DEFAULT_DIRECTION[column]);
    },
    [sortColumn],
  );

  const cashBalance = portfolio?.cash_balance ?? 0;
  const holdingsValue = useMemo(
    () => (portfolio?.holdings ?? []).reduce((sum, holding) => sum + Number(holding.market_value || 0), 0),
    [portfolio],
  );
  const marginCall = portfolio?.margin_call ?? false;
  const equity = portfolio?.equity ?? cashBalance + holdingsValue;

  const visibleRows = useMemo<MarketRow[]>(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const normalizedQuery = query.trim().toLowerCase();
    const filteredRows = players
      .filter((player) => {
        const matchesQuery =
          !normalizedQuery ||
          player.name.toLowerCase().includes(normalizedQuery) ||
          player.team.toLowerCase().includes(normalizedQuery);
        const matchesSport = player.sport === activeSport;
        const matchesPosition = positionFilter === "ALL" || player.position === positionFilter;
        return matchesQuery && matchesSport && matchesPosition;
      })
      .map((player) => {
        const owned = ownedById[player.id] ?? 0;
        const sharesHeld = player.shares_held ?? 0;
        const sharesShort = player.shares_short ?? 0;
        const totalChangePct = getSignedPercent(player.base_price, player.spot_price);
        const change24hPct = change24hById[player.id] ?? 0;
        const maxOpenSharesAtSpot = MAX_POSITION_NOTIONAL_PER_PLAYER / Math.max(0.0001, player.spot_price);
        const buyRemaining = owned < 0 ? 0 : Math.max(0, Math.floor(maxOpenSharesAtSpot - Math.max(0, owned)));
        const shortRemaining =
          owned > 0 ? 0 : Math.max(0, Math.floor(maxOpenSharesAtSpot - Math.max(0, Math.abs(owned))));
        return {
          player,
          sharesHeld,
          sharesShort,
          totalChangePct,
          change24hPct,
          buyRemaining,
          shortRemaining,
        };
      });

    filteredRows.sort((a, b) => {
      if (sortColumn === "name") {
        return direction * a.player.name.localeCompare(b.player.name);
      }
      if (sortColumn === "team") {
        return direction * a.player.team.localeCompare(b.player.team);
      }
      if (sortColumn === "position") {
        return direction * a.player.position.localeCompare(b.player.position);
      }
      if (sortColumn === "spot_price") {
        return direction * (a.player.spot_price - b.player.spot_price);
      }
      if (sortColumn === "change_pct") {
        return direction * (a.totalChangePct - b.totalChangePct);
      }
      if (sortColumn === "change_24h_pct") {
        return direction * (a.change24hPct - b.change24hPct);
      }
      return 0;
    });

    return filteredRows;
  }, [activeSport, change24hById, ownedById, players, positionFilter, query, sortColumn, sortDirection]);

  const sortLabel = useCallback(
    (column: MarketSortColumn) => {
      if (sortColumn !== column) return "";
      return sortDirection === "asc" ? " \u2191" : " \u2193";
    },
    [sortColumn, sortDirection],
  );

  function sideFor(playerId: number): TradeSide {
    return sideById[playerId] ?? "BUY";
  }

  function clearQuote(playerId: number) {
    setQuoteById((prev) => ({ ...prev, [playerId]: null }));
  }

  function setSide(playerId: number, side: TradeSide) {
    setSideById((prev) => ({ ...prev, [playerId]: side }));
    clearQuote(playerId);
  }

  function setQuantity(playerId: number, value: string) {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 4);
    setQtyById((prev) => ({ ...prev, [playerId]: digitsOnly }));
    clearQuote(playerId);
  }

  async function executeMaxTrade(playerId: number, nextSide: "BUY" | "SHORT", maxSize: number) {
    if (maxSize <= 0) return;
    setSideById((prev) => ({ ...prev, [playerId]: nextSide }));
    setQtyById((prev) => ({ ...prev, [playerId]: String(maxSize) }));
    setPreviewingId(playerId);
    setPlacingId(playerId);
    setError("");
    try {
      const quote = await apiPost<Quote>(`/quote/${nextSide.toLowerCase()}`, {
        player_id: playerId,
        shares: maxSize,
      });
      await apiPost(`/trade/${nextSide.toLowerCase()}`, {
        player_id: playerId,
        shares: quote.shares,
      });
      setQtyById((prev) => ({ ...prev, [playerId]: "" }));
      setQuoteById((prev) => ({ ...prev, [playerId]: null }));
      await load();
    } catch (err: unknown) {
      handleRequestError(err);
    } finally {
      setPreviewingId(null);
      setPlacingId(null);
    }
  }

  async function previewTrade(playerId: number) {
    const side = sideFor(playerId);
    const shares = parseWholeShares(qtyById[playerId] ?? "");
    if (!shares) {
      setError("Enter whole shares (1 or more) before previewing.");
      return;
    }

    setPreviewingId(playerId);
    setError("");
    try {
      const quote = await apiPost<Quote>(`/quote/${side.toLowerCase()}`, {
        player_id: playerId,
        shares,
      });
      setQuoteById((prev) => ({ ...prev, [playerId]: quote }));
    } catch (err: unknown) {
      handleRequestError(err);
    } finally {
      setPreviewingId(null);
    }
  }

  async function placeTrade(playerId: number) {
    const side = sideFor(playerId);
    const quote = quoteById[playerId];
    if (!quote) {
      setError("Preview a quote first.");
      return;
    }

    setPlacingId(playerId);
    setError("");
    try {
      await apiPost(`/trade/${side.toLowerCase()}`, {
        player_id: playerId,
        shares: quote.shares,
      });
      setQtyById((prev) => ({ ...prev, [playerId]: "" }));
      setQuoteById((prev) => ({ ...prev, [playerId]: null }));
      await load();
    } catch (err: unknown) {
      handleRequestError(err);
    } finally {
      setPlacingId(null);
    }
  }

  return (
    <main ref={marketShellRef} className="page-shell market-page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Market</p>
          <h1>Athlete Exchange</h1>
          <p className="subtle">Search players by sport, preview quote impact, and place two-step trades. Buy/short openings are capped at $10,000 per player.</p>
        </div>
        <div className="hero-metrics">
          <article className="kpi-card">
            <span>Cash</span>
            <strong>{formatCurrency(cashBalance)}</strong>
          </article>
          <article className="kpi-card">
            <span>Holdings</span>
            <strong>{formatCurrency(holdingsValue)}</strong>
          </article>
          <article className="kpi-card">
            <span>Equity</span>
            <strong>{formatCurrency(equity)}</strong>
          </article>
        </div>
        <div className="sport-filter-buttons hero-sport-filter-buttons" role="group" aria-label="Filter sports">
          {SPORT_FILTER_BUTTONS.map((sport) => (
            <button
              key={sport}
              type="button"
              className={`sport-filter-btn${activeSport === sport ? " active" : ""}`}
              aria-pressed={activeSport === sport}
              onClick={() => selectSport(sport)}
            >
              {sport}
            </button>
          ))}
        </div>
      </section>

      {marginCall && (
        <p className="error-box">
          Margin call active. Positions may be automatically liquidated until maintenance requirements are met.
        </p>
      )}

      <section className="toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search player or team"
          aria-label="Search players"
        />
        <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}>
          {positions.map((position) => (
            <option key={position} value={position}>
              {position === "ALL" ? "All positions" : position}
            </option>
          ))}
        </select>
        <button onClick={load}>Refresh</button>
      </section>

      {error && <p className="error-box">{error}</p>}

      {visibleRows.length === 0 ? (
        <section className="empty-panel">
          <h3>No players are listed yet</h3>
          <p className="subtle">
            IPO has not been launched for the selected sport. Once an admin launches IPO, players will appear here.
          </p>
        </section>
      ) : (
        <section ref={marketTablePanelRef} className="table-panel market-table-panel">
          <div className="table-wrap">
            <table className="market-table">
              <colgroup>
                <col className="market-col-player" />
                <col className="market-col-price" />
                <col className="market-col-change" />
                <col className="market-col-change-24h" />
                <col className="market-col-shares-held" />
                <col className="market-col-shares-short" />
                <col className="market-col-quick" />
                <col className="market-col-action" />
                <col className="market-col-qty" />
                <col className="market-col-quote" />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <button type="button" className="market-sort-btn" onClick={() => toggleSort("name")}>
                      Player{sortLabel("name")}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="market-sort-btn" onClick={() => toggleSort("spot_price")}>
                      Price{sortLabel("spot_price")}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="market-sort-btn" onClick={() => toggleSort("change_pct")}>
                      Total Gain{sortLabel("change_pct")}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="market-sort-btn" onClick={() => toggleSort("change_24h_pct")}>
                      24h Gain{sortLabel("change_24h_pct")}
                    </button>
                  </th>
                  <th>Shares Held</th>
                  <th>Shares Short</th>
                  <th>Quick Actions</th>
                  <th>Action</th>
                  <th>Qty</th>
                  <th>Quote</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const { player, sharesHeld, sharesShort, totalChangePct, change24hPct, buyRemaining, shortRemaining } = row;
                  const side = sideFor(player.id);
                  const quote = quoteById[player.id];

                  return (
                    <tr key={player.id}>
                      <td>
                        <div className="market-player-cell">
                          <Link href={`/player/${player.id}`} className="card-title">
                            {player.name}
                          </Link>
                          <span className="market-player-meta">
                            {player.team} {player.position}
                          </span>
                          {player.live?.live_now && <span className="market-live-chip">LIVE</span>}
                        </div>
                      </td>
                      <td>{formatCurrency(player.spot_price)}</td>
                      <td className={totalChangePct >= 0 ? "up" : "down"}>{formatSignedPercent(totalChangePct)}</td>
                      <td className={change24hPct >= 0 ? "up" : "down"}>{formatSignedPercent(change24hPct)}</td>
                      <td className="market-owned-cell">{formatNumber(Math.round(sharesHeld))}</td>
                      <td className="market-owned-cell">{formatNumber(Math.round(sharesShort))}</td>
                      <td>
                        <div className="market-row-actions">
                          <button
                            className="chip market-mini-btn market-quick-buy-btn"
                            onClick={() => void executeMaxTrade(player.id, "BUY", buyRemaining)}
                            disabled={buyRemaining <= 0 || previewingId === player.id || placingId === player.id}
                          >
                            Buy Max
                          </button>
                          <button
                            className="chip market-mini-btn market-quick-short-btn"
                            onClick={() => void executeMaxTrade(player.id, "SHORT", shortRemaining)}
                            disabled={shortRemaining <= 0 || previewingId === player.id || placingId === player.id}
                          >
                            Short Max
                          </button>
                        </div>
                      </td>
                      <td>
                        <select
                          className="market-side-select"
                          value={side}
                          onChange={(event) => setSide(player.id, event.target.value as TradeSide)}
                        >
                          <option value="BUY">BUY</option>
                          <option value="SELL">SELL</option>
                          <option value="SHORT">SHORT</option>
                          <option value="COVER">COVER</option>
                        </select>
                      </td>
                      <td className="market-qty-cell">
                        <input
                          className="market-qty-input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={4}
                          value={qtyById[player.id] ?? ""}
                          onChange={(event) => setQuantity(player.id, event.target.value)}
                          placeholder="qty"
                        />
                      </td>
                      <td className="market-quote-cell">
                        {quote ? (
                          <div className="market-quote-with-action">
                            <div className="market-quote-text">
                              <p className="market-quote-main">
                                {isCostSide(side) ? "Cost" : "Proceeds"}: {formatCurrency(quote.total)}
                              </p>
                              <p className="market-quote-sub">Avg {formatCurrency(quote.average_price, 3)}</p>
                            </div>
                            <button
                              className={
                                side === "SHORT" || side === "SELL"
                                  ? "primary-btn short-btn market-quote-action-btn"
                                  : "primary-btn market-quote-action-btn"
                              }
                              disabled={placingId === player.id}
                              onClick={() => void placeTrade(player.id)}
                            >
                              {placingId === player.id ? "Placing..." : "Execute"}
                            </button>
                          </div>
                        ) : (
                          <button
                            className="market-quote-action-btn market-quote-preview-btn"
                            onClick={() => void previewTrade(player.id)}
                            disabled={previewingId === player.id}
                          >
                            {previewingId === player.id ? "Quoting..." : "Preview"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
