"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, clearAuthToken, isUnauthorizedError } from "@/lib/api";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/format";
import { teamPrimaryColor } from "@/lib/teamColors";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { DirectThreadSummary, FriendshipStatus, UserAccount, UserProfile, WatchlistPlayer } from "@/lib/types";

type HoldingRow = {
  id: number;
  name: string;
  sport: string;
  team: string;
  position: string;
  shares: number;
  averageEntryPrice: number;
  basisNotional: number;
  spot: number;
  marketValue: number;
  pnl: number;
  pnlPct: number;
  allocationPct: number;
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

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function initialLetter(value: string): string {
  const normalized = (value || "").trim();
  if (!normalized) return "?";
  return normalized[0].toUpperCase();
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

export default function UserProfilePage() {
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const username = (params?.username || "").trim().toLowerCase();
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingThread, setOpeningThread] = useState(false);
  const [friendActionBusy, setFriendActionBusy] = useState(false);
  const [activeAccountMixSliceKey, setActiveAccountMixSliceKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async (options?: { silent?: boolean }) => {
    if (!username) return;
    if (!options?.silent) setLoading(true);
    try {
      const [me, nextProfile, nextWatchlist] = await Promise.all([
        apiGet<UserAccount>("/auth/me"),
        apiGet<UserProfile>(`/users/${encodeURIComponent(username)}/profile`),
        apiGet<WatchlistPlayer[]>("/watchlist/players").catch(() => []),
      ]);
      setCurrentUser(me);
      setProfile(nextProfile);
      setWatchlist(nextWatchlist);
      setError("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [router, username]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProfile();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  useAdaptivePolling(
    () => loadProfile({ silent: true }),
    { activeMs: 20_000, hiddenMs: 90_000, runImmediately: false },
  );

  const friendship = profile?.friendship;
  const isOwnProfile = useMemo(() => {
    if (!currentUser || !profile) return false;
    return currentUser.username.trim().toLowerCase() === profile.username.trim().toLowerCase();
  }, [currentUser, profile]);

  const rows = useMemo<HoldingRow[]>(
    () =>
      (profile?.holdings ?? [])
        .map((holding) => ({
          id: holding.player_id,
          name: holding.player_name,
          sport: holding.sport,
          team: holding.team,
          position: holding.position,
          shares: holding.shares_owned,
          averageEntryPrice: holding.average_entry_price,
          basisNotional: holding.basis_amount,
          spot: holding.spot_price,
          marketValue: holding.market_value,
          pnl: holding.unrealized_pnl,
          pnlPct: holding.unrealized_pnl_pct,
          allocationPct: holding.allocation_pct,
        }))
        .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue)),
    [profile],
  );

  const computedGrossExposure = useMemo(
    () => rows.reduce((sum, row) => sum + Math.abs(row.marketValue), 0),
    [rows],
  );
  const grossExposure = profile?.gross_exposure ?? computedGrossExposure;
  const unrealizedPnl = useMemo(
    () => rows.reduce((sum, row) => sum + row.pnl, 0),
    [rows],
  );
  const basisNotional = useMemo(
    () => rows.reduce((sum, row) => sum + row.basisNotional, 0),
    [rows],
  );
  const unrealizedPnlPct = basisNotional > 0 ? (unrealizedPnl / basisNotional) * 100 : 0;

  const sportGroups = useMemo<SportGroup[]>(() => {
    const groups = new Map<string, HoldingRow[]>();
    for (const row of rows) {
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
          allocationPct: grossExposure > 0 ? (grossValue / grossExposure) * 100 : 0,
        };
      })
      .sort((a, b) => {
        const aIndex = orderIndex.has(a.sport) ? (orderIndex.get(a.sport) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const bIndex = orderIndex.has(b.sport) ? (orderIndex.get(b.sport) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.sport.localeCompare(b.sport);
      });
  }, [grossExposure, rows]);

  const pieSlices = useMemo<AccountMixSlice[]>(() => {
    const cashValue = Math.max(0, profile?.cash_balance ?? 0);
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

    const topHoldings = holdingSlices.slice(0, MAX_ACCOUNT_MIX_HOLDINGS);
    const otherValue = holdingSlices.slice(MAX_ACCOUNT_MIX_HOLDINGS).reduce((sum, slice) => sum + slice.value, 0);

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
  }, [profile?.cash_balance, rows]);

  const pieTotal = useMemo(() => pieSlices.reduce((sum, slice) => sum + slice.value, 0), [pieSlices]);

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

  function applyFriendship(nextFriendship: FriendshipStatus) {
    setProfile((previous) => (previous ? { ...previous, friendship: nextFriendship } : previous));
  }

  async function sendFriendRequest() {
    if (!profile || isOwnProfile) return;
    setFriendActionBusy(true);
    setError("");
    try {
      const nextFriendship = await apiPost<FriendshipStatus>("/friends/requests", {
        username: profile.username,
      });
      applyFriendship(nextFriendship);
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setFriendActionBusy(false);
    }
  }

  async function respondToFriendRequest(action: "accept" | "decline") {
    if (!profile?.friendship.friendship_id) return;
    setFriendActionBusy(true);
    setError("");
    try {
      const nextFriendship = await apiPost<FriendshipStatus>(
        `/friends/requests/${profile.friendship.friendship_id}/${action}`,
        {},
      );
      applyFriendship(nextFriendship);
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setFriendActionBusy(false);
    }
  }

  async function openThread() {
    if (!profile || isOwnProfile || !profile.friendship.can_message) return;
    setOpeningThread(true);
    setError("");
    try {
      const thread = await apiPost<DirectThreadSummary>("/inbox/threads", {
        username: profile.username,
      });
      router.push(`/inbox?thread=${thread.id}`);
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setOpeningThread(false);
    }
  }

  if (!username) {
    return (
      <main className="page-shell">
        <section className="empty-panel">
          <h2>Invalid username</h2>
          <p className="subtle">This profile route is invalid.</p>
          <Link href="/community" className="ghost-link">
            Back to Forum
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero-panel profile-hero">
        <div className="profile-avatar-wrap">
          {profile?.profile_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.profile_image_url} alt={`${profile.username} profile`} className="profile-avatar-img" />
          ) : (
            <div className="profile-avatar-fallback">{initialLetter(profile?.username ?? username)}</div>
          )}
        </div>
        <div>
          <p className="eyebrow">User Profile</p>
          <h1>{profile?.username ?? username}</h1>
          <p className="subtle profile-bio-text">{profile?.bio || "This user has not added a bio yet."}</p>
        </div>
        <div className="hero-actions">
          <Link href="/community" className="ghost-link">
            Back to Forum
          </Link>
          {!isOwnProfile && friendship?.status === "NONE" ? (
            <button type="button" className="primary-btn" onClick={() => void sendFriendRequest()} disabled={friendActionBusy}>
              {friendActionBusy ? "Sending..." : "Add Friend"}
            </button>
          ) : null}
          {!isOwnProfile && friendship?.status === "PENDING_INCOMING" ? (
            <>
              <button
                type="button"
                className="primary-btn"
                onClick={() => void respondToFriendRequest("accept")}
                disabled={friendActionBusy}
              >
                {friendActionBusy ? "Saving..." : "Accept Request"}
              </button>
              <button
                type="button"
                className="ghost-link"
                onClick={() => void respondToFriendRequest("decline")}
                disabled={friendActionBusy}
              >
                Decline
              </button>
            </>
          ) : null}
          {!isOwnProfile && friendship?.can_message ? (
            <button type="button" className="primary-btn" onClick={() => void openThread()} disabled={openingThread}>
              {openingThread ? "Opening..." : "Message User"}
            </button>
          ) : null}
          {!isOwnProfile && friendship?.status === "PENDING_OUTGOING" ? (
            <span className="chip muted-chip">Friend Request Sent</span>
          ) : null}
          {!isOwnProfile && friendship?.status === "FRIENDS" ? <span className="chip">Friends</span> : null}
          <button type="button" onClick={() => void loadProfile()} disabled={loading}>
            Refresh
          </button>
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      {!profile ? (
        <section className="empty-panel">
          <h3>{loading ? "Loading profile..." : "Profile not found"}</h3>
        </section>
      ) : (
        <>
          <section className="metrics-grid portfolio-kpi-grid">
            <article className="kpi-card">
              <span>Cash</span>
              <strong>{formatCurrency(profile.cash_balance)}</strong>
            </article>
            <article className="kpi-card">
              <span>Holdings</span>
              <strong>{formatCurrency(profile.holdings_value)}</strong>
            </article>
            <article className="kpi-card">
              <span>Total Account</span>
              <strong>{formatCurrency(profile.equity)}</strong>
            </article>
            <article className="kpi-card">
              <span>Unrealized P/L</span>
              <strong className={unrealizedPnl >= 0 ? "up" : "down"}>
                {formatSignedCurrency(unrealizedPnl)} ({formatPercent(unrealizedPnlPct)})
              </strong>
            </article>
            <article className="kpi-card">
              <span>Return</span>
              <strong className={profile.return_pct >= 0 ? "up" : "down"}>{formatNumber(profile.return_pct, 2)}%</strong>
            </article>
            <article className="kpi-card">
              <span>Leaderboard</span>
              <strong>{profile.leaderboard_rank ? `#${formatNumber(profile.leaderboard_rank, 0)}` : "--"}</strong>
            </article>
          </section>

          <section className="table-panel account-mix-panel">
            <div className="portfolio-sport-group-head">
              <h3>Account Mix</h3>
              <p className="subtle portfolio-sport-summary">
                Top {MAX_ACCOUNT_MIX_HOLDINGS} holdings, cash, and grouped remainder.
              </p>
            </div>
            <div className="account-mix-layout">
              <div className="account-mix-chart-wrap" onMouseLeave={() => setActiveAccountMixSliceKey(null)}>
                <svg className="account-mix-donut" viewBox="0 0 200 200" role="img" aria-label="Donut chart showing account mix composition">
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
                  <strong>{formatCurrency(activeAccountMixSlice ? activeAccountMixSlice.value : profile.equity)}</strong>
                  <span>{activeAccountMixSlice ? `${formatPercent(activeAccountMixSlice.pct, 1)} allocation` : "Hover slices for details"}</span>
                </div>
              </div>

              <div className="account-mix-legend" onMouseLeave={() => setActiveAccountMixSliceKey(null)}>
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
                      <span
                        className={
                          slice.gainLossPct == null
                            ? "account-mix-gl"
                            : `account-mix-gl ${slice.gainLossPct >= 0 ? "up" : "down"}`
                        }
                      >
                        {slice.gainLossPct == null ? "--" : formatSignedPercent(slice.gainLossPct, 2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="mobile-holdings">
            {rows.length === 0 ? (
              <section className="empty-panel">
                <h3>No positions yet</h3>
                <p className="subtle">This user has no open holdings right now.</p>
              </section>
            ) : (
              sportGroups.map((group) => (
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
              ))
            )}
          </section>

          {rows.length > 0 ? (
            <section className="desktop-only portfolio-holdings-groups">
              {sportGroups.map((group) => (
                <section key={group.sport} className="table-panel">
                  <div className="portfolio-sport-group-head">
                    <h3>{group.sport}</h3>
                    <p className="subtle portfolio-sport-summary">
                      {formatNumber(group.rows.length)} positions | Net {formatCurrency(group.netValue)} | Gross {formatCurrency(group.grossValue)} |{" "}
                      {formatPercent(group.allocationPct, 1)} allocation
                    </p>
                  </div>
                  <div className="table-wrap">
                    <table className="portfolio-table">
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th>Shares</th>
                          <th>Purchase Price</th>
                          <th>Current Price</th>
                          <th>Market Value</th>
                          <th>Unrealized P/L</th>
                          <th>Allocation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <Link href={`/player/${row.id}`} className="card-title">
                                {row.name}
                              </Link>
                            </td>
                            <td>{formatNumber(row.shares, 0)}</td>
                            <td>{formatCurrency(row.averageEntryPrice)}</td>
                            <td>{formatCurrency(row.spot)}</td>
                            <td>{formatCurrency(row.marketValue)}</td>
                            <td className={row.pnl >= 0 ? "up" : "down"}>
                              {formatSignedCurrency(row.pnl)} ({formatPercent(row.pnlPct)})
                            </td>
                            <td>{formatPercent(row.allocationPct, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </section>
          ) : null}

          {isOwnProfile ? (
            <section className="table-panel">
              <h3>Watchlist</h3>
              {watchlist.length === 0 ? (
                <p className="subtle">Use the Watch button on any player page to add names here.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Sport</th>
                        <th>Team</th>
                        <th>Pos</th>
                        <th>Current Price</th>
                        <th>Status</th>
                        <th>Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {watchlist.map((player) => (
                        <tr key={player.player_id}>
                          <td>
                            <Link href={`/player/${player.player_id}`} className="card-title">
                              {player.name}
                            </Link>
                          </td>
                          <td>{player.sport}</td>
                          <td>{player.team}</td>
                          <td>{player.position}</td>
                          <td>{formatCurrency(player.spot_price)}</td>
                          <td>{player.live?.live_now ? "Live now" : "Watching"}</td>
                          <td>{new Date(player.added_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
