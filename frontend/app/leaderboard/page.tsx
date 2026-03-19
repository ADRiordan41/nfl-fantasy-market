"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { apiGet, isUnauthorizedError } from "@/lib/api";
import EmptyStatePanel from "@/components/empty-state-panel";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { LeaderboardResponse } from "@/lib/types";

const SPORT_OPTIONS = ["ALL", "MLB", "NFL", "NBA", "NHL"] as const;
type LeaderboardScope = "global" | "friends";

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

export default function LeaderboardPage() {
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [sport, setSport] = useState<(typeof SPORT_OPTIONS)[number]>("ALL");
  const [payload, setPayload] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiGet<LeaderboardResponse>(`/leaderboard?scope=${scope}&sport=${sport}&limit=100`);
      setPayload(next);
      setError("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        window.location.href = "/auth";
        return;
      }
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [scope, sport]);

  useAdaptivePolling(load, { activeMs: 45_000, hiddenMs: 180_000 });

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Competition</p>
          <h1>Leaderboard</h1>
          <p className="subtle">Track who is leading the market and where your account ranks.</p>
        </div>
      </section>

      <section className="toolbar">
        <select value={scope} onChange={(event) => setScope(event.target.value as LeaderboardScope)}>
          <option value="global">Global</option>
          <option value="friends">Friends</option>
        </select>
        <select value={sport} onChange={(event) => setSport(event.target.value as (typeof SPORT_OPTIONS)[number])}>
          {SPORT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "ALL" ? "All sports" : option}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        <p className="subtle toolbar-last-updated">
          {payload ? `Updated ${formatStamp(payload.generated_at)}` : "Loading leaderboard"}
        </p>
      </section>

      {error && <p className="error-box" role="alert">{error}</p>}

      {loading && !payload ? (
        <section className="table-panel" aria-busy="true">
          <div className="skeleton-stack">
            <div className="skeleton-line lg" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        </section>
      ) : !payload || payload.entries.length === 0 ? (
        <EmptyStatePanel
          kind="community"
          title="No ranked users yet"
          description={scope === "friends" ? "Add friends to compare performance privately." : "Once users begin trading, rankings will appear here."}
          actionHref={scope === "friends" ? "/community" : "/market"}
          actionLabel={scope === "friends" ? "Open Community" : "Open Market"}
        />
      ) : (
        <section className="table-panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>User</th>
                  <th>Equity</th>
                  <th>Cash</th>
                  <th>Holdings</th>
                  <th>Return</th>
                </tr>
              </thead>
              <tbody>
                {payload.entries.map((entry) => (
                  <tr key={entry.user_id} className={entry.is_current_user ? "leaderboard-row-active" : ""}>
                    <td>#{formatNumber(entry.rank, 0)}</td>
                    <td>
                      <Link href={`/profile/${entry.username}`} className="community-user-link">
                        {entry.username}
                      </Link>
                      {entry.is_current_user && <div className="subtle">You</div>}
                    </td>
                    <td>{formatCurrency(entry.equity)}</td>
                    <td>{formatCurrency(entry.cash_balance)}</td>
                    <td>{formatCurrency(entry.holdings_value)}</td>
                    <td className={entry.return_pct >= 0 ? "up" : "down"}>{formatNumber(entry.return_pct, 2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
