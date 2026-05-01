"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type SVGProps } from "react";
import MarketTableRow, {
  type MarketTableRowModel,
  type MarketTradeSide,
} from "@/components/market-table-row";
import AccountMixPanel, { type AccountMixSegment as SharedAccountMixSegment } from "@/components/account-mix-panel";
import CommunityPostsPanel from "@/components/community-posts-panel";
import { apiGet, apiPost, friendlyApiError, isUnauthorizedError } from "@/lib/api";
import EmptyStatePanel from "@/components/empty-state-panel";
import { formatCurrency, formatNumber, formatSignedCurrency, formatSignedPercent } from "@/lib/format";
import { teamPrimaryColor } from "@/lib/teamColors";
import { CHICAGO_TIME_ZONE, chicagoNowStamp } from "@/lib/time";
import { notifySuccess } from "@/lib/toast";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type {
  AdminAuditTrade,
  ForumPostSummary,
  MarketMovers,
  Player,
  Portfolio,
  Quote,
  TradingHaltState,
  TradingStatus,
  UserAccount,
  UserProfile,
} from "@/lib/types";

type MarketSortColumn = "name" | "spot_price" | "avg_purchase" | "total_gain" | "earnings" | "shares" | "position";
type SortDirection = "asc" | "desc";

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
};

type PortfolioMarketRow = {
  market: MarketTableRowModel;
  positionShares: number;
  totalValue: number;
  averageEntryPrice: number;
  totalGain: number;
  totalGainPct: number;
};

type AccountMixSlice = {
  key: string;
  label: string;
  color: string;
  value: number;
  gainLossPct: number | null;
};

const MAX_POSITION_NOTIONAL_PER_PLAYER = 10000;
const STARTING_ACCOUNT_BASELINE = 100000;
const SORT_DEFAULT_DIRECTION: Record<MarketSortColumn, SortDirection> = {
  name: "asc",
  spot_price: "desc",
  avg_purchase: "desc",
  total_gain: "desc",
  earnings: "desc",
  shares: "desc",
  position: "desc",
};

function MatchupMarketLogo(props: SVGProps<SVGSVGElement>) {
  const sigmaPath = "M2 6H42L38 12H19.5L33.5 23L19.5 34H42L38 40H2L10 34L24 23L10 12Z";
  const deltaPath = "M62 10L81 37H43Z";
  return (
    <svg {...props} viewBox="0 0 94 46" fill="none" stroke="none" preserveAspectRatio="xMidYMid meet">
      <path d={sigmaPath} fill="#ffad3d" />
      <path d={deltaPath} fill="none" stroke="#4db8ff" strokeWidth="6" strokeLinejoin="miter" />
    </svg>
  );
}

