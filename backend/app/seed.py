import csv
import os
import time
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .auth import hash_password
from .db import Base, engine
from .models import Player, User

STAR_PLAYER_CATALOG: list[dict[str, object]] = [
    # Quarterbacks
    {"name": "Patrick Mahomes", "team": "KC", "position": "QB", "base_price": 35, "k": 0.0020},
    {"name": "Josh Allen", "team": "BUF", "position": "QB", "base_price": 34, "k": 0.0020},
    {"name": "Lamar Jackson", "team": "BAL", "position": "QB", "base_price": 33, "k": 0.0020},
    {"name": "Jalen Hurts", "team": "PHI", "position": "QB", "base_price": 32, "k": 0.0020},
    {"name": "Joe Burrow", "team": "CIN", "position": "QB", "base_price": 31, "k": 0.0020},
    {"name": "C.J. Stroud", "team": "HOU", "position": "QB", "base_price": 30, "k": 0.0021},
    {"name": "Justin Herbert", "team": "LAC", "position": "QB", "base_price": 30, "k": 0.0021},
    {"name": "Dak Prescott", "team": "DAL", "position": "QB", "base_price": 29, "k": 0.0021},
    {"name": "Jordan Love", "team": "GB", "position": "QB", "base_price": 28, "k": 0.0022},
    {"name": "Brock Purdy", "team": "SF", "position": "QB", "base_price": 28, "k": 0.0022},
    {"name": "Kyler Murray", "team": "ARI", "position": "QB", "base_price": 27, "k": 0.0022},
    {"name": "Tua Tagovailoa", "team": "MIA", "position": "QB", "base_price": 27, "k": 0.0022},
    # Running backs
    {"name": "Christian McCaffrey", "team": "SF", "position": "RB", "base_price": 32, "k": 0.0024},
    {"name": "Bijan Robinson", "team": "ATL", "position": "RB", "base_price": 30, "k": 0.0024},
    {"name": "Saquon Barkley", "team": "PHI", "position": "RB", "base_price": 29, "k": 0.0025},
    {"name": "Breece Hall", "team": "NYJ", "position": "RB", "base_price": 28, "k": 0.0025},
    {"name": "Jahmyr Gibbs", "team": "DET", "position": "RB", "base_price": 29, "k": 0.0024},
    {"name": "Jonathan Taylor", "team": "IND", "position": "RB", "base_price": 28, "k": 0.0025},
    {"name": "Kyren Williams", "team": "LAR", "position": "RB", "base_price": 27, "k": 0.0025},
    {"name": "Derrick Henry", "team": "BAL", "position": "RB", "base_price": 27, "k": 0.0025},
    {"name": "De'Von Achane", "team": "MIA", "position": "RB", "base_price": 27, "k": 0.0025},
    {"name": "Josh Jacobs", "team": "GB", "position": "RB", "base_price": 26, "k": 0.0026},
    {"name": "Kenneth Walker III", "team": "SEA", "position": "RB", "base_price": 25, "k": 0.0026},
    {"name": "Alvin Kamara", "team": "NO", "position": "RB", "base_price": 24, "k": 0.0026},
    # Wide receivers
    {"name": "Justin Jefferson", "team": "MIN", "position": "WR", "base_price": 30, "k": 0.0022},
    {"name": "Ja'Marr Chase", "team": "CIN", "position": "WR", "base_price": 30, "k": 0.0022},
    {"name": "CeeDee Lamb", "team": "DAL", "position": "WR", "base_price": 29, "k": 0.0022},
    {"name": "Tyreek Hill", "team": "MIA", "position": "WR", "base_price": 29, "k": 0.0022},
    {"name": "Amon-Ra St. Brown", "team": "DET", "position": "WR", "base_price": 28, "k": 0.0023},
    {"name": "A.J. Brown", "team": "PHI", "position": "WR", "base_price": 28, "k": 0.0023},
    {"name": "Puka Nacua", "team": "LAR", "position": "WR", "base_price": 27, "k": 0.0023},
    {"name": "Garrett Wilson", "team": "NYJ", "position": "WR", "base_price": 27, "k": 0.0023},
    {"name": "DJ Moore", "team": "CHI", "position": "WR", "base_price": 26, "k": 0.0024},
    {"name": "Chris Olave", "team": "NO", "position": "WR", "base_price": 25, "k": 0.0024},
    {"name": "Drake London", "team": "ATL", "position": "WR", "base_price": 25, "k": 0.0024},
    {"name": "Nico Collins", "team": "HOU", "position": "WR", "base_price": 25, "k": 0.0024},
    {"name": "DeVonta Smith", "team": "PHI", "position": "WR", "base_price": 24, "k": 0.0024},
    {"name": "Mike Evans", "team": "TB", "position": "WR", "base_price": 24, "k": 0.0024},
    {"name": "Brandon Aiyuk", "team": "SF", "position": "WR", "base_price": 24, "k": 0.0024},
    {"name": "DK Metcalf", "team": "SEA", "position": "WR", "base_price": 24, "k": 0.0024},
    {"name": "Jaylen Waddle", "team": "MIA", "position": "WR", "base_price": 24, "k": 0.0024},
    {"name": "Zay Flowers", "team": "BAL", "position": "WR", "base_price": 23, "k": 0.0025},
    {"name": "Tee Higgins", "team": "CIN", "position": "WR", "base_price": 23, "k": 0.0025},
    {"name": "Marvin Harrison Jr.", "team": "ARI", "position": "WR", "base_price": 23, "k": 0.0025},
    {"name": "Terry McLaurin", "team": "WAS", "position": "WR", "base_price": 22, "k": 0.0025},
    # Tight ends
    {"name": "Travis Kelce", "team": "KC", "position": "TE", "base_price": 22, "k": 0.0020},
    {"name": "Sam LaPorta", "team": "DET", "position": "TE", "base_price": 22, "k": 0.0021},
    {"name": "Mark Andrews", "team": "BAL", "position": "TE", "base_price": 21, "k": 0.0021},
    {"name": "George Kittle", "team": "SF", "position": "TE", "base_price": 21, "k": 0.0021},
    {"name": "Trey McBride", "team": "ARI", "position": "TE", "base_price": 20, "k": 0.0022},
    {"name": "Dalton Kincaid", "team": "BUF", "position": "TE", "base_price": 20, "k": 0.0022},
    {"name": "T.J. Hockenson", "team": "MIN", "position": "TE", "base_price": 20, "k": 0.0022},
    {"name": "Dallas Goedert", "team": "PHI", "position": "TE", "base_price": 19, "k": 0.0022},
    {"name": "Evan Engram", "team": "JAX", "position": "TE", "base_price": 18, "k": 0.0023},
    {"name": "David Njoku", "team": "CLE", "position": "TE", "base_price": 18, "k": 0.0023},
]

