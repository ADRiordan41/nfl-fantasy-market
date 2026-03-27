"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import MarketTableRow, {
  type MarketTableRowModel,
  type MarketTradeSide,
} from "@/components/market-table-row";
import { apiGet, apiPost, isUnauthorizedError } from "@/lib/api";
import EmptyStatePanel from "@/components/empty-state-panel";
import { formatCurrency, formatNumber, formatPercent, formatSignedCurrency, formatSignedPercent } from "@/lib/format";
import { teamPrimaryColor } from "@/lib/teamColors";
import { notifySuccess } from "@/lib/toast";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { AdminAuditTrade, MarketMovers, Player, Portfolio, Quote, TradingHaltState, TradingStatus, UserAccount } from "@/lib/types";

type MarketSortColumn = "name" | "spot_price" | "avg_purchase" | "total_gain" | "earnings";
type SortDirection = "asc" | "desc";

type PortfolioTradeSide = "SELL" | "COVER";

type HoldingRow = {
  id: number;
  name: string;
  sport: string;
  team: string;
  position: string;
  shares: number;
  earnings: number;
  averageEntryPrice: number;
  spot: number;
  basisNotional: number;
  marketValue: number;
  pnl: number;
  pnlPct: number;
  allocationPct: number;
};

type PortfolioMarketRow = {
  market: MarketTableRowModel;
  averageEntryPrice: number;
  totalGain: number;
  totalGainPct: number;
};

type SportGroup = {
  sport: string;
  rows: HoldingRow[];
  netValue: number;
  grossValue: number;
  allocationPct: number;
};

type AccountMixSlice = {
  key: string;
  label: string;
  color: string;
  value: number;
  gainLossPct: number | null;
};

type AccountMixSegment = AccountMixSlice & {
  pct: number;
  startAngle: number;
  endAngle: number;
};

