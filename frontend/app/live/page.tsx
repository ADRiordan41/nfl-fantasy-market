"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { apiGet, isUnauthorizedError } from "@/lib/api";
import EmptyStatePanel from "@/components/empty-state-panel";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { LiveGame, LiveGamePlayer, LiveGames } from "@/lib/types";

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

function sortPlayersByPerformance(players: LiveGamePlayer[]): LiveGamePlayer[] {
  return [...players].sort((a, b) => {
    if (b.game_fantasy_points !== a.game_fantasy_points) {
      return b.game_fantasy_points - a.game_fantasy_points;
    }
    if (b.points_to_date !== a.points_to_date) {
      return b.points_to_date - a.points_to_date;
    }
    return a.name.localeCompare(b.name);
  });
}

function groupTeams(game: LiveGame): Array<{ team: string; topPlayers: LiveGamePlayer[]; allPlayers: LiveGamePlayer[] }> {
  const byTeam = new Map<string, LiveGamePlayer[]>();
  for (const player of game.players) {
    const team = player.team || "Team";
    const existing = byTeam.get(team) ?? [];
    existing.push(player);
    byTeam.set(team, existing);
  }
  return Array.from(byTeam.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([team, players]) => {
      const sorted = sortPlayersByPerformance(players);
      return {
        team,
        topPlayers: sorted.slice(0, 3),
        allPlayers: sorted,
      };
    });
}

export default function LivePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<LiveGames | null>(null);
  const [sportFilter, setSportFilter] = useState("ALL");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiGet<LiveGames>("/live/games");
      setPayload(next);
      setLastUpdated(new Date().toISOString());
      setError("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useAdaptivePolling(load, { activeMs: 30_000, hiddenMs: 120_000 });

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
            Active games. Live stats. Place your orders.
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
        <button onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        <p className="subtle toolbar-last-updated">Last refreshed {formatStamp(lastUpdated)}</p>
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
      ) : visibleGames.length === 0 ? (
        <EmptyStatePanel
          kind="live"
          title="No live games right now"
          description="When games go live, this page will stream updates automatically."
          actionHref="/market"
          actionLabel="View Market"
        />
      ) : (
        <>
          <section className="table-panel">
            <p className="subtle">
              Showing {formatNumber(visibleGames.length)} games and {formatNumber(visiblePlayers)} live players.
            </p>
          </section>
          <section className="live-games-grid">
            {visibleGames.map((game) => (
              <article key={game.game_id} className={`live-game-card${expandedGameId === game.game_id ? " expanded" : ""}`}>
                {(() => {
                  const teams = groupTeams(game);
                  const expanded = expandedGameId === game.game_id;
                  return (
                    <>
                      <button
                        type="button"
                        className="live-game-toggle"
                        onClick={() => setExpandedGameId(expanded ? null : game.game_id)}
                        aria-expanded={expanded}
                      >
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
                        <div className="live-team-grid">
                          {teams.map((team) => (
                            <section key={`${game.game_id}-${team.team}`} className="live-team-panel">
                              <div className="live-team-head">
                                <strong>{team.team}</strong>
                                <span className="subtle">Top 3 performers</span>
                              </div>
                              <div className="live-top-list">
                                {team.topPlayers.map((player) => (
                                  <div key={`${game.game_id}-${team.team}-${player.player_id}`} className="live-top-row">
                                    <div className="live-top-player">
                                      <span className="live-top-name">{player.name}</span>
                                      <span className="subtle">{player.position}</span>
                                    </div>
                                    <div className="live-top-metrics">
                                      <strong>{formatNumber(player.game_fantasy_points, 2)} pts</strong>
                                      <span className="subtle">{formatCurrency(player.spot_price)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                        <div className="live-card-footer">
                          <span className="subtle">{expanded ? "Hide box score" : "Tap to view full box score"}</span>
                        </div>
                      </button>
                      {expanded ? (
                        <div className="table-wrap live-box-score-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Player</th>
                                <th>Team</th>
                                <th>Live Stat Line</th>
                                <th>Game Pts</th>
                                <th>Season Pts</th>
                                <th>Current Price</th>
                              </tr>
                            </thead>
                            <tbody>
                              {teams.flatMap((team) =>
                                team.allPlayers.map((player) => (
                                  <tr key={`${game.game_id}-${player.player_id}`}>
                                    <td>
                                      <Link
                                        href={`/player/${player.player_id}`}
                                        className="community-user-link"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        {player.name}
                                      </Link>
                                      <div className="subtle">{player.position}</div>
                                    </td>
                                    <td>{player.team}</td>
                                    <td>{player.game_stat_line ?? "--"}</td>
                                    <td>{formatNumber(player.game_fantasy_points, 2)}</td>
                                    <td>{formatNumber(player.points_to_date, 2)}</td>
                                    <td>{formatCurrency(player.spot_price)}</td>
                                  </tr>
                                )),
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
