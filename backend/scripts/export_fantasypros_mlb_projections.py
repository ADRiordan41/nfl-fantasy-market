from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen


HITTERS_URL = "https://www.fantasypros.com/mlb/projections/hitters.php"
PITCHERS_URL = "https://www.fantasypros.com/mlb/projections/pitchers.php"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
PLAYER_CELL_RE = re.compile(
    r"^(?P<name>.+?)\s*\(\s*(?P<team>[A-Z]{2,4})\s*-\s*(?P<positions>[^)]+)\)$"
)

HITTER_POSITION_ORDER = ["C", "1B", "2B", "3B", "SS", "OF", "DH"]
HITTER_POSITION_ALIASES = {
    "LF": "OF",
    "CF": "OF",
    "RF": "OF",
    "UTIL": "DH",
    "UT": "DH",
}


@dataclass
class ProjectionRow:
    name: str
    team: str
    position: str
    projected_points: float
    is_pitcher: bool


class FantasyProsTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._capturing_table = False
        self._table_depth = 0
        self._header_open = False
        self._body_open = False
        self._row_open = False
        self._cell_open = False
        self._cell_chunks: list[str] = []
        self._current_row: list[str] = []

        self.headers: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = {key: value for key, value in attrs}

        if tag == "table" and attrs_map.get("id") == "data" and not self._capturing_table:
            self._capturing_table = True
            self._table_depth = 1
            return

        if self._capturing_table and tag == "table":
            self._table_depth += 1

        if not self._capturing_table:
            return

        if tag == "thead":
            self._header_open = True
            return
        if tag == "tbody":
            self._body_open = True
            return
        if tag == "tr":
            self._row_open = True
            self._current_row = []
            return
        if tag in {"th", "td"} and self._row_open:
            self._cell_open = True
            self._cell_chunks = []
            return
        if tag == "br" and self._cell_open:
            self._cell_chunks.append(" ")

    def handle_data(self, data: str) -> None:
        if not self._cell_open:
            return
        text = data.strip()
        if text:
            self._cell_chunks.append(text)

    def handle_endtag(self, tag: str) -> None:
        if self._capturing_table and tag == "table":
            self._table_depth -= 1
            if self._table_depth == 0:
                self._capturing_table = False
            return

        if not self._capturing_table:
            return

        if tag in {"th", "td"} and self._cell_open:
            self._cell_open = False
            cell_text = " ".join(" ".join(self._cell_chunks).split())
            self._current_row.append(cell_text)
            return

        if tag == "tr" and self._row_open:
            self._row_open = False
            if not self._current_row:
                return
            if self._header_open:
                self.headers = self._current_row
            elif self._body_open:
                self.rows.append(self._current_row)
            return

        if tag == "thead":
            self._header_open = False
            return
        if tag == "tbody":
            self._body_open = False


