from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

from .mlb_statsapi import MlbGameAtBat, MlbGameState


@dataclass(frozen=True)
class WinProbabilityContext:
    away_score: int | None = None
    home_score: int | None = None
    inning: int | None = None
    inning_half: str | None = None
    outs: int | None = None
    balls: int | None = None
    strikes: int | None = None
    runner_on_first: bool | None = None
    runner_on_second: bool | None = None
    runner_on_third: bool | None = None
    offense_team: str | None = None
    defense_team: str | None = None
    batter_name: str | None = None
    pitcher_name: str | None = None


@dataclass(frozen=True)
class WinProbabilityPoint:
    captured_at: str | datetime | None
    away_probability: float
    home_probability: float
    away_score: int | None = None
    home_score: int | None = None
    inning: int | None = None
    inning_half: str | None = None
    outs: int | None = None
    balls: int | None = None
    strikes: int | None = None
    runner_on_first: bool | None = None
    runner_on_second: bool | None = None
    runner_on_third: bool | None = None
    offense_team: str | None = None
    defense_team: str | None = None
    batter_name: str | None = None
    pitcher_name: str | None = None
    at_bat_index: int | None = None


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def same_team(left: str | None, right: str | None) -> bool:
    return bool(left and right and left.strip().upper() == right.strip().upper())


def estimate_win_probability_from_points(team_points: float, opponent_points: float) -> float:
    base_weight = 18.0
    team = max(0.0, float(team_points))
    opponent = max(0.0, float(opponent_points))
    denominator = team + opponent + base_weight * 2
    if denominator <= 0:
        return 50.0
    return clamp(((team + base_weight) / denominator) * 100, 3, 97)


def non_final_win_probability_cap(run_diff: int, outs_remaining: int) -> float:
    margin = abs(run_diff)
    if margin <= 0:
        return 92
    if margin == 1:
        if outs_remaining >= 12:
            return 86
        if outs_remaining >= 6:
            return 92
        if outs_remaining >= 3:
            return 96
        return 98
    if margin == 2:
        if outs_remaining >= 12:
            return 93
        if outs_remaining >= 6:
            return 97
        if outs_remaining >= 3:
            return 98.5
        return 99
    if margin == 3:
        if outs_remaining >= 12:
            return 96.5
        if outs_remaining >= 6:
            return 98.5
        return 99
    if margin == 4:
        if outs_remaining >= 12:
            return 98
        return 99
    return 99


def estimate_mlb_away_win_probability(
    context: WinProbabilityContext,
    *,
    away_team: str,
    home_team: str,
    fallback_away_points: float = 0.0,
    fallback_home_points: float = 0.0,
) -> float:
    away_score = context.away_score
    home_score = context.home_score
    if away_score is None or home_score is None:
        return estimate_win_probability_from_points(fallback_away_points, fallback_home_points)

    inning = context.inning or 1
    outs = int(clamp(float(context.outs or 0), 0, 3))
    inning_half = (context.inning_half or "").strip().upper()
    base_outs = max(0, inning - 1) * 6
    outs_elapsed = base_outs + outs
    if inning_half == "BOTTOM":
        outs_elapsed = base_outs + 3 + outs
    if inning_half == "MIDDLE":
        outs_elapsed = base_outs + 3
    if inning_half == "END":
        outs_elapsed = base_outs + 6

    regulation_outs_elapsed = int(clamp(float(outs_elapsed), 0, 54))
    outs_remaining = max(0, 54 - regulation_outs_elapsed)
    progress = clamp(regulation_outs_elapsed / 54, 0, 1)
    progress_curve = progress**2.15
    run_diff = away_score - home_score
    endgame_pressure = 0.55 * progress**8
    run_logit_weight = 0.16 + 1.05 * progress_curve + endgame_pressure
    away_logit = run_diff * run_logit_weight

    away_logit -= 0.12

    runner_threat = (
        (0.06 if context.runner_on_first else 0)
        + (0.1 if context.runner_on_second else 0)
        + (0.16 if context.runner_on_third else 0)
    )
    outs_threat_multiplier = 0.78 if context.outs is None else 0.52 if context.outs >= 2 else 0.74 if context.outs == 1 else 1
    count_edge = ((context.balls or 0) - (context.strikes or 0)) * 0.04
    situation_logit = (runner_threat * outs_threat_multiplier + count_edge) * (0.28 + 0.36 * progress_curve)
    if same_team(context.offense_team, away_team):
        away_logit += situation_logit
    if same_team(context.offense_team, home_team):
        away_logit -= situation_logit

    if inning >= 9:
        if inning_half == "BOTTOM" and run_diff == 0:
            away_logit -= 0.52
        if inning_half == "TOP" and run_diff == 0:
            away_logit += 0.08
        if inning_half == "BOTTOM" and run_diff > 0:
            away_logit -= 0.22

    if inning >= 9 and inning_half == "BOTTOM" and home_score > away_score:
        return 0.5
    if inning >= 9 and inning_half == "BOTTOM" and away_score > home_score and outs >= 2:
        away_logit += 0.18

    raw_away_probability = 100 / (1 + math.exp(-clamp(away_logit, -6, 6)))
    favorite_cap = non_final_win_probability_cap(run_diff, outs_remaining)
    if run_diff > 0:
        capped = min(raw_away_probability, favorite_cap)
    elif run_diff < 0:
        capped = max(raw_away_probability, 100 - favorite_cap)
    else:
        capped = raw_away_probability
    return clamp(capped, 1, 99)


