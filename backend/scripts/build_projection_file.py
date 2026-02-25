import argparse
import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass
class RosterPlayer:
    name: str
    team: str
    position: str
    sport: str


def normalize(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def normalize_sport(value: str, default: str = "NFL") -> str:
    sport = (value or default).strip().upper()
    return sport or default


def detect_column(row: dict[str, str], candidates: Iterable[str]) -> str:
    normalized = {normalize(key): key for key in row.keys()}
    for candidate in candidates:
        key = normalized.get(normalize(candidate))
        if key:
            return key
    return ""


def load_roster(
    roster_path: Path,
    target_sport: str,
) -> tuple[dict[tuple[str, str], RosterPlayer], dict[str, list[RosterPlayer]]]:
    by_name_team: dict[tuple[str, str], RosterPlayer] = {}
    by_name: dict[str, list[RosterPlayer]] = {}

    with roster_path.open("r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            name = (row.get("name") or "").strip()
            team = (row.get("team") or "").strip().upper()
            position = (row.get("position") or "").strip().upper()
            sport = normalize_sport(str(row.get("sport", "")), target_sport)
            if not name or not team or not position:
                continue
            if sport != target_sport:
                continue

            player = RosterPlayer(name=name, team=team, position=position, sport=sport)
            by_name_team[(normalize(name), normalize(team))] = player
            by_name.setdefault(normalize(name), []).append(player)

    return by_name_team, by_name


def resolve_player(
    name: str,
    team: str,
    by_name_team: dict[tuple[str, str], RosterPlayer],
    by_name: dict[str, list[RosterPlayer]],
) -> RosterPlayer | None:
    key_name = normalize(name)
    key_team = normalize(team)

    if key_name and key_team:
        direct = by_name_team.get((key_name, key_team))
        if direct:
            return direct

    matches = by_name.get(key_name, [])
    if len(matches) == 1:
        return matches[0]

    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Build canonical per-player projections CSV")
    parser.add_argument("--source", required=True, help="Raw projections CSV from provider")
    parser.add_argument(
        "--roster",
        default="backend/data/nfl_players.csv",
        help="Roster CSV used for exact player universe",
    )
    parser.add_argument(
        "--output",
        default="backend/data/nfl_projections_2026.csv",
        help="Canonical output CSV path",
    )
    parser.add_argument(
        "--sport",
        default="NFL",
        help="Sport code to build (for example NFL, MLB, NBA)",
    )
    parser.add_argument("--strict", action="store_true", help="Exit non-zero if any row cannot be mapped")
    args = parser.parse_args()

    source_path = Path(args.source)
    roster_path = Path(args.roster)
    output_path = Path(args.output)
    target_sport = normalize_sport(args.sport)

    if not source_path.exists():
        print(f"[error] source file not found: {source_path}")
        return 1
    if not roster_path.exists():
        print(f"[error] roster file not found: {roster_path}")
        return 1

    by_name_team, by_name = load_roster(roster_path, target_sport)

    with source_path.open("r", encoding="utf-8", newline="") as src:
        reader = csv.DictReader(src)
        rows = list(reader)

    if not rows:
        print("[error] source CSV has no rows")
        return 1

    sample = rows[0]
    col_name = detect_column(sample, ["player_name", "name", "player", "player name"])
    col_team = detect_column(sample, ["team", "team_abbr", "team code"])
    col_points = detect_column(sample, ["projected_points", "projection", "points", "fpts", "fantasy_points"])

    if not col_name or not col_points:
        print("[error] source CSV must include player name and projected points columns")
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    unmatched = 0
    duplicates = 0
    seen: set[tuple[str, str]] = set()

    with output_path.open("w", encoding="utf-8", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(["name", "team", "position", "sport", "projected_points"])

        for idx, row in enumerate(rows, start=2):
            name = str(row.get(col_name, "")).strip()
            team = str(row.get(col_team, "")).strip().upper() if col_team else ""
            points_raw = str(row.get(col_points, "")).strip()

            if not name or not points_raw:
                continue

            try:
                points = float(points_raw)
            except ValueError:
                print(f"[row {idx}] invalid projected points: {points_raw}")
                unmatched += 1
                continue

            roster_player = resolve_player(name, team, by_name_team, by_name)
            if not roster_player:
                team_hint = f" ({team})" if team else ""
                print(f"[row {idx}] unmatched player: {name}{team_hint}")
                unmatched += 1
                continue

            key = (normalize(roster_player.name), normalize(roster_player.team))
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)

            writer.writerow([
                roster_player.name,
                roster_player.team,
                roster_player.position,
                roster_player.sport,
                f"{points:.3f}",
            ])
            written += 1

    print(
        f"done | written={written} unmatched={unmatched} duplicates_ignored={duplicates} output={output_path}"
    )

    if args.strict and unmatched > 0:
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
