from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import Any
from urllib import parse, request

MLB_STATS_API_BASE = "https://statsapi.mlb.com"
MLB_STATS_API_SCHEDULE_PATH = "/api/v1/schedule"
MLB_STATS_API_LIVE_FEED_PATH = "/api/v1.1/game/{game_pk}/feed/live"
DEFAULT_MLB_ALLOWED_GAME_TYPES = {"R", "F", "D", "L", "W", "S"}
MLB_TEAM_ALIASES = {
    "SFG": "SF",
    "SFN": "SF",
    "CHW": "CWS",
    "KCR": "KC",
    "TBR": "TB",
    "WSN": "WSH",
}


@dataclass
class MlbIncomingStat:
    name: str
    team: str
    week: int
    fantasy_points: float
    live_now: bool | None = None
    live_week: int | None = None
    live_game_id: str | None = None
    live_game_label: str | None = None
    live_game_status: str | None = None
    live_game_stat_line: str | None = None
    live_game_fantasy_points: float | None = None


@dataclass
class MlbGameState:
    game_pk: str
    home_team: str | None = None
    away_team: str | None = None
    home_score: int | None = None
    away_score: int | None = None
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


def normalize_lookup_text(value: str | None) -> str:
    raw = unicodedata.normalize("NFKD", str(value or ""))
    folded = "".join(ch for ch in raw if not unicodedata.combining(ch))
    cleaned = "".join(ch if ch.isalnum() else " " for ch in folded.lower())
    return " ".join(cleaned.split())


def normalize_team_code(value: str | None) -> str:
    token = normalize_lookup_text(value).replace(" ", "").upper()
    if not token:
        return ""
    return MLB_TEAM_ALIASES.get(token, token)


def parse_mlb_allowed_game_types(raw_value: str | None) -> set[str]:
    raw = str(raw_value or "").strip().upper()
    if not raw:
        return set(DEFAULT_MLB_ALLOWED_GAME_TYPES)
    allowed = {
        token.strip().upper()
        for token in raw.replace(";", ",").split(",")
        if token.strip()
    }
    if allowed == {"R", "F", "D", "L", "W"}:
        allowed.add("S")
    return allowed or set(DEFAULT_MLB_ALLOWED_GAME_TYPES)


def _http_get_json(url: str, timeout: float) -> Any:
    req = request.Request(url, method="GET")
    with request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw)


def _parse_float(value: Any) -> float:
    if value is None:
        return 0.0
    raw = str(value).strip()
    if not raw:
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _parse_innings_pitched(value: Any) -> float:
    raw = str(value or "").strip()
    if not raw:
        return 0.0
    if "." not in raw:
        return _parse_float(raw)
    whole_raw, frac_raw = raw.split(".", 1)
    whole = _parse_float(whole_raw)
    outs = 0
    if frac_raw and frac_raw[0].isdigit():
        outs = int(frac_raw[0])
    outs = max(0, min(2, outs))
    return whole + (outs / 3.0)


def _mlb_hitter_points(stats: dict[str, Any]) -> float:
    hits = _parse_float(stats.get("hits"))
    doubles = _parse_float(stats.get("doubles"))
    triples = _parse_float(stats.get("triples"))
    homers = _parse_float(stats.get("homeRuns"))
    runs = _parse_float(stats.get("runs"))
    rbi = _parse_float(stats.get("rbi"))
    walks = _parse_float(stats.get("baseOnBalls"))
    steals = _parse_float(stats.get("stolenBases"))
    strikeouts = _parse_float(stats.get("strikeOuts"))
    singles = max(0.0, hits - doubles - triples - homers)
    points = (
        singles
        + (2.0 * doubles)
        + (3.0 * triples)
        + (4.0 * homers)
        + runs
        + rbi
        + walks
        + (2.0 * steals)
        - (0.25 * strikeouts)
    )
    return round(points, 6)