function formatStamp(value: string | null): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    timeZone: CHICAGO_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getSignedPercent(base: number, spot: number): number {
  if (!base) return 0;
  return ((spot - base) / base) * 100;
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
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [tradingStatus, setTradingStatus] = useState<TradingStatus | null>(null);
  const [communityPosts, setCommunityPosts] = useState<ForumPostSummary[]>([]);
  const [activeAccountMixSliceKey, setActiveAccountMixSliceKey] = useState<string | null>(null);
  const [isRecentTradesOpen, setIsRecentTradesOpen] = useState(false);
  const [error, setError] = useState("");

  const handleRequestError = useCallback(
    (err: unknown) => {
      if (isUnauthorizedError(err)) {
        router.replace("/auth");
        return;
      }
      setError(friendlyApiError(err));
    },
    [router],
  );

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const [portfolioData, transactions, players, me, statusData, movers24hData, meProfile] = await Promise.all([
        apiGet<Portfolio>("/portfolio"),
        apiGet<AdminAuditTrade[]>("/transactions/me?limit=50"),
        apiGet<Player[]>("/players"),
        apiGet<UserAccount>("/auth/me"),
        apiGet<TradingStatus>("/trading/status").catch(() => null),
        apiGet<MarketMovers>("/market/movers?limit=100&window_hours=24").catch(() => null),
        apiGet<UserProfile>("/users/me/profile").catch(() => null),
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
      setCommunityPosts(meProfile?.community_posts ?? []);
      setLastUpdated(chicagoNowStamp());
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
        };
      })
      .filter((row): row is HoldingRow => row !== null)
      .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
  }, [playersById, portfolio]);

  const computedNetExposure = useMemo(
    () => rows.reduce((sum, row) => sum + row.marketValue, 0),
    [rows],
  );

  const marketRows = useMemo<PortfolioMarketRow[]>(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const nextRows: PortfolioMarketRow[] = [];
    for (const row of rows) {
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
        positionShares: Number(row.shares),
        totalValue: Number(row.marketValue),
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
      if (sortColumn === "shares") return direction * (a.positionShares - b.positionShares);
      if (sortColumn === "position") return direction * (a.totalValue - b.totalValue);
      return 0;
    });
    return nextRows;
  }, [change24hById, playersById, rows, sortColumn, sortDirection]);

  const cash = portfolio?.cash_balance ?? 0;
  const holdings = portfolio?.net_exposure ?? computedNetExposure;
  const totalAccount = portfolio?.equity ?? cash + holdings;
  const totalAccountPnlPct = ((totalAccount - STARTING_ACCOUNT_BASELINE) / STARTING_ACCOUNT_BASELINE) * 100;
  const totalAccountAboveBaseline = totalAccount >= STARTING_ACCOUNT_BASELINE;
  const pieSlices = useMemo<AccountMixSlice[]>(() => {
    const cashValue = Math.max(0, cash);
    const holdingSlices = rows
      .map((row) => ({
        key: `player-${row.id}`,
        label: `${row.shares < 0 ? "Short " : ""}${row.name} (${row.team})`,
        color: teamPrimaryColor(row.team, row.sport),
        value: Math.max(0, row.marketValue),
        gainLossPct: Number.isFinite(row.pnlPct) ? row.pnlPct : null,
      }))
      .filter((slice) => slice.value > 0)
      .sort((a, b) => b.value - a.value);

    const slices: AccountMixSlice[] = [];
    if (cashValue > 0 || holdingSlices.length === 0) {
      slices.push({
        key: "cash",
        label: "Cash",
        color: "#15784d",
        value: cashValue,
        gainLossPct: null,
      });
    }
    slices.push(...holdingSlices);
    return slices;
  }, [cash, rows]);
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
  const pieSegments = useMemo<SharedAccountMixSegment[]>(() => {
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
      .filter((slice) => slice.endAngle > slice.startAngle);
  }, [pieSlices, pieTotal]);
  function haltedForSport(sport: string): TradingHaltState | null {
    if (globalHalt) return globalHalt;
    return haltBySport.get(sport) ?? null;
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

  return (
    <main className="page-shell">
      <section className="hero-panel portfolio-hero">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>Portfolio</h1>
          <p className="subtle">Monitor market value, allocation, and unrealized return by position.</p>
          <p className="subtle">Last updated {formatStamp(lastUpdated)}</p>
          {currentUser && (
            <p className="portfolio-user-meta">
              Username: <strong>{currentUser.username}</strong> | User ID: <strong>{currentUser.id}</strong>
              {currentUser.is_admin && (
                <span className="portfolio-admin-badge" aria-label="Admin account">
                  <span className="portfolio-admin-star" aria-hidden="true">
                    ✶
                  </span>
                  Admin
                  <span className="portfolio-admin-star" aria-hidden="true">
                    ✶
                  </span>
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
              <strong className="portfolio-kpi-pnl">
                <b className={totalAccountAboveBaseline ? "up" : "down"}>{formatCurrency(totalAccount)}</b>
              </strong>
            </article>
            <article className="kpi-card portfolio-logo-kpi-card">
              <span className="portfolio-kpi-logo-label" aria-label="MatchupMarket">
                <MatchupMarketLogo aria-hidden="true" />
              </span>
              <strong className={`portfolio-kpi-pnl ${totalAccountPnlPct > 0 ? "up" : totalAccountPnlPct < 0 ? "down" : ""}`}>
                {formatSignedPercent(totalAccountPnlPct)}
              </strong>
            </article>
          </section>

          <AccountMixPanel
            totalValue={totalAccount}
            pieSegments={pieSegments}
            activeSliceKey={activeAccountMixSliceKey}
            onActiveSliceKeyChange={setActiveAccountMixSliceKey}
            showHeader={false}
          />

          {rows.length === 0 ? (
            <EmptyStatePanel
              kind="portfolio"
              title="No positions yet"
              description="Place your first trade in the market to start tracking gains, allocation, and exposure."
              actionHref="/market"
              actionLabel="Browse Market"
            />
          ) : (
            <>
              <section className="table-panel market-table-panel portfolio-market-table-panel">
                <div className="table-wrap">
                  <table className="market-table portfolio-market-table">
                    <colgroup>
                      <col className="market-col-player" />
                      <col className="market-col-price" />
                      <col className="market-col-earnings" />
                      <col className="market-col-change" />
                      <col className="market-col-earnings" />
                      <col className="market-col-shares" />
                      <col className="market-col-position" />
                      <col className="market-col-quick" />
                      <col className="market-col-action" />
                    </colgroup>
                    <thead>
                      <tr className="market-header-detail-row">
                        <th className="market-sticky-player-cell market-header-corner">
                          {renderSortButton("name", "Player")}
                        </th>
                        <th>{renderSortButton("spot_price", "Price")}</th>
                        <th>{renderSortButton("avg_purchase", "Cost")}</th>
                        <th>{renderSortButton("total_gain", "Total Gain")}</th>
                        <th>{renderSortButton("earnings", "Earnings")}</th>
                        <th>{renderSortButton("shares", "Shares")}</th>
                        <th>{renderSortButton("position", "Value")}</th>
                        <th className="market-header-single">Quick Action</th>
                        <th className="market-header-single">Player Page</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketRows.map((row) => (
                        <MarketTableRow
                          key={row.market.player.id}
                          row={row.market}
                          hidePerformanceColumns
                          extraColumnsBeforeEarnings
                          combinePositionColumn
                          separateSharesColumn
                          quickActionOnly
                          showPlayerPageAction
                          positionShares={row.positionShares}
                          holdingTotalValue={row.totalValue}
                          closeOnlyShares={row.positionShares}
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

          <CommunityPostsPanel
            posts={communityPosts}
            emptyMessage="You haven't published any community posts yet."
          />

          <section className="table-panel portfolio-recent-trades-card">
            <button
              type="button"
              className="portfolio-recent-trades-toggle"
              aria-expanded={isRecentTradesOpen}
              aria-controls="portfolio-recent-trades-table"
              onClick={() => setIsRecentTradesOpen((isOpen) => !isOpen)}
            >
              <span>{isRecentTradesOpen ? "Hide Recent Trades" : "Show Recent Trades"}</span>
              <span className="portfolio-recent-trades-count">
                {recentTransactions.length
                  ? `${formatNumber(recentTransactions.length)} most recent transactions`
                  : "No trades recorded yet"}
              </span>
            </button>
            {isRecentTradesOpen && (
              <div id="portfolio-recent-trades-table">
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
                  <p className="subtle portfolio-recent-trades-empty">Executed trades will appear here.</p>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
