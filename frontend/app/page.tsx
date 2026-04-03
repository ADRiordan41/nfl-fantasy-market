"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, getAuthToken } from "@/lib/api";
import { formatCurrency, formatNumber, formatSignedPercent } from "@/lib/format";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type {
  AdminAuditTrade,
  ForumPostSummary,
  LeaderboardResponse,
  MarketMovers,
  Player,
  UserAccount,
} from "@/lib/types";

const HOME_TUTORIAL_VERSION = "v1";
const HOME_TUTORIAL_STORAGE_PREFIX = "fsm-home-tutorial-dismissed";

type HomeTutorialMode = "full" | "tour";

type HomeTutorialStep = {
  title: string;
  body: string;
};

const HOME_TUTORIAL_FULL_STEPS: HomeTutorialStep[] = [
  {
    title: "1. Understand The Price",
    body: "Each player starts near a preseason projection-based IPO price. Their live price moves as users trade and as fantasy performance updates.",
  },
  {
    title: "2. Trade Long Or Short",
    body: "Buy shares if you think a player is underpriced. Short shares if you think they are overpriced. Entry price, position size, and timing all matter.",
  },
  {
    title: "3. Track Live Context",
    body: "Use the Live page and player cards to follow momentum, matchup context, and performance swings that can shift prices quickly during games.",
  },
  {
    title: "4. Manage Risk",
    body: "Watch portfolio equity, unrealized P/L, and concentration by holding. Diversify if one position is driving too much of your account.",
  },
  {
    title: "5. Season Settlement",
    body: "At season close, positions settle to final fantasy production. Strong entries and good risk control usually win over one-off spikes.",
  },
];

const HOME_TOUR_SHORT_STEPS: HomeTutorialStep[] = [
  {
    title: "1. Check The Board",
    body: "Open Market and scan prices, movers, and player cards to find your setup quickly.",
  },
  {
    title: "2. Place A Trade",
    body: "Go long if you expect upside, or short if you expect downside. Keep sizing tight and avoid overconcentration.",
  },
  {
    title: "3. Track And Adjust",
    body: "Use Live Game Center and Portfolio to monitor win probability context, position P/L, and rebalance when needed.",
  },
];

function homeTutorialStorageKey(userId: number): string {
  return `${HOME_TUTORIAL_STORAGE_PREFIX}:${HOME_TUTORIAL_VERSION}:${userId}`;
}

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
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [homeTutorialOpen, setHomeTutorialOpen] = useState(false);
  const [homeTutorialMode, setHomeTutorialMode] = useState<HomeTutorialMode>("full");

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
    let cancelled = false;

    async function resolveAuth() {
      const token = getAuthToken();
      if (!token) {
        if (cancelled) return;
        setCurrentUser(null);
        setIsLoggedIn(false);
        setAuthResolved(true);
        return;
      }

      try {
        const me = await apiGet<UserAccount>("/auth/me");
        if (cancelled) return;
        setCurrentUser(me);
        setIsLoggedIn(true);
      } catch {
        if (cancelled) return;
        setCurrentUser(null);
        setIsLoggedIn(false);
      } finally {
        if (!cancelled) setAuthResolved(true);
      }
    }

    void resolveAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authResolved || !isLoggedIn || !currentUser) {
      setIsNewUser(false);
      return;
    }
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(homeTutorialStorageKey(currentUser.id)) === "1") {
      setIsNewUser(false);
      return;
    }

    let cancelled = false;
    async function resolveNewUser() {
      try {
        const transactions = await apiGet<AdminAuditTrade[]>("/transactions/me?limit=1");
        if (cancelled) return;
        const shouldAutoOpenTutorial = transactions.length === 0;
        setIsNewUser(shouldAutoOpenTutorial);
        if (shouldAutoOpenTutorial) {
          setHomeTutorialMode("full");
          setHomeTutorialOpen(true);
        }
      } catch {
        if (cancelled) return;
      }
    }

    void resolveNewUser();
    return () => {
      cancelled = true;
    };
  }, [authResolved, currentUser, isLoggedIn]);

  useEffect(() => {
    if (!homeTutorialOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setHomeTutorialOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [homeTutorialOpen]);

  const dismissHomeTutorial = useCallback(() => {
    if (typeof window !== "undefined" && currentUser) {
      window.localStorage.setItem(homeTutorialStorageKey(currentUser.id), "1");
    }
    setHomeTutorialOpen(false);
    setIsNewUser(false);
  }, [currentUser]);

  const openHomeTutorial = useCallback((mode: HomeTutorialMode) => {
    setHomeTutorialMode(mode);
    setHomeTutorialOpen(true);
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
  const tutorialSteps = homeTutorialMode === "tour" ? HOME_TOUR_SHORT_STEPS : HOME_TUTORIAL_FULL_STEPS;
  const tutorialTitle = homeTutorialMode === "tour" ? "Take A Tour" : "How MatchupMarket Works";
  const tutorialEyebrow = homeTutorialMode === "tour" ? "Tour" : "Quick Start";
  const tutorialSubtitle =
    homeTutorialMode === "tour"
      ? "A short refresher to re-run the core workflow."
      : "A full onboarding walkthrough of how pricing, trading, and settlement work.";

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

      {homeTutorialOpen && (
        <div className="home-tutorial-backdrop" onClick={() => setHomeTutorialOpen(false)}>
          <section
            className="home-tutorial-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-tutorial-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="home-tutorial-head">
              <p className="eyebrow">{tutorialEyebrow}</p>
              <h3 id="home-tutorial-title">{tutorialTitle}</h3>
              <p className="subtle home-tutorial-subtitle">{tutorialSubtitle}</p>
            </div>
            <div className="home-tutorial-grid">
              {tutorialSteps.map((step) => (
                <article className="home-tutorial-step" key={step.title}>
                  <h4>{step.title}</h4>
                  <p className="subtle">{step.body}</p>
                </article>
              ))}
            </div>
            <div className="home-tutorial-actions">
              <button
                type="button"
                className="home-tutorial-switch-btn"
                onClick={() => setHomeTutorialMode((current) => (current === "tour" ? "full" : "tour"))}
              >
                {homeTutorialMode === "tour" ? "Open Full Tutorial" : "Take Short Tour"}
              </button>
              <Link href={isLoggedIn ? "/market" : "/auth"} className="ghost-link">
                {isLoggedIn ? "Open Market" : "Sign In To Start"}
              </Link>
              {isLoggedIn && homeTutorialMode === "full" && (
                <button type="button" onClick={dismissHomeTutorial}>
                  Don&apos;t Show Again
                </button>
              )}
              <button type="button" onClick={() => setHomeTutorialOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {error && <p className="error-box">{error}</p>}

      <section className="table-panel home-explainer">
        <div className="home-explainer-head">
          <h3>How MatchupMarket Works</h3>
          <div className="home-explainer-actions">
            <button type="button" className="home-tutorial-open-btn" onClick={() => openHomeTutorial("tour")}>
              Take A Tour
            </button>
            <button
              type="button"
              className="home-tutorial-open-btn home-tutorial-open-btn-secondary"
              onClick={() => openHomeTutorial("full")}
            >
              {isLoggedIn && isNewUser ? "Continue Full Tutorial" : "Open Full Tutorial"}
            </button>
          </div>
        </div>
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
