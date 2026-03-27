"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, getAuthToken } from "@/lib/api";
import { formatCurrency, formatNumber, formatSignedPercent } from "@/lib/format";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { ForumPostSummary, LeaderboardResponse, MarketMovers, Player } from "@/lib/types";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatStamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSignedPercent(base: number, spot: number): number {
  if (!base) return 0;
  return ((spot - base) / base) * 100;
}

export default function HomePage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [weeklyMovers, setWeeklyMovers] = useState<MarketMovers | null>(null);
  const [posts, setPosts] = useState<ForumPostSummary[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [communityLocked, setCommunityLocked] = useState(false);
  const [error, setError] = useState("");
  const [authResolved, setAuthResolved] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let locked = false;
      const [nextPlayers, nextPosts, nextLeaderboard, nextWeeklyMovers] = await Promise.all([
        apiGet<Player[]>("/players"),
        apiGet<ForumPostSummary[]>("/forum/posts?limit=4").catch((err: unknown) => {
          const message = toMessage(err);
          if (message.includes("401")) {
            locked = true;
            return [];
          }
          throw err;
        }),
        apiGet<LeaderboardResponse>("/leaderboard?scope=global&sport=ALL&limit=5").catch(() => null),
        apiGet<MarketMovers>("/market/movers?limit=100&window_hours=168").catch(() => null),
      ]);
      setPlayers(nextPlayers);
      setPosts(nextPosts);
      setLeaderboard(nextLeaderboard);
      setWeeklyMovers(nextWeeklyMovers);
      setCommunityLocked(locked);
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useAdaptivePolling(loadSnapshots, { activeMs: 60_000, hiddenMs: 240_000 });

  useEffect(() => {
    setIsLoggedIn(Boolean(getAuthToken()));
    setAuthResolved(true);
  }, []);

  const marketLeaders = useMemo(() => {
    const weekGainByPlayerId = new Map<number, number>();
    for (const row of [...(weeklyMovers?.gainers ?? []), ...(weeklyMovers?.losers ?? [])]) {
      const existing = weekGainByPlayerId.get(row.player_id);
      if (existing === undefined || Math.abs(row.change_percent) > Math.abs(existing)) {
        weekGainByPlayerId.set(row.player_id, row.change_percent);
      }
    }

    const topWeekly = players
      .filter((player) => weekGainByPlayerId.has(player.id))
      .map((player) => ({
        player,
        weekGainPct: Number(weekGainByPlayerId.get(player.id) ?? 0),
        overallGainPct: getSignedPercent(player.base_price, player.spot_price),
      }))
      .sort((a, b) => {
        const byMagnitude = Math.abs(b.weekGainPct) - Math.abs(a.weekGainPct);
        if (byMagnitude !== 0) return byMagnitude;
        const bySigned = b.weekGainPct - a.weekGainPct;
        if (bySigned !== 0) return bySigned;
        return a.player.name.localeCompare(b.player.name);
      })
      .slice(0, 10);

    if (topWeekly.length > 0) return topWeekly;

    return [...players]
      .map((player) => ({
        player,
        weekGainPct: 0,
        overallGainPct: getSignedPercent(player.base_price, player.spot_price),
      }))
      .sort((a, b) => Math.abs(b.overallGainPct) - Math.abs(a.overallGainPct))
      .slice(0, 10);
  }, [players, weeklyMovers]);

  const totalComments = useMemo(
    () => posts.reduce((sum, post) => sum + Number(post.comment_count || 0), 0),
    [posts],
  );

  return (
    <main className="page-shell">
      <section className={`hero-panel home-hero${authResolved && isLoggedIn ? " home-hero-logged-in" : ""}`}>
        <div>
          <p className="eyebrow">Welcome</p>
          <h1 className="home-headline">Trade Pro Athletes Like Stocks in a Live Market</h1>
          <p className="subtle">
            MatchupMarket is a free-to-play fantasy sports stock market. Start from preseason projections,
            trade long or short during the season, and settle positions against final fantasy production.
          </p>
        </div>
        {authResolved && !isLoggedIn && (
          <div className="hero-actions hero-actions-single">
            <Link href="/auth" className="primary-btn ghost-link home-create-account-cta">
              Create Account
            </Link>
          </div>
        )}
      </section>

      {error && <p className="error-box">{error}</p>}

      <section className="table-panel home-explainer">
        <h3>How MatchupMarket Works</h3>
        <div className="home-steps">
          <article className="home-step">
            <h4>1. IPO Opens Each Sport</h4>
            <p className="subtle">Players list at preseason projection-based prices before each season starts.</p>
          </article>
          <article className="home-step">
            <h4>2. Prices Move Live</h4>
            <p className="subtle">Player prices react to a combination of market activity and live fantasy performance.</p>
          </article>
          <article className="home-step">
            <h4>3. Final Season Settlement</h4>
            <p className="subtle">At season close, positions settle against each player&apos;s final fantasy points total.</p>
          </article>
        </div>
      </section>

      <section className="home-snapshot-grid">
        <article className="table-panel">
          <div className="home-snapshot-head">
            <h3>This Week&apos;s Top 10 Movers</h3>
            <Link href="/market" className="ghost-link">
              Open Market
            </Link>
          </div>
          {loading ? (
            <p className="subtle">Loading market snapshot...</p>
          ) : marketLeaders.length === 0 ? (
            <p className="subtle">No listed players yet. IPO controls are managed in Admin.</p>
          ) : (
            <>
              <div className="table-wrap home-market-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Current Price</th>
                      <th>1 Week Gain</th>
                      <th>Overall Gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketLeaders.map((row) => {
                      const { player, weekGainPct, overallGainPct } = row;
                      return (
                        <tr key={player.id}>
                          <td>
                            <Link href={`/player/${player.id}`} className="community-user-link">
                              {player.name}
                            </Link>
                            <div className="subtle">{player.team} {player.position}</div>
                          </td>
                          <td>{formatCurrency(player.spot_price)}</td>
                          <td className={weekGainPct >= 0 ? "up" : "down"}>{formatSignedPercent(weekGainPct)}</td>
                          <td className={overallGainPct >= 0 ? "up" : "down"}>{formatSignedPercent(overallGainPct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="home-market-mobile-list">
                {marketLeaders.map((row) => {
                  const { player, weekGainPct, overallGainPct } = row;
                  return (
                    <article className="home-market-mobile-card" key={player.id}>
                      <div className="home-market-mobile-top">
                        <div className="home-market-mobile-player">
                          <Link href={`/player/${player.id}`} className="community-user-link">
                            {player.name}
                          </Link>
                          <p className="subtle">{player.team} {player.position}</p>
                        </div>
                        <strong>{formatCurrency(player.spot_price)}</strong>
                      </div>
                      <div className="home-market-mobile-bottom">
                        <span className="subtle">1 week gain</span>
                        <span className={weekGainPct >= 0 ? "up" : "down"}>{formatSignedPercent(weekGainPct)}</span>
                      </div>
                      <div className="home-market-mobile-bottom">
                        <span className="subtle">Overall gain</span>
                        <span className={overallGainPct >= 0 ? "up" : "down"}>{formatSignedPercent(overallGainPct)}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </article>

        <article className="table-panel">
          <div className="home-snapshot-head">
            <h3>Leaderboard</h3>
            <Link href={isLoggedIn ? "/portfolio" : "/auth"} className="ghost-link">
              {isLoggedIn ? "Open Portfolio" : "Sign In"}
            </Link>
          </div>
          {loading ? (
            <p className="subtle">Loading leaderboard...</p>
          ) : !leaderboard || leaderboard.entries.length === 0 ? (
            <p className="subtle">No ranked users yet. Once trading activity builds, standings will appear here.</p>
          ) : (
            <div className="home-post-list">
              {leaderboard.entries.map((entry) => (
                <article className="community-post-card" key={entry.user_id}>
                  <div className="home-snapshot-head">
                    <Link href={`/profile/${entry.username}`} className="community-post-title">
                      #{formatNumber(entry.rank, 0)} {entry.username}
                    </Link>
                    <span className={entry.return_pct >= 0 ? "up" : "down"}>{formatSignedPercent(entry.return_pct)}</span>
                  </div>
                  <p className="community-meta">
                    Equity {formatCurrency(entry.equity)} | Cash {formatCurrency(entry.cash_balance)} | Holdings{" "}
                    {formatCurrency(entry.holdings_value)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="table-panel">
          <div className="home-snapshot-head">
            <h3>Community Snapshot</h3>
            <Link href="/community" className="ghost-link">
              Open Community
            </Link>
          </div>
          {loading ? (
            <p className="subtle">Loading forum snapshot...</p>
          ) : communityLocked ? (
            <p className="subtle">Sign in to view community posts.</p>
          ) : posts.length === 0 ? (
            <p className="subtle">No posts yet. Start the first discussion in Community.</p>
          ) : (
            <>
              <p className="subtle">{formatNumber(totalComments)} comments across latest threads.</p>
              <div className="home-post-list">
                {posts.map((post) => (
                  <article className="community-post-card" key={post.id}>
                    <Link href={`/community/${post.id}`} className="community-post-title">
                      {post.title}
                    </Link>
                    <p className="community-post-preview">{post.body_preview}</p>
                    <p className="community-meta">
                      By {" "}
                      <Link href={`/profile/${post.author_username}`} className="community-user-link">
                        {post.author_username}
                      </Link>{" "}
                      | {formatStamp(post.updated_at)} | {formatNumber(post.view_count)} views |{" "}
                      {formatNumber(post.comment_count)} comments
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </article>
      </section>
    </main>
  );
}
