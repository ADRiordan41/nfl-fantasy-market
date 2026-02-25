# MatchupMarket - Play Money + AMM Quotes

This is a FastAPI + Postgres backend and Next.js frontend where users trade player shares with a bonding-curve AMM.

Core pricing model:
- `base_price` starts from projected full-season fantasy points.
- `spot_price` moves from trading pressure (buy/sell/short/cover).
- `fundamental_price` updates with in-season stats.
- End-of-season closeout pays out final fantasy points and closes all open positions.

## Prereqs
- Docker Desktop installed and running
- Node.js 20+ (for local frontend dev)

## Run
1. Copy `.env.example` to `.env` in project root.
2. Start backend + database:

```bash
docker compose up --build
```

API: `http://localhost:8000`  
Docs (Swagger): `http://localhost:8000/docs`

3. Start frontend (new terminal):

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:3000` (or `3001` if `3000` is busy)

## Quick API Walkthrough (`/docs`)
1. `GET /sports`
2. `POST /auth/register` with `{"username":"alice","password":"strong-pass-123"}`
3. `POST /auth/login` with same credentials
4. Click **Authorize** and paste `Bearer <access_token>`
5. `POST /admin/ipo/launch` with `{"sport":"NFL","season":2026}` (admin only)
6. `GET /players?sport=NFL`
7. `GET /players?sport=MLB`
8. `GET /live/games`
9. `POST /trade/buy` with `{"player_id": 1, "shares": 5}`
10. `POST /trade/short` with `{"player_id": 1, "shares": 5}`
11. `POST /trade/cover` with `{"player_id": 1, "shares": 2}`
12. `GET /portfolio`
13. `POST /stats` with `{"player_id": 1, "week": 1, "fantasy_points": 28}` (admin only)
14. `POST /season/close/2026`
15. `POST /season/reset/2026`

## Multi-Sport Foundation
Players now include a `sport` field and APIs support sport filtering.

Supported now:
- `GET /sports` for discovered sports in the current player universe.
- `GET /players?sport=<CODE>` (`sport=ALL` or no param returns all players).
- `GET /search?query=<text>&sport=<CODE>` (optional sport filter).
- Players stay hidden from market/search/trading until IPO is launched for their sport.
- IPO admin endpoints:
  - `GET /admin/ipo/sports`
  - `GET /admin/ipo/players?sport=<CODE>`
  - `POST /admin/ipo/launch` with `{"sport":"NFL","season":2026}`
  - `POST /admin/ipo/hide` with `{"sport":"NFL"}`

Seeding now supports one or many roster/projection files:
- `PLAYER_CSV_PATHS` (comma-separated)
- `PLAYER_PROJECTIONS_CSV_PATHS` (comma-separated)
- Backward-compatible single-file vars still work:
  - `PLAYER_CSV_PATH`
  - `PLAYER_PROJECTIONS_CSV_PATH`

If a roster row has no `sport`, the seeder uses `DEFAULT_PRIMARY_SPORT`.

The repo now includes MLB data out of the box:
- `backend/data/mlb_players.csv`
- `backend/data/mlb_projections_2026.csv`

If those files are present, default seeding automatically includes both NFL and MLB.

### MLB Data Refresh
Use the no-account exporter to rebuild MLB roster + projections from public FantasyPros pages:

```bash
python backend/scripts/export_fantasypros_mlb_projections.py --min-points 25
```

If you store files elsewhere, set in `.env`:

```bash
PLAYER_CSV_PATHS=/app/data/nfl_players.csv,/app/data/mlb_players.csv
PLAYER_PROJECTIONS_CSV_PATHS=/app/data/nfl_projections_2026.csv,/app/data/mlb_projections_2026.csv
```

Then rebuild API container:

```bash
docker compose up --build -d api
```

## Trading + Risk Notes
- Weekly dividends are deprecated.
- Use `POST /season/close/{season}` to close out all positions and credit payouts.
- Use `POST /season/reset/{season}` to archive then clear stats/holdings for a fresh season.
- Shorting and covering are supported (`/quote/short`, `/quote/cover`, `/trade/short`, `/trade/cover`).
- Spot price has a floor via `MIN_SPOT_PRICE`.
- Opening notional is capped per player (`MAX_POSITION_NOTIONAL_PER_PLAYER`, default `$10,000`) for both buy and short entries.
- Cap is checked at trade time; position market value can exceed `$10,000` later due to price movement.
- Trade impact is damped globally by `PRICE_IMPACT_MULTIPLIER`.

## Auth + Admin
- Register: `POST /auth/register`
- New accounts always start with `$100,000.00` cash.
- Login: `POST /auth/login`
- Current user: `GET /auth/me`
- Logout: `POST /auth/logout`
- Token auth required for market/portfolio/search/forum/profile endpoints
- Seeded user: `foreverhopeful` / `sandbox` (override via `SANDBOX_USERNAME` / `SANDBOX_PASSWORD`)
- Admin users from `ADMIN_USERNAMES` (comma-separated; default `foreverhopeful`)
- Admin stats import:
  - Preview: `POST /admin/stats/preview`
  - Publish: `POST /admin/stats/publish`
  - Direct `POST /stats` is admin-only

## Automating Weekly Stat Imports
Use the importer script with a CSV export:

```bash
python backend/scripts/import_weekly_stats.py --file backend/data/weekly_stats_template.csv --api-base http://localhost:8000 --dry-run
python backend/scripts/import_weekly_stats.py --file path/to/your_weekly_stats.csv --api-base http://localhost:8000 --token <admin_bearer_token>
```

## Live In-Game Stat Polling
For near real-time fundamental updates during games, run the live poller:

```bash
python backend/scripts/live_stats_poller.py --source-url https://your-provider-endpoint --source-format json --week 1 --api-base http://localhost:8000 --token <admin_bearer_token> --interval-seconds 60
```

You can also poll a local file that another process keeps updating:

```bash
python backend/scripts/live_stats_poller.py --source-file path/to/live_feed.csv --source-format csv --week 1 --api-base http://localhost:8000 --token <admin_bearer_token> --interval-seconds 60
```

Supported source fields (case-insensitive):
- player name: `player_name` or `name` or `player`
- team (optional but recommended): `team` or `team_abbr` or `team_code`
- week: `week` (or pass `--week` to override)
- fantasy points: `fantasy_points` or `points` or `fpts` or `half_ppr_points`
- live flag (optional): `is_live` or `live_now` or `live`
- live game id (optional): `live_game_id` or `game_id` or `event_id`
- live game label (optional): `live_game_label` or `game_label` or `game` or `matchup`
- live game status (optional): `live_game_status` or `game_status` or `live_status` or `status`
- live stat line (optional): `live_game_stat_line` or `game_stat_line` or `stat_line` or `live_stats`
- live game fantasy points (optional): `live_game_fantasy_points` or `game_fantasy_points` or `current_fantasy_points`

Notes:
- The poller only posts changed `player_id + week` values (tracked in `backend/data/live_stats_state.json` by default).
- If live fields are present, the poller also updates `/stats` live snapshot fields for `LIVE NOW` UI badges.
- If `live_game_id` and/or `live_game_label` are present, `/live/games` groups players into game cards.
- Use `--once` for one cycle, or omit it to run continuously.
- Use `--dry-run` to validate mappings without posting to `/stats`.

Accepted CSV columns:
- `player_name` (or `name` / `player`)
- `fantasy_points` (or `points` / `fpts` / `half_ppr_points`)
- `week` (optional if passed via `--week`)
- `team` recommended for disambiguation

## Build Canonical Projection Files
For provider exports:

```bash
python backend/scripts/build_projection_file.py --source path/to/provider_export.csv --sport NFL
```

Output columns:
- `name`
- `team`
- `position`
- `sport`
- `projected_points`

## No-Account Provider Export (FFToday, NFL)
You can fetch public FFToday projections and write a canonical file:

```bash
python backend/scripts/export_fftoday_projections.py --season latest --sport NFL
```

Optional:
- Force season year: `--season 2025`
- Fail on unmatched rows: `--strict`
- Custom output: `--output backend/data/nfl_projections_2026.csv`
- Custom roster: `--roster backend/data/nfl_players.csv`
