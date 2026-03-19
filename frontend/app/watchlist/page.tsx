"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import EmptyStatePanel from "@/components/empty-state-panel";
import { apiDelete, apiGet, isUnauthorizedError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { WatchlistPlayer } from "@/lib/types";

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

export default function WatchlistPage() {
  const [players, setPlayers] = useState<WatchlistPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiGet<WatchlistPlayer[]>("/watchlist/players");
      setPlayers(next);
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
  }, []);

  useAdaptivePolling(load, { activeMs: 45_000, hiddenMs: 180_000 });

  async function removePlayer(playerId: number) {
    setBusyId(playerId);
    setError("");
    try {
      const next = await apiDelete<WatchlistPlayer[]>(`/watchlist/players/${playerId}`);
      setPlayers(next);
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Tracking</p>
          <h1>Watchlist</h1>
          <p className="subtle">Keep a tighter eye on players you may want to trade or discuss.</p>
        </div>
      </section>

      {error && <p className="error-box" role="alert">{error}</p>}

      {loading ? (
        <section className="table-panel" aria-busy="true">
          <div className="skeleton-stack">
            <div className="skeleton-line lg" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        </section>
      ) : players.length === 0 ? (
        <EmptyStatePanel
          kind="market"
          title="No watched players yet"
          description="Use the Watch button on any player page to save names you want to revisit."
          actionHref="/market"
          actionLabel="Open Market"
        />
      ) : (
        <section className="table-panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Sport</th>
                  <th>Current Price</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <tr key={player.player_id}>
                    <td>
                      <Link href={`/player/${player.player_id}`} className="community-user-link">
                        {player.name}
                      </Link>
                      <div className="subtle">
                        {player.team} {player.position}
                      </div>
                    </td>
                    <td>{player.sport}</td>
                    <td>{formatCurrency(player.spot_price)}</td>
                    <td>{player.live?.live_now ? "Live now" : "Watching"}</td>
                    <td>{formatStamp(player.added_at)}</td>
                    <td>
                      <button type="button" onClick={() => void removePlayer(player.player_id)} disabled={busyId === player.player_id}>
                        {busyId === player.player_id ? "Removing..." : "Remove"}
                      </button>
                    </td>
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