def _mlb_pitcher_points(stats: dict[str, Any]) -> float:
    innings = _parse_innings_pitched(stats.get("inningsPitched"))
    strikeouts = _parse_float(stats.get("strikeOuts"))
    wins = _parse_float(stats.get("wins"))
    saves = _parse_float(stats.get("saves"))
    earned_runs = _parse_float(stats.get("earnedRuns"))
    hits_allowed = _parse_float(stats.get("hits"))
    walks = _parse_float(stats.get("baseOnBalls"))
    losses = _parse_float(stats.get("losses"))
    points = (
        (3.0 * innings)
        + strikeouts
        + (5.0 * wins)
        + (5.0 * saves)
        - (2.0 * earned_runs)
        - (0.25 * hits_allowed)
        - (0.5 * walks)
        - (2.0 * losses)
    )
    return round(points, 6)


def _format_mlb_live_stat_line(
    game_batting: dict[str, Any],
    game_pitching: dict[str, Any],
) -> str | None:
    batting_hits = _parse_float(game_batting.get("hits"))
    batting_ab = _parse_float(game_batting.get("atBats"))
    batting_runs = _parse_float(game_batting.get("runs"))
    batting_rbi = _parse_float(game_batting.get("rbi"))
    batting_bb = _parse_float(game_batting.get("baseOnBalls"))
    batting_sb = _parse_float(game_batting.get("stolenBases"))

    pitching_ip_raw = str(game_pitching.get("inningsPitched") or "").strip()
    pitching_k = _parse_float(game_pitching.get("strikeOuts"))
    pitching_er = _parse_float(game_pitching.get("earnedRuns"))
    pitching_hits = _parse_float(game_pitching.get("hits"))
    pitching_bb = _parse_float(game_pitching.get("baseOnBalls"))

    if pitching_ip_raw or pitching_k > 0 or pitching_er > 0:
        return (
            f"IP {pitching_ip_raw or '0.0'} | K {int(pitching_k)} | ER {int(pitching_er)}"
            f" | H {int(pitching_hits)} | BB {int(pitching_bb)}"
        )
    if any(
        key in game_batting
        for key in ("atBats", "hits", "runs", "rbi", "baseOnBalls", "stolenBases", "strikeOuts")
    ):
        return (
            f"AB {int(batting_ab)} | H {int(batting_hits)} | R {int(batting_runs)}"
            f" | RBI {int(batting_rbi)} | BB {int(batting_bb)} | SB {int(batting_sb)}"
        )
    return None


