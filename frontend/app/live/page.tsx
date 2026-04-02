"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type PointerEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, isUnauthorizedError } from "@/lib/api";
import EmptyStatePanel from "@/components/empty-state-panel";
import { formatCurrency, formatNumber } from "@/lib/format";
import { CHICAGO_TIME_ZONE, chicagoNowStamp } from "@/lib/time";
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
  markerLabel: string;
  atBatIndex: number | null;
};

type WinProbabilityContext = {
  awayScore: number | null;
  homeScore: number | null;
  inning: number | null;
  inningHalf: string | null;
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  runnerOnFirst: boolean | null;
  runnerOnSecond: boolean | null;
  runnerOnThird: boolean | null;
  offenseTeam: string | null;
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseTimestamp(value: string): Date {
  const raw = value.trim();
  if (!raw) return new Date(Number.NaN);
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  return new Date(normalized);
}

function formatStamp(value: string | null): string {
  if (!value) return "--";
  const parsed = parseTimestamp(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    timeZone: CHICAGO_TIME_ZONE,
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

function resolveAwayHomeTeams(game: LiveGame, teams: TeamGroup[]): { awayTeam: string; homeTeam: string } {
  const stateAway = (game.state?.away_team ?? "").trim();
  const stateHome = (game.state?.home_team ?? "").trim();
  if (stateAway && stateHome) {
    return { awayTeam: stateAway, homeTeam: stateHome };
  }
  const fromLabel = parseTeamsFromLabel(game.game_label);
  const selected = pickWinProbabilityTeams(teams);
  let awayTeam = stateAway || fromLabel?.awayTeam || selected?.[0]?.team || "";
  let homeTeam = stateHome || fromLabel?.homeTeam || selected?.[1]?.team || "";

  if (!awayTeam && teams.length > 0) awayTeam = teams[0].team;
  if (!homeTeam && teams.length > 1) homeTeam = teams[1].team;
  if (!awayTeam) awayTeam = "AWAY";
  if (!homeTeam) homeTeam = "HOME";
  if (sameTeam(awayTeam, homeTeam)) {
    homeTeam = sameTeam(awayTeam, "HOME") ? "AWAY" : "HOME";
  }

  return { awayTeam, homeTeam };
}

function totalPointsForTeam(teams: TeamGroup[], teamCode: string): number {
  const found = teams.find((team) => sameTeam(team.team, teamCode));
  return found?.gameFantasyPointsTotal ?? 0;
}

function formatBaseState(context: WinProbabilityContext): string {
  const runners: string[] = [];
  if (context.runnerOnFirst) runners.push("1st");
  if (context.runnerOnSecond) runners.push("2nd");
  if (context.runnerOnThird) runners.push("3rd");
  if (runners.length === 0) return "Bases empty";
  return `Runners: ${runners.join(", ")}`;
}

function formatInningState(context: WinProbabilityContext): string {
  if (!context.inningHalf && context.inning == null) return "State pending";
  const inning = context.inning ?? "--";
  const half = (context.inningHalf ?? "").trim().toUpperCase();
  if (half === "TOP") return `Top ${inning}`;
  if (half === "BOTTOM") return `Bottom ${inning}`;
  if (half === "MIDDLE") return `Mid ${inning}`;
  if (half === "END") return `End ${inning}`;
  return half ? `${half} ${inning}` : `Inning ${inning}`;
}

function isCompletedGameStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return normalized.includes("FINAL") || normalized.includes("COMPLETE") || normalized.includes("GAME OVER");
}

function isSettledGame(game: Pick<LiveGame, "is_live" | "game_status">): boolean {
  return !game.is_live || isCompletedGameStatus(game.game_status);
}

function finalProbabilityFromScores(
  awayScore: number | null | undefined,
  homeScore: number | null | undefined,
): { awayProbability: number; homeProbability: number } | null {
  if (awayScore == null || homeScore == null) return null;
  if (awayScore > homeScore) return { awayProbability: 100, homeProbability: 0 };
  if (homeScore > awayScore) return { awayProbability: 0, homeProbability: 100 };
  return null;
}

function estimateAwayWinProbability(
  context: WinProbabilityContext,
  args: {
    awayTeam: string;
    homeTeam: string;
    fallbackAwayPoints: number;
    fallbackHomePoints: number;
  },
): number {
  const { awayTeam, homeTeam, fallbackAwayPoints, fallbackHomePoints } = args;
  const awayScore = context.awayScore;
  const homeScore = context.homeScore;
  const hasScore = awayScore != null && homeScore != null;
  if (!hasScore) {
    return estimateWinProbabilityFromPoints(fallbackAwayPoints, fallbackHomePoints);
  }

  const inning = context.inning ?? 1;
  const outs = context.outs == null ? 0 : clamp(context.outs, 0, 3);
  const inningHalf = (context.inningHalf ?? "").trim().toUpperCase();
  const baseOuts = Math.max(0, inning - 1) * 6;
  let outsElapsed = baseOuts + outs;
  if (inningHalf === "BOTTOM") outsElapsed = baseOuts + 3 + outs;
  if (inningHalf === "MIDDLE") outsElapsed = baseOuts + 3;
  if (inningHalf === "END") outsElapsed = baseOuts + 6;

  const progress = clamp(outsElapsed / 54, 0, 1.3);
  const runDiff = awayScore - homeScore;
  const runInfluencePerRun = 4 + progress * 8.5;
  let awayProbability = 50 + runDiff * runInfluencePerRun;

  const runnerPressure =
    (context.runnerOnFirst ? 1.0 : 0) +
    (context.runnerOnSecond ? 1.6 : 0) +
    (context.runnerOnThird ? 2.2 : 0);
  const outsLeverage = context.outs == null ? 0.7 : clamp((3 - context.outs) / 3, 0, 1);
  const pressurePhase = 0.5 + 0.5 * (1 - clamp(progress, 0, 1));
  const countEdge = ((context.balls ?? 0) - (context.strikes ?? 0)) * 0.9;
  const situationEdge = runnerPressure * outsLeverage * pressurePhase + countEdge;
  if (sameTeam(context.offenseTeam, awayTeam)) awayProbability += situationEdge;
  if (sameTeam(context.offenseTeam, homeTeam)) awayProbability -= situationEdge;

  if (inning >= 9 && inningHalf === "BOTTOM" && homeScore >= awayScore) {
    awayProbability -= 6 + (homeScore - awayScore) * 3;
  }
  if (inning >= 9 && inningHalf === "TOP" && awayScore > homeScore) {
    awayProbability += 2.5 + (awayScore - homeScore) * 0.7;
  }

  return clamp(awayProbability, 1, 99);
}

function contextFromLiveState(game: LiveGame): WinProbabilityContext {
  const state = game.state;
  return {
    awayScore: state?.away_score ?? null,
    homeScore: state?.home_score ?? null,
    inning: state?.inning ?? null,
    inningHalf: state?.inning_half ?? null,
    outs: state?.outs ?? null,
    balls: state?.balls ?? null,
    strikes: state?.strikes ?? null,
    runnerOnFirst: state?.runner_on_first ?? null,
    runnerOnSecond: state?.runner_on_second ?? null,
    runnerOnThird: state?.runner_on_third ?? null,
    offenseTeam: state?.offense_team ?? null,
  };
}

function contextFromAtBat(
  atBat: LiveGame["at_bats"][number],
  awayTeam: string,
  homeTeam: string,
): WinProbabilityContext {
  const half = (atBat.inning_half ?? "").trim().toUpperCase();
  const offenseTeam = half === "TOP" ? awayTeam : half === "BOTTOM" ? homeTeam : null;
  return {
    awayScore: atBat.away_score,
    homeScore: atBat.home_score,
    inning: atBat.inning,
    inningHalf: atBat.inning_half,
    outs: atBat.outs_after_play,
    balls: atBat.balls,
    strikes: atBat.strikes,
    runnerOnFirst: atBat.runner_on_first,
    runnerOnSecond: atBat.runner_on_second,
    runnerOnThird: atBat.runner_on_third,
    offenseTeam,
  };
}

function buildAtBatWinProbabilityPoints(game: LiveGame, teams: TeamGroup[], generatedAt: string): WinProbabilityPoint[] {
  const teamsForGame = resolveAwayHomeTeams(game, teams);
  const atBats = game.at_bats ?? [];
  if (atBats.length === 0) return [];
  const awayTeam = teamsForGame.awayTeam;
  const homeTeam = teamsForGame.homeTeam;
  const fallbackAwayPoints = totalPointsForTeam(teams, awayTeam);
  const fallbackHomePoints = totalPointsForTeam(teams, homeTeam);
  const rows = [...atBats].sort((a, b) => a.at_bat_index - b.at_bat_index);

  const series = rows.map((atBat) => {
    const context = contextFromAtBat(atBat, awayTeam, homeTeam);
    const awayProbability = roundTo(
      estimateAwayWinProbability(context, {
        awayTeam,
        homeTeam,
        fallbackAwayPoints,
        fallbackHomePoints,
      }),
      1,
    );
    const homeProbability = roundTo(100 - awayProbability, 1);
    const scoreLabel =
      atBat.away_score != null && atBat.home_score != null
        ? `${awayTeam} ${formatNumber(atBat.away_score, 0)} - ${formatNumber(atBat.home_score, 0)} ${homeTeam}`
        : `${awayTeam} vs ${homeTeam}`;
    const outsLabel =
      atBat.outs_after_play == null ? "Outs --" : `${atBat.outs_after_play} out${atBat.outs_after_play === 1 ? "" : "s"}`;
    const countLabel =
      atBat.balls != null && atBat.strikes != null
        ? `${atBat.balls}-${atBat.strikes} count`
        : atBat.balls != null
          ? `${atBat.balls} balls`
          : atBat.strikes != null
            ? `${atBat.strikes} strikes`
            : "Count --";
    const eventLabel = atBat.event ?? "At-bat result";
    return {
      capturedAt: atBat.occurred_at ?? game.updated_at ?? generatedAt,
      awayTeam,
      homeTeam,
      awayProbability,
      homeProbability,
      scoreLabel,
      situationLabel: `${formatInningState(context)} | ${outsLabel} | ${formatBaseState(context)} | ${countLabel} | ${eventLabel}`,
      markerLabel: eventLabel,
      atBatIndex: atBat.at_bat_index,
    };
  });
  const gameSettled = isSettledGame(game);
  if (gameSettled && series.length > 0) {
    const lastAtBat = rows[rows.length - 1];
    const finalProbabilities =
      finalProbabilityFromScores(lastAtBat.away_score, lastAtBat.home_score) ??
      finalProbabilityFromScores(game.state?.away_score, game.state?.home_score);
    if (finalProbabilities) {
      const lastIndex = series.length - 1;
      const lastPoint = series[lastIndex];
      series[lastIndex] = {
        ...lastPoint,
        awayProbability: finalProbabilities.awayProbability,
        homeProbability: finalProbabilities.homeProbability,
      };
    }
  }
  return series;
}

function nextWinProbabilityPoint(game: LiveGame, teams: TeamGroup[], generatedAt: string): WinProbabilityPoint {
  const teamsForGame = resolveAwayHomeTeams(game, teams);
  const awayTeam = teamsForGame.awayTeam;
  const homeTeam = teamsForGame.homeTeam;
  const context = contextFromLiveState(game);
  let awayProbability = roundTo(
    estimateAwayWinProbability(context, {
      awayTeam,
      homeTeam,
      fallbackAwayPoints: totalPointsForTeam(teams, awayTeam),
      fallbackHomePoints: totalPointsForTeam(teams, homeTeam),
    }),
    1,
  );
  let homeProbability = roundTo(100 - awayProbability, 1);
  if (isSettledGame(game)) {
    const finalProbabilities = finalProbabilityFromScores(context.awayScore, context.homeScore);
    if (finalProbabilities) {
      awayProbability = finalProbabilities.awayProbability;
      homeProbability = finalProbabilities.homeProbability;
    }
  }
  const hasScore = context.awayScore != null && context.homeScore != null;
  const scoreLabel = hasScore
    ? `${awayTeam} ${formatNumber(context.awayScore ?? 0, 0)} - ${formatNumber(context.homeScore ?? 0, 0)} ${homeTeam}`
    : `${awayTeam} vs ${homeTeam}`;
  const outsLabel = context.outs == null ? "Outs --" : `${context.outs} out${context.outs === 1 ? "" : "s"}`;
  const battingLabel = context.offenseTeam ? ` | Batting ${context.offenseTeam}` : "";
  return {
    capturedAt: game.updated_at ?? generatedAt,
    awayTeam,
    homeTeam,
    awayProbability,
    homeProbability,
    scoreLabel,
    situationLabel: `${formatInningState(context)} | ${outsLabel} | ${formatBaseState(context)}${battingLabel}`,
    markerLabel: "Live snapshot",
    atBatIndex: null,
  };
}

function WinProbabilityChart({ points }: { points: WinProbabilityPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  const activeIndex = hoveredIndex == null ? points.length - 1 : clamp(hoveredIndex, 0, points.length - 1);
  const activePoint = points[activeIndex];
  const previousPoint = activeIndex > 0 ? points[activeIndex - 1] : null;
  const activeDelta = previousPoint ? roundTo(activePoint.homeProbability - previousPoint.homeProbability, 1) : null;
  const activeDeltaLabel = previousPoint
    ? `${activeDelta != null && activeDelta >= 0 ? "+" : ""}${formatNumber(activeDelta ?? 0, 1)}%`
    : "start";
  const activeIndexLabel = activePoint.atBatIndex == null ? "Snapshot" : `At-bat ${formatNumber(activePoint.atBatIndex, 0)}`;
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

  // Plot the line on a "road top / home bottom" axis by anchoring Y to road win probability.
  // This is equivalent to vertically mirroring a home-probability plot.
  const lineCoords = points.map((point, index) => ({ x: xAt(index), y: yAt(point.awayProbability) }));
  const activeCoord = lineCoords[activeIndex];
  const atBatPointsCount = points.reduce((sum, point) => (point.atBatIndex == null ? sum : sum + 1), 0);
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (points.length === 1) {
      setHoveredIndex(0);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const rawX = ((event.clientX - bounds.left) / bounds.width) * width;
    const clampedX = clamp(rawX, left, width - right);
    const progress = clamp((clampedX - left) / plotWidth, 0, 1);
    const nextIndex = Math.round(progress * (points.length - 1));
    setHoveredIndex((current) => (current === nextIndex ? current : nextIndex));
  };
  const handlePointerLeave = () => setHoveredIndex(null);

  return (
    <section className="live-winprob-card" aria-label={`Win probability for ${activePoint.awayTeam} and ${activePoint.homeTeam}`}>
      <div className="live-winprob-head">
        <span className="subtle">Win Probability (single-line view)</span>
        <span className="subtle">
          {atBatPointsCount > 0 ? `${atBatPointsCount} at-bat points` : `${points.length} snapshots`}
        </span>
      </div>
      <p className="subtle live-winprob-score">{activePoint.scoreLabel}</p>
      <p className="subtle live-winprob-state">{activePoint.situationLabel}</p>
      <div className="live-winprob-legend">
        <span className="live-winprob-team">
          <strong className="live-winprob-team-name live-winprob-team-a">{activePoint.awayTeam}</strong>
          <span>{formatNumber(activePoint.awayProbability, 1)}%</span>
        </span>
        <span className="live-winprob-team">
          <strong className="live-winprob-team-name live-winprob-team-b">{activePoint.homeTeam}</strong>
          <span>{formatNumber(activePoint.homeProbability, 1)}%</span>
        </span>
      </div>
      <div className="live-winprob-chart-layout">
        <span className="live-winprob-pole live-winprob-pole-top">{activePoint.awayTeam} road (top)</span>
        <div className="live-winprob-chart-wrap">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="live-winprob-chart"
            role="img"
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            aria-label={`Win probability line. ${activePoint.homeTeam} ${formatNumber(
              activePoint.homeProbability,
              1,
            )} percent, ${activePoint.awayTeam} ${formatNumber(activePoint.awayProbability, 1)} percent`}
          >
            <line x1={left} x2={width - right} y1={midpointY} y2={midpointY} className="live-winprob-midline" />
            {hoveredIndex != null && (
              <line
                x1={activeCoord.x}
                x2={activeCoord.x}
                y1={top}
                y2={height - bottom}
                className="live-winprob-hover-line"
              />
            )}
            <path d={toPath(lineCoords)} className="live-winprob-line-home" />
            {lineCoords.map((coord, index) => (
              <circle
                key={`winprob-point-${index}`}
                cx={coord.x}
                cy={coord.y}
                r={index === activeIndex ? 3.35 : index === lineCoords.length - 1 ? 3 : 1.85}
                className={
                  index === activeIndex
                    ? "live-winprob-dot-home-active"
                    : index === lineCoords.length - 1
                      ? "live-winprob-dot-home"
                      : "live-winprob-dot-home-point"
                }
              >
                <title>
                  {`${points[index].atBatIndex == null ? "Snapshot" : `At-bat ${formatNumber(points[index].atBatIndex, 0)}`}: ${
                    points[index].markerLabel
                  } | Home ${formatNumber(points[index].homeProbability, 1)}% | ${points[index].scoreLabel}`}
                </title>
              </circle>
            ))}
          </svg>
        </div>
        <span className="live-winprob-pole live-winprob-pole-bottom">{activePoint.homeTeam} home (bottom)</span>
      </div>
      <div className="live-winprob-axis">
        <span>{`${activeIndexLabel}: ${activePoint.markerLabel}`}</span>
        <span>{`Home ${formatNumber(activePoint.homeProbability, 1)}% (${activeDeltaLabel})`}</span>
        <span>{hoveredIndex == null ? `Updated ${formatStamp(latest.capturedAt)}` : `Occurred ${formatStamp(activePoint.capturedAt)}`}</span>
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
      setLastUpdated(chicagoNowStamp());
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
      const generatedAt = payload.generated_at ?? chicagoNowStamp();
      const next: Record<string, WinProbabilityPoint[]> = {};

      for (const game of payload.games) {
        const teams = groupTeams(game);
        const atBatSeries = buildAtBatWinProbabilityPoints(game, teams, generatedAt);
        if (atBatSeries.length > 0) {
          next[game.game_id] = atBatSeries.slice(-180);
          continue;
        }

        const point = nextWinProbabilityPoint(game, teams, generatedAt);
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
            Today&apos;s slate with live and final game snapshots.
          </p>
        </div>
        <div className="hero-metrics">
          <article className="kpi-card">
            <span>Today&apos;s Games</span>
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
              Showing {formatNumber(visibleGames.length)} games and {formatNumber(visiblePlayers)} tracked players.
            </p>
          </section>
          <section className="live-games-grid">
            {visibleGames.map((game) => (
              <article key={game.game_id} className={`live-game-card${expandedGameId === game.game_id ? " expanded" : ""}`}>
                {(() => {
                  const teams = groupTeams(game);
                  const expanded = expandedGameId === game.game_id;
                  const winProbabilityPoints = winProbabilityByGameId[game.game_id] ?? [];
                  const activelyLive = game.is_live && !isCompletedGameStatus(game.game_status);
                  const gameSettled = isSettledGame(game);
                  const liveBadgeLabel = activelyLive ? "LIVE NOW" : gameSettled ? "FINAL" : "TODAY";
                  const liveStatusLabel = game.game_status ?? (activelyLive ? "In progress" : gameSettled ? "Final" : "Today");
                  return (
                    <>
                      <button
                        type="button"
                        className="live-game-toggle"
                        onClick={() => setExpandedGameId(expanded ? null : game.game_id)}
                        aria-expanded={expanded}
                      >
                        <div className="live-now-head">
                          <span className={`live-indicator${activelyLive ? "" : " live-indicator-muted"}`}>
                            <span className={`live-dot${activelyLive ? "" : " live-dot-muted"}`} />
                            {liveBadgeLabel}
                          </span>
                          <span className="live-status">{liveStatusLabel}</span>
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
