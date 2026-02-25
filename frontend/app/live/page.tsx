"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, isUnauthorizedError } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { LiveGames } from "@/lib/types";

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
  });
}

export default function LivePage() {
  const router = useRouter();
  const [payload, setPayload] = useState<LiveGames | null>(null);
  const [sportFilter, setSportFilter] = useState("ALL");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await apiGet<LiveGames>("/live/games");
      setPayload(next);
      setError("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const intervalId = window.setInterval(() => {
      void load();
    }, 30000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(intervalId);
    };
  }, [load]);

  const sports = useMemo(
    () => ["ALL", ...Array.from(new Set((payload?.games ?? []).map((game) => game.sport))).sort()],
    [payload],
  );

  const activeSportFilter = sports.includes(sportFilter) ? sportFilter : "ALL";

  const visibleGames = useMemo(() => {
    const games = payload?.games ?? [];
    if (activeSportFilter === "ALL") return games;
    return games.filter((game) => game.sport === activeSportFilter);
  }, [activeSportFilter, payload]);

  const visiblePlayers = useMemo(
    () => visibleGames.reduce((sum, game) => sum + game.players.length, 0),
    [visibleGames],
  );

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Live</p>
          <h1>Live Game Center</h1>
          <p className="subtle">
            Active games, player-level live production, and current spot prices. Auto-refreshes every 30 seconds.
          </p>
        </div>
        <div className="hero-metrics">
          <article className="kpi-card">
            <span>Live Games</span>
            <strong>{formatNumber(payload?.live_games_count ?? 0)}</strong>
          </article>
          <article className="kpi-card">
            <span>Live Players</span>
            <strong>{formatNumber(payload?.live_players_count ?? 0)}</strong>
          </article>
          <article className="kpi-card">
            <span>Updated</span>
            <strong>{formatStamp(payload?.generated_at ?? null)}</strong>
          </article>
        </div>
      </section>

      <section className="toolbar">
        <select value={activeSportFilter} onChange={(event) => setSportFilter(event.target.value)}>
          {sports.map((sport) => (
            <option key={sport} value={sport}>
              {sport === "ALL" ? "All sports" : sport}
            </option>
          ))}
        </select>
        <button onClick={load}>Refresh</button>
      </section>

      {error && <p className="error-box">{error}</p>}

      {visibleGames.length === 0 ? (
        <section className="empty-panel">
          <h3>No live games right now</h3>
          <p className="subtle">
            When games are live, real-time updates will appear here.
          </p>
        </section>
      ) : (
        <>
          <section className="table-panel">
            <p className="subtle">
              Showing {formatNumber(visibleGames.length)} games and {formatNumber(visiblePlayers)} live players.
            </p>
          </section>
          <section className="live-games-grid">
            {visibleGames.map((game) => (
              <article key={game.game_id} className="live-game-card">
                <div className="live-now-head">
                  <span className="live-indicator">
                    <span className="live-dot" />
                    LIVE NOW
                  </span>
                  <span className="live-status">{game.game_status ?? "In progress"}</span>
                </div>
                <h3 className="live-game-title">
                  {game.sport} {game.game_label}
                </h3>
                <p className="subtle">
                  Week {game.week ?? "--"} | Players {formatNumber(game.live_player_count)} | Game points{" "}
                  {formatNumber(game.game_fantasy_points_total, 2)} | Updated {formatStamp(game.updated_at)}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Live Stat Line</th>
                        <th>Game Pts</th>
                        <th>Season Pts</th>
                        <th>Spot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {game.players.map((player) => (
                        <tr key={`${game.game_id}-${player.player_id}`}>
                          <td>
                            <Link href={`/player/${player.player_id}`} className="community-user-link">
                              {player.name}
                            </Link>
                            <div className="subtle">
                              {player.team} {player.position}
                            </div>
                          </td>
                          <td>{player.game_stat_line ?? "--"}</td>
                          <td>{formatNumber(player.game_fantasy_points, 2)}</td>
                          <td>{formatNumber(player.points_to_date, 2)}</td>
                          <td>{formatCurrency(player.spot_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