def fetch_mlb_statsapi_rows(
    *,
    schedule_date: date,
    week: int,
    timeout: float = 20.0,
    allowed_game_types: set[str] | None = None,
) -> tuple[list[MlbIncomingStat], int]:
    target_week = max(1, int(week))
    allowed = set(allowed_game_types or DEFAULT_MLB_ALLOWED_GAME_TYPES)

    params = parse.urlencode({"sportId": 1, "date": schedule_date.isoformat()})
    schedule_url = f"{MLB_STATS_API_BASE}{MLB_STATS_API_SCHEDULE_PATH}?{params}"
    schedule_payload = _http_get_json(url=schedule_url, timeout=timeout)
    dates = schedule_payload.get("dates", []) if isinstance(schedule_payload, dict) else []

    game_rows_by_pk: dict[str, dict[str, Any]] = {}
    for date_block in dates:
        if not isinstance(date_block, dict):
            continue
        games = date_block.get("games", [])
        if not isinstance(games, list):
            continue
        for game in games:
            if not isinstance(game, dict):
                continue
            game_pk = game.get("gamePk")
            if game_pk is None:
                continue
            game_rows_by_pk[str(game_pk)] = game

    game_rows = list(game_rows_by_pk.values())
    out_rows: dict[tuple[str, str], MlbIncomingStat] = {}

    for game in game_rows:
        game_pk = game.get("gamePk")
        if game_pk is None:
            continue
        game_type = str(game.get("gameType") or "").strip().upper()
        if allowed and game_type not in allowed:
            continue

        status_block = game.get("status", {}) if isinstance(game.get("status"), dict) else {}
        abstract_state = str(status_block.get("abstractGameState") or "").strip().upper()
        if abstract_state == "PREVIEW":
            continue

        feed_url = f"{MLB_STATS_API_BASE}{MLB_STATS_API_LIVE_FEED_PATH.format(game_pk=game_pk)}"
        feed_payload = _http_get_json(url=feed_url, timeout=timeout)
        if not isinstance(feed_payload, dict):
            continue

        game_data = feed_payload.get("gameData", {}) if isinstance(feed_payload.get("gameData"), dict) else {}
        live_data = feed_payload.get("liveData", {}) if isinstance(feed_payload.get("liveData"), dict) else {}
        feed_game_type = str(game_data.get("gameType") or game_type).strip().upper()
        if allowed and feed_game_type not in allowed:
            continue

        status = game_data.get("status", {}) if isinstance(game_data.get("status"), dict) else {}
        abstract = str(status.get("abstractGameState") or abstract_state).strip().upper()
        detailed = str(status.get("detailedState") or "").strip() or None
        live_now = abstract == "LIVE"

        teams_meta = game_data.get("teams", {}) if isinstance(game_data.get("teams"), dict) else {}
        home_meta = teams_meta.get("home", {}) if isinstance(teams_meta.get("home"), dict) else {}
        away_meta = teams_meta.get("away", {}) if isinstance(teams_meta.get("away"), dict) else {}
        home_team = normalize_team_code(str(home_meta.get("abbreviation") or ""))
        away_team = normalize_team_code(str(away_meta.get("abbreviation") or ""))

        game_label = f"{away_team} @ {home_team}".strip()
        if not game_label or game_label == "@":
            game_label = "MLB Game"

        teams_box = (live_data.get("boxscore") or {}).get("teams")
        if not isinstance(teams_box, dict):
            continue

        for side in ("home", "away"):
            side_box = teams_box.get(side, {})
            if not isinstance(side_box, dict):
                continue
            team_code = home_team if side == "home" else away_team
            players = side_box.get("players", {})
            if not isinstance(players, dict):
                continue

            for player_entry in players.values():
                if not isinstance(player_entry, dict):
                    continue
                person = player_entry.get("person", {})
                if not isinstance(person, dict):
                    continue
                name = str(person.get("fullName") or "").strip()
                if not name:
                    continue

                game_stats = player_entry.get("stats", {})
                if not isinstance(game_stats, dict):
                    game_stats = {}
                season_stats = player_entry.get("seasonStats", {})
                if not isinstance(season_stats, dict):
                    season_stats = {}

                game_batting = game_stats.get("batting", {}) if isinstance(game_stats.get("batting"), dict) else {}
                game_pitching = game_stats.get("pitching", {}) if isinstance(game_stats.get("pitching"), dict) else {}
                season_batting = season_stats.get("batting", {}) if isinstance(season_stats.get("batting"), dict) else {}
                season_pitching = season_stats.get("pitching", {}) if isinstance(season_stats.get("pitching"), dict) else {}

                season_points = _mlb_hitter_points(season_batting) + _mlb_pitcher_points(season_pitching)
                game_points = _mlb_hitter_points(game_batting) + _mlb_pitcher_points(game_pitching)
                live_stat_line = _format_mlb_live_stat_line(game_batting=game_batting, game_pitching=game_pitching)

                row = MlbIncomingStat(
                    name=name,
                    team=team_code,
                    week=target_week,
                    fantasy_points=round(season_points, 6),
                    live_now=live_now,
                    live_week=target_week,
                    live_game_id=str(game_pk),
                    live_game_label=game_label,
                    live_game_status=detailed,
                    live_game_stat_line=live_stat_line,
                    live_game_fantasy_points=round(game_points, 6),
                )

                dedupe_key = (normalize_lookup_text(name), normalize_team_code(team_code))
                existing = out_rows.get(dedupe_key)
                if existing is None:
                    out_rows[dedupe_key] = row
                    continue
                if bool(row.live_now) and not bool(existing.live_now):
                    out_rows[dedupe_key] = row
                    continue
                if (row.live_game_fantasy_points or 0.0) > (existing.live_game_fantasy_points or 0.0):
                    out_rows[dedupe_key] = row
                    continue
                if float(row.fantasy_points) > float(existing.fantasy_points):
                    out_rows[dedupe_key] = row

    return list(out_rows.values()), len(game_rows)


