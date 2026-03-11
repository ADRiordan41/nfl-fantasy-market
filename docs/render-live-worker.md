# Render Live Stats Worker

Recommended setup for MatchupMarket beta:

- Service type: `Background Worker`
- Plan: `Starter`
- Root directory: `backend`
- Runtime: `Docker`
- Start command: `python scripts/run_live_stats_worker.py`

## Required env vars

```env
LIVE_POLLER_SOURCE_PROVIDER=mlb-statsapi
LIVE_POLLER_API_BASE=https://matchupmarket.onrender.com
LIVE_POLLER_SPORT=MLB
LIVE_POLLER_WEEK=1
LIVE_POLLER_INTERVAL_SECONDS=30
LIVE_POLLER_MLB_LIVE_ONLY=true
LIVE_POLLER_STATE_FILE=/tmp/live_stats_state.json
LIVE_POLLER_TIMEOUT=20
LIVE_POLLER_MAX_POST_RETRIES=3
LIVE_POLLER_RETRY_BACKOFF=1.5
LIVE_POLLER_USERNAME=ForeverHopeful
LIVE_POLLER_PASSWORD=<admin_password>
```

## Optional env vars

```env
LIVE_POLLER_MLB_DATE=2026-03-24
LIVE_POLLER_DRY_RUN=false
LIVE_POLLER_ONCE=false
LIVE_POLLER_TOKEN=
```

Use `LIVE_POLLER_TOKEN` only if you want to provide a fixed bearer token manually. If `LIVE_POLLER_TOKEN` is empty, the worker logs in through `/auth/login` using `LIVE_POLLER_USERNAME` and `LIVE_POLLER_PASSWORD`, caches the session token until expiry, and refreshes it automatically on `401`.

## Notes

- `LIVE_POLLER_INTERVAL_SECONDS=30` is a good beta default on Render Starter.
- `LIVE_POLLER_STATE_FILE=/tmp/live_stats_state.json` keeps duplicate posts down during a running worker instance.
- If the worker restarts or redeploys, the state file resets and the poller may repost the current live rows once. That is acceptable because `/stats` upserts the latest values.
- Keep the backend service and worker pointed at the same production API base URL.
