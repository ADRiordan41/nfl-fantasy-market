import argparse
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib import request


@dataclass
class PlayerRef:
    player_id: int
    name: str
    team: str


def normalize(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def fetch_players(api_base: str) -> list[dict]:
    url = f"{api_base.rstrip('/')}/players"
    with request.urlopen(url) as response:
        return json.loads(response.read().decode("utf-8"))


def post_stat(api_base: str, payload: dict, token: str | None = None) -> None:
    url = f"{api_base.rstrip('/')}/stats"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with request.urlopen(req):
        return


def detect_column(row: dict, candidates: Iterable[str]) -> str:
    normalized_keys = {normalize(key): key for key in row.keys()}
    for candidate in candidates:
        key = normalized_keys.get(normalize(candidate))
        if key:
            return key
    return ""


def resolve_player(
    name: str,
    team: str,
    by_name_team: dict[tuple[str, str], PlayerRef],
    by_name: dict[str, list[PlayerRef]],
) -> PlayerRef | None:
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
    parser = argparse.ArgumentParser(description="Import weekly fantasy stats into /stats endpoint")
    parser.add_argument("--file", required=True, help="CSV file path")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--week", type=int, default=None, help="Optional week override for all rows")
    parser.add_argument("--token", default=None, help="Bearer token for admin-authenticated /stats endpoint")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print without posting")
    args = parser.parse_args()

    file_path = Path(args.file)
    if not file_path.exists():
        print(f"[error] file not found: {file_path}")
        return 1

    players = fetch_players(args.api_base)
    by_name_team: dict[tuple[str, str], PlayerRef] = {}
    by_name: dict[str, list[PlayerRef]] = {}

    for player in players:
        ref = PlayerRef(
            player_id=int(player["id"]),
            name=str(player["name"]),
            team=str(player["team"]),
        )
        key_name = normalize(ref.name)
        key_team = normalize(ref.team)
        by_name_team[(key_name, key_team)] = ref
        by_name.setdefault(key_name, []).append(ref)

    success = 0
    skipped = 0
    failed = 0

    with file_path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        rows = list(reader)

    if not rows:
        print("[error] CSV has no rows")
        return 1

    sample = rows[0]
    col_name = detect_column(sample, ["player_name", "name", "player"])
    col_team = detect_column(sample, ["team", "team_abbr", "team_code"])
    col_week = detect_column(sample, ["week"])
    col_points = detect_column(sample, ["fantasy_points", "points", "fpts", "half_ppr_points"])

    if not col_name or not col_points:
        print("[error] CSV must include player name and fantasy points columns")
        return 1

    for idx, row in enumerate(rows, start=2):
        name = str(row.get(col_name, "")).strip()
        team = str(row.get(col_team, "")).strip() if col_team else ""
        points_raw = str(row.get(col_points, "")).strip()

        if not name or not points_raw:
            skipped += 1
            continue

        row_week = args.week
        if row_week is None:
            if not col_week:
                print(f"[row {idx}] missing week and no --week supplied")
                failed += 1
                continue
            try:
                row_week = int(str(row.get(col_week, "")).strip())
            except ValueError:
                print(f"[row {idx}] invalid week value")
                failed += 1
                continue

        try:
            points = float(points_raw)
        except ValueError:
            print(f"[row {idx}] invalid points value: {points_raw}")
            failed += 1
            continue

        ref = resolve_player(name, team, by_name_team, by_name)
        if not ref:
            team_hint = f" ({team})" if team else ""
            print(f"[row {idx}] no player match for '{name}{team_hint}'")
            failed += 1
            continue

        payload = {
            "player_id": ref.player_id,
            "week": int(row_week),
            "fantasy_points": float(points),
        }

        if args.dry_run:
            print(f"[dry-run] row {idx}: {ref.name} ({ref.team}) -> week {row_week}, pts {points}")
            success += 1
            continue

        try:
            post_stat(args.api_base, payload, token=args.token)
            success += 1
        except Exception as exc:
            print(f"[row {idx}] post failed for {ref.name} ({ref.team}): {exc}")
            failed += 1

    print(
        f"done | posted={success} skipped={skipped} failed={failed}"
        + (" (dry-run)" if args.dry_run else "")
    )

    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
