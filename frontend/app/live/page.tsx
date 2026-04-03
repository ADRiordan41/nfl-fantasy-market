"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type ReactNode, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, isUnauthorizedError } from "@/lib/api";
import EmptyStatePanel from "@/components/empty-state-panel";
import { formatCurrency, formatNumber } from "@/lib/format";
import { teamPrimaryColor } from "@/lib/teamColors";
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
  sport: string;
  awayScore: number | null;
  homeScore: number | null;
  awayProbability: number;
  homeProbability: number;
  inningLabel: string;
  outsLabel: string;
  countLabel: string;
  baseStateLabel: string;
  eventLabel: string;
  playDescription: string | null;
  scoringPlay: boolean;
  runsScored: number;
  battingTeam: string | null;
  fieldingTeam: string | null;
  batterName: string | null;
  batterPlayerId: number | null;
  batterTeam: string | null;
  pitcherName: string | null;
  pitcherPlayerId: number | null;
  pitcherTeam: string | null;
  runnerOnFirst: boolean;
  runnerOnSecond: boolean;
  runnerOnThird: boolean;
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
  defenseTeam: string | null;
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

function normalizePlayerName(value: string | null | undefined): string {
  const raw = (value ?? "").normalize("NFKD");
  const stripped = raw.replace(/[\u0300-\u036f]/g, "");
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripPlayerNameDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function buildPlayerNameAliases(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const aliases = new Set<string>();
  aliases.add(trimmed);

  const withoutSuffix = trimmed.replace(/\s+(?:jr|sr|ii|iii|iv|v)\.?$/i, "").trim();
  if (withoutSuffix) aliases.add(withoutSuffix);

  const nameParts = withoutSuffix.split(/\s+/).filter((part) => part.length > 0);
  if (nameParts.length >= 2) {
    const first = nameParts[0];
    const remainder = nameParts.slice(1).join(" ");
    if (remainder) {
      aliases.add(remainder);
      aliases.add(`${first.charAt(0)}. ${remainder}`);
      aliases.add(`${first.charAt(0)} ${remainder}`);
    }
  }

  for (const alias of [...aliases]) {
    const asciiAlias = stripPlayerNameDiacritics(alias);
    if (asciiAlias) aliases.add(asciiAlias);
  }

  return [...aliases].map((alias) => alias.trim()).filter((alias) => alias.length > 0);
}

function buildLivePlayerLookup(players: LiveGamePlayer[]): Map<string, number> {
  const idsByKey = new Map<string, Set<number>>();
  const addKey = (key: string, playerId: number) => {
    const normalized = key.trim().toLowerCase();
    if (!normalized) return;
    const existing = idsByKey.get(normalized);
    if (existing) {
      existing.add(playerId);
      return;
    }
    idsByKey.set(normalized, new Set([playerId]));
  };

  for (const player of players) {
    const raw = player.name.trim();
    if (!raw) continue;
    for (const alias of buildPlayerNameAliases(raw)) {
      addKey(alias, player.player_id);
      addKey(normalizePlayerName(alias), player.player_id);
    }
  }

  const lookup = new Map<string, number>();
  for (const [key, ids] of idsByKey.entries()) {
    if (ids.size !== 1) continue;
    const [playerId] = [...ids];
    lookup.set(key, playerId);
  }
  return lookup;
}

function buildLivePlayerNameCandidates(players: LiveGamePlayer[]): string[] {
  const idsByAlias = new Map<string, Set<number>>();
  const aliasByKey = new Map<string, string>();

  for (const player of players) {
    for (const alias of buildPlayerNameAliases(player.name)) {
      const trimmedAlias = alias.trim();
      if (!trimmedAlias) continue;
      const aliasKey = trimmedAlias.toLowerCase();
      const existing = idsByAlias.get(aliasKey);
      if (existing) {
        existing.add(player.player_id);
      } else {
        idsByAlias.set(aliasKey, new Set([player.player_id]));
      }
      const previousAlias = aliasByKey.get(aliasKey);
      if (!previousAlias || trimmedAlias.length > previousAlias.length) {
        aliasByKey.set(aliasKey, trimmedAlias);
      }
    }
  }

  const candidates: string[] = [];
  for (const [aliasKey, ids] of idsByAlias.entries()) {
    if (ids.size !== 1) continue;
    const alias = aliasByKey.get(aliasKey) ?? "";
    if (!alias) continue;
    if (alias.length < 3) continue;
    candidates.push(alias);
  }

  return [...new Set(candidates)].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function resolveLivePlayerId(name: string | null | undefined, lookup: Map<string, number>): number | null {
  if (!name) return null;
  const rawKey = name.trim().toLowerCase();
  if (rawKey && lookup.has(rawKey)) return lookup.get(rawKey) ?? null;
  const normalized = normalizePlayerName(name);
  if (normalized && lookup.has(normalized)) return lookup.get(normalized) ?? null;
  return null;
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

function naturalBaseState(runnerOnFirst: boolean, runnerOnSecond: boolean, runnerOnThird: boolean): string {
  if (runnerOnFirst && runnerOnSecond && runnerOnThird) return "Bases loaded";
  if (!runnerOnFirst && !runnerOnSecond && !runnerOnThird) return "Bases empty";
  if (runnerOnFirst && runnerOnSecond) return "Runners on first and second";
  if (runnerOnFirst && runnerOnThird) return "Runners on first and third";
  if (runnerOnSecond && runnerOnThird) return "Runners on second and third";
  if (runnerOnFirst) return "Runner on first";
  if (runnerOnSecond) return "Runner on second";
  return "Runner on third";
}

function formatBaseState(context: WinProbabilityContext): string {
  return naturalBaseState(Boolean(context.runnerOnFirst), Boolean(context.runnerOnSecond), Boolean(context.runnerOnThird));
}

function formatPointBaseState(point: Pick<WinProbabilityPoint, "runnerOnFirst" | "runnerOnSecond" | "runnerOnThird">): string {
  return naturalBaseState(point.runnerOnFirst, point.runnerOnSecond, point.runnerOnThird);
}

function BaseDiamond({
  runnerOnFirst,
  runnerOnSecond,
  runnerOnThird,
  compact = false,
}: Pick<WinProbabilityPoint, "runnerOnFirst" | "runnerOnSecond" | "runnerOnThird"> & { compact?: boolean }) {
  const hasRunner = runnerOnFirst || runnerOnSecond || runnerOnThird;
  const ariaLabel = hasRunner
    ? `Base occupancy. ${formatPointBaseState({ runnerOnFirst, runnerOnSecond, runnerOnThird })}.`
    : "Base occupancy. Bases empty.";
  return (
    <figure className="live-winprob-diamond" aria-label={ariaLabel}>
      <svg viewBox="0 0 56 56" className="live-winprob-diamond-svg" role="img" aria-hidden="true">
        <path d="M 28 8 L 48 28 L 28 48 L 8 28 Z" className="live-winprob-diamond-track" />
        <rect x="26" y="40" width="4" height="4" transform="rotate(45 28 42)" className="live-winprob-base-home" />
        <rect
          x="38"
          y="26"
          width="4"
          height="4"
          transform="rotate(45 40 28)"
          className={runnerOnFirst ? "live-winprob-base occupied" : "live-winprob-base"}
        />
        <rect
          x="26"
          y="14"
          width="4"
          height="4"
          transform="rotate(45 28 16)"
          className={runnerOnSecond ? "live-winprob-base occupied" : "live-winprob-base"}
        />
        <rect
          x="14"
          y="26"
          width="4"
          height="4"
          transform="rotate(45 16 28)"
          className={runnerOnThird ? "live-winprob-base occupied" : "live-winprob-base"}
        />
      </svg>
      {!compact ? (
        <figcaption className="subtle live-winprob-diamond-caption">
          {hasRunner ? formatPointBaseState({ runnerOnFirst, runnerOnSecond, runnerOnThird }) : "Bases empty"}
        </figcaption>
      ) : null}
    </figure>
  );
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

function formatCountState(balls: number | null | undefined, strikes: number | null | undefined): string {
  if (balls == null || strikes == null) return "--";
  return `${balls}-${strikes}`;
}

function formatHighlightedPlay(point: WinProbabilityPoint): string {
  const description = (point.playDescription ?? "").trim();
  const event = (point.eventLabel ?? "").trim();
  const batter = (point.batterName ?? "").trim();
  const pitcher = (point.pitcherName ?? "").trim();
  const withPeriod = (value: string) => (/[.!?]$/.test(value) ? value : `${value}.`);

  if (description) {
    return withPeriod(description);
  }

  if (point.atBatIndex == null) {
    if (!event || event.toLowerCase() === "live snapshot") {
      return "Live snapshot of the current game state.";
    }
    return withPeriod(event);
  }

  if (batter && event) {
    return `${batter}: ${withPeriod(event)}`;
  }

  if (event) {
    return withPeriod(event);
  }

  if (batter && pitcher) {
    return `${batter} faced ${pitcher}.`;
  }

  if (batter) {
    return `${batter} completed the at-bat.`;
  }

  return "At-bat outcome recorded.";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type PlaySummarySegment = {
  text: string;
  playerId: number | null;
};

function buildPlaySummarySegments(
  point: WinProbabilityPoint,
  text: string,
  playerLookup: Map<string, number>,
  playerNameCandidates: string[],
): PlaySummarySegment[] {
  const explicitNameToId = new Map<string, number>();
  const mergedCandidates = [...playerNameCandidates];

  if (point.batterPlayerId != null && point.batterName) {
    const name = point.batterName.trim();
    const key = name.toLowerCase();
    if (key) explicitNameToId.set(key, point.batterPlayerId);
    if (name) mergedCandidates.push(name);
  }
  if (point.pitcherPlayerId != null && point.pitcherName) {
    const name = point.pitcherName.trim();
    const key = name.toLowerCase();
    if (key && !explicitNameToId.has(key)) explicitNameToId.set(key, point.pitcherPlayerId);
    if (name) mergedCandidates.push(name);
  }

  const uniqueNames = [...new Set(mergedCandidates.map((name) => name.trim()).filter((name) => name.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
  if (uniqueNames.length === 0) return [{ text, playerId: null }];

  const tokenPattern = uniqueNames.map((name) => escapeRegExp(name)).join("|");
  if (!tokenPattern) return [{ text, playerId: null }];
  const parts = text.split(new RegExp(`(${tokenPattern})`, "gi"));
  return parts
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      playerId: explicitNameToId.get(part.toLowerCase()) ?? resolveLivePlayerId(part, playerLookup),
    }));
}

function renderPlaySummaryTextWithLinks(
  point: WinProbabilityPoint,
  text: string,
  linkClassName: string,
  playerLookup: Map<string, number>,
  playerNameCandidates: string[],
  options?: { stopPropagation?: boolean },
): ReactNode {
  const segments = buildPlaySummarySegments(point, text, playerLookup, playerNameCandidates);
  return segments.map((segment, index) => {
    if (segment.playerId == null) {
      return <Fragment key={`play-segment-${index}`}>{segment.text}</Fragment>;
    }
    return (
      <Link
        key={`play-segment-link-${index}`}
        href={`/player/${segment.playerId}`}
        className={linkClassName}
        onClick={options?.stopPropagation ? (event) => event.stopPropagation() : undefined}
      >
        {segment.text}
      </Link>
    );
  });
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
    defenseTeam: state?.defense_team ?? null,
  };
}

function contextFromAtBat(
  atBat: LiveGame["at_bats"][number],
  awayTeam: string,
  homeTeam: string,
): WinProbabilityContext {
  const half = (atBat.inning_half ?? "").trim().toUpperCase();
  const offenseTeam = half === "TOP" ? awayTeam : half === "BOTTOM" ? homeTeam : null;
  const defenseTeam =
    half === "TOP"
      ? homeTeam
      : half === "BOTTOM"
        ? awayTeam
        : offenseTeam && sameTeam(offenseTeam, awayTeam)
          ? homeTeam
          : offenseTeam && sameTeam(offenseTeam, homeTeam)
            ? awayTeam
            : null;
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
    defenseTeam,
  };
}

function buildAtBatWinProbabilityPoints(game: LiveGame, teams: TeamGroup[], generatedAt: string): WinProbabilityPoint[] {
  const teamsForGame = resolveAwayHomeTeams(game, teams);
  const atBats = game.at_bats ?? [];
  if (atBats.length === 0) return [];
  const playerLookup = buildLivePlayerLookup(game.players);
  const awayTeam = teamsForGame.awayTeam;
  const homeTeam = teamsForGame.homeTeam;
  const fallbackAwayPoints = totalPointsForTeam(teams, awayTeam);
  const fallbackHomePoints = totalPointsForTeam(teams, homeTeam);
  const rows = [...atBats].sort((a, b) => a.at_bat_index - b.at_bat_index);

  const series = rows.map((atBat, index) => {
    const previousAtBat = index > 0 ? rows[index - 1] : null;
    let runsScored = 0;
    if (
      previousAtBat &&
      previousAtBat.away_score != null &&
      previousAtBat.home_score != null &&
      atBat.away_score != null &&
      atBat.home_score != null
    ) {
      const awayDelta = atBat.away_score - previousAtBat.away_score;
      const homeDelta = atBat.home_score - previousAtBat.home_score;
      runsScored = Math.max(0, awayDelta + homeDelta);
    }
    const scoringHint = /(?:\bscored\b|\bscores\b|\bhome run\b|\bhomered\b|\bgrand slam\b|\bsacrifice fly\b)/i.test(
      `${atBat.event ?? ""} ${atBat.description ?? ""}`,
    );
    const scoringPlay = runsScored > 0 || scoringHint;
    if (runsScored === 0 && scoringHint) runsScored = 1;

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
    const inningLabel = formatInningState(context);
    const outsLabel =
      atBat.outs_after_play == null ? "Outs --" : `${atBat.outs_after_play} out${atBat.outs_after_play === 1 ? "" : "s"}`;
    const countLabel = formatCountState(atBat.balls, atBat.strikes);
    const baseStateLabel = formatBaseState(context);
    const eventLabel = atBat.event ?? "At-bat result";
    const playDescription = atBat.description ?? null;
    const batterPlayerId = resolveLivePlayerId(atBat.batter_name, playerLookup);
    const pitcherPlayerId = resolveLivePlayerId(atBat.pitcher_name, playerLookup);
    return {
      capturedAt: atBat.occurred_at ?? game.updated_at ?? generatedAt,
      awayTeam,
      homeTeam,
      sport: game.sport ?? "",
      awayScore: atBat.away_score,
      homeScore: atBat.home_score,
      awayProbability,
      homeProbability,
      inningLabel,
      outsLabel,
      countLabel,
      baseStateLabel,
      eventLabel,
      playDescription,
      scoringPlay,
      runsScored,
      battingTeam: context.offenseTeam ?? null,
      fieldingTeam: context.defenseTeam ?? null,
      batterName: atBat.batter_name ?? null,
      batterPlayerId,
      batterTeam: context.offenseTeam ?? null,
      pitcherName: atBat.pitcher_name ?? null,
      pitcherPlayerId,
      pitcherTeam: context.defenseTeam ?? null,
      runnerOnFirst: Boolean(context.runnerOnFirst),
      runnerOnSecond: Boolean(context.runnerOnSecond),
      runnerOnThird: Boolean(context.runnerOnThird),
      scoreLabel,
      situationLabel: `${inningLabel} | ${outsLabel} | ${baseStateLabel} | ${countLabel} | ${eventLabel}`,
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
  const inningLabel = formatInningState(context);
  const outsLabel = context.outs == null ? "Outs --" : `${context.outs} out${context.outs === 1 ? "" : "s"}`;
  const countLabel = formatCountState(context.balls, context.strikes);
  const baseStateLabel = formatBaseState(context);
  const eventLabel = "Live snapshot";
  const battingLabel = context.offenseTeam ? ` | Batting ${context.offenseTeam}` : "";
  return {
    capturedAt: game.updated_at ?? generatedAt,
    awayTeam,
    homeTeam,
    sport: game.sport ?? "",
    awayScore: context.awayScore,
    homeScore: context.homeScore,
    awayProbability,
    homeProbability,
    inningLabel,
    outsLabel,
    countLabel,
    baseStateLabel,
    eventLabel,
    playDescription: null,
    scoringPlay: false,
    runsScored: 0,
    battingTeam: context.offenseTeam ?? null,
    fieldingTeam: context.defenseTeam ?? null,
    batterName: null,
    batterPlayerId: null,
    batterTeam: context.offenseTeam ?? null,
    pitcherName: null,
    pitcherPlayerId: null,
    pitcherTeam: context.defenseTeam ?? null,
    runnerOnFirst: Boolean(context.runnerOnFirst),
    runnerOnSecond: Boolean(context.runnerOnSecond),
    runnerOnThird: Boolean(context.runnerOnThird),
    scoreLabel,
    situationLabel: `${inningLabel} | ${outsLabel} | ${baseStateLabel} | ${countLabel}${battingLabel}`,
    markerLabel: eventLabel,
    atBatIndex: null,
  };
}

function WinProbabilityChart({ points, players }: { points: WinProbabilityPoint[]; players: LiveGamePlayer[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  if (points.length === 0) return null;
  const playTextPlayerLookup = buildLivePlayerLookup(players);
  const playTextNameCandidates = buildLivePlayerNameCandidates(players);
  const topSwingPlays: Array<{ index: number; point: WinProbabilityPoint; homeDelta: number; absDelta: number; summary: string }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point.atBatIndex == null) continue;
    const previous = points[index - 1];
    const homeDelta = roundTo(point.homeProbability - previous.homeProbability, 1);
    const absDelta = Math.abs(homeDelta);
    if (absDelta <= 0) continue;
    topSwingPlays.push({
      index,
      point,
      homeDelta,
      absDelta,
      summary: formatHighlightedPlay(point),
    });
  }
  topSwingPlays.sort((left, right) => right.absDelta - left.absDelta || right.index - left.index);
  const topSwingLeaders = topSwingPlays.slice(0, 3);
  const topSwingIndexSet = new Set(topSwingLeaders.map((entry) => entry.index));
  const activeIndex = hoveredIndex == null ? points.length - 1 : clamp(hoveredIndex, 0, points.length - 1);
  const activePoint = points[activeIndex];
  const showMatchupRow =
    activePoint.atBatIndex != null &&
    Boolean(activePoint.batterName || activePoint.pitcherName || activePoint.batterTeam || activePoint.pitcherTeam);
  const batterLabel = activePoint.batterName ?? "Unknown hitter";
  const pitcherLabel = activePoint.pitcherName ?? "Unknown pitcher";
  const awayScoreValue = activePoint.awayScore == null ? "--" : formatNumber(activePoint.awayScore, 0);
  const homeScoreValue = activePoint.homeScore == null ? "--" : formatNumber(activePoint.homeScore, 0);
  const battingTeamLabel = activePoint.battingTeam ?? "TBD";
  const fieldingTeamLabel = activePoint.fieldingTeam ?? "TBD";
  const inningBugLabel = activePoint.inningLabel
    .replace(/^Top\s+/i, "TOP ")
    .replace(/^Bottom\s+/i, "BOTTOM ")
    .replace(/^Mid\s+/i, "MIDDLE ")
    .replace(/^End\s+/i, "END ");
  const outsBugLabel = activePoint.outsLabel === "Outs --" ? "OUTS --" : activePoint.outsLabel.toUpperCase();
  const countBugLabel = activePoint.countLabel.toUpperCase();
  const batterTeamValue = activePoint.batterTeam ?? battingTeamLabel;
  const pitcherTeamValue = activePoint.pitcherTeam ?? fieldingTeamLabel;
  const batterNameValue = showMatchupRow ? batterLabel : "Current batter pending";
  const pitcherNameValue = showMatchupRow ? pitcherLabel : "Current pitcher pending";
  const batterPlayerHref = activePoint.batterPlayerId != null ? `/player/${activePoint.batterPlayerId}` : null;
  const pitcherPlayerHref = activePoint.pitcherPlayerId != null ? `/player/${activePoint.pitcherPlayerId}` : null;
  const awayTeamColor = teamPrimaryColor(activePoint.awayTeam, activePoint.sport);
  const homeTeamColor = teamPrimaryColor(activePoint.homeTeam, activePoint.sport);
  const highlightedPlaySummary = formatHighlightedPlay(activePoint);
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
      <section className="live-scorebug" aria-label={`Game state ${activePoint.scoreLabel}`}>
        <div className="live-scorebug-main">
          <div className="live-scorebug-scoreboard">
            <div className="live-scorebug-team-row away">
              <span className="live-scorebug-team-code" style={{ color: awayTeamColor }}>
                {activePoint.awayTeam}
              </span>
              <strong className="live-scorebug-runs">{awayScoreValue}</strong>
            </div>
            <div className="live-scorebug-team-row home">
              <span className="live-scorebug-team-code" style={{ color: homeTeamColor }}>
                {activePoint.homeTeam}
              </span>
              <strong className="live-scorebug-runs">{homeScoreValue}</strong>
            </div>
          </div>
          <div className="live-scorebug-bases">
            <BaseDiamond
              runnerOnFirst={activePoint.runnerOnFirst}
              runnerOnSecond={activePoint.runnerOnSecond}
              runnerOnThird={activePoint.runnerOnThird}
              compact
            />
            <span className="live-scorebug-count">{countBugLabel}</span>
          </div>
          <div className="live-scorebug-info">
            <div className="live-scorebug-state-box">
              <span className="live-scorebug-state-top">{inningBugLabel}</span>
              <span className="live-scorebug-state-bottom">{outsBugLabel}</span>
            </div>
            <div className="live-scorebug-details" aria-label="Current matchup">
              <p className="live-scorebug-detail-row">
                <span className="live-scorebug-detail-tag">P</span>
                {pitcherPlayerHref ? (
                  <Link
                    href={pitcherPlayerHref}
                    className="live-scorebug-detail-name live-scorebug-detail-name-link"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {pitcherNameValue}
                  </Link>
                ) : (
                  <strong className="live-scorebug-detail-name">{pitcherNameValue}</strong>
                )}
                <span className="live-scorebug-detail-team">{pitcherTeamValue}</span>
              </p>
              <p className="live-scorebug-detail-row">
                <span className="live-scorebug-detail-tag">B</span>
                {batterPlayerHref ? (
                  <Link
                    href={batterPlayerHref}
                    className="live-scorebug-detail-name live-scorebug-detail-name-link"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {batterNameValue}
                  </Link>
                ) : (
                  <strong className="live-scorebug-detail-name">{batterNameValue}</strong>
                )}
                <span className="live-scorebug-detail-team">{batterTeamValue}</span>
              </p>
            </div>
          </div>
        </div>
      </section>
      <div className="live-winprob-legend">
        <span className="live-winprob-team">
          <strong className="live-winprob-team-name live-winprob-team-a">{activePoint.awayTeam}</strong>
          <span>{formatNumber(activePoint.awayProbability, 1)}%</span>
        </span>
        <span className="live-winprob-play-inline" aria-live="polite" title={highlightedPlaySummary}>
          <span className="live-winprob-play-inline-text">
            {renderPlaySummaryTextWithLinks(
              activePoint,
              highlightedPlaySummary,
              "live-winprob-play-link",
              playTextPlayerLookup,
              playTextNameCandidates,
            )}
          </span>
        </span>
        <span className="live-winprob-team">
          <strong className="live-winprob-team-name live-winprob-team-b">{activePoint.homeTeam}</strong>
          <span>{formatNumber(activePoint.homeProbability, 1)}%</span>
        </span>
      </div>
      <div className="live-winprob-chart-layout">
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
            {lineCoords.map((coord, index) => {
              const point = points[index];
              const active = index === activeIndex;
              const last = index === lineCoords.length - 1;
              const topSwing = topSwingIndexSet.has(index);
              const dotRadius = active ? 3.35 : last ? 3 : 1.85;
              const topSwingRingRadius = dotRadius + (active ? 4.3 : 3.7);
              const scoringRingRadius = dotRadius + (active ? 2.9 : 2.35);
              const scoringLabel = point.scoringPlay
                ? ` | Scoring play${point.runsScored > 0 ? ` (+${formatNumber(point.runsScored, 0)} run${point.runsScored === 1 ? "" : "s"})` : ""}`
                : "";
              return (
                <g key={`winprob-point-${index}`}>
                  {topSwing ? (
                    <circle
                      cx={coord.x}
                      cy={coord.y}
                      r={topSwingRingRadius}
                      className={active ? "live-winprob-top-play-ring-active" : "live-winprob-top-play-ring"}
                    />
                  ) : null}
                  {point.scoringPlay ? (
                    <circle
                      cx={coord.x}
                      cy={coord.y}
                      r={scoringRingRadius}
                      className={active ? "live-winprob-score-ring-active" : "live-winprob-score-ring"}
                    />
                  ) : null}
                  <circle
                    cx={coord.x}
                    cy={coord.y}
                    r={dotRadius}
                    className={active ? "live-winprob-dot-home-active" : last ? "live-winprob-dot-home" : "live-winprob-dot-home-point"}
                  >
                    <title>
                      {`${point.atBatIndex == null ? "Snapshot" : `At-bat ${formatNumber(point.atBatIndex, 0)}`}: ${point.markerLabel}${scoringLabel} | Home ${formatNumber(point.homeProbability, 1)}% | ${point.scoreLabel}${
                        point.batterName || point.pitcherName
                          ? ` | Batter ${point.batterName ?? "Unknown"} (${point.batterTeam ?? "--"}) vs Pitcher ${point.pitcherName ?? "Unknown"} (${point.pitcherTeam ?? "--"})`
                          : ""
                      } | ${formatPointBaseState(point)}`}
                    </title>
                  </circle>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {topSwingLeaders.length > 0 ? (
        <section className="live-winprob-top-plays" aria-label="Top 3 win probability swing plays">
          <p className="live-winprob-top-plays-title">Top 3 plays</p>
          <div className="live-winprob-top-plays-list">
            {topSwingLeaders.map((entry, rank) => {
              const activeTopPlay = entry.index === activeIndex;
              const swingLabel =
                entry.homeDelta >= 0
                  ? `${entry.point.homeTeam} +${formatNumber(entry.homeDelta, 1)}%`
                  : `${entry.point.awayTeam} +${formatNumber(Math.abs(entry.homeDelta), 1)}%`;
              const scoreAfterPlay =
                entry.point.awayScore != null && entry.point.homeScore != null
                  ? `${entry.point.awayTeam} ${formatNumber(entry.point.awayScore, 0)} - ${formatNumber(entry.point.homeScore, 0)} ${entry.point.homeTeam}`
                  : "--";
              return (
                <div
                  key={`top-play-${entry.index}`}
                  role="button"
                  tabIndex={0}
                  className={`live-winprob-top-play${activeTopPlay ? " active" : ""}`}
                  onMouseEnter={() => setHoveredIndex(entry.index)}
                  onFocus={() => setHoveredIndex(entry.index)}
                  onClick={() => setHoveredIndex(entry.index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setHoveredIndex(entry.index);
                    }
                  }}
                  aria-label={`Top play ${rank + 1}. ${swingLabel}. ${entry.summary}`}
                >
                  <span className="live-winprob-top-play-rank">{rank + 1}</span>
                  <span className="live-winprob-top-play-copy">
                    <span className="live-winprob-top-play-meta">
                      <span className="live-winprob-top-play-swing">{swingLabel}</span>
                      <span className="live-winprob-top-play-score">{scoreAfterPlay}</span>
                    </span>
                    <span className="live-winprob-top-play-text">
                      {renderPlaySummaryTextWithLinks(
                        entry.point,
                        entry.summary,
                        "live-winprob-top-play-link",
                        playTextPlayerLookup,
                        playTextNameCandidates,
                        {
                          stopPropagation: true,
                        },
                      )}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </section>
  );
}

export default function LivePage() {
  const router = useRouter();
  const gameCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<LiveGames | null>(null);
  const [sportFilter, setSportFilter] = useState("ALL");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [focusedGameId, setFocusedGameId] = useState<string | null>(null);
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

  const overviewGames = useMemo(
    () =>
      visibleGames.map((game) => {
        const teams = groupTeams(game);
        const { awayTeam, homeTeam } = resolveAwayHomeTeams(game, teams);
        const series = winProbabilityByGameId[game.game_id] ?? [];
        const latestPoint = series.length > 0 ? series[series.length - 1] : null;
        const awayScoreRaw = latestPoint?.awayScore ?? game.state?.away_score ?? null;
        const homeScoreRaw = latestPoint?.homeScore ?? game.state?.home_score ?? null;
        const activelyLive = game.is_live && !isCompletedGameStatus(game.game_status);
        const gameSettled = isSettledGame(game);
        return {
          gameId: game.game_id,
          sport: game.sport,
          awayTeam,
          homeTeam,
          awayScoreLabel: awayScoreRaw == null ? "--" : formatNumber(awayScoreRaw, 0),
          homeScoreLabel: homeScoreRaw == null ? "--" : formatNumber(homeScoreRaw, 0),
          badgeLabel: activelyLive ? "LIVE" : gameSettled ? "FINAL" : "TODAY",
          statusLabel: game.game_status ?? (activelyLive ? "In progress" : gameSettled ? "Final" : "Today"),
          stateLabel: latestPoint?.inningLabel ?? "--",
        };
      }),
    [visibleGames, winProbabilityByGameId],
  );
  const jumpToGame = useCallback((gameId: string) => {
    setFocusedGameId(gameId);
    const node = gameCardRefs.current[gameId];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  }, []);

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
          lastPoint.awayScore === point.awayScore &&
          lastPoint.homeScore === point.homeScore &&
          lastPoint.awayProbability === point.awayProbability &&
          lastPoint.homeProbability === point.homeProbability &&
          lastPoint.inningLabel === point.inningLabel &&
          lastPoint.outsLabel === point.outsLabel &&
          lastPoint.countLabel === point.countLabel &&
          lastPoint.baseStateLabel === point.baseStateLabel &&
          lastPoint.eventLabel === point.eventLabel &&
          lastPoint.playDescription === point.playDescription &&
          lastPoint.scoringPlay === point.scoringPlay &&
          lastPoint.runsScored === point.runsScored &&
          lastPoint.battingTeam === point.battingTeam &&
          lastPoint.fieldingTeam === point.fieldingTeam &&
          lastPoint.batterName === point.batterName &&
          lastPoint.batterPlayerId === point.batterPlayerId &&
          lastPoint.batterTeam === point.batterTeam &&
          lastPoint.pitcherName === point.pitcherName &&
          lastPoint.pitcherPlayerId === point.pitcherPlayerId &&
          lastPoint.pitcherTeam === point.pitcherTeam &&
          lastPoint.runnerOnFirst === point.runnerOnFirst &&
          lastPoint.runnerOnSecond === point.runnerOnSecond &&
          lastPoint.runnerOnThird === point.runnerOnThird &&
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
          <section className="live-game-overview" aria-label="All visible games">
            <div className="live-mini-scorebug-strip" role="list">
              {overviewGames.map((game) => (
                <button
                  key={`overview-${game.gameId}`}
                  type="button"
                  className={`live-mini-scorebug${focusedGameId === game.gameId ? " active" : ""}`}
                  onClick={() => jumpToGame(game.gameId)}
                  title={`${game.awayTeam} ${game.awayScoreLabel} - ${game.homeScoreLabel} ${game.homeTeam} (${game.statusLabel})`}
                >
                  <div className="live-mini-scorebug-top">
                    <span className={`live-mini-badge${game.badgeLabel === "LIVE" ? "" : " muted"}`}>{game.badgeLabel}</span>
                    <span className="live-mini-status">{game.statusLabel}</span>
                  </div>
                  <div className="live-mini-score-lines">
                    <p className="live-mini-score-row">
                      <span className="live-mini-team" style={{ color: teamPrimaryColor(game.awayTeam, game.sport) }}>
                        {game.awayTeam}
                      </span>
                      <strong className="live-mini-score">{game.awayScoreLabel}</strong>
                    </p>
                    <p className="live-mini-score-row">
                      <span className="live-mini-team" style={{ color: teamPrimaryColor(game.homeTeam, game.sport) }}>
                        {game.homeTeam}
                      </span>
                      <strong className="live-mini-score">{game.homeScoreLabel}</strong>
                    </p>
                  </div>
                  <span className="live-mini-state">{game.stateLabel}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="live-games-grid">
            {visibleGames.map((game) => (
              <article
                key={game.game_id}
                id={`live-game-card-${game.game_id}`}
                ref={(node) => {
                  gameCardRefs.current[game.game_id] = node;
                }}
                className={`live-game-card${focusedGameId === game.game_id ? " expanded" : ""}`}
              >
                {(() => {
                  const teams = groupTeams(game);
                  const { awayTeam, homeTeam } = resolveAwayHomeTeams(game, teams);
                  const winProbabilityPoints = winProbabilityByGameId[game.game_id] ?? [];
                  const activelyLive = game.is_live && !isCompletedGameStatus(game.game_status);
                  const gameSettled = isSettledGame(game);
                  const liveBadgeLabel = activelyLive ? "LIVE NOW" : gameSettled ? "FINAL" : "TODAY";
                  return (
                    <>
                      <div className="live-game-toggle">
                        <div className="live-now-head">
                          <span className={`live-indicator${activelyLive ? "" : " live-indicator-muted"}`}>
                          <span className={`live-dot${activelyLive ? "" : " live-dot-muted"}`} />
                            {liveBadgeLabel}
                          </span>
                        </div>
                        <h3 className="live-game-title live-game-matchup-title" aria-label={`${awayTeam} at ${homeTeam}`}>
                          <span className="live-game-matchup-team" style={{ color: teamPrimaryColor(awayTeam, game.sport) }}>
                            {awayTeam}
                          </span>
                          <span className="live-game-matchup-separator">@</span>
                          <span className="live-game-matchup-team" style={{ color: teamPrimaryColor(homeTeam, game.sport) }}>
                            {homeTeam}
                          </span>
                        </h3>
                        <WinProbabilityChart points={winProbabilityPoints} players={game.players} />
                        <div className="live-team-grid">
                          {teams.map((team) => (
                            <section key={`${game.game_id}-${team.team}`} className="live-team-panel">
                              <div className="live-team-head">
                                <strong>{team.team}</strong>
                                <span className="subtle">Top 3 players</span>
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
                      </div>
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
