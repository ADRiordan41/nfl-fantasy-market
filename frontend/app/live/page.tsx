"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type CSSProperties, type ReactNode, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, isUnauthorizedError } from "@/lib/api";
import EmptyStatePanel from "@/components/empty-state-panel";
import { formatCurrency, formatNumber } from "@/lib/format";
import { teamPrimaryColor, teamReadableColor } from "@/lib/teamColors";
import { CHICAGO_TIME_ZONE, chicagoNowStamp } from "@/lib/time";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { LiveGame, LiveGamePlayer, LiveGames, LiveGameWinProbabilityPoint } from "@/lib/types";

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
  inningNumber: number | null;
  inningHalfCode: string | null;
  outsCount: number | null;
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

function formatFirstPitchLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = parseTimestamp(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString([], {
    timeZone: CHICAGO_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

function chicagoDateKey(value: Date): string {
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleDateString("en-CA", {
    timeZone: CHICAGO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatCompactMatchupName(name: string | null | undefined, fallback: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return fallback;
  const withoutSuffix = trimmed.replace(/\s+(?:jr|sr|ii|iii|iv|v)\.?$/i, "").trim();
  const parts = withoutSuffix.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return withoutSuffix || trimmed;
  const firstInitial = parts[0][0]?.toUpperCase() ?? "";
  return `${firstInitial}. ${parts[parts.length - 1]}`;
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
  return isCompletedGameStatus(game.game_status);
}

function contextFromWinProbabilityPoint(point: LiveGameWinProbabilityPoint): WinProbabilityContext {
  return {
    awayScore: point.away_score,
    homeScore: point.home_score,
    inning: point.inning,
    inningHalf: point.inning_half,
    outs: point.outs,
    balls: point.balls,
    strikes: point.strikes,
    runnerOnFirst: point.runner_on_first,
    runnerOnSecond: point.runner_on_second,
    runnerOnThird: point.runner_on_third,
    offenseTeam: point.offense_team,
    defenseTeam: point.defense_team,
  };
}

function winProbabilityPointFromApi(
  game: LiveGame,
  teams: TeamGroup[],
  apiPoint: LiveGameWinProbabilityPoint,
  generatedAt: string,
): WinProbabilityPoint {
  const teamsForGame = resolveAwayHomeTeams(game, teams);
  const awayTeam = teamsForGame.awayTeam;
  const homeTeam = teamsForGame.homeTeam;
  const context = contextFromWinProbabilityPoint(apiPoint);
  const atBat =
    apiPoint.at_bat_index == null
      ? null
      : (game.at_bats ?? []).find((row) => row.at_bat_index === apiPoint.at_bat_index) ?? null;
  const playerLookup = buildLivePlayerLookup(game.players);
  const awayProbability = roundTo(apiPoint.away_probability, 1);
  const homeProbability = roundTo(apiPoint.home_probability, 1);
  const scoreLabel =
    apiPoint.away_score != null && apiPoint.home_score != null
      ? `${awayTeam} ${formatNumber(apiPoint.away_score, 0)} - ${formatNumber(apiPoint.home_score, 0)} ${homeTeam}`
      : `${awayTeam} vs ${homeTeam}`;
  const inningLabel = formatInningState(context);
  const outsLabel = apiPoint.outs == null ? "Outs --" : `${apiPoint.outs} out${apiPoint.outs === 1 ? "" : "s"}`;
  const countLabel = formatCountState(apiPoint.balls, apiPoint.strikes);
  const baseStateLabel = formatBaseState(context);
  const eventLabel = atBat?.event ?? "Live snapshot";
  const playDescription = atBat?.description ?? null;
  const batterPlayerId = resolveLivePlayerId(atBat?.batter_name, playerLookup);
  const pitcherPlayerId = resolveLivePlayerId(atBat?.pitcher_name, playerLookup);
  return {
    capturedAt: apiPoint.captured_at ?? game.updated_at ?? generatedAt,
    awayTeam,
    homeTeam,
    sport: game.sport ?? "",
    awayScore: apiPoint.away_score,
    homeScore: apiPoint.home_score,
    awayProbability,
    homeProbability,
    inningNumber: apiPoint.inning,
    inningHalfCode: apiPoint.inning_half,
    outsCount: apiPoint.outs,
    inningLabel,
    outsLabel,
    countLabel,
    baseStateLabel,
    eventLabel,
    playDescription,
    scoringPlay: false,
    runsScored: 0,
    battingTeam: apiPoint.offense_team,
    fieldingTeam: apiPoint.defense_team,
    batterName: atBat?.batter_name ?? null,
    batterPlayerId,
    batterTeam: apiPoint.offense_team,
    pitcherName: atBat?.pitcher_name ?? null,
    pitcherPlayerId,
    pitcherTeam: apiPoint.defense_team,
    runnerOnFirst: Boolean(apiPoint.runner_on_first),
    runnerOnSecond: Boolean(apiPoint.runner_on_second),
    runnerOnThird: Boolean(apiPoint.runner_on_third),
    scoreLabel,
    situationLabel: `${inningLabel} | ${outsLabel} | ${baseStateLabel} | ${countLabel} | ${eventLabel}`,
    markerLabel: eventLabel,
    atBatIndex: apiPoint.at_bat_index,
  };
}

function backendWinProbabilityPoints(game: LiveGame, teams: TeamGroup[], generatedAt: string): WinProbabilityPoint[] {
  const series = (game.win_probability_series ?? []).map((point) => winProbabilityPointFromApi(game, teams, point, generatedAt));
  const current = game.win_probability ? winProbabilityPointFromApi(game, teams, game.win_probability, generatedAt) : null;
  if (!current) return series;
  const last = series[series.length - 1];
  if (last && last.atBatIndex === current.atBatIndex && last.awayProbability === current.awayProbability) {
    return series;
  }
  return [...series, current];
}

function WinProbabilityChart({
  points,
  players,
  liveBadgeLabel,
  activelyLive,
}: {
  points: WinProbabilityPoint[];
  players: LiveGamePlayer[];
  liveBadgeLabel: string;
  activelyLive: boolean;
}) {
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
  const batterLabel = formatCompactMatchupName(activePoint.batterName, "Unknown hitter");
  const pitcherLabel = formatCompactMatchupName(activePoint.pitcherName, "Unknown pitcher");
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
  const batterNameValue = showMatchupRow ? batterLabel : "Batter pending";
  const pitcherNameValue = showMatchupRow ? pitcherLabel : "Pitcher pending";
  const batterPlayerHref = activePoint.batterPlayerId != null ? `/player/${activePoint.batterPlayerId}` : null;
  const pitcherPlayerHref = activePoint.pitcherPlayerId != null ? `/player/${activePoint.pitcherPlayerId}` : null;
  const awayTeamReadableColor = teamReadableColor(activePoint.awayTeam, activePoint.sport);
  const homeTeamReadableColor = teamReadableColor(activePoint.homeTeam, activePoint.sport);
  const batterNameStyle = { "--live-scorebug-detail-color": teamReadableColor(batterTeamValue, activePoint.sport) } as CSSProperties;
  const pitcherNameStyle = { "--live-scorebug-detail-color": teamReadableColor(pitcherTeamValue, activePoint.sport) } as CSSProperties;
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
  const inningValues = points
    .map((point) => (point.inningNumber == null ? null : Math.max(1, Math.trunc(point.inningNumber))))
    .filter((inning): inning is number => inning != null);
  const chartInnings = Math.max(9, ...inningValues);
  const halfInningSpan = 0.5;
  const outSlice = halfInningSpan / 3;
  const bucketTotals = new Map<string, number>();
  for (const point of points) {
    const inning = point.inningNumber == null ? null : Math.max(1, Math.trunc(point.inningNumber));
    const half = (point.inningHalfCode ?? "").trim().toUpperCase();
    if (inning == null || (half !== "TOP" && half !== "BOTTOM")) continue;
    const outs = point.outsCount == null ? 0 : clamp(Math.trunc(point.outsCount), 0, 2);
    const key = `${inning}:${half}:${outs}`;
    bucketTotals.set(key, (bucketTotals.get(key) ?? 0) + 1);
  }
  const bucketSeen = new Map<string, number>();
  const progressByPoint = points.map((point, index) => {
    const inning = point.inningNumber == null ? null : Math.max(1, Math.trunc(point.inningNumber));
    const half = (point.inningHalfCode ?? "").trim().toUpperCase();
    if (inning == null) {
      return points.length === 1 ? chartInnings / 2 : (index * chartInnings) / (points.length - 1);
    }
    let progress = inning - 1;
    if (half === "BOTTOM" || half === "MIDDLE") progress += halfInningSpan;
    if (half === "END") progress += 1;
    if (half === "TOP" || half === "BOTTOM") {
      const outs = point.outsCount == null ? 0 : clamp(Math.trunc(point.outsCount), 0, 3);
      if (outs >= 3) {
        progress += halfInningSpan;
      } else {
        progress += outs * outSlice;
        const key = `${inning}:${half}:${outs}`;
        const total = bucketTotals.get(key) ?? 1;
        const seen = bucketSeen.get(key) ?? 0;
        bucketSeen.set(key, seen + 1);
        progress += ((seen + 1) / (total + 1)) * outSlice;
      }
    }
    return clamp(progress, 0, chartInnings);
  });
  for (let index = 1; index < progressByPoint.length; index += 1) {
    if (progressByPoint[index] < progressByPoint[index - 1]) {
      progressByPoint[index] = progressByPoint[index - 1];
    }
  }
  const xAt = (progress: number) => left + (clamp(progress, 0, chartInnings) / chartInnings) * plotWidth;
  const midpointY = yAt(50);
  const toPath = (coords: Array<{ x: number; y: number }>) =>
    coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`).join(" ");
  const inningTickStep = chartInnings > 12 ? 2 : 1;
  const inningGuideMarks = Array.from({ length: chartInnings - 1 }, (_, index) => index + 1).filter(
    (inningBoundary) => inningBoundary % inningTickStep === 0,
  );
  const inningTicks = Array.from({ length: chartInnings }, (_, index) => index + 1).filter(
    (inning) => inning === 1 || inning === chartInnings || (inning - 1) % inningTickStep === 0,
  );

  // Plot the line on a "road top / home bottom" axis by anchoring Y to road win probability.
  // This is equivalent to vertically mirroring a home-probability plot.
  const lineCoords = points.map((point, index) => ({ x: xAt(progressByPoint[index]), y: yAt(point.awayProbability) }));
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
    let nextIndex = 0;
    let nextDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < lineCoords.length; index += 1) {
      const distance = Math.abs(lineCoords[index].x - clampedX);
      if (distance < nextDistance) {
        nextDistance = distance;
        nextIndex = index;
      }
    }
    setHoveredIndex((current) => (current === nextIndex ? current : nextIndex));
  };
  const handlePointerLeave = () => setHoveredIndex(null);

  return (
    <section className="live-winprob-card" aria-label={`Win probability for ${activePoint.awayTeam} and ${activePoint.homeTeam}`}>
      <section className="live-scorebug" aria-label={`Game state ${activePoint.scoreLabel}`}>
        <div className="live-scorebug-main">
          <div className="live-scorebug-scoreboard">
            <div className="live-scorebug-team-row away">
              <span className="live-scorebug-team-code" style={{ color: awayTeamReadableColor }}>
                {activePoint.awayTeam}
              </span>
              <strong className="live-scorebug-runs">{awayScoreValue}</strong>
            </div>
            <div className="live-scorebug-team-row home">
              <span className="live-scorebug-team-code" style={{ color: homeTeamReadableColor }}>
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
            <div className="live-scorebug-footerline">
              <span className={`live-mini-badge live-scorebug-inline-badge${activelyLive ? "" : " muted"}`}>
                {liveBadgeLabel}
              </span>
              <span className="live-scorebug-count">{countBugLabel}</span>
            </div>
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
                    style={pitcherNameStyle}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {pitcherNameValue}
                  </Link>
                ) : (
                  <strong className="live-scorebug-detail-name" style={pitcherNameStyle}>
                    {pitcherNameValue}
                  </strong>
                )}
              </p>
              <p className="live-scorebug-detail-row">
                <span className="live-scorebug-detail-tag">B</span>
                {batterPlayerHref ? (
                  <Link
                    href={batterPlayerHref}
                    className="live-scorebug-detail-name live-scorebug-detail-name-link"
                    style={batterNameStyle}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {batterNameValue}
                  </Link>
                ) : (
                  <strong className="live-scorebug-detail-name" style={batterNameStyle}>
                    {batterNameValue}
                  </strong>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>
      <div className="live-winprob-legend">
        <span className="live-winprob-team">
          <strong className="live-winprob-team-name live-winprob-team-a" style={{ color: awayTeamReadableColor }}>
            {activePoint.awayTeam}
          </strong>
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
          <strong className="live-winprob-team-name live-winprob-team-b" style={{ color: homeTeamReadableColor }}>
            {activePoint.homeTeam}
          </strong>
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
            {inningGuideMarks.map((inningBoundary) => {
              const guideX = xAt(inningBoundary);
              return (
                <line
                  key={`inning-guide-${inningBoundary}`}
                  x1={guideX}
                  x2={guideX}
                  y1={top}
                  y2={height - bottom}
                  className="live-winprob-inning-guide"
                />
              );
            })}
            <line x1={left} x2={width - right} y1={midpointY} y2={midpointY} className="live-winprob-midline" />
            {inningTicks.map((inning) => {
              const tickX = xAt(inning - 0.5);
              return (
                <g key={`inning-tick-${inning}`}>
                  <line
                    x1={tickX}
                    x2={tickX}
                    y1={height - bottom}
                    y2={height - bottom + 2.75}
                    className="live-winprob-inning-tick"
                  />
                  <text x={tickX} y={height - 2.35} className="live-winprob-inning-label">
                    {inning}
                  </text>
                </g>
              );
            })}
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
  const todayDateKey = useMemo(() => chicagoDateKey(new Date()), []);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payload, setPayload] = useState<LiveGames | null>(null);
  const [sportFilter, setSportFilter] = useState("ALL");
  const [selectedDate, setSelectedDate] = useState<string>(todayDateKey);
  const [focusedGameId, setFocusedGameId] = useState<string | null>(null);
  const [winProbabilityByGameId, setWinProbabilityByGameId] = useState<Record<string, WinProbabilityPoint[]>>({});
  const [error, setError] = useState("");

  const load = useCallback(async (dateOverride?: string) => {
    const showFullLoading = payload == null;
    if (showFullLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const queryDate = (dateOverride ?? selectedDate).trim();
      const params = new URLSearchParams();
      if (queryDate && queryDate !== todayDateKey) {
        params.set("date", queryDate);
      }
      const route = params.size > 0 ? `/live/games?${params.toString()}` : "/live/games";
      const next = await apiGet<LiveGames>(route);
      setPayload(next);
      setError("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      if (showFullLoading) setLoading(false);
      setRefreshing(false);
    }
  }, [payload, router, selectedDate, todayDateKey]);

  useAdaptivePolling(load, { activeMs: 30_000, hiddenMs: 120_000 });

  const sports = useMemo(
    () => ["ALL", ...Array.from(new Set((payload?.games ?? []).map((game) => game.sport))).sort()],
    [payload],
  );
  const selectedDateDisplay = selectedDate === todayDateKey ? "Today" : selectedDate;

  const activeSportFilter = sports.includes(sportFilter) ? sportFilter : "ALL";

  const visibleGames = useMemo(() => {
    const games = payload?.games ?? [];
    if (activeSportFilter === "ALL") return games;
    return games.filter((game) => game.sport === activeSportFilter);
  }, [activeSportFilter, payload]);

  const overviewGames = useMemo(
    () => {
      const overview = visibleGames.map((game) => {
        const teams = groupTeams(game);
        const { awayTeam, homeTeam } = resolveAwayHomeTeams(game, teams);
        const series = winProbabilityByGameId[game.game_id] ?? [];
        const latestPoint = series.length > 0 ? series[series.length - 1] : null;
        const awayScoreRaw = latestPoint?.awayScore ?? game.state?.away_score ?? null;
        const homeScoreRaw = latestPoint?.homeScore ?? game.state?.home_score ?? null;
        const awayWinProbabilityRaw = latestPoint?.awayProbability ?? null;
        const homeWinProbabilityRaw =
          latestPoint?.homeProbability ?? (awayWinProbabilityRaw == null ? null : roundTo(100 - awayWinProbabilityRaw, 1));
        const gameSettled = isSettledGame(game);
        const firstPitchAt = game.state?.first_pitch_at ?? null;
        const firstPitchDate = firstPitchAt ? parseTimestamp(firstPitchAt) : new Date(Number.NaN);
        const firstPitchEpoch = Number.isNaN(firstPitchDate.getTime()) ? Number.POSITIVE_INFINITY : firstPitchDate.getTime();
        const scheduledInFuture = firstPitchEpoch !== Number.POSITIVE_INFINITY && firstPitchEpoch > Date.now() + 60_000;
        const activelyLive = game.is_live && !isCompletedGameStatus(game.game_status);
        const gameStateType = gameSettled ? "final" : scheduledInFuture ? "upcoming" : activelyLive ? "live" : "upcoming";
        const pregame = gameStateType === "upcoming";
        const firstPitchLabel = formatFirstPitchLabel(game.state?.first_pitch_at ?? null);
        const rawStateLabel = latestPoint?.inningLabel ?? "--";
        const pendingState =
          rawStateLabel.trim().toLowerCase() === "state pending" ||
          rawStateLabel.trim().toLowerCase() === "inning --";
        const stateLabel =
          pregame
            ? firstPitchLabel ?? "--"
            : gameSettled
              ? ""
            : !activelyLive && !gameSettled && firstPitchLabel && (pendingState || rawStateLabel === "--")
              ? firstPitchLabel
              : rawStateLabel;
        const topTextLabel = pregame ? firstPitchLabel ?? "--" : "";
        return {
          gameId: game.game_id,
          sport: game.sport,
          awayTeam,
          homeTeam,
          awayScoreLabel: pregame ? "-" : awayScoreRaw == null ? "--" : formatNumber(awayScoreRaw, 0),
          homeScoreLabel: pregame ? "-" : homeScoreRaw == null ? "--" : formatNumber(homeScoreRaw, 0),
          awayWinProbability: awayWinProbabilityRaw,
          homeWinProbability: homeWinProbabilityRaw,
          showLiveWinProbability:
            gameStateType === "live" && awayWinProbabilityRaw != null && homeWinProbabilityRaw != null,
          stateType: gameStateType,
          showFinalBadge: gameStateType === "final",
          topTextLabel,
          statusLabel: game.game_status ?? (activelyLive ? "In progress" : gameSettled ? "Final" : "Scheduled"),
          stateLabel,
          activelyLive,
          gameSettled,
          firstPitchEpoch,
        };
      });

      // Order mini scorebugs so users see active games first, then upcoming games by start time.
      overview.sort((left, right) => {
        const leftRank = left.activelyLive ? 0 : left.gameSettled ? 2 : 1;
        const rightRank = right.activelyLive ? 0 : right.gameSettled ? 2 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        if (left.firstPitchEpoch !== right.firstPitchEpoch) return left.firstPitchEpoch - right.firstPitchEpoch;
        return left.gameId.localeCompare(right.gameId);
      });
      return overview;
    },
    [visibleGames, winProbabilityByGameId],
  );
  const orderedVisibleGames = useMemo(() => {
    const byId = new Map(visibleGames.map((game) => [game.game_id, game]));
    return overviewGames
      .map((game) => byId.get(game.gameId))
      .filter((game): game is LiveGame => Boolean(game));
  }, [overviewGames, visibleGames]);
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
        const backendSeries = backendWinProbabilityPoints(game, teams, generatedAt);
        if (backendSeries.length > 0) {
          next[game.game_id] = backendSeries.slice(-180);
          continue;
        }
        const previousSeries = previous[game.game_id] ?? [];
        if (previousSeries.length > 0) next[game.game_id] = previousSeries.slice(-40);
      }

      return next;
    });
  }, [payload]);

  return (
    <main className="page-shell">
      <section className="hero-panel live-hero-panel">
        <div className="live-hero-copy">
          <p className="eyebrow">Live</p>
          <h1>Live Game Center</h1>
        </div>

        <section className="live-toolbar" aria-label="Live controls">
          <div className="live-date-picker-group">
            <div className="live-date-picker-field">
              <span className="live-date-picker-value" aria-hidden="true">
                {selectedDateDisplay}
              </span>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => {
                  const nextDate = event.target.value || todayDateKey;
                  setSelectedDate(nextDate);
                  setFocusedGameId(null);
                  void load(nextDate);
                }}
                aria-label={
                  selectedDate === todayDateKey
                    ? "Choose game date, Today selected"
                    : `Choose game date, ${selectedDate}`
                }
              />
            </div>
          </div>
          <select value={activeSportFilter} onChange={(event) => setSportFilter(event.target.value)}>
            {sports.map((sport) => (
              <option key={sport} value={sport}>
                {sport === "ALL" ? "All sports" : sport}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              void load();
            }}
            disabled={loading || refreshing}
          >
            {loading || refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </section>
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
              {overviewGames.map((game) => {
                const awayTeamColor = teamPrimaryColor(game.awayTeam, game.sport);
                const homeTeamColor = teamPrimaryColor(game.homeTeam, game.sport);
                const awayTeamReadableColor = teamReadableColor(game.awayTeam, game.sport);
                const homeTeamReadableColor = teamReadableColor(game.homeTeam, game.sport);
                const awayProbValue = game.awayWinProbability == null ? null : clamp(roundTo(game.awayWinProbability, 0), 0, 100);
                const homeProbValue =
                  game.homeWinProbability == null ? null : clamp(roundTo(game.homeWinProbability, 0), 0, 100);
                const showLiveProb = game.showLiveWinProbability && awayProbValue != null && homeProbValue != null;
                const liveWinProbPillStyle = showLiveProb
                  ? ({
                      background: `linear-gradient(90deg, ${awayTeamColor} 0%, ${awayTeamColor} ${awayProbValue}%, ${homeTeamColor} ${awayProbValue}%, ${homeTeamColor} 100%)`,
                      "--mini-winprob-split": `${awayProbValue}%`,
                    } as CSSProperties)
                  : undefined;
                return (
                  <button
                    key={`overview-${game.gameId}`}
                    type="button"
                    className={`live-mini-scorebug ${
                      game.stateType === "live" ? "status-live" : game.stateType === "final" ? "status-final" : "status-upcoming"
                    }${game.stateType === "upcoming" ? " pregame" : ""}${focusedGameId === game.gameId ? " active" : ""}`}
                    onClick={() => jumpToGame(game.gameId)}
                    title={`${game.awayTeam} ${game.awayScoreLabel} - ${game.homeScoreLabel} ${game.homeTeam} (${game.statusLabel})`}
                  >
                    <div className="live-mini-scorebug-inner">
                      {game.stateType === "upcoming" ? (
                        <div className="live-mini-scorebug-top upcoming">
                          <span className="live-mini-status">{game.topTextLabel}</span>
                        </div>
                      ) : game.showFinalBadge ? (
                        <div className="live-mini-scorebug-top final">
                          <span className="live-mini-badge muted">FINAL</span>
                        </div>
                      ) : null}
                      {game.stateType === "live" ? (
                        <div className="live-mini-scorebug-top upcoming">
                          <span className="live-mini-status live-mini-status-live">LIVE</span>
                        </div>
                      ) : null}
                      <div className={`live-mini-score-lines${showLiveProb ? " has-winprob" : ""}`}>
                        <p className="live-mini-score-row">
                          <span className="live-mini-team-meta">
                            <span className="live-mini-team-box">
                              <span className="live-mini-team" style={{ color: awayTeamReadableColor }}>
                                {game.awayTeam}
                              </span>
                            </span>
                            {showLiveProb ? <span className="live-mini-team-prob">{`${awayProbValue}%`}</span> : null}
                          </span>
                          <strong className="live-mini-score">{game.awayScoreLabel}</strong>
                        </p>
                        {showLiveProb ? (
                          <div
                            className="live-mini-winprob-pill"
                            style={liveWinProbPillStyle}
                            aria-label={`Live win probability: ${game.awayTeam} ${awayProbValue} percent, ${game.homeTeam} ${homeProbValue} percent`}
                          />
                        ) : null}
                        <p className="live-mini-score-row">
                          <span className="live-mini-team-meta">
                            <span className="live-mini-team-box">
                              <span className="live-mini-team" style={{ color: homeTeamReadableColor }}>
                                {game.homeTeam}
                              </span>
                            </span>
                            {showLiveProb ? <span className="live-mini-team-prob">{`${homeProbValue}%`}</span> : null}
                          </span>
                          <strong className="live-mini-score">{game.homeScoreLabel}</strong>
                        </p>
                      </div>
                      {game.stateLabel ? (
                        <span className="live-mini-state">{game.stateLabel}</span>
                      ) : game.stateType === "final" ? (
                        <span className="live-mini-state live-mini-state-spacer" aria-hidden="true">
                          --
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="live-games-grid">
            {orderedVisibleGames.map((game) => (
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
                  const winProbabilityPoints = winProbabilityByGameId[game.game_id] ?? [];
                  const activelyLive = game.is_live && !isCompletedGameStatus(game.game_status);
                  const gameSettled = isSettledGame(game);
                  const liveBadgeLabel = activelyLive ? "LIVE" : gameSettled ? "FINAL" : "TODAY";
                  return (
                    <>
                      <div className="live-game-toggle">
                        <WinProbabilityChart
                          points={winProbabilityPoints}
                          players={game.players}
                          liveBadgeLabel={liveBadgeLabel}
                          activelyLive={activelyLive}
                        />
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
                                      <Link
                                        href={`/player/${player.player_id}`}
                                        className="live-top-player-link"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                        }}
                                      >
                                        <span className="live-top-name live-top-name-clickable">{player.name}</span>
                                        <span className="subtle">{player.position}</span>
                                      </Link>
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
