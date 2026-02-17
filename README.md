# NFL Fantasy Market (Sandbox) — Play Money + AMM Quotes

This is a minimal FastAPI + Postgres backend that lets you "trade" NFL players like stocks using a bonding-curve AMM.

## Prereqs
- Docker Desktop installed and running

## Run
1) Copy `.env.example` to `.env` (in the project root)
2) Start:

```bash
docker compose up --build
```

API: http://localhost:8000  
Docs (Swagger): http://localhost:8000/docs

## Try it (in /docs)
1) GET /players
2) POST /trade/buy  {"player_id": 1, "shares": 5}
3) GET /portfolio
4) POST /stats {"player_id": 1, "week": 1, "fantasy_points": 28}
5) POST /settlement/week/1
6) GET /portfolio
