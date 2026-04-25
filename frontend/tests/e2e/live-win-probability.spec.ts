import { expect, test } from "@playwright/test";
import { mockAuthedApi } from "../visual/helpers/mock-api";

const CONSERVATIVE_LIVE_GAMES = {
  generated_at: "2026-02-25T01:30:00Z",
  live_games_count: 1,
  live_players_count: 2,
  games: [
    {
      game_id: "mlb-nyy-bos-conservative-winprob",
      sport: "MLB",
      game_label: "NYY @ BOS",
      game_status: "Top 7th",
      week: 12,
      is_live: true,
      live_player_count: 2,
      game_fantasy_points_total: 18.2,
      state: {
        home_team: "BOS",
        away_team: "NYY",
        home_score: 3,
        away_score: 5,
        inning: 7,
        inning_half: "TOP",
        outs: 1,
        balls: 1,
        strikes: 1,
        runner_on_first: false,
        runner_on_second: false,
        runner_on_third: false,
        offense_team: "NYY",
        defense_team: "BOS",
      },
      at_bats: [],
      win_probability: {
        captured_at: "2026-02-25T01:29:00Z",
        away_probability: 76.6,
        home_probability: 23.4,
        away_score: 5,
        home_score: 3,
        inning: 7,
        inning_half: "TOP",
        outs: 1,
        balls: 1,
        strikes: 1,
        runner_on_first: false,
        runner_on_second: false,
        runner_on_third: false,
        offense_team: "NYY",
        defense_team: "BOS",
        at_bat_index: null,
      },
      win_probability_series: [],
      updated_at: "2026-02-25T01:29:00Z",
      players: [
        {
          player_id: 101,
          name: "Aaron Judge",
          team: "NYY",
          position: "OF",
          points_to_date: 96.0,
          game_fantasy_points: 9.4,
          game_stat_line: "1-3, RBI",
          spot_price: 318.4,
          fundamental_price: 306.4,
        },
        {
          player_id: 103,
          name: "Rafael Devers",
          team: "BOS",
          position: "3B",
          points_to_date: 80.0,
          game_fantasy_points: 8.8,
          game_stat_line: "2-3, 2B",
          spot_price: 258.4,
          fundamental_price: 269.1,
        },
      ],
    },
  ],
};

test("live MLB win probability stays conservative with a small lead and plenty of outs left", async ({ page }) => {
  await mockAuthedApi(page, { liveGames: CONSERVATIVE_LIVE_GAMES });

  await page.goto("/live");
  await page.waitForLoadState("networkidle");

  const scorebug = page.locator(".live-mini-scorebug", { hasText: "NYY" }).first();
  await expect(scorebug).toBeVisible();
  await expect(scorebug.locator(".live-mini-team-prob").first()).toHaveText("77%");
  await expect(scorebug).not.toContainText("99%");
});
