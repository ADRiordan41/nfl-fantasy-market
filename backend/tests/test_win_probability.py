from backend.app.mlb_statsapi import MlbGameState
from backend.app.win_probability import (
    WinProbabilityContext,
    build_mlb_current_win_probability,
    estimate_mlb_away_win_probability,
)


def test_small_late_lead_with_outs_remaining_stays_conservative():
    probability = estimate_mlb_away_win_probability(
        WinProbabilityContext(
            away_score=5,
            home_score=3,
            inning=7,
            inning_half="TOP",
            outs=1,
            balls=1,
            strikes=1,
            runner_on_first=False,
            runner_on_second=False,
            runner_on_third=False,
            offense_team="NYY",
            defense_team="BOS",
        ),
        away_team="NYY",
        home_team="BOS",
    )

    assert round(probability, 1) == 76.6


def test_current_probability_from_mlb_state_uses_backend_model():
    point = build_mlb_current_win_probability(
        MlbGameState(
            game_pk="12345",
            away_team="NYY",
            home_team="BOS",
            away_score=5,
            home_score=3,
            inning=7,
            inning_half="TOP",
            outs=1,
            balls=1,
            strikes=1,
            runner_on_first=False,
            runner_on_second=False,
            runner_on_third=False,
            offense_team="NYY",
            defense_team="BOS",
        )
    )

    assert point is not None
    assert point.away_probability == 76.6
    assert point.home_probability == 23.4
