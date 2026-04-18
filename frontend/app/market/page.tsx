"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarketTableRow, {
  DEFAULT_MARKET_ROW_HEIGHT,
  type MarketPriceFlashState,
  type MarketTableRowModel,
  type MarketTradeSide,
} from "@/components/market-table-row";
import EmptyStatePanel from "@/components/empty-state-panel";
import { apiGet, apiPost, isUnauthorizedError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { notifySuccess } from "@/lib/toast";
import { teamPrimaryColor } from "@/lib/teamColors";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { MarketMovers, Player, Portfolio, Quote, TradingStatus, UserAccount } from "@/lib/types";

type MarketSortColumn =
  | "name"
  | "team"
  | "position"
  | "spot_price"
  | "change_pct"
  | "change_24h_pct"
  | "earnings";
type SortDirection = "asc" | "desc";
type PriceSnapshot = {
  spot: number;
};
type VirtualWindow = {
  start: number;
  end: number;
  topSpacer: number;
  bottomSpacer: number;
};

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
  earnings: "desc",
};
const MARKET_SORT_STORAGE_PREFIX = "fsm_market_sort_v1";
const MARKET_SORT_COLUMN_SET = new Set<MarketSortColumn>([
  "name",
  "team",
  "position",
  "spot_price",
  "change_pct",
  "change_24h_pct",
  "earnings",
]);
const MARKET_PRICE_FLASH_MS = 1100;
const MARKET_FILTER_DEBOUNCE_MS = 180;
const MARKET_VIRTUALIZATION_THRESHOLD = 60;
const MARKET_VIRTUALIZATION_OVERSCAN = 8;
const MARKET_TABLE_COLUMN_COUNT = 8;
type MobileQuickActionState = {
  playerId: number;
  side: "BUY" | "SHORT";
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getSignedPercent(base: number, spot: number): number {
  if (!base) return 0;
  return ((spot - base) / base) * 100;
}

function formatSignedPercentCompact(value: number): string {
  if (!Number.isFinite(value)) return "0.0%";
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return `${rounded.toFixed(1)}%`;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatCompactPlayerName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstInitial = parts[0][0]?.toUpperCase() ?? "";
  const lastName = parts[parts.length - 1];
  return `${firstInitial}. ${lastName}`;
}

export default function MarketPage() {
  const router = useRouter();
  const marketShellRef = useRef<HTMLElement | null>(null);
  const marketTablePanelRef = useRef<HTMLElement | null>(null);
  const previousPriceSnapshotRef = useRef<Record<number, PriceSnapshot>>({});
  const flashTimeoutsRef = useRef<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<Player[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [change24hById, setChange24hById] = useState<Record<number, number>>({});
  const [change7dById, setChange7dById] = useState<Record<number, number>>({});
  const [priceFlashById, setPriceFlashById] = useState<Record<number, MarketPriceFlashState>>({});
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [activeSport, setActiveSport] = useState<SportFilter>("MLB");
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [sortColumn, setSortColumn] = useState<MarketSortColumn>("spot_price");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [hydratedSortKey, setHydratedSortKey] = useState("");
  const [tradingStatus, setTradingStatus] = useState<TradingStatus | null>(null);
  const [rowHeight, setRowHeight] = useState(DEFAULT_MARKET_ROW_HEIGHT);
  const [virtualWindow, setVirtualWindow] = useState<VirtualWindow>({
    start: 0,
    end: 0,
    topSpacer: 0,
    bottomSpacer: 0,
  });
  const [error, setError] = useState("");
  const [mobileQuickAction, setMobileQuickAction] = useState<MobileQuickActionState | null>(null);
  const [isCompactMobile, setIsCompactMobile] = useState(false);
  const [mobileTableExpanded, setMobileTableExpanded] = useState(false);

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

  const schedulePriceFlashes = useCallback((playersData: Player[]) => {
    const previous = previousPriceSnapshotRef.current;
    const nextSnapshot: Record<number, PriceSnapshot> = {};
    const nextFlashes: Record<number, MarketPriceFlashState> = {};

    for (const player of playersData) {
      const snapshot: PriceSnapshot = {
        spot: player.spot_price,
      };
      nextSnapshot[player.id] = snapshot;
      const previousSnapshot = previous[player.id];
      if (!previousSnapshot) continue;

      const rowFlash: MarketPriceFlashState = {};
      if (snapshot.spot !== previousSnapshot.spot) rowFlash.spot = snapshot.spot > previousSnapshot.spot ? "up" : "down";
      if (rowFlash.spot) nextFlashes[player.id] = rowFlash;
    }

    previousPriceSnapshotRef.current = nextSnapshot;
    if (!Object.keys(nextFlashes).length) return;

    setPriceFlashById((current) => ({ ...current, ...nextFlashes }));

    for (const [playerId, flashState] of Object.entries(nextFlashes)) {
      const numericPlayerId = Number(playerId);
      for (const field of ["spot"] as const) {
        if (!flashState[field]) continue;
        const timeoutKey = `${numericPlayerId}:${field}`;
        const existingTimeout = flashTimeoutsRef.current[timeoutKey];
        if (existingTimeout) window.clearTimeout(existingTimeout);
        flashTimeoutsRef.current[timeoutKey] = window.setTimeout(() => {
          setPriceFlashById((current) => {
            const currentRow = current[numericPlayerId];
            if (!currentRow?.[field]) return current;
            const nextRow: MarketPriceFlashState = { ...currentRow };
            delete nextRow[field];
            if (!nextRow.spot) {
              const nextState = { ...current };
              delete nextState[numericPlayerId];
              return nextState;
            }
            return { ...current, [numericPlayerId]: nextRow };
          });
          delete flashTimeoutsRef.current[timeoutKey];
        }, MARKET_PRICE_FLASH_MS);
      }
    }
  }, []);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      try {
        const [playersData, portfolioData, movers24hData, movers7dData, statusData] = await Promise.all([
          apiGet<Player[]>("/players"),
          apiGet<Portfolio>("/portfolio"),
          apiGet<MarketMovers>(`/market/movers?limit=100&window_hours=24&sport=${encodeURIComponent(activeSport)}`).catch(
            () => null,
          ),
          apiGet<MarketMovers>(`/market/movers?limit=100&window_hours=168&sport=${encodeURIComponent(activeSport)}`).catch(
            () => null,
          ),
          apiGet<TradingStatus>("/trading/status").catch(() => null),
        ]);
        schedulePriceFlashes(playersData);
        setPlayers(playersData);
        setPortfolio(portfolioData);
        const next24hById: Record<number, number> = {};
        if (movers24hData) {
          for (const row of [...movers24hData.gainers, ...movers24hData.losers]) {
            const existing = next24hById[row.player_id];
            if (existing === undefined || Math.abs(row.change_percent) > Math.abs(existing)) {
              next24hById[row.player_id] = row.change_percent;
            }
          }
        }
        const next7dById: Record<number, number> = {};
        if (movers7dData) {
          for (const row of [...movers7dData.gainers, ...movers7dData.losers]) {
            const existing = next7dById[row.player_id];
            if (existing === undefined || Math.abs(row.change_percent) > Math.abs(existing)) {
              next7dById[row.player_id] = row.change_percent;
            }
          }
        }
        setChange24hById(next24hById);
        setChange7dById(next7dById);
        setTradingStatus(statusData);
        setError("");
      } catch (err: unknown) {
        handleRequestError(err);
      } finally {
        setLoading(false);
      }
    },
    [activeSport, handleRequestError, schedulePriceFlashes],
  );

  useAdaptivePolling(
    () => load({ silent: true }),
    { activeMs: 30_000, hiddenMs: 120_000 },
  );

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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setQuery(queryInput.trim());
    }, MARKET_FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [queryInput]);

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(flashTimeoutsRef.current)) {
        window.clearTimeout(timeoutId);
      }
      flashTimeoutsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = "(max-width: 640px)";
    const media = window.matchMedia(query);
    const updateCompactState = (matches: boolean) => {
      setIsCompactMobile(matches);
      if (!matches) setMobileTableExpanded(false);
    };
    updateCompactState(media.matches);
    const listener = (event: MediaQueryListEvent) => updateCompactState(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

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
    if (sortColumn === "change_24h_pct") {
      setSortColumn("change_pct");
      setSortDirection("desc");
      return;
    }
    if (sortColumn === "team" || sortColumn === "position") {
      setSortColumn("name");
      setSortDirection("asc");
    }
  }, [sortColumn]);

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

  const visibleRows = useMemo<MarketTableRowModel[]>(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const normalizedQuery = query.toLowerCase();
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
        const seasonEarnings = player.points_to_date ?? 0;
        const totalChangePct = getSignedPercent(player.base_price, player.spot_price);
        const change24hPct = change24hById[player.id] ?? 0;
        const change7dPct = change7dById[player.id] ?? 0;
        const maxOpenSharesAtSpot = MAX_POSITION_NOTIONAL_PER_PLAYER / Math.max(0.0001, player.spot_price);
        const buyRemaining = owned < 0 ? 0 : Math.max(0, Math.floor(maxOpenSharesAtSpot - Math.max(0, owned)));
        const shortRemaining =
          owned > 0 ? 0 : Math.max(0, Math.floor(maxOpenSharesAtSpot - Math.max(0, Math.abs(owned))));
        return {
          player,
          sharesHeld,
          sharesShort,
          seasonEarnings,
          totalChangePct,
          change24hPct,
          change7dPct,
          buyRemaining,
          shortRemaining,
        };
      });

    filteredRows.sort((a, b) => {
      if (sortColumn === "name") return direction * a.player.name.localeCompare(b.player.name);
      if (sortColumn === "team") return direction * a.player.team.localeCompare(b.player.team);
      if (sortColumn === "position") return direction * a.player.position.localeCompare(b.player.position);
      if (sortColumn === "spot_price") return direction * (a.player.spot_price - b.player.spot_price);
      if (sortColumn === "change_pct") return direction * (a.totalChangePct - b.totalChangePct);
      if (sortColumn === "change_24h_pct") return direction * (a.change24hPct - b.change24hPct);
      if (sortColumn === "earnings") return direction * (a.seasonEarnings - b.seasonEarnings);
      return 0;
    });

    return filteredRows;
  }, [activeSport, change24hById, change7dById, ownedById, players, positionFilter, query, sortColumn, sortDirection]);

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
  }, [activeSport, players.length, positionFilter, query, visibleRows.length]);

  useEffect(() => {
    if (visibleRows.length === 0) {
      setVirtualWindow({ start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 });
      return;
    }

    if (visibleRows.length <= MARKET_VIRTUALIZATION_THRESHOLD) {
      setVirtualWindow({
        start: 0,
        end: visibleRows.length,
        topSpacer: 0,
        bottomSpacer: 0,
      });
      return;
    }

    const updateVirtualWindow = () => {
      const panel = marketTablePanelRef.current;
      if (!panel) return;

      const rect = panel.getBoundingClientRect();
      const panelTop = window.scrollY + rect.top;
      const visibleTop = window.scrollY - panelTop;
      const visibleBottom = visibleTop + window.innerHeight;
      const start = clamp(Math.floor(visibleTop / rowHeight) - MARKET_VIRTUALIZATION_OVERSCAN, 0, visibleRows.length - 1);
      const end = clamp(
        Math.ceil(visibleBottom / rowHeight) + MARKET_VIRTUALIZATION_OVERSCAN,
        start + 1,
        visibleRows.length,
      );
      setVirtualWindow({
        start,
        end,
        topSpacer: start * rowHeight,
        bottomSpacer: Math.max(0, (visibleRows.length - end) * rowHeight),
      });
    };

    updateVirtualWindow();
    window.addEventListener("scroll", updateVirtualWindow, { passive: true });
    window.addEventListener("resize", updateVirtualWindow);
    return () => {
      window.removeEventListener("scroll", updateVirtualWindow);
      window.removeEventListener("resize", updateVirtualWindow);
    };
  }, [rowHeight, visibleRows.length]);

  const activeSportHalt = useMemo(() => {
    if (!tradingStatus) return null;
    const globalHalt = tradingStatus.global_halt;
    if (globalHalt?.halted) return globalHalt;
    return tradingStatus.sport_halts.find((entry) => entry.sport === activeSport && entry.halted) ?? null;
  }, [activeSport, tradingStatus]);

  const activeSportTradingHalted = Boolean(activeSportHalt?.halted);
  const activeSportHaltMessage = activeSportHalt
    ? activeSportHalt.reason
      ? `Trading paused for ${activeSport}. ${activeSportHalt.reason}`
      : `Trading paused for ${activeSport}.`
    : "";

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

  const handleMeasureRow = useCallback((nextHeight: number) => {
    if (!nextHeight || Math.abs(nextHeight - rowHeight) < 2) return;
    setRowHeight(nextHeight);
  }, [rowHeight]);

  const requestQuote = useCallback(
    async (playerId: number, side: MarketTradeSide, shares: number) => {
      try {
        return await apiPost<Quote>(`/quote/${side.toLowerCase()}`, {
          player_id: playerId,
          shares,
        });
      } catch (err: unknown) {
        handleRequestError(err);
        throw err;
      }
    },
    [handleRequestError],
  );

  const executeTrade = useCallback(
    async (playerId: number, side: MarketTradeSide, shares: number) => {
      try {
        await apiPost(`/trade/${side.toLowerCase()}`, {
          player_id: playerId,
          shares,
        });
        await load({ silent: true });
        notifySuccess(`${side} executed.`);
      } catch (err: unknown) {
        handleRequestError(err);
        throw err;
      }
    },
    [handleRequestError, load],
  );

  const renderSortButton = useCallback(
    (column: MarketSortColumn, label: string) => {
      const active = sortColumn === column;
      return (
        <button
          type="button"
          className={`market-sort-btn${active ? " active" : ""}`}
          onClick={() => toggleSort(column)}
          aria-pressed={active}
        >
          <span className="market-sort-label">{label}</span>
        </button>
      );
    },
    [sortColumn, toggleSort],
  );

  const cashBalance = portfolio?.cash_balance ?? 0;
  const holdingsValue = useMemo(
    () => (portfolio?.holdings ?? []).reduce((sum, holding) => sum + Number(holding.market_value || 0), 0),
    [portfolio],
  );
  const equity = portfolio?.equity ?? cashBalance + holdingsValue;

  const virtualizationEnabled = visibleRows.length > MARKET_VIRTUALIZATION_THRESHOLD;
  const visibleStart = virtualizationEnabled ? virtualWindow.start : 0;
  const renderedRows = virtualizationEnabled ? visibleRows.slice(virtualWindow.start, virtualWindow.end) : visibleRows;

  async function executeMobileMaxTrade(row: MarketTableRowModel, side: "BUY" | "SHORT", maxShares: number) {
    if (activeSportTradingHalted || maxShares <= 0 || mobileQuickAction) return;
    setMobileQuickAction({ playerId: row.player.id, side });
    setError("");
    try {
      const nextQuote = await requestQuote(row.player.id, side, maxShares);
      await executeTrade(row.player.id, side, nextQuote.shares);
    } catch {
      // Parent handlers already surface the error.
    } finally {
      setMobileQuickAction((current) =>
        current && current.playerId === row.player.id && current.side === side ? null : current,
      );
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

      {activeSportTradingHalted && <p className="error-box" role="status">{activeSportHaltMessage}</p>}

      <section className="toolbar market-toolbar-controls">
        <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}>
          {positions.map((position) => (
            <option key={position} value={position}>
              {position === "ALL" ? "All positions" : position}
            </option>
          ))}
        </select>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {error && <p className="error-box" role="alert">{error}</p>}

      <section className="toolbar market-table-search">
        <input
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="Search player or team"
          aria-label="Search players"
        />
      </section>

      {loading ? (
        <section className="table-panel" aria-busy="true">
          <div className="skeleton-stack">
            <div className="skeleton-line lg" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        </section>
      ) : visibleRows.length === 0 ? (
        <EmptyStatePanel
          kind="market"
          title="No players are listed yet"
          description="IPO has not been launched for this sport yet. Once listed, players will appear here automatically."
          actionHref="/community"
          actionLabel="Open Community"
        />
      ) : (
        <>
          <section
            className={`table-panel market-table-panel market-mobile-list${
              mobileTableExpanded ? " market-mobile-list-expanded" : ""
            }`}
          >
            {isCompactMobile && (
              <div className="market-mobile-density-toggle">
                <button
                  type="button"
                  className="chip"
                  onClick={() => setMobileTableExpanded((current) => !current)}
                  aria-pressed={mobileTableExpanded}
                >
                  {mobileTableExpanded ? "Show compact view" : "Expand table"}
                </button>
              </div>
            )}
            <div className="table-wrap">
              <table className="market-mobile-table" aria-label="Mobile market table">
                <colgroup>
                  <col className="market-mobile-col-player" />
                  <col className="market-mobile-col-price" />
                  {(!isCompactMobile || mobileTableExpanded) && (
                    <>
                      <col className="market-mobile-col-delta" />
                      <col className="market-mobile-col-earnings" />
                    </>
                  )}
                  <col className="market-mobile-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="market-mobile-player-head market-sticky-player-cell market-header-corner">
                      {renderSortButton("name", "Player")}
                    </th>
                    <th>{renderSortButton("spot_price", "Price")}</th>
                    {(!isCompactMobile || mobileTableExpanded) && (
                      <>
                        <th>{renderSortButton("change_pct", "Δ")}</th>
                        <th>{renderSortButton("earnings", "Earnings")}</th>
                      </>
                    )}
                    <th className="market-header-single">Quick Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const quickActionBusy = Boolean(mobileQuickAction);
                    const teamCode = row.player.team.trim().toUpperCase() || "--";
                    const teamColor = teamPrimaryColor(row.player.team, row.player.sport);
                    const teamTextStyle = {
                      color: teamColor,
                    };
                    return (
                      <tr key={row.player.id} className="market-mobile-table-row">
                        <td className="market-sticky-player-cell">
                          <div className="market-mobile-player-cell">
                            <div className="market-mobile-player-line">
                              <span className="market-mobile-player-name card-title">
                                {isCompactMobile && !mobileTableExpanded
                                  ? formatCompactPlayerName(row.player.name)
                                  : row.player.name}
                              </span>
                              <span className="market-mobile-team-text" style={teamTextStyle}>
                                {teamCode}
                              </span>
                            </div>
                            <span className="market-player-meta">
                              {row.player.team} {row.player.position}
                            </span>
                            {row.player.live?.live_now && <span className="market-live-chip">LIVE</span>}
                          </div>
                        </td>
                        <td className="market-cell-numeric">{formatCurrency(row.player.spot_price)}</td>
                        {(!isCompactMobile || mobileTableExpanded) && (
                          <>
                            <td className={`market-cell-numeric ${row.totalChangePct >= 0 ? "up" : "down"}`}>
                              {formatSignedPercentCompact(row.totalChangePct)}
                            </td>
                            <td className="market-cell-numeric">{formatCurrency(row.seasonEarnings)}</td>
                          </>
                        )}
                        <td className="market-cell-control market-mobile-actions-cell">
                          <div className="market-mobile-quick-action-stack">
                            <button
                              type="button"
                              className="market-mobile-max-btn market-quick-buy-btn"
                              onClick={() => void executeMobileMaxTrade(row, "BUY", row.buyRemaining)}
                              disabled={activeSportTradingHalted || row.buyRemaining <= 0 || quickActionBusy}
                              aria-label={`Buy max ${row.buyRemaining} shares of ${row.player.name}`}
                            >
                              Buy
                            </button>
                            <button
                              type="button"
                              className="market-mobile-max-btn market-quick-short-btn"
                              onClick={() => void executeMobileMaxTrade(row, "SHORT", row.shortRemaining)}
                              disabled={activeSportTradingHalted || row.shortRemaining <= 0 || quickActionBusy}
                              aria-label={`Short max ${row.shortRemaining} shares of ${row.player.name}`}
                            >
                              Short
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section ref={marketTablePanelRef} className="table-panel market-table-panel desktop-market-table">
            <div className="table-wrap">
              <table className="market-table">
                <colgroup>
                  <col className="market-col-player" />
                  <col className="market-col-price" />
                  <col className="market-col-earnings" />
                  <col className="market-col-change" />
                  <col className="market-col-quick" />
                  <col className="market-col-action" />
                  <col className="market-col-qty" />
                  <col className="market-col-quote" />
                </colgroup>
                <thead>
                  <tr className="market-header-detail-row">
                    <th className="market-sticky-player-cell market-header-corner">
                      {renderSortButton("name", "Player")}
                    </th>
                    <th>{renderSortButton("spot_price", "Price")}</th>
                    <th>{renderSortButton("earnings", "Earnings")}</th>
                    <th>{renderSortButton("change_pct", "Σ Δ")}</th>
                    <th className="market-header-single">Quick Actions</th>
                    <th className="market-header-single">Action</th>
                    <th className="market-header-single">Qty</th>
                    <th className="market-header-single">Quote</th>
                  </tr>
                </thead>
                <tbody>
                  {virtualizationEnabled && virtualWindow.topSpacer > 0 && (
                    <tr className="market-spacer-row" aria-hidden="true">
                      <td colSpan={MARKET_TABLE_COLUMN_COUNT} style={{ height: `${virtualWindow.topSpacer}px` }} />
                    </tr>
                  )}
                  {renderedRows.map((row, index) => (
                    <MarketTableRow
                      key={row.player.id}
                      row={row}
                      isTradingHalted={activeSportTradingHalted}
                      earningsAfterPrice
                      hideChange24hColumn
                      priceFlash={priceFlashById[row.player.id]}
                      measureRow={index === 0}
                      onMeasureRow={handleMeasureRow}
                      onSetError={setError}
                      onPreviewQuote={requestQuote}
                      onExecuteTrade={executeTrade}
                    />
                  ))}
                  {virtualizationEnabled && virtualWindow.bottomSpacer > 0 && (
                    <tr className="market-spacer-row" aria-hidden="true">
                      <td colSpan={MARKET_TABLE_COLUMN_COUNT} style={{ height: `${virtualWindow.bottomSpacer}px` }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {virtualizationEnabled && (
              <p className="subtle market-table-status">
                Showing rows {visibleStart + 1}-{visibleStart + renderedRows.length} of {visibleRows.length}
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
