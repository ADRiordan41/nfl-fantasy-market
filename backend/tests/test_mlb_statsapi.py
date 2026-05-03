import unittest

from backend.app.mlb_statsapi import _mlb_player_appeared_in_game


class MlbStatsApiTests(unittest.TestCase):
    def test_player_without_game_stats_did_not_appear(self) -> None:
        self.assertFalse(_mlb_player_appeared_in_game(game_batting={}, game_pitching={}))

    def test_zero_point_pitching_appearance_counts_as_appeared(self) -> None:
        self.assertTrue(
            _mlb_player_appeared_in_game(
                game_batting={},
                game_pitching={
                    "inningsPitched": "0.0",
                    "strikeOuts": 0,
                    "earnedRuns": 0,
                    "hits": 0,
                    "baseOnBalls": 0,
                },
            )
        )

    def test_zero_for_four_batting_appearance_counts_as_appeared(self) -> None:
        self.assertTrue(
            _mlb_player_appeared_in_game(
                game_batting={
                    "atBats": 4,
                    "hits": 0,
                    "runs": 0,
                    "rbi": 0,
                    "baseOnBalls": 0,
                    "stolenBases": 0,
                    "strikeOuts": 2,
                },
                game_pitching={},
            )
        )


if __name__ == "__main__":
    unittest.main()
