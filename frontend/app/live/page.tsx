"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, isUnauthorizedError } from "@/lib/api";
import EmptyStatePanel from "@/components/empty-state-panel";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { LiveGame, LiveGamePlayer, LiveGames } from "@/lib/types";

type TeamGroup = {
  team: string;
  topPlayers: LiveGamePlayer[];
  allPlayers: LiveGamePlayer[];
  gameFantasyPointsTotal: number;
};

type WinProbabilityPoint = {
  capturedAt: string;
  awayTeam: string;
  homeTeam: string;
  awayProbability: number;
  homeProbability: number;
  scoreLabel: string;
  situationLabel: string;
};

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

function groupTeams(game: LiveGame): TeamGroup[] {
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
        gameFantasyPointsTotal: sorted.reduce((sum, player) => sum + player.game_fantasy_points, 0),
      };
    });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function pickWinProbabilityTeams(teams: TeamGroup[]): [TeamGroup, TeamGroup] | null {
  if (teams.length < 2) return null;
  const ranked = [...teams]
    .sort((a, b) => {
      if (b.gameFantasyPointsTotal !== a.gameFantasyPointsTotal) {
        return b.gameFantasyPointsTotal - a.gameFantasyPointsTotal;
      }
      return a.team.localeCompare(b.team);
    })
    .slice(0, 2)
    .sort((a, b) => a.team.localeCompare(b.team));
  return [ranked[0], ranked[1]];
}

function estimateWinProbabilityFromPoints(teamPoints: number, opponentPoints: number): number {
  const baseWeight = 10;
  const team = Math.max(0, teamPoints);
  const opponent = Math.max(0, opponentPoints);
  const denominator = team + opponent + baseWeight * 2;
  if (denominator <= 0) return 50;
  return clamp(((team + baseWeight) / denominator) * 100, 1, 99);
}

function parseTeamsFromLabel(gameLabel: string): { awayTeam: string; homeTeam: string } | null {
  const trimmed = gameLabel.trim();
  if (!trimmed) return null;
  const atSplit = trimmed.split(/\s+@\s+/);
  if (atSplit.length === 2 && atSplit[0] && atSplit[1]) {
    return { awayTeam: atSplit[0].trim(), homeTeam: atSplit[1].trim() };
  }
  const vsSplit = trimmed.split(/\s+vs\.?\s+/i);
  if (vsSplit.length === 2 && vsSplit[0] && vsSplit[1]) {
    return { awayTeam: vsSplit[0].trim(), homeTeam: vsSplit[1].trim() };
  }
  return null;
}

