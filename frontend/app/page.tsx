"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, getAuthToken } from "@/lib/api";
import { formatCurrency, formatNumber, formatSignedPercent } from "@/lib/format";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { ForumPostSummary, LeaderboardResponse, Player } from "@/lib/types";

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
      const [nextPlayers, nextPosts, nextLeaderboard] = await Promise.all([
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
      ]);
      setPlayers(nextPlayers);
      setPosts(nextPosts);
      setLeaderboard(nextLeaderboard);
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

  const sportsCount = useMemo(
    () => new Set(players.map((player) => player.sport)).size,
    [players],
  );

  const averageSpot = useMemo(() => {
    if (!players.length) return 0;
    const total = players.reduce((sum, player) => sum + Number(player.spot_price || 0), 0);
    return total / players.length;
  }, [players]);

  const marketLeaders = useMemo(
    () => [...players].sort((a, b) => b.spot_price - a.spot_price).slice(0, 6),
    [players],
  );

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

      <section className="metrics-grid">
        <article className="kpi-card">
          <span>Players Listed</span>
          <strong>{formatNumber(players.length)}</strong>
        </article>
        <article className="kpi-card">
          <span>Sports Live</span>
          <strong>{formatNumber(sportsCount)}</strong>
        </article>
        <article className="kpi-card">
          <span>Average Current Price</span>
          <strong>{formatCurrency(averageSpot)}</strong>
        </article>
        <article className="kpi-card">
          <span>Community Activity</span>
          <strong>{communityLocked ? "Sign in" : `${formatNumber(posts.length)} posts`}</strong>
        </article>
      </section>

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
            <h3>Market Snapshot</h3>
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
                      <th>Sport</th>
                      <th>Current Price</th>
                      <th>Move vs Purchase Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketLeaders.map((player) => {
                      const changePct = getSignedPercent(player.base_price, player.spot_price);
                      return (
                        <tr key={player.id}>
                          <td>
                            <Link href={`/player/${player.id}`} className="community-user-link">
                              {player.name}
                            </Link>
                            <div className="subtle">{player.team} {player.position}</div>
                          </td>
                          <td>{player.sport}</td>
                          <td>{formatCurrency(player.spot_price)}</td>
                          <td className={changePct >= 0 ? "up" : "down"}>{formatSignedPercent(changePct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="home-market-mobile-list">
                {marketLeaders.map((player) => {
                  const changePct = getSignedPercent(player.base_price, player.spot_price);
                  return (
                    <article className="home-market-mobile-card" key={player.id}>
                      <div className="home-market-mobile-top">
                        <div className="home-market-mobile-player">
                          <Link href={`/player/${player.id}`} className="community-user-link">
                            {player.name}
                          </Link>
                          <p className="subtle">
                            {player.team} {player.position} | {player.sport}
                          </p>
                        </div>
                        <strong>{formatCurrency(player.spot_price)}</strong>
                      </div>
                      <div className="home-market-mobile-bottom">
                        <span className="subtle">Move vs purchase price</span>
                        <span className={changePct >= 0 ? "up" : "down"}>{formatSignedPercent(changePct)}</span>
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
