import argparse
import csv
import datetime as dt
import hashlib
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib import parse, request
from urllib.error import URLError


BASE_URL = "https://mail.fftoday.com/rankings/playerproj.php"
POSITION_TO_ID = {
    "QB": 10,
    "RB": 20,
    "WR": 30,
    "TE": 40,
}
TEAM_ALIASES = {
    "JAC": "JAX",
    "WSH": "WAS",
    "KCC": "KC",
    "GNB": "GB",
    "SFO": "SF",
    "NWE": "NE",
    "NOR": "NO",
    "TAM": "TB",
    "LVR": "LV",
    "SD": "LAC",
    "STL": "LAR",
    "OAK": "LV",
}
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
ROW_RE = re.compile(
    r"^(?:\d+\.\s*)?(?P<name>.+?)\s+(?P<team>[A-Z]{2,4})\s+\d+\s+.+\s+(?P<fpts>-?\d+(?:\.\d+)?)$"
)
SEASON_RE = re.compile(r"Projections:\s*(\d{4})")


@dataclass
class ProviderProjection:
    name: str
    team: str
    position: str
    projected_points: float


@dataclass
class RosterPlayer:
    name: str
    team: str
    position: str
    sport: str


class TableRowParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._in_row = False
        self._in_cell = False
        self._cell_chunks: list[str] = []
        self._current_row: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._in_row = True
            self._current_row = []
            return

        if not self._in_row:
            return

        if tag in {"td", "th"}:
            self._in_cell = True
            self._cell_chunks = []
        elif tag == "br" and self._in_cell:
            self._cell_chunks.append(" ")

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            text = data.strip()
            if text:
                self._cell_chunks.append(text)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._in_row and self._in_cell:
            cell_text = " ".join(" ".join(self._cell_chunks).split())
            self._current_row.append(cell_text)
            self._in_cell = False
            return

        if tag == "tr" and self._in_row:
            if any(cell for cell in self._current_row):
                self.rows.append(self._current_row)
            self._in_row = False
            self._in_cell = False


def normalize(value: str) -> str:
    lowered = (value or "").strip().lower()
    alnum_only = re.sub(r"[^a-z0-9\s]", "", lowered)
    tokens = alnum_only.split()
    while tokens and tokens[-1] in NAME_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def normalize_sport(value: str, default: str = "NFL") -> str:
    sport = (value or default).strip().upper()
    return sport or default


def canonical_team(team: str) -> str:
    raw = (team or "").strip().upper()
    return TEAM_ALIASES.get(raw, raw)