def final_probability_from_scores(away_score: int | None, home_score: int | None) -> tuple[float, float] | None:
    if away_score is None or home_score is None:
        return None
    if away_score > home_score:
        return (100.0, 0.0)
    if home_score > away_score:
        return (0.0, 100.0)
    return None


def context_from_mlb_state(state: MlbGameState) -> WinProbabilityContext:
    return WinProbabilityContext(
        away_score=state.away_score,
        home_score=state.home_score,
        inning=state.inning,
        inning_half=state.inning_half,
        outs=state.outs,
        balls=state.balls,
        strikes=state.strikes,
        runner_on_first=state.runner_on_first,
        runner_on_second=state.runner_on_second,
        runner_on_third=state.runner_on_third,
        offense_team=state.offense_team,
        defense_team=state.defense_team,
        batter_name=state.batter_name,
        pitcher_name=state.pitcher_name,
    )


def context_from_mlb_at_bat(at_bat: MlbGameAtBat, *, away_team: str, home_team: str) -> WinProbabilityContext:
    half = (at_bat.inning_half or "").strip().upper()
    offense_team = away_team if half == "TOP" else home_team if half == "BOTTOM" else None
    defense_team = home_team if half == "TOP" else away_team if half == "BOTTOM" else None
    return WinProbabilityContext(
        away_score=at_bat.away_score,
        home_score=at_bat.home_score,
        inning=at_bat.inning,
        inning_half=at_bat.inning_half,
        outs=at_bat.outs_after_play,
        balls=at_bat.balls,
        strikes=at_bat.strikes,
        runner_on_first=at_bat.runner_on_first,
        runner_on_second=at_bat.runner_on_second,
        runner_on_third=at_bat.runner_on_third,
        offense_team=offense_team,
        defense_team=defense_team,
        batter_name=at_bat.batter_name,
        pitcher_name=at_bat.pitcher_name,
    )


def point_from_context(
    context: WinProbabilityContext,
    *,
    captured_at: str | datetime | None,
    away_team: str,
    home_team: str,
    fallback_away_points: float = 0.0,
    fallback_home_points: float = 0.0,
    at_bat_index: int | None = None,
) -> WinProbabilityPoint:
    away_probability = round(
        estimate_mlb_away_win_probability(
            context,
            away_team=away_team,
            home_team=home_team,
            fallback_away_points=fallback_away_points,
            fallback_home_points=fallback_home_points,
        ),
        1,
    )
    return WinProbabilityPoint(
        captured_at=captured_at,
        away_probability=away_probability,
        home_probability=round(100 - away_probability, 1),
        away_score=context.away_score,
        home_score=context.home_score,
        inning=context.inning,
        inning_half=context.inning_half,
        outs=context.outs,
        balls=context.balls,
        strikes=context.strikes,
        runner_on_first=context.runner_on_first,
        runner_on_second=context.runner_on_second,
        runner_on_third=context.runner_on_third,
        offense_team=context.offense_team,
        defense_team=context.defense_team,
        batter_name=context.batter_name,
        pitcher_name=context.pitcher_name,
        at_bat_index=at_bat_index,
    )


def build_mlb_win_probability_series(
    state: MlbGameState,
    *,
    fallback_away_points: float = 0.0,
    fallback_home_points: float = 0.0,
    final: bool = False,
) -> list[WinProbabilityPoint]:
    away_team = state.away_team or "AWAY"
    home_team = state.home_team or "HOME"
    series = [
        point_from_context(
            context_from_mlb_at_bat(at_bat, away_team=away_team, home_team=home_team),
            captured_at=at_bat.occurred_at,
            away_team=away_team,
            home_team=home_team,
            fallback_away_points=fallback_away_points,
            fallback_home_points=fallback_home_points,
            at_bat_index=at_bat.at_bat_index,
        )
        for at_bat in sorted(state.at_bats, key=lambda row: row.at_bat_index)
    ]
    if series and final:
        final_probability = final_probability_from_scores(series[-1].away_score, series[-1].home_score)
        if final_probability:
            away_probability, home_probability = final_probability
            last = series[-1]
            series[-1] = WinProbabilityPoint(
                **{**last.__dict__, "away_probability": away_probability, "home_probability": home_probability}
            )
    return series[-180:]


def build_mlb_current_win_probability(
    state: MlbGameState,
    *,
    fallback_away_points: float = 0.0,
    fallback_home_points: float = 0.0,
    final: bool = False,
) -> WinProbabilityPoint | None:
    away_team = state.away_team or "AWAY"
    home_team = state.home_team or "HOME"
    if final:
        final_probability = final_probability_from_scores(state.away_score, state.home_score)
        if final_probability:
            away_probability, home_probability = final_probability
            context = context_from_mlb_state(state)
            return WinProbabilityPoint(
                captured_at=None,
                away_probability=away_probability,
                home_probability=home_probability,
                away_score=context.away_score,
                home_score=context.home_score,
                inning=context.inning,
                inning_half=context.inning_half,
                outs=context.outs,
                balls=context.balls,
                strikes=context.strikes,
                runner_on_first=context.runner_on_first,
                runner_on_second=context.runner_on_second,
                runner_on_third=context.runner_on_third,
                offense_team=context.offense_team,
                defense_team=context.defense_team,
                batter_name=context.batter_name,
                pitcher_name=context.pitcher_name,
            )
    return point_from_context(
        context_from_mlb_state(state),
        captured_at=None,
        away_team=away_team,
        home_team=home_team,
        fallback_away_points=fallback_away_points,
        fallback_home_points=fallback_home_points,
    )