const SPORT_DISPLAY_ORDER = ["MLB", "NFL", "NBA", "NHL"] as const;
const MAX_ACCOUNT_MIX_HOLDINGS = 8;
const MAX_POSITION_NOTIONAL_PER_PLAYER = 10000;
const SORT_DEFAULT_DIRECTION: Record<MarketSortColumn, SortDirection> = {
  name: "asc",
  spot_price: "desc",
  avg_purchase: "desc",
  total_gain: "desc",
  earnings: "desc",
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatStamp(value: string | null): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function parseWholeShares(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

function getSignedPercent(base: number, spot: number): number {
  if (!base) return 0;
  return ((spot - base) / base) * 100;
}

function sideForRow(row: HoldingRow): PortfolioTradeSide {
  return row.shares < 0 ? "COVER" : "SELL";
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

function describeDonutSegment(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  if (endAngle <= startAngle) return "";
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

export default function PortfolioPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<AdminAuditTrade[]>([]);
  const [playersById, setPlayersById] = useState<Record<number, Player>>({});
  const [change24hById, setChange24hById] = useState<Record<number, number>>({});
  const [sortColumn, setSortColumn] = useState<MarketSortColumn>("spot_price");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [qtyById, setQtyById] = useState<Record<number, string>>({});
  const [quoteById, setQuoteById] = useState<Record<number, Quote | null>>({});
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [placingId, setPlacingId] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [tradingStatus, setTradingStatus] = useState<TradingStatus | null>(null);
  const [activeAccountMixSliceKey, setActiveAccountMixSliceKey] = useState<string | null>(null);
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

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const [portfolioData, transactions, players, me, statusData, movers24hData] = await Promise.all([
        apiGet<Portfolio>("/portfolio"),
        apiGet<AdminAuditTrade[]>("/transactions/me?limit=50"),
        apiGet<Player[]>("/players"),
        apiGet<UserAccount>("/auth/me"),
        apiGet<TradingStatus>("/trading/status").catch(() => null),
        apiGet<MarketMovers>("/market/movers?limit=100&window_hours=24").catch(() => null),
      ]);
      const next24hById: Record<number, number> = {};
      if (movers24hData) {
        for (const row of [...movers24hData.gainers, ...movers24hData.losers]) {
          const existing = next24hById[row.player_id];
          if (existing === undefined || Math.abs(row.change_percent) > Math.abs(existing)) {
            next24hById[row.player_id] = row.change_percent;
          }
        }
      }
      setRecentTransactions(transactions);
      setPortfolio(portfolioData);
      setPlayersById(Object.fromEntries(players.map((player) => [player.id, player])));
      setChange24hById(next24hById);
      setCurrentUser(me);
      setTradingStatus(statusData);
      setLastUpdated(new Date().toISOString());
      setError("");
    } catch (err: unknown) {
      handleRequestError(err);
    } finally {
      setLoading(false);
    }
  }, [handleRequestError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useAdaptivePolling(
    () => load({ silent: true }),
    { activeMs: 20_000, hiddenMs: 90_000, runImmediately: false },
  );

  const rows = useMemo<HoldingRow[]>(() => {
    if (!portfolio) return [];

    return portfolio.holdings
      .map((holding) => {
        const player = playersById[holding.player_id];
        if (!player) return null;
        const shares = Number(holding.shares_owned);
        const basisNotional = Number(holding.basis_amount);
        const averageEntryPriceRaw = Number(holding.average_entry_price);
        const averageEntryPrice =
          Number.isFinite(averageEntryPriceRaw) && averageEntryPriceRaw > 0
            ? averageEntryPriceRaw
            : Math.abs(shares) > 0 && Number.isFinite(basisNotional) && basisNotional > 0
              ? basisNotional / Math.abs(shares)
              : Number.NaN;
        const spot = Number(holding.spot_price || player.spot_price);
        const marketValue = Number(holding.market_value);
        const pnl = Number(holding.unrealized_pnl);
        const normalizedPnl = Math.abs(pnl) < 0.005 ? 0 : pnl;
        const pnlPct = Number(holding.unrealized_pnl_pct);
        return {
          id: player.id,
          name: player.name,
          sport: player.sport,
          team: player.team,
          position: player.position,
          shares,
          earnings: Number(player.points_to_date ?? 0),
          averageEntryPrice,
          spot,
          basisNotional,
          marketValue,
          pnl: normalizedPnl,
          pnlPct,
          allocationPct: 0,
        };
      })
      .filter((row): row is HoldingRow => row !== null)
      .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
  }, [playersById, portfolio]);

  const computedNetExposure = useMemo(
    () => rows.reduce((sum, row) => sum + row.marketValue, 0),
    [rows],
  );

  const computedGrossExposure = useMemo(
    () => rows.reduce((sum, row) => sum + Math.abs(row.marketValue), 0),
    [rows],
  );

  const basisNotional = useMemo(
    () => rows.reduce((sum, row) => sum + row.basisNotional, 0),
    [rows],
  );

  const rowsWithAllocation = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        allocationPct: computedGrossExposure > 0 ? (Math.abs(row.marketValue) / computedGrossExposure) * 100 : 0,
      })),
    [computedGrossExposure, rows],
  );
  const sportGroups = useMemo<SportGroup[]>(() => {
    const groups = new Map<string, HoldingRow[]>();
    for (const row of rowsWithAllocation) {
      const existing = groups.get(row.sport);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(row.sport, [row]);
      }
    }

    const orderIndex = new Map<string, number>(SPORT_DISPLAY_ORDER.map((sport, index) => [sport, index]));
    return Array.from(groups.entries())
      .map(([sport, sportRows]) => {
        const netValue = sportRows.reduce((sum, row) => sum + row.marketValue, 0);
        const grossValue = sportRows.reduce((sum, row) => sum + Math.abs(row.marketValue), 0);
        return {
          sport,
          rows: sportRows,
          netValue,
          grossValue,
          allocationPct: computedGrossExposure > 0 ? (grossValue / computedGrossExposure) * 100 : 0,
        };
      })
      .sort((a, b) => {
        const aIndex = orderIndex.has(a.sport) ? (orderIndex.get(a.sport) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const bIndex = orderIndex.has(b.sport) ? (orderIndex.get(b.sport) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.sport.localeCompare(b.sport);
      });
  }, [computedGrossExposure, rowsWithAllocation]);

  const marketRows = useMemo<PortfolioMarketRow[]>(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const nextRows: PortfolioMarketRow[] = [];
    for (const row of rowsWithAllocation) {
      const player = playersById[row.id];
      if (!player) continue;
      const owned = Number(row.shares);
      const maxOpenSharesAtSpot = MAX_POSITION_NOTIONAL_PER_PLAYER / Math.max(0.0001, Number(player.spot_price));
      const buyRemaining = owned < 0 ? 0 : Math.max(0, Math.floor(maxOpenSharesAtSpot - Math.max(0, owned)));
      const shortRemaining =
        owned > 0 ? 0 : Math.max(0, Math.floor(maxOpenSharesAtSpot - Math.max(0, Math.abs(owned))));
      nextRows.push({
        market: {
          player: {
            id: player.id,
            name: player.name,
            team: player.team,
            position: player.position,
            sport: player.sport,
            spot_price: Number(player.spot_price),
            live: player.live ? { live_now: Boolean(player.live.live_now) } : null,
          },
          sharesHeld: Number(player.shares_held ?? 0),
          sharesShort: Number(player.shares_short ?? 0),
          seasonEarnings: Number(player.points_to_date ?? 0),
          totalChangePct: getSignedPercent(Number(player.base_price), Number(player.spot_price)),
          change24hPct: Number(change24hById[player.id] ?? 0),
          change7dPct: 0,
          buyRemaining,
          shortRemaining,
        },
        averageEntryPrice: Number(row.averageEntryPrice),
        totalGain: Number(row.pnl),
        totalGainPct: Number(row.pnlPct),
      });
    }

    nextRows.sort((a, b) => {
      if (sortColumn === "name") return direction * a.market.player.name.localeCompare(b.market.player.name);
      if (sortColumn === "spot_price") return direction * (a.market.player.spot_price - b.market.player.spot_price);
      if (sortColumn === "avg_purchase") return direction * (a.averageEntryPrice - b.averageEntryPrice);
      if (sortColumn === "total_gain") return direction * (a.totalGain - b.totalGain);
      if (sortColumn === "earnings") return direction * (a.market.seasonEarnings - b.market.seasonEarnings);
      return 0;
    });
    return nextRows;
  }, [change24hById, playersById, rowsWithAllocation, sortColumn, sortDirection]);

  const cash = portfolio?.cash_balance ?? 0;
  const holdings = portfolio?.net_exposure ?? computedNetExposure;
  const totalAccount = portfolio?.equity ?? cash + holdings;
  const pnl = rows.reduce((sum, row) => sum + row.pnl, 0);
  const pnlPct = basisNotional > 0 ? (pnl / basisNotional) * 100 : 0;
  const pieSlices = useMemo<AccountMixSlice[]>(() => {
    const cashValue = Math.max(0, cash);
    const holdingSlices = rowsWithAllocation
      .map((row) => ({
        key: `player-${row.id}`,
        label: `${row.shares < 0 ? "Short " : ""}${row.name} (${row.team})`,
        color: teamPrimaryColor(row.team, row.sport),
        value: Math.max(0, row.marketValue),
        gainLossPct: Number.isFinite(row.pnlPct) ? row.pnlPct : null,
      }))
      .filter((slice) => slice.value > 0)
      .sort((a, b) => b.value - a.value);

    const topHoldings = holdingSlices.slice(0, MAX_ACCOUNT_MIX_HOLDINGS);
    const otherValue = holdingSlices
      .slice(MAX_ACCOUNT_MIX_HOLDINGS)
      .reduce((sum, slice) => sum + slice.value, 0);

    const slices: AccountMixSlice[] = [];
    if (cashValue > 0 || (topHoldings.length === 0 && otherValue <= 0)) {
      slices.push({
        key: "cash",
        label: "Cash",
        color: "#15784d",
        value: cashValue,
        gainLossPct: null,
      });
    }
    slices.push(...topHoldings);
    if (otherValue > 0) {
      slices.push({
        key: "other",
        label: "Other Holdings",
        color: "#8ea5bf",
        value: otherValue,
        gainLossPct: null,
      });
    }
    return slices;
  }, [cash, rowsWithAllocation]);

  const pieTotal = useMemo(
    () => pieSlices.reduce((sum, slice) => sum + slice.value, 0),
    [pieSlices],
  );
  const globalHalt = tradingStatus?.global_halt?.halted ? tradingStatus.global_halt : null;
  const haltBySport = useMemo(() => {
    const map = new Map<string, TradingHaltState>();
    for (const entry of tradingStatus?.sport_halts ?? []) {
      if (entry.halted) map.set(entry.sport, entry);
    }
    return map;
  }, [tradingStatus]);
  const pieSegments = useMemo<AccountMixSegment[]>(() => {
    if (pieTotal <= 0) return [];
    const sliceGapDeg = pieSlices.length > 1 ? 1.3 : 0;
    let cursor = -90;
    return pieSlices
      .map((slice) => {
        const sweep = (slice.value / pieTotal) * 360;
        const adjustedGap = Math.min(sliceGapDeg, sweep * 0.45);
        const startAngle = cursor + adjustedGap / 2;
        const endAngle = cursor + sweep - adjustedGap / 2;
        cursor += sweep;
        return {
          ...slice,
          pct: (slice.value / pieTotal) * 100,
          startAngle,
          endAngle,
        };
      })
      .filter((slice) => slice.endAngle - slice.startAngle > 0.05);
  }, [pieSlices, pieTotal]);
  const activeAccountMixSlice = useMemo(() => {
    if (!pieSegments.length) return null;
    if (!activeAccountMixSliceKey) return pieSegments[0];
    return pieSegments.find((slice) => slice.key === activeAccountMixSliceKey) ?? pieSegments[0];
  }, [activeAccountMixSliceKey, pieSegments]);

  function haltedForSport(sport: string): TradingHaltState | null {
    if (globalHalt) return globalHalt;
    return haltBySport.get(sport) ?? null;
  }

  function maxTradableShares(row: HoldingRow): number {
    return Math.max(0, Math.abs(Math.trunc(row.shares)));
  }
  function haltedForRow(row: HoldingRow): TradingHaltState | null {
    return haltedForSport(row.sport);
  }

  function clearQuote(playerId: number) {
    setQuoteById((prev) => ({ ...prev, [playerId]: null }));
  }

  function setQuantity(playerId: number, value: string) {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 4);
    setQtyById((prev) => ({ ...prev, [playerId]: digitsOnly }));
    clearQuote(playerId);
  }

  function setMaxQuantity(row: HoldingRow) {
    if (haltedForRow(row)) return;
    setQuantity(row.id, String(maxTradableShares(row)));
  }

  function toggleSort(column: MarketSortColumn) {
    if (sortColumn === column) {
      setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection(SORT_DEFAULT_DIRECTION[column]);
  }

  function renderSortButton(column: MarketSortColumn, label: string) {
    const active = sortColumn === column;
    const indicator = active ? sortDirection : "both";
    return (
      <button
        type="button"
        className={`market-sort-btn${active ? " active" : ""}`}
        onClick={() => toggleSort(column)}
        aria-pressed={active}
      >
        <span className="market-sort-label">{label}</span>
        <span className={`market-sort-indicator ${indicator}`} aria-hidden="true" />
      </button>
    );
  }

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

  async function previewTrade(row: HoldingRow) {
    const halt = haltedForRow(row);
    if (halt) return;
    const side = sideForRow(row);
    const maxShares = maxTradableShares(row);
    if (maxShares <= 0) {
      setError("No shares available for this action.");
      return;
    }

    const shares = parseWholeShares(qtyById[row.id] ?? "");
    if (!shares) {
      setError("Enter whole shares (1 or more) before previewing.");
      return;
    }
    if (shares > maxShares) {
      setError(`${side === "SELL" ? "Sell" : "Cover"} size cannot exceed ${formatNumber(maxShares)} shares.`);
      return;
    }

    setPreviewingId(row.id);
    setError("");
    try {
      const quote = await apiPost<Quote>(`/quote/${side.toLowerCase()}`, {
        player_id: row.id,
        shares,
      });
      setQuoteById((prev) => ({ ...prev, [row.id]: quote }));
    } catch (err: unknown) {
      handleRequestError(err);
    } finally {
      setPreviewingId(null);
    }
  }

  async function placeTrade(row: HoldingRow) {
    const halt = haltedForRow(row);
    if (halt) return;
    const side = sideForRow(row);
    const quote = quoteById[row.id];
    if (!quote) {
      setError("Preview a quote first.");
      return;
    }

    setPlacingId(row.id);
    setError("");
    try {
      await apiPost(`/trade/${side.toLowerCase()}`, {
        player_id: row.id,
        shares: quote.shares,
      });
      setQtyById((prev) => ({ ...prev, [row.id]: "" }));
      setQuoteById((prev) => ({ ...prev, [row.id]: null }));
      await load({ silent: true });
      notifySuccess(`${side} executed.`);
    } catch (err: unknown) {
      handleRequestError(err);
    } finally {
      setPlacingId(null);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>Performance Board</h1>
          <p className="subtle">Monitor market value, allocation, and unrealized return by position.</p>
          <p className="subtle">Last updated {formatStamp(lastUpdated)}</p>
          {currentUser && (
            <p className="portfolio-user-meta">
              Username: <strong>{currentUser.username}</strong> | User ID: <strong>{currentUser.id}</strong>
              {currentUser.is_admin && (
                <span className="portfolio-admin-badge" aria-label="Admin account">
                  Admin
                </span>
              )}
            </p>
          )}
        </div>
      </section>

      {error && <p className="error-box" role="alert">{error}</p>}

      {globalHalt && (
        <p className="error-box" role="status">
          Trading paused across all sports.{globalHalt.reason ? ` ${globalHalt.reason}` : ""}
        </p>
      )}

      {!portfolio || loading ? (
        <section className="table-panel" aria-busy="true">
          <div className="skeleton-stack">
            <div className="skeleton-line lg" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        </section>
      ) : (
        <>
          <section className="metrics-grid portfolio-kpi-grid">
            <article className="kpi-card">
              <span>Cash</span>
              <strong>{formatCurrency(cash)}</strong>
            </article>
            <article className="kpi-card">
              <span>Holdings</span>
              <strong>{formatCurrency(holdings)}</strong>
            </article>
            <article className="kpi-card">
              <span>Total Account</span>
              <strong>{formatCurrency(totalAccount)}</strong>
            </article>
            <article className="kpi-card">
              <span>Unrealized P/L</span>
              <strong className={pnl >= 0 ? "up" : "down"}>
                {formatSignedCurrency(pnl)} ({formatPercent(pnlPct)})
              </strong>
            </article>
          </section>

          <section className="table-panel account-mix-panel">
            <div className="account-mix-layout">
              <div
                className="account-mix-chart-wrap"
                onMouseLeave={() => setActiveAccountMixSliceKey(null)}
              >
                <svg
                  className="account-mix-donut"
                  viewBox="0 0 200 200"
                  role="img"
                  aria-label="Donut chart showing account mix composition"
                >
                  <circle className="account-mix-donut-track" cx="100" cy="100" r="76" />
                  {pieSegments.map((slice) => {
                    const path = describeDonutSegment(100, 100, 47, 76, slice.startAngle, slice.endAngle);
                    const isActive = activeAccountMixSlice?.key === slice.key;
                    const isMuted = Boolean(activeAccountMixSlice) && !isActive;
                    return (
                      <path
                        key={slice.key}
                        d={path}
                        fill={slice.color}
                        className={`account-mix-segment${isActive ? " active" : ""}${isMuted ? " muted" : ""}`}
                        tabIndex={0}
                        onMouseEnter={() => setActiveAccountMixSliceKey(slice.key)}
                        onFocus={() => setActiveAccountMixSliceKey(slice.key)}
                        aria-label={`${slice.label}: ${formatCurrency(slice.value)} (${formatPercent(slice.pct, 1)} allocation)${
                          slice.gainLossPct == null ? "" : `, ${formatSignedPercent(slice.gainLossPct, 2)} gain/loss`
                        }`}
                      />
                    );
                  })}
                </svg>
                {activeAccountMixSlice && (
                  <div className="account-mix-tooltip" role="status">
                    <strong>{activeAccountMixSlice.label}</strong>
                    <span>
                      {formatCurrency(activeAccountMixSlice.value)} ({formatPercent(activeAccountMixSlice.pct, 1)})
                    </span>
                  </div>
                )}
                <div className="account-mix-center">
                  <span>{activeAccountMixSlice ? activeAccountMixSlice.label : "Total Account"}</span>
                  <strong>{formatCurrency(activeAccountMixSlice ? activeAccountMixSlice.value : totalAccount)}</strong>
                  <span>
                    {activeAccountMixSlice
                      ? `${formatPercent(activeAccountMixSlice.pct, 1)} allocation`
                      : "Hover slices for details"}
                  </span>
                </div>
              </div>

              <div
                className="account-mix-legend"
                onMouseLeave={() => setActiveAccountMixSliceKey(null)}
              >
                <p className="subtle account-mix-caption">
                  Top {MAX_ACCOUNT_MIX_HOLDINGS} holdings, cash, and grouped remainder.
                </p>
                {pieSegments.map((slice) => {
                  const isActive = activeAccountMixSlice?.key === slice.key;
                  const isMuted = Boolean(activeAccountMixSlice) && !isActive;
                  return (
                    <div
                      className={`account-mix-row${isActive ? " active" : ""}${isMuted ? " muted" : ""}`}
                      key={slice.key}
                      tabIndex={0}
                      onMouseEnter={() => setActiveAccountMixSliceKey(slice.key)}
                      onFocus={() => setActiveAccountMixSliceKey(slice.key)}
                      aria-label={`${slice.label}: ${formatCurrency(slice.value)} (${formatPercent(slice.pct, 1)} allocation)${
                        slice.gainLossPct == null ? "" : `, ${formatSignedPercent(slice.gainLossPct, 2)} gain/loss`
                      }`}
                    >
                      <span className="account-mix-label">
                        <span className="account-mix-swatch" style={{ background: slice.color }} />
                        <span className="account-mix-name" title={slice.label}>
                          {slice.label}
                        </span>
                      </span>
                      <strong>{formatCurrency(slice.value)}</strong>
                      <span>{formatPercent(slice.pct, 1)}</span>
                      <span className={slice.gainLossPct == null ? "account-mix-gl" : `account-mix-gl ${slice.gainLossPct >= 0 ? "up" : "down"}`}>
                        {slice.gainLossPct == null ? "--" : formatSignedPercent(slice.gainLossPct, 2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {rowsWithAllocation.length === 0 ? (
            <EmptyStatePanel
              kind="portfolio"
              title="No positions yet"
              description="Place your first trade in the market to start tracking gains, allocation, and exposure."
              actionHref="/market"
              actionLabel="Browse Market"
            />
          ) : (
            <>
              <section className="mobile-holdings">
                {sportGroups.map((group) => (
                  <section key={group.sport} className="portfolio-sport-group">
                    <div className="portfolio-sport-group-head">
                      <h3>{group.sport}</h3>
                      <p className="subtle portfolio-sport-summary">
                        {formatNumber(group.rows.length)} positions | Net {formatCurrency(group.netValue)} | {formatPercent(group.allocationPct, 1)} allocation
                      </p>
                    </div>

                    <div className="portfolio-sport-group-list">
                      {group.rows.map((row) => (
                        <article key={row.id} className="holding-card">
                          <div className="holding-head">
                            <Link href={`/player/${row.id}`} className="card-title">
                              {row.name}
                            </Link>
                            <span className="team-pill">
                              {row.sport} {row.team} {row.position}
                            </span>
                          </div>
                          <p className="muted-line">
                            {formatNumber(row.shares, 0)} shares | Current Price {formatCurrency(row.spot)} | Purchase Price{" "}
                            {formatCurrency(row.averageEntryPrice)}
                          </p>
                          <div className="portfolio-trade-row">
                            {haltedForRow(row) && (
                              <p className="subtle portfolio-row-halt-note">
                                Trading paused{haltedForRow(row)?.reason ? `: ${haltedForRow(row)?.reason}` : "."}
                              </p>
                            )}
                            <button
                              type="button"
                              className={`chip market-mini-btn portfolio-trade-action-btn ${
                                sideForRow(row) === "SELL" ? "portfolio-trade-sell-btn" : "portfolio-trade-cover-btn"
                              }`}
                              onClick={() => setMaxQuantity(row)}
                              disabled={Boolean(haltedForRow(row)) || maxTradableShares(row) <= 0 || previewingId === row.id || placingId === row.id}
                            >
                              {sideForRow(row)} Max
                            </button>
                            <input
                              className="market-qty-input"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={4}
                              value={qtyById[row.id] ?? ""}
                              onChange={(event) => setQuantity(row.id, event.target.value)}
                              placeholder="qty"
                              disabled={Boolean(haltedForRow(row))}
                            />
                            {quoteById[row.id] ? (
                              <button
                                type="button"
                                className={sideForRow(row) === "SELL" ? "primary-btn short-btn market-quote-action-btn" : "primary-btn market-quote-action-btn"}
                                disabled={Boolean(haltedForRow(row)) || placingId === row.id}
                                onClick={() => void placeTrade(row)}
                              >
                                {placingId === row.id ? "Placing..." : "Execute"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="market-quote-action-btn market-quote-preview-btn"
                                onClick={() => void previewTrade(row)}
                                disabled={Boolean(haltedForRow(row)) || previewingId === row.id}
                              >
                                {previewingId === row.id ? "Quoting..." : "Preview"}
                              </button>
                            )}
                          </div>
                          {quoteById[row.id] && (
                            <p className="subtle portfolio-trade-quote">
                              Net: {formatCurrency(quoteById[row.id]!.total)} | Avg{" "}
                              {formatCurrency(quoteById[row.id]!.average_price, 3)}
                            </p>
                          )}
                          <div className="holding-metrics">
                            <span>Value: {formatCurrency(row.marketValue)}</span>
                            <span className={row.pnl >= 0 ? "up" : "down"}>
                              {formatSignedCurrency(row.pnl)} ({formatPercent(row.pnlPct)})
                            </span>
                          </div>
                          <div className="allocation-track">
                            <div style={{ width: `${Math.max(3, row.allocationPct)}%` }} />
                          </div>
                          <p className="subtle">Allocation {formatPercent(row.allocationPct, 1)}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </section>

              <section className="desktop-only table-panel market-table-panel desktop-market-table">
                <div className="portfolio-sport-group-head">
                  <h3>Held Players (Market View)</h3>
                  <p className="subtle portfolio-sport-summary">
                    {formatNumber(marketRows.length)} held players shown with the same columns and actions as the market table.
                  </p>
                </div>
                <div className="table-wrap">
                  <table className="market-table">
                    <colgroup>
                      <col className="market-col-player" />
                      <col className="market-col-price" />
                      <col className="market-col-earnings" />
                      <col className="market-col-change" />
                      <col className="market-col-earnings" />
                      <col className="market-col-shares-held" />
                      <col className="market-col-shares-short" />
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
                        <th>{renderSortButton("avg_purchase", "Avg Purchase")}</th>
                        <th>{renderSortButton("total_gain", "Total Gain")}</th>
                        <th>{renderSortButton("earnings", "Earnings")}</th>
                        <th>Shares Held</th>
                        <th>Shares Short</th>
                        <th className="market-header-single">Quick Actions</th>
                        <th className="market-header-single">Action</th>
                        <th className="market-header-single">Qty</th>
                        <th className="market-header-single">Quote</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketRows.map((row) => (
                        <MarketTableRow
                          key={row.market.player.id}
                          row={row.market}
                          hidePerformanceColumns
                          extraColumnsBeforeEarnings
                          averageEntryPrice={row.averageEntryPrice}
                          userTotalGain={row.totalGain}
                          userTotalGainPct={row.totalGainPct}
                          isTradingHalted={Boolean(haltedForSport(row.market.player.sport))}
                          onSetError={setError}
                          onPreviewQuote={requestQuote}
                          onExecuteTrade={executeTrade}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <section className="table-panel">
            <div className="portfolio-sport-group-head">
              <h3>Recent Trades</h3>
              <p className="subtle portfolio-sport-summary">
                {recentTransactions.length
                  ? `${formatNumber(recentTransactions.length)} most recent transactions`
                  : "No trades recorded yet."}
              </p>
            </div>
            {recentTransactions.length ? (
              <div className="table-wrap">
                <table className="portfolio-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Player</th>
                      <th>Shares</th>
                      <th>Unit Price</th>
                      <th>Cash Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTransactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{formatStamp(transaction.created_at)}</td>
                        <td>{transaction.trade_type}</td>
                        <td>
                          {transaction.player_id && transaction.player_name ? (
                            <Link href={`/player/${transaction.player_id}`} className="card-title">
                              {transaction.player_name}
                            </Link>
                          ) : (
                            <span>{transaction.player_name ?? "System"}</span>
                          )}
                        </td>
                        <td>{formatNumber(transaction.shares, 0)}</td>
                        <td>{formatCurrency(transaction.unit_price)}</td>
                        <td className={transaction.amount >= 0 ? "up" : "down"}>
                          {formatSignedCurrency(transaction.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="subtle">Executed trades will appear here.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