SPORT_DEFAULT_BASE_PRICE = {
    "NFL": 180.0,
    "MLB": 160.0,
    "NBA": 175.0,
}

SPORT_DEFAULT_K = {
    "NFL": 0.0023,
    "MLB": 0.0021,
    "NBA": 0.0022,
}

POSITION_DEFAULT_BASE_PRICE = {
    "NFL": {
        "QB": 290.0,
        "RB": 210.0,
        "WR": 195.0,
        "TE": 150.0,
    },
    "MLB": {
        "SP": 185.0,
        "RP": 135.0,
        "C": 130.0,
        "1B": 155.0,
        "2B": 150.0,
        "3B": 155.0,
        "SS": 160.0,
        "OF": 165.0,
        "DH": 150.0,
    },
    "NBA": {
        "PG": 190.0,
        "SG": 185.0,
        "SF": 185.0,
        "PF": 190.0,
        "C": 195.0,
    },
}

POSITION_DEFAULT_K = {
    "NFL": {
        "QB": 0.0021,
        "RB": 0.0025,
        "WR": 0.0024,
        "TE": 0.0022,
    },
    "MLB": {
        "SP": 0.0020,
        "RP": 0.0023,
        "C": 0.0022,
        "1B": 0.0021,
        "2B": 0.0021,
        "3B": 0.0021,
        "SS": 0.0021,
        "OF": 0.0021,
        "DH": 0.0021,
    },
    "NBA": {
        "PG": 0.0022,
        "SG": 0.0022,
        "SF": 0.0022,
        "PF": 0.0022,
        "C": 0.0021,
    },
}