def fetch_html(url: str, timeout: float, user_agent: str) -> str:
    req = Request(url, headers={"User-Agent": user_agent})
    with urlopen(req, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def fetch_projection_table(url: str, timeout: float, user_agent: str) -> tuple[list[str], list[list[str]]]:
    html = fetch_html(url=url, timeout=timeout, user_agent=user_agent)
    parser = FantasyProsTableParser()
    parser.feed(html)
    if not parser.headers or not parser.rows:
        raise RuntimeError(f"Could not parse projection table from {url}")
    return parser.headers, parser.rows


def parse_player_cell(raw_player: str) -> tuple[str, str, list[str]] | None:
    match = PLAYER_CELL_RE.match(raw_player.strip())
    if not match:
        return None

    name = " ".join(match.group("name").split())
    team = match.group("team").strip().upper()
    positions = [part.strip().upper() for part in match.group("positions").split(",") if part.strip()]
    if not name or not team or not positions:
        return None
    return name, team, positions


def to_float(value: str) -> float:
    raw = value.strip().replace(",", "")
    if not raw:
        return 0.0
    return float(raw)


def canonical_hitter_position(positions: list[str]) -> str | None:
    canonical: set[str] = set()
    for position in positions:
        mapped = HITTER_POSITION_ALIASES.get(position, position)
        if mapped in {"SP", "RP"}:
            continue
        canonical.add(mapped)

    for position in HITTER_POSITION_ORDER:
        if position in canonical:
            return position
    return None


def hitter_points(stats: dict[str, str]) -> tuple[float, float]:
    ab = to_float(stats.get("AB", "0"))
    runs = to_float(stats.get("R", "0"))
    hr = to_float(stats.get("HR", "0"))
    rbi = to_float(stats.get("RBI", "0"))
    sb = to_float(stats.get("SB", "0"))
    hits = to_float(stats.get("H", "0"))
    doubles = to_float(stats.get("2B", "0"))
    triples = to_float(stats.get("3B", "0"))
    walks = to_float(stats.get("BB", "0"))
    strikeouts = to_float(stats.get("SO", "0"))

    singles = max(0.0, hits - doubles - triples - hr)
    points = (
        singles
        + (2.0 * doubles)
        + (3.0 * triples)
        + (4.0 * hr)
        + runs
        + rbi
        + walks
        + (2.0 * sb)
        - (0.25 * strikeouts)
    )
    return points, ab


def pitcher_points(stats: dict[str, str]) -> tuple[float, float, float]:
    ip = to_float(stats.get("IP", "0"))
    strikeouts = to_float(stats.get("K", "0"))
    wins = to_float(stats.get("W", "0"))
    saves = to_float(stats.get("SV", "0"))
    earned_runs = to_float(stats.get("ER", "0"))
    hits_allowed = to_float(stats.get("H", "0"))
    walks = to_float(stats.get("BB", "0"))
    losses = to_float(stats.get("L", "0"))
    starts = to_float(stats.get("GS", "0"))

    points = (
        (3.0 * ip)
        + strikeouts
        + (5.0 * wins)
        + (5.0 * saves)
        - (2.0 * earned_runs)
        - (0.25 * hits_allowed)
        - (0.5 * walks)
        - (2.0 * losses)
    )
    return points, ip, starts


def parse_hitter_rows(headers: list[str], rows: list[list[str]]) -> list[ProjectionRow]:
    projections: list[ProjectionRow] = []
    for row in rows:
        if len(row) != len(headers):
            continue
        stat_map = dict(zip(headers, row))

        parsed = parse_player_cell(stat_map.get("Player", ""))
        if not parsed:
            continue
        name, team, positions = parsed
        position = canonical_hitter_position(positions)
        if not position:
            continue

        points, ab = hitter_points(stat_map)
        if points <= 0:
            continue
        if ab < 40 and points < 40:
            continue

        projections.append(
            ProjectionRow(
                name=name,
                team=team,
                position=position,
                projected_points=points,
                is_pitcher=False,
            )
        )
    return projections


def parse_pitcher_rows(headers: list[str], rows: list[list[str]]) -> list[ProjectionRow]:
    projections: list[ProjectionRow] = []
    for row in rows:
        if len(row) != len(headers):
            continue
        stat_map = dict(zip(headers, row))

        parsed = parse_player_cell(stat_map.get("Player", ""))
        if not parsed:
            continue
        name, team, positions = parsed

        points, ip, starts = pitcher_points(stat_map)
        if points <= 0:
            continue
        if ip < 10 and points < 40:
            continue

        pitcher_position = "RP" if "RP" in positions and "SP" not in positions else "SP"
        if "SP" not in positions and "RP" not in positions:
            pitcher_position = "SP" if starts >= 8 else "RP"

        projections.append(
            ProjectionRow(
                name=name,
                team=team,
                position=pitcher_position,
                projected_points=points,
                is_pitcher=True,
            )
        )
    return projections


def merge_projection_rows(rows: list[ProjectionRow]) -> list[ProjectionRow]:
    merged: dict[tuple[str, str], ProjectionRow] = {}
    for row in rows:
        key = (row.name, row.team)
        existing = merged.get(key)
        if existing is None:
            merged[key] = row
            continue

        if existing.is_pitcher != row.is_pitcher:
            existing.projected_points += row.projected_points
            if existing.is_pitcher and not row.is_pitcher:
                existing.position = row.position
                existing.is_pitcher = False
            continue

        if row.projected_points > existing.projected_points:
            merged[key] = row

    return list(merged.values())


def write_outputs(
    rows: list[ProjectionRow],
    roster_path: Path,
    projection_path: Path,
    sport: str,
    min_points: float,
) -> tuple[int, int]:
    sport_upper = sport.strip().upper() or "MLB"
    filtered = [row for row in rows if row.projected_points >= min_points]
    filtered.sort(key=lambda row: (-row.projected_points, row.name))

    roster_path.parent.mkdir(parents=True, exist_ok=True)
    projection_path.parent.mkdir(parents=True, exist_ok=True)

    with roster_path.open("w", encoding="utf-8", newline="") as roster_file:
        writer = csv.writer(roster_file)
        writer.writerow(["name", "team", "position", "sport"])
        for row in filtered:
            writer.writerow([row.name, row.team, row.position, sport_upper])

    with projection_path.open("w", encoding="utf-8", newline="") as projection_file:
        writer = csv.writer(projection_file)
        writer.writerow(["name", "team", "position", "sport", "projected_points"])
        for row in filtered:
            writer.writerow([row.name, row.team, row.position, sport_upper, f"{row.projected_points:.3f}"])

    sp_count = sum(1 for row in filtered if row.position == "SP")
    rp_count = sum(1 for row in filtered if row.position == "RP")
    hitter_count = len(filtered) - sp_count - rp_count
    return len(filtered), hitter_count + sp_count + rp_count


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export MLB player universe + projected fantasy points from FantasyPros"
    )
    parser.add_argument("--sport", default="MLB", help="Sport code to write (default MLB)")
    parser.add_argument(
        "--output-roster",
        default="backend/data/mlb_players.csv",
        help="Output roster CSV path",
    )
    parser.add_argument(
        "--output-projections",
        default="backend/data/mlb_projections_2026.csv",
        help="Output projections CSV path",
    )
    parser.add_argument(
        "--min-points",
        type=float,
        default=25.0,
        help="Drop players below this projected fantasy point threshold",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="HTTP timeout in seconds",
    )
    parser.add_argument(
        "--user-agent",
        default=DEFAULT_USER_AGENT,
        help="HTTP User-Agent header",
    )
    args = parser.parse_args()

    hitter_headers, hitter_rows = fetch_projection_table(
        url=HITTERS_URL,
        timeout=args.timeout,
        user_agent=args.user_agent,
    )
    pitcher_headers, pitcher_rows = fetch_projection_table(
        url=PITCHERS_URL,
        timeout=args.timeout,
        user_agent=args.user_agent,
    )

    hitters = parse_hitter_rows(hitter_headers, hitter_rows)
    pitchers = parse_pitcher_rows(pitcher_headers, pitcher_rows)
    merged = merge_projection_rows([*hitters, *pitchers])

    roster_path = Path(args.output_roster)
    projection_path = Path(args.output_projections)
    kept_count, _ = write_outputs(
        rows=merged,
        roster_path=roster_path,
        projection_path=projection_path,
        sport=args.sport,
        min_points=args.min_points,
    )

    print(
        "done | "
        f"hitters_raw={len(hitters)} pitchers_raw={len(pitchers)} merged={len(merged)} "
        f"kept={kept_count} "
        f"roster={roster_path} projections={projection_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

