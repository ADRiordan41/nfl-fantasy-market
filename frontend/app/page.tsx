"use client";

import Link from "next/link";
import type { SVGProps } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { apiGet, getAuthToken } from "@/lib/api";
import { formatCurrency, formatNumber, formatSignedPercent } from "@/lib/format";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type {
  ForumPostSummary,
  LeaderboardResponse,
  MarketMovers,
  Player,
} from "@/lib/types";

type HomeIntroStep = {
  eyebrow: string;
  icon: "market" | "position" | "portfolio" | "live" | "forum";
  href: string;
  title: string;
  body: string;
  tone?: "up" | "down" | "brand";
  tradeActions?: {
    label: string;
    description: string;
    tone: "up" | "down";
  }[];
};

const HOME_INTRO_STEPS: HomeIntroStep[] = [
  {
    eyebrow: "I",
    icon: "market",
    href: "/market",
    title: "Explore the Market",
    body: "Player prices move as their fantasy value changes. Strong performance, rising opportunity, and market demand can push prices up, while weaker production or fading roles can pull them down. Early prices lean on projections, then actual fantasy production and market pressure carry more weight as the season progresses. When the season ends, shares liquidate at each player's total fantasy points.",
    tone: "brand",
  },
  {
    eyebrow: "II",
    icon: "position",
    href: "/market",
    title: "Take a Position by Buying and Shorting Players",
    body: "Buy when you think fantasy value is headed up, or short when you think the price is too high. Preview the quote, then confirm the trade when the move looks right.",
    tradeActions: [
      {
        label: "Buy",
        description: "Open a long position when you think value is rising.",
        tone: "up",
      },
      {
        label: "Short",
        description: "Open a short position when you think value is too high.",
        tone: "down",
      },
    ],
  },
  {
    eyebrow: "III",
    icon: "portfolio",
    href: "/portfolio",
    title: "Manage Your Portfolio",
    body: "Use Portfolio and Profile to follow cash, holdings, open positions, gains, and public activity as your strategy develops.",
    tone: "brand",
    tradeActions: [
      {
        label: "Sell",
        description: "Close long shares to lock in cash or reduce exposure.",
        tone: "down",
      },
      {
        label: "Cover",
        description: "Close short shares when your downside read has played out.",
        tone: "up",
      },
    ],
  },
  {
    eyebrow: "IV",
    icon: "live",
    href: "/live",
    title: "Follow the Action in the Live Game Center",
    body: "Watch active games, track win probability swings, and follow player performance as live stats update.",
    tone: "brand",
  },
  {
    eyebrow: "V",
    icon: "forum",
    href: "/community",
    title: "Join the Conversation in the Forum",
    body: "Post takes, compare ideas, and talk through market moves with other users before the next price swing.",
    tone: "brand",
  },
];

function HomeDockIconGradient({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#ffad58" />
        <stop offset="0.34" stopColor="#ff8f2f" />
        <stop offset="0.62" stopColor="#66a9ff" />
        <stop offset="1" stopColor="#3f8cff" />
      </linearGradient>
    </defs>
  );
}

function HomeIntroIcon({ kind, ...props }: SVGProps<SVGSVGElement> & { kind: HomeIntroStep["icon"] }) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
      style={{ ...(props.style ?? {}), stroke: `url(#${gradientId})` }}
    >
      <HomeDockIconGradient id={gradientId} />
      {kind === "market" && (
        <>
          <path d="M4 20V10" />
          <path d="M9 20V6" />
          <path d="M14 20v-4" />
          <path d="M19 20V8" />
          <path d="M3.5 14.5L8.5 11l4 2 7-6" />
        </>
      )}
      {kind === "position" && (
        <>
          <path d="M7 18V6" />
          <path d="m7 6-3 3" />
          <path d="m7 6 3 3" />
          <path d="M17 6v12" />
          <path d="m17 18-3-3" />
          <path d="m17 18 3-3" />
        </>
      )}
      {kind === "portfolio" && (
        <>
          <path d="M12 3v9h9" />
          <path d="M12 3a9 9 0 1 0 9 9" />
          <path d="M12 12 5.8 18.2" />
        </>
      )}
      {kind === "live" && (
        <>
          <path d="M8.6 4 12 7" />
          <path d="M15.4 4 12 7" />
          <rect x="2.6" y="7" width="18.8" height="11.6" rx="2.6" />
          <path d="M8.4 20.2h7.2" />
          <path d="M7.4 18.6 6.4 20.4" />
          <path d="m16.6 18.6 1 1.8" />
        </>
      )}
      {kind === "forum" && (
        <>
          <path d="M5 6.5h14a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-6l-3.6 3V17H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
          <path d="M8 10h8" />
          <path d="M8 13h5.5" />
        </>
      )}
    </svg>
  );
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
        setIsLoggedIn(false);
        setAuthResolved(true);
        return;
      }

      try {
        await apiGet("/auth/me");
        if (cancelled) return;
        setIsLoggedIn(true);
      } catch {
        if (cancelled) return;
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
            Matchup Market is a sports market game where you buy and short shares of players based on how you think
            their fantasy value will move. If you believe a player is ready to rise, buy shares before the market catches
            on. If you think a player is overvalued, short shares and benefit if the price falls. It&apos;s a simple,
            competitive game where your sports knowledge becomes your edge.
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

      <section className="home-explainer" aria-labelledby="home-explainer-title">
        <div className="home-explainer-head">
          <div>
            <p className="eyebrow">Quick Start</p>
            <h2 id="home-explainer-title" className="home-explainer-title">How Matchup Market Works</h2>
            <p className="subtle home-explainer-subtitle">
              Turn your sports knowledge into market moves. Evaluate player value, take a position, track your
              portfolio, and join the conversation.
            </p>
          </div>
          <div className="home-explainer-actions" aria-label="Homepage onboarding links">
            <Link href="/market" className="primary-btn ghost-link home-market-cta">
              Explore Market
            </Link>
            <Link href={isLoggedIn ? "/portfolio" : "/auth"} className="ghost-link">
              {isLoggedIn ? "View Portfolio" : "Create Account"}
            </Link>
            <Link href="/community" className="ghost-link">
              Join The Forum
            </Link>
          </div>
        </div>

        <div className="home-steps">
          {HOME_INTRO_STEPS.map((step) => (
            <Link
              href={step.href}
              className={`home-step${step.tone ? ` home-step-${step.tone}` : ""}`}
              key={step.title}
              aria-label={`${step.title}: ${step.body}`}
            >
              <span className="home-step-marker">
                <span className="home-step-number">{step.eyebrow}</span>
                <span className="home-step-icon-wrap">
                  <HomeIntroIcon kind={step.icon} className="home-step-icon" />
                </span>
              </span>
              <h3>{step.title}</h3>
              <p className="subtle home-step-body">{step.body}</p>
              {step.tradeActions && (
                <div className="home-step-trade-grid">
                  {step.tradeActions.map((action) => (
                    <div className={`home-trade-action home-trade-action-${action.tone}`} key={action.label}>
                      <span>{action.label}</span>
                      <p>{action.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </Link>
          ))}
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