DEFAULT_PRIMARY_SPORT = os.environ.get("DEFAULT_PRIMARY_SPORT", "NFL").strip().upper() or "NFL"
DEFAULT_SANDBOX_USERNAME = (os.environ.get("SANDBOX_USERNAME") or "ForeverHopeful").strip().lower() or "foreverhopeful"
LEGACY_SANDBOX_USERNAME = "sandbox"
REQUIRE_PROJECTIONS = os.environ.get("REQUIRE_PROJECTIONS", "false").strip().lower() in {"1", "true", "yes"}
SEED_UPDATE_EXISTING_PRICING = os.environ.get("SEED_UPDATE_EXISTING_PRICING", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}


def normalize_key(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def normalize_sport(value: str | None, default: str = DEFAULT_PRIMARY_SPORT) -> str:
    sport = (value or default).strip().upper()
    if not sport:
        return default
    return sport


def default_base_price_for(sport: str, position: str) -> float:
    sport_key = normalize_sport(sport)
    return POSITION_DEFAULT_BASE_PRICE.get(sport_key, {}).get(
        position,
        SPORT_DEFAULT_BASE_PRICE.get(sport_key, SPORT_DEFAULT_BASE_PRICE["NFL"]),
    )


def default_k_for(sport: str, position: str) -> float:
    sport_key = normalize_sport(sport)
    return POSITION_DEFAULT_K.get(sport_key, {}).get(
        position,
        SPORT_DEFAULT_K.get(sport_key, SPORT_DEFAULT_K["NFL"]),
    )


def resolve_projection_csv_paths() -> list[Path]:
    custom_paths_raw = os.environ.get("PLAYER_PROJECTIONS_CSV_PATHS", "").strip()
    if custom_paths_raw:
        paths = [Path(item.strip()) for item in custom_paths_raw.split(",") if item.strip()]
        return paths

    custom_path = os.environ.get("PLAYER_PROJECTIONS_CSV_PATH", "").strip()
    if custom_path:
        return [Path(custom_path)]

    data_dir = Path(__file__).resolve().parent.parent / "data"
    paths = [data_dir / "nfl_projections_2026.csv"]
    mlb_projection_path = data_dir / "mlb_projections_2026.csv"
    if mlb_projection_path.exists():
        paths.append(mlb_projection_path)
    return paths


def load_projection_index() -> tuple[
    dict[tuple[str, str, str, str], float],
    dict[tuple[str, str, str], float],
    dict[tuple[str, str], list[float]],
]:
    projection_paths = resolve_projection_csv_paths()
    by_full: dict[tuple[str, str, str, str], float] = {}
    by_name_team: dict[tuple[str, str, str], float] = {}
    by_name: dict[tuple[str, str], list[float]] = {}

    for projection_path in projection_paths:
        if not projection_path.exists():
            continue
        with projection_path.open("r", encoding="utf-8", newline="") as projection_file:
            reader = csv.DictReader(projection_file)
            if not reader.fieldnames:
                continue

            for row in reader:
                name = normalize_key(str(row.get("name", "")))
                team = normalize_key(str(row.get("team", "")))
                position = normalize_key(str(row.get("position", "")))
                sport = normalize_key(str(row.get("sport", "")))

                raw_points = str(
                    row.get("projected_points")
                    or row.get("projection")
                    or row.get("points")
                    or row.get("base_price")
                    or ""
                ).strip()
                if not name or not raw_points:
                    continue

                try:
                    projected_points = float(raw_points)
                except ValueError:
                    continue

                if team and position:
                    by_full[(name, team, position, sport)] = projected_points
                if team:
                    by_name_team[(name, team, sport)] = projected_points
                by_name.setdefault((name, sport), []).append(projected_points)

    return by_full, by_name_team, by_name


def get_projected_points(
    name: str,
    team: str,
    position: str,
    sport: str,
    by_full: dict[tuple[str, str, str, str], float],
    by_name_team: dict[tuple[str, str, str], float],
    by_name: dict[tuple[str, str], list[float]],
) -> float | None:
    key_name = normalize_key(name)
    key_team = normalize_key(team)
    key_position = normalize_key(position)
    key_sport = normalize_key(sport)

    projection = by_full.get((key_name, key_team, key_position, key_sport))
    if projection is not None:
        return projection

    projection = by_full.get((key_name, key_team, key_position, ""))
    if projection is not None:
        return projection

    projection = by_name_team.get((key_name, key_team, key_sport))
    if projection is not None:
        return projection

    projection = by_name_team.get((key_name, key_team, ""))
    if projection is not None:
        return projection

    name_matches = by_name.get((key_name, key_sport), [])
    if len(name_matches) == 1:
        return name_matches[0]

    fallback_name_matches = by_name.get((key_name, ""), [])
    if len(fallback_name_matches) == 1:
        return fallback_name_matches[0]

    return None


def resolve_player_csv_paths() -> list[Path]:
    custom_paths_raw = os.environ.get("PLAYER_CSV_PATHS", "").strip()
    if custom_paths_raw:
        paths = [Path(item.strip()) for item in custom_paths_raw.split(",") if item.strip()]
        return paths

    custom_path = os.environ.get("PLAYER_CSV_PATH", "").strip()
    if custom_path:
        return [Path(custom_path)]

    data_dir = Path(__file__).resolve().parent.parent / "data"
    paths = [data_dir / "nfl_players.csv"]
    mlb_player_path = data_dir / "mlb_players.csv"
    if mlb_player_path.exists():
        paths.append(mlb_player_path)
    return paths


def load_players_from_csv(
    by_full: dict[tuple[str, str, str, str], float],
    by_name_team: dict[tuple[str, str, str], float],
    by_name: dict[tuple[str, str], list[float]],
) -> tuple[list[dict[str, object]], int]:
    csv_paths = resolve_player_csv_paths()

    players: list[dict[str, object]] = []
    missing_projection_count = 0
    for csv_path in csv_paths:
        if not csv_path.exists():
            continue
        with csv_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                continue

            for row in reader:
                name = (row.get("name") or "").strip()
                team = (row.get("team") or "").strip().upper()
                position = (row.get("position") or "").strip().upper()
                sport = normalize_sport((row.get("sport") or "").strip().upper(), DEFAULT_PRIMARY_SPORT)

                if not name or not team or not position:
                    continue

                base_raw = (
                    row.get("projected_points")
                    or row.get("base_price")
                    or row.get("projection")
                    or ""
                ).strip()
                k_raw = (row.get("k") or "").strip()

                projected_points = get_projected_points(
                    name=name,
                    team=team,
                    position=position,
                    sport=sport,
                    by_full=by_full,
                    by_name_team=by_name_team,
                    by_name=by_name,
                )

                fallback_base_price = default_base_price_for(sport=sport, position=position)
                fallback_k = default_k_for(sport=sport, position=position)

                try:
                    csv_base_price = float(base_raw) if base_raw else fallback_base_price
                except ValueError:
                    csv_base_price = fallback_base_price

                if projected_points is None and not base_raw:
                    missing_projection_count += 1
                base_price = projected_points if projected_points is not None else csv_base_price

                try:
                    k = float(k_raw) if k_raw else fallback_k
                except ValueError:
                    k = fallback_k

                players.append(
                    {
                        "sport": sport,
                        "name": name,
                        "team": team,
                        "position": position,
                        "base_price": base_price,
                        "k": k,
                    }
                )

    return players, missing_projection_count


def init_db():
    # Wait for Postgres to accept connections
    for attempt in range(30):  # ~30 seconds
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            break
        except OperationalError:
            time.sleep(1)
    else:
        raise RuntimeError("Database not ready after 30 seconds")

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(512)"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url VARCHAR(512)"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT"))
        conn.execute(text("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS sport VARCHAR(16)"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS ipo_open BOOLEAN DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS ipo_season INTEGER"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS ipo_opened_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS live_now BOOLEAN DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS live_week INTEGER"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS live_game_id VARCHAR(64)"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS live_game_label VARCHAR(96)"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS live_game_status VARCHAR(64)"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS live_game_stat_line TEXT"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS live_game_fantasy_points NUMERIC(18,6)"))
        conn.execute(text("ALTER TABLE players ADD COLUMN IF NOT EXISTS live_updated_at TIMESTAMP"))
        conn.execute(text("UPDATE players SET sport='NFL' WHERE sport IS NULL OR sport=''"))
        conn.execute(text("UPDATE players SET ipo_open=FALSE WHERE ipo_open IS NULL"))
        conn.execute(text("UPDATE players SET live_now=FALSE WHERE live_now IS NULL"))
        conn.execute(text("UPDATE forum_posts SET view_count=0 WHERE view_count IS NULL"))


def seed(db: Session):
    sandbox_username = DEFAULT_SANDBOX_USERNAME
    user = db.execute(select(User).where(User.username == sandbox_username)).scalar_one_or_none()
    if not user and sandbox_username != LEGACY_SANDBOX_USERNAME:
        legacy_user = db.execute(select(User).where(User.username == LEGACY_SANDBOX_USERNAME)).scalar_one_or_none()
        if legacy_user:
            legacy_user.username = sandbox_username
            user = legacy_user
    sandbox_password_hash = hash_password(os.environ.get("SANDBOX_PASSWORD", "sandbox"))
    if not user:
        starting_cash = Decimal(os.environ.get("STARTING_CASH", "100000"))
        user = User(
            username=sandbox_username,
            cash_balance=float(starting_cash),
            password_hash=sandbox_password_hash,
        )
        db.add(user)
    elif not user.password_hash:
        user.password_hash = sandbox_password_hash

    existing_players = db.execute(select(Player)).scalars().all()
    existing_by_key = {
        (
            normalize_sport(str(player.sport), DEFAULT_PRIMARY_SPORT),
            str(player.name),
            str(player.team).upper(),
            str(player.position).upper(),
        ): player
        for player in existing_players
    }

    by_full, by_name_team, by_name = load_projection_index()

    csv_players, missing_projection_count = load_players_from_csv(
        by_full=by_full,
        by_name_team=by_name_team,
        by_name=by_name,
    )

    star_catalog_with_projection: list[dict[str, object]] = []
    for star in STAR_PLAYER_CATALOG:
        projected_points = get_projected_points(
            name=str(star["name"]),
            team=str(star["team"]),
            position=str(star["position"]),
            sport=normalize_sport(str(star.get("sport", "NFL")), DEFAULT_PRIMARY_SPORT),
            by_full=by_full,
            by_name_team=by_name_team,
            by_name=by_name,
        )
        star_catalog_with_projection.append(
            {
                **star,
                "sport": normalize_sport(str(star.get("sport", "NFL")), DEFAULT_PRIMARY_SPORT),
                "base_price": projected_points if projected_points is not None else float(star["base_price"]),
            }
        )

    # Roster CSV is authoritative for the player universe, with projections merged in.
    full_catalog = [*star_catalog_with_projection, *csv_players]

    if REQUIRE_PROJECTIONS and not by_full and not by_name_team and not by_name:
        raise RuntimeError(
            "REQUIRE_PROJECTIONS is enabled but no projections were loaded. "
            "Set PLAYER_PROJECTIONS_CSV_PATHS or PLAYER_PROJECTIONS_CSV_PATH, "
            "or add backend/data/nfl_projections_2026.csv."
        )
    if REQUIRE_PROJECTIONS and missing_projection_count > 0:
        raise RuntimeError(
            "REQUIRE_PROJECTIONS is enabled but some roster rows do not have per-player projections. "
            f"Missing projections for {missing_projection_count} players."
        )

    new_players: list[Player] = []
    for player_row in full_catalog:
        key = (
            normalize_sport(str(player_row.get("sport", DEFAULT_PRIMARY_SPORT)), DEFAULT_PRIMARY_SPORT),
            str(player_row["name"]),
            str(player_row["team"]).upper(),
            str(player_row["position"]).upper(),
        )
        existing = existing_by_key.get(key)
        if existing is not None:
            # Preserve in-season price anchors by default. Set SEED_UPDATE_EXISTING_PRICING=true
            # only when you intentionally want to reseed existing player pricing pre-season.
            if SEED_UPDATE_EXISTING_PRICING:
                existing.base_price = float(player_row["base_price"])
                existing.k = float(player_row["k"])
                existing.sport = key[0]
            continue

        existing_by_key[key] = Player(
            sport=key[0],
            name=key[1],
            team=key[2],
            position=key[3],
            ipo_open=False,
            ipo_season=None,
            ipo_opened_at=None,
            base_price=float(player_row["base_price"]),
            k=float(player_row["k"]),
        )
        new_players.append(
            existing_by_key[key]
        )

    if new_players:
        db.add_all(new_players)

    db.commit()