def load_roster(
    roster_path: Path,
    target_sport: str,
) -> tuple[list[RosterPlayer], dict[tuple[str, str], RosterPlayer], dict[str, list[RosterPlayer]]]:
    roster_players: list[RosterPlayer] = []
    by_name_team: dict[tuple[str, str], RosterPlayer] = {}
    by_name: dict[str, list[RosterPlayer]] = {}

    with roster_path.open("r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            name = (row.get("name") or "").strip()
            team = canonical_team((row.get("team") or "").strip())
            position = (row.get("position") or "").strip().upper()
            sport = normalize_sport(str(row.get("sport", "")), target_sport)

            if not name or not team or not position:
                continue
            if sport != target_sport:
                continue

            player = RosterPlayer(name=name, team=team, position=position, sport=sport)
            roster_players.append(player)
            by_name_team[(normalize(name), normalize(team))] = player
            by_name.setdefault(normalize(name), []).append(player)

    return roster_players, by_name_team, by_name


def resolve_roster_player(
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


def build_url(season: int, pos_id: int, page: int) -> str:
    query = parse.urlencode(
        {
            "LeagueID": "",
            "PosID": pos_id,
            "Season": season,
            "cur_page": page,
            "order_by": "FFPts",
            "sort_order": "DESC",
        }
    )
    return f"{BASE_URL}?{query}"


def fetch_html(url: str, timeout: float) -> str:
    req = request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/121.0.0.0 Safari/537.36"
            )
        },
    )
    with request.urlopen(req, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def extract_season(html: str) -> int | None:
    match = SEASON_RE.search(html)
    if not match:
        return None
    return int(match.group(1))


def parse_rows(html: str) -> list[list[str]]:
    parser = TableRowParser()
    parser.feed(html)
    return parser.rows


def parse_projection_rows(rows: list[list[str]], position: str) -> list[ProviderProjection]:
    projections: list[ProviderProjection] = []

    for cells in rows:
        row_text = " ".join(cell for cell in cells if cell)
        row_text = " ".join(row_text.replace("\xa0", " ").split())
        if not row_text:
            continue

        lowered = row_text.lower()
        if lowered.startswith("sort first:") or lowered.startswith("fftoday standard scoring"):
            continue

        match = ROW_RE.match(row_text)
        if not match:
            continue

        name = re.sub(r"^[^\w]+", "", match.group("name")).strip()
        team = canonical_team(match.group("team"))
        points_str = match.group("fpts").replace(",", "")

        if not name or not team:
            continue

        try:
            projected_points = float(points_str)
        except ValueError:
            continue

        projections.append(
            ProviderProjection(
                name=name,
                team=team,
                position=position,
                projected_points=projected_points,
            )
        )

    return projections


def fetch_position(
    season: int,
    position: str,
    max_pages: int,
    timeout: float,
) -> tuple[list[ProviderProjection], int | None]:
    pos_id = POSITION_TO_ID[position]
    all_rows: list[ProviderProjection] = []
    seen_keys: set[tuple[str, str, str]] = set()
    seen_signatures: set[int] = set()
    detected_season: int | None = None

    for page in range(max_pages):
        url = build_url(season=season, pos_id=pos_id, page=page)
        html = fetch_html(url, timeout=timeout)

        extracted = extract_season(html)
        if extracted is not None:
            detected_season = extracted

        # Use full-page signature to detect true page repeats.
        signature = hash(html)
        if signature in seen_signatures:
            break
        seen_signatures.add(signature)

        parsed = parse_projection_rows(parse_rows(html), position=position)
        if not parsed:
            break

        new_count = 0
        for row in parsed:
            key = (normalize(row.name), normalize(row.team), row.position)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            all_rows.append(row)
            new_count += 1

        if new_count == 0:
            break

    return all_rows, detected_season


def fetch_season(
    season: int,
    max_pages: int,
    timeout: float,
) -> tuple[list[ProviderProjection], int]:
    all_rows: list[ProviderProjection] = []
    detected_season: int | None = None

    for position in ("QB", "RB", "WR", "TE"):
        position_rows, position_season = fetch_position(
            season=season,
            position=position,
            max_pages=max_pages,
            timeout=timeout,
        )
        all_rows.extend(position_rows)
        if position_season is not None:
            detected_season = position_season

    return all_rows, detected_season or season


def select_season(
    requested: str,
    min_players: int,
    max_pages: int,
    timeout: float,
) -> tuple[list[ProviderProjection], int]:
    if requested != "latest":
        season = int(requested)
        projections, actual_season = fetch_season(season=season, max_pages=max_pages, timeout=timeout)
        return projections, actual_season

    current_year = dt.date.today().year
    candidates = [current_year, current_year - 1, current_year - 2]

    best_rows: list[ProviderProjection] = []
    best_season = candidates[0]
    for year in candidates:
        rows, actual_season = fetch_season(season=year, max_pages=max_pages, timeout=timeout)
        unique_count = len(
            {(normalize(row.name), normalize(row.team), row.position) for row in rows}
        )
        if unique_count > len(best_rows):
            best_rows = rows
            best_season = actual_season
        if unique_count >= min_players:
            return rows, actual_season

    return best_rows, best_season


def quantile_desc(values_desc: list[float], q: float) -> float:
    if not values_desc:
        return 1.0
    clamped_q = max(0.0, min(1.0, q))
    idx = int(round((len(values_desc) - 1) * clamped_q))
    return float(values_desc[idx])


def stable_factor(key: str, amplitude: float = 0.08) -> float:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    unit = int(digest[:8], 16) / 0xFFFFFFFF
    centered = (unit * 2.0) - 1.0
    return 1.0 + (centered * (amplitude / 2.0))


def estimate_missing_projection(
    player: RosterPlayer,
    depth_rank: int,
    position_values_desc: list[float],
) -> float:
    if depth_rank <= 1:
        quantile = 0.42
    elif depth_rank == 2:
        quantile = 0.62
    elif depth_rank == 3:
        quantile = 0.78
    elif depth_rank == 4:
        quantile = 0.90
    else:
        quantile = 0.97

    base = quantile_desc(position_values_desc, quantile)
    deep_decay = 0.88 ** max(0, depth_rank - 5)
    jittered = base * deep_decay * stable_factor(f"{player.name}|{player.team}|{player.position}")
    return max(1.0, jittered)


def write_canonical_output(
    rows: list[ProviderProjection],
    roster_path: Path,
    output_path: Path,
    target_sport: str,
) -> tuple[int, int, int, int]:
    roster_players, by_name_team, by_name = load_roster(roster_path, target_sport)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    unmatched = 0
    duplicates = 0
    estimated = 0

    roster_by_key = {
        (normalize(player.name), normalize(player.team)): player for player in roster_players
    }
    provider_points_by_key: dict[tuple[str, str], float] = {}

    for row in rows:
        roster_player = resolve_roster_player(
            name=row.name,
            team=row.team,
            by_name_team=by_name_team,
            by_name=by_name,
        )
        if not roster_player:
            unmatched += 1
            continue

        key = (normalize(roster_player.name), normalize(roster_player.team))
        if key in provider_points_by_key:
            duplicates += 1
            continue
        provider_points_by_key[key] = row.projected_points

    position_values: dict[str, list[float]] = {}
    for key, projected in provider_points_by_key.items():
        roster_player = roster_by_key.get(key)
        if roster_player is None:
            continue
        position_values.setdefault(roster_player.position, []).append(projected)
    for position in position_values:
        position_values[position].sort(reverse=True)

    depth_keys_by_team_position: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for player in roster_players:
        key = (normalize(player.name), normalize(player.team))
        depth_keys_by_team_position.setdefault((player.team, player.position), []).append(key)

    depth_rank_by_key: dict[tuple[str, str], int] = {}
    for keys in depth_keys_by_team_position.values():
        for depth_rank, key in enumerate(keys, start=1):
            depth_rank_by_key[key] = depth_rank

    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["name", "team", "position", "sport", "projected_points"])

        for roster_player in roster_players:
            key = (normalize(roster_player.name), normalize(roster_player.team))
            projected = provider_points_by_key.get(key)
            if projected is None:
                projected = estimate_missing_projection(
                    player=roster_player,
                    depth_rank=depth_rank_by_key.get(key, 1),
                    position_values_desc=position_values.get(roster_player.position, []),
                )
                estimated += 1

            writer.writerow(
                [
                    roster_player.name,
                    roster_player.team,
                    roster_player.position,
                    roster_player.sport,
                    f"{projected:.3f}",
                ]
            )
            written += 1

    return written, unmatched, duplicates, estimated


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch FFToday season projections and write canonical per-player projections CSV"
    )
    parser.add_argument(
        "--season",
        default="latest",
        help="Season year to fetch (for example 2025) or 'latest' for auto-detection",
    )
    parser.add_argument(
        "--output",
        default="backend/data/nfl_projections_2026.csv",
        help="Canonical output CSV path",
    )
    parser.add_argument(
        "--roster",
        default="backend/data/nfl_players.csv",
        help="Roster CSV path for player mapping",
    )
    parser.add_argument(
        "--sport",
        default="NFL",
        help="Sport code to write in canonical output (default NFL)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=8,
        help="Max pages to fetch per position",
    )
    parser.add_argument(
        "--min-players",
        type=int,
        default=120,
        help="Minimum unique players when using --season latest",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="HTTP timeout in seconds",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when any provider rows cannot be mapped to roster players",
    )
    args = parser.parse_args()

    roster_path = Path(args.roster)
    output_path = Path(args.output)
    target_sport = normalize_sport(args.sport)

    if not roster_path.exists():
        print(f"[error] roster file not found: {roster_path}")
        return 1

    try:
        provider_rows, actual_season = select_season(
            requested=args.season,
            min_players=args.min_players,
            max_pages=args.max_pages,
            timeout=args.timeout,
        )
    except ValueError:
        print(f"[error] invalid --season value: {args.season}")
        return 1
    except URLError as exc:
        print(f"[error] failed to fetch provider pages: {exc}")
        return 1
    except Exception as exc:
        print(f"[error] unexpected failure while fetching provider pages: {exc}")
        return 1

    if not provider_rows:
        print("[error] no projection rows were fetched from provider")
        return 1

    written, unmatched, duplicates, estimated = write_canonical_output(
        rows=provider_rows,
        roster_path=roster_path,
        output_path=output_path,
        target_sport=target_sport,
    )

    print(
        "done | "
        f"provider=fftoday season={actual_season} "
        f"fetched={len(provider_rows)} written={written} "
        f"unmatched={unmatched} duplicates_ignored={duplicates} "
        f"estimated_missing={estimated} output={output_path}"
    )

    if args.strict and unmatched > 0:
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