def fetch_mlb_game_states(*, game_pks: list[str], timeout: float = 5.0) -> dict[str, MlbGameState]:
    states: dict[str, MlbGameState] = {}
    for raw_game_pk in game_pks:
        game_pk = str(raw_game_pk or "").strip()
        if not game_pk or not game_pk.isdigit():
            continue
        feed_url = f"{MLB_STATS_API_BASE}{MLB_STATS_API_LIVE_FEED_PATH.format(game_pk=game_pk)}"
        try:
            feed_payload = _http_get_json(url=feed_url, timeout=timeout)
        except Exception:
            continue
        if not isinstance(feed_payload, dict):
            continue

        game_data = feed_payload.get("gameData", {}) if isinstance(feed_payload.get("gameData"), dict) else {}
        live_data = feed_payload.get("liveData", {}) if isinstance(feed_payload.get("liveData"), dict) else {}
        linescore = live_data.get("linescore", {}) if isinstance(live_data.get("linescore"), dict) else {}
        teams_meta = game_data.get("teams", {}) if isinstance(game_data.get("teams"), dict) else {}
        home_meta = teams_meta.get("home", {}) if isinstance(teams_meta.get("home"), dict) else {}
        away_meta = teams_meta.get("away", {}) if isinstance(teams_meta.get("away"), dict) else {}

        home_team = normalize_team_code(str(home_meta.get("abbreviation") or ""))
        away_team = normalize_team_code(str(away_meta.get("abbreviation") or ""))
        home_team_id = _parse_int(home_meta.get("id"))
        away_team_id = _parse_int(away_meta.get("id"))

        teams_score = linescore.get("teams", {}) if isinstance(linescore.get("teams"), dict) else {}
        home_score_payload = teams_score.get("home", {}) if isinstance(teams_score.get("home"), dict) else {}
        away_score_payload = teams_score.get("away", {}) if isinstance(teams_score.get("away"), dict) else {}

        inning_half = str(linescore.get("inningState") or "").strip().upper() or None
        if inning_half:
            if inning_half.startswith("TOP"):
                inning_half = "TOP"
            elif inning_half.startswith("BOTTOM"):
                inning_half = "BOTTOM"
            elif inning_half.startswith("MIDDLE"):
                inning_half = "MIDDLE"
            elif inning_half.startswith("END"):
                inning_half = "END"

        offense_payload = linescore.get("offense", {}) if isinstance(linescore.get("offense"), dict) else {}
        defense_payload = linescore.get("defense", {}) if isinstance(linescore.get("defense"), dict) else {}
        offense_team_payload = offense_payload.get("team", {}) if isinstance(offense_payload.get("team"), dict) else {}
        defense_team_payload = defense_payload.get("team", {}) if isinstance(defense_payload.get("team"), dict) else {}
        offense_team_id = _parse_int(offense_team_payload.get("id"))
        defense_team_id = _parse_int(defense_team_payload.get("id"))

        offense_team: str | None = None
        defense_team: str | None = None
        if offense_team_id is not None:
            if home_team_id is not None and offense_team_id == home_team_id:
                offense_team = home_team or None
            elif away_team_id is not None and offense_team_id == away_team_id:
                offense_team = away_team or None
        if defense_team_id is not None:
            if home_team_id is not None and defense_team_id == home_team_id:
                defense_team = home_team or None
            elif away_team_id is not None and defense_team_id == away_team_id:
                defense_team = away_team or None

        if offense_team is None and inning_half in {"TOP", "BOTTOM"}:
            offense_team = away_team if inning_half == "TOP" else home_team
        if defense_team is None and inning_half in {"TOP", "BOTTOM"}:
            defense_team = home_team if inning_half == "TOP" else away_team

        states[game_pk] = MlbGameState(
            game_pk=game_pk,
            home_team=home_team or None,
            away_team=away_team or None,
            home_score=_parse_int(home_score_payload.get("runs")),
            away_score=_parse_int(away_score_payload.get("runs")),
            inning=_parse_int(linescore.get("currentInning")),
            inning_half=inning_half,
            outs=_parse_int(linescore.get("outs")),
            balls=_parse_int(linescore.get("balls")),
            strikes=_parse_int(linescore.get("strikes")),
            runner_on_first=isinstance(offense_payload.get("first"), dict),
            runner_on_second=isinstance(offense_payload.get("second"), dict),
            runner_on_third=isinstance(offense_payload.get("third"), dict),
            offense_team=offense_team,
            defense_team=defense_team,
        )

    return states