function sameTeam(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function resolveAwayHomeTeams(game: LiveGame, teams: TeamGroup[]): { awayTeam: string; homeTeam: string } | null {
  if (game.state?.away_team && game.state?.home_team) {
    return { awayTeam: game.state.away_team, homeTeam: game.state.home_team };
  }
  const fromLabel = parseTeamsFromLabel(game.game_label);
  if (fromLabel) return fromLabel;
  const selected = pickWinProbabilityTeams(teams);
  if (!selected) return null;
  return {
    awayTeam: selected[0].team,
    homeTeam: selected[1].team,
  };
}

function totalPointsForTeam(teams: TeamGroup[], teamCode: string): number {
  const found = teams.find((team) => sameTeam(team.team, teamCode));
  return found?.gameFantasyPointsTotal ?? 0;
}

function formatBaseState(game: LiveGame): string {
  const state = game.state;
  if (!state) return "Bases unavailable";
  const runners: string[] = [];
  if (state.runner_on_first) runners.push("1st");
  if (state.runner_on_second) runners.push("2nd");
  if (state.runner_on_third) runners.push("3rd");
  if (runners.length === 0) return "Bases empty";
  return `Runners: ${runners.join(", ")}`;
}

function formatInningState(game: LiveGame): string {
  const state = game.state;
  if (!state || (!state.inning_half && state.inning == null)) return "State pending";
  const inning = state.inning ?? "--";
  const half = (state.inning_half ?? "").trim().toUpperCase();
  if (half === "TOP") return `Top ${inning}`;
  if (half === "BOTTOM") return `Bottom ${inning}`;
  if (half === "MIDDLE") return `Mid ${inning}`;
  if (half === "END") return `End ${inning}`;
  return half ? `${half} ${inning}` : `Inning ${inning}`;
}

function estimateAwayWinProbability(game: LiveGame, teams: TeamGroup[], awayTeam: string, homeTeam: string): number {
  const state = game.state;
  const awayScore = state?.away_score;
  const homeScore = state?.home_score;
  const hasScore = awayScore != null && homeScore != null;
  if (!hasScore) {
    const awayPoints = totalPointsForTeam(teams, awayTeam);
    const homePoints = totalPointsForTeam(teams, homeTeam);
    return estimateWinProbabilityFromPoints(awayPoints, homePoints);
  }

  const inning = state?.inning ?? 1;
  const outs = state?.outs == null ? 0 : clamp(state.outs, 0, 3);
  const inningHalf = (state?.inning_half ?? "").trim().toUpperCase();
  const baseOuts = Math.max(0, inning - 1) * 6;
  let outsElapsed = baseOuts + outs;
  if (inningHalf === "BOTTOM") outsElapsed = baseOuts + 3 + outs;
  if (inningHalf === "MIDDLE") outsElapsed = baseOuts + 3;
  if (inningHalf === "END") outsElapsed = baseOuts + 6;

  const progress = clamp(outsElapsed / 54, 0, 1.3);
  const runDiff = awayScore - homeScore;
  let scoreEdge = runDiff * (0.9 + progress * 2.8);

  const runnerPressure =
    (state?.runner_on_first ? 0.45 : 0) +
    (state?.runner_on_second ? 0.75 : 0) +
    (state?.runner_on_third ? 1.05 : 0);
  const outsLeverage = state?.outs == null ? 0.65 : clamp((3 - state.outs) / 3, 0, 1);
  const countLeverage = clamp(1 + ((state?.balls ?? 0) - (state?.strikes ?? 0)) * 0.08, 0.82, 1.2);
  const pressure = runnerPressure * outsLeverage * countLeverage;
  if (sameTeam(state?.offense_team, awayTeam)) scoreEdge += pressure;
  if (sameTeam(state?.offense_team, homeTeam)) scoreEdge -= pressure;

  if (inning >= 9 && inningHalf === "BOTTOM" && homeScore >= awayScore) {
    scoreEdge -= 1 + (homeScore - awayScore) * 0.35;
  }
  if (inning >= 9 && inningHalf === "TOP" && awayScore > homeScore) {
    scoreEdge += 0.25 + (awayScore - homeScore) * 0.1;
  }

  return clamp(100 / (1 + Math.exp(-scoreEdge)), 1, 99);
}

function nextWinProbabilityPoint(game: LiveGame, teams: TeamGroup[], generatedAt: string): WinProbabilityPoint | null {
  const teamsForGame = resolveAwayHomeTeams(game, teams);
  if (!teamsForGame) return null;
  const awayTeam = teamsForGame.awayTeam;
  const homeTeam = teamsForGame.homeTeam;
  const awayProbability = roundTo(estimateAwayWinProbability(game, teams, awayTeam, homeTeam), 1);
  const homeProbability = roundTo(100 - awayProbability, 1);
  const hasScore = game.state?.away_score != null && game.state?.home_score != null;
  const scoreLabel = hasScore
    ? `${awayTeam} ${formatNumber(game.state?.away_score ?? 0, 0)} - ${formatNumber(game.state?.home_score ?? 0, 0)} ${homeTeam}`
    : `${awayTeam} vs ${homeTeam}`;
  const outsLabel =
    game.state?.outs == null ? "Outs --" : `${game.state.outs} out${game.state.outs === 1 ? "" : "s"}`;
  const battingLabel = game.state?.offense_team ? ` | Batting ${game.state.offense_team}` : "";
  return {
    capturedAt: game.updated_at ?? generatedAt,
    awayTeam,
    homeTeam,
    awayProbability,
    homeProbability,
    scoreLabel,
    situationLabel: `${formatInningState(game)} | ${outsLabel} | ${formatBaseState(game)}${battingLabel}`,
  };
}

function WinProbabilityChart({ points }: { points: WinProbabilityPoint[] }) {
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  const width = 340;
  const height = 124;
  const left = 10;
  const right = 10;
  const top = 12;
  const bottom = 14;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const yAt = (probability: number) => top + ((100 - probability) / 100) * plotHeight;
  const xAt = (index: number) => (points.length === 1 ? left + plotWidth / 2 : left + (index * plotWidth) / (points.length - 1));
  const midpointY = yAt(50);
  const toPath = (coords: Array<{ x: number; y: number }>) =>
    coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`).join(" ");

  const homeCoords = points.map((point, index) => ({ x: xAt(index), y: yAt(point.homeProbability) }));

  return (
    <section className="live-winprob-card" aria-label={`Win probability for ${latest.awayTeam} and ${latest.homeTeam}`}>
      <div className="live-winprob-head">
        <span className="subtle">Win Probability (single-line view)</span>
        <span className="subtle">{points.length} snapshots</span>
      </div>
      <p className="subtle live-winprob-score">{latest.scoreLabel}</p>
      <p className="subtle live-winprob-state">{latest.situationLabel}</p>
      <div className="live-winprob-legend">
        <span className="live-winprob-team">
          <strong className="live-winprob-team-name live-winprob-team-a">{latest.awayTeam}</strong>
          <span>{formatNumber(latest.awayProbability, 1)}%</span>
        </span>
        <span className="live-winprob-team">
          <strong className="live-winprob-team-name live-winprob-team-b">{latest.homeTeam}</strong>
          <span>{formatNumber(latest.homeProbability, 1)}%</span>
        </span>
      </div>
      <div className="live-winprob-chart-layout">
        <span className="live-winprob-pole live-winprob-pole-top">{latest.awayTeam} road (top)</span>
        <div className="live-winprob-chart-wrap">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="live-winprob-chart"
            role="img"
            aria-label={`Home win probability line. ${latest.homeTeam} ${formatNumber(
              latest.homeProbability,
              1,
            )} percent, ${latest.awayTeam} ${formatNumber(latest.awayProbability, 1)} percent`}
          >
            <line x1={left} x2={width - right} y1={midpointY} y2={midpointY} className="live-winprob-midline" />
            <path d={toPath(homeCoords)} className="live-winprob-line-home" />
            <circle cx={homeCoords[homeCoords.length - 1].x} cy={homeCoords[homeCoords.length - 1].y} r={3} className="live-winprob-dot-home" />
          </svg>
        </div>
        <span className="live-winprob-pole live-winprob-pole-bottom">{latest.homeTeam} home (bottom)</span>
      </div>
      <div className="live-winprob-axis">
        <span>50% midline (47% home plots slightly below)</span>
        <span>Updated {formatStamp(latest.capturedAt)}</span>
      </div>
    </section>
  );
}

export default function LivePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<LiveGames | null>(null);
  const [sportFilter, setSportFilter] = useState("ALL");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [winProbabilityByGameId, setWinProbabilityByGameId] = useState<Record<string, WinProbabilityPoint[]>>({});
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

  useEffect(() => {
    if (!payload) return;
    setWinProbabilityByGameId((previous) => {
      const generatedAt = payload.generated_at ?? new Date().toISOString();
      const next: Record<string, WinProbabilityPoint[]> = {};

      for (const game of payload.games) {
        const teams = groupTeams(game);
        const point = nextWinProbabilityPoint(game, teams, generatedAt);
        if (!point) continue;

        const previousSeries = previous[game.game_id] ?? [];
        const lastPoint = previousSeries[previousSeries.length - 1];
        const sameTeams = !lastPoint || (lastPoint.awayTeam === point.awayTeam && lastPoint.homeTeam === point.homeTeam);
        const unchanged =
          Boolean(lastPoint) &&
          sameTeams &&
          lastPoint.awayProbability === point.awayProbability &&
          lastPoint.homeProbability === point.homeProbability &&
          lastPoint.scoreLabel === point.scoreLabel &&
          lastPoint.situationLabel === point.situationLabel &&
          lastPoint.capturedAt === point.capturedAt;

        if (unchanged) {
          next[game.game_id] = previousSeries.slice(-40);
          continue;
        }

        const series = sameTeams ? [...previousSeries, point] : [point];
        next[game.game_id] = series.slice(-40);
      }

      return next;
    });
  }, [payload]);

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
                  const winProbabilityPoints = winProbabilityByGameId[game.game_id] ?? [];
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
                        <WinProbabilityChart points={winProbabilityPoints} />
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
                                      <span
                                        className="live-top-name live-top-name-clickable"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          void router.push(`/player/${player.player_id}`);
                                        }}
                                      >
                                        {player.name}
                                      </span>
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
