# Windows Mini PC Deployment Guide

This guide replaces Render with your own Windows mini PC for:
- Postgres
- Backend API
- Frontend
- Live stat polling

## 1. Prereqs (Mini PC)
- Windows 11 Pro (or equivalent)
- Docker Desktop (WSL2 enabled)
- Git
- Python 3.12+
- Router access (if exposing publicly)
- Optional: your domain name

## 2. Clone Repo on Mini PC
```powershell
cd C:\
mkdir dev -Force
cd C:\dev
git clone https://github.com/ADRiordan41/nfl-fantasy-market.git
cd C:\dev\nfl-fantasy-market
```

## 3. Configure Env
Copy env template:
```powershell
Copy-Item .env.selfhost.example .env.selfhost
```

Edit `.env.selfhost`:
- Set `ALLOWED_ORIGINS` to your frontend URL(s), for example:
  - `http://localhost:3000`
  - `http://192.168.1.50:3000`
  - `https://app.yourdomain.com` (if using HTTPS domain)
- Set `SESSION_TOKEN_PEPPER` to a long random string.

Set frontend API target in shell before compose build:
```powershell
$env:NEXT_PUBLIC_API_BASE_URL = "http://192.168.1.50:8000"
```
Use your LAN IP or your public API URL.

## 4. Start Full Stack
```powershell
docker compose -f docker-compose.selfhost.yml up -d --build
```

Verify:
- API docs: `http://<mini-pc-ip>:8000/docs`
- Frontend: `http://<mini-pc-ip>:3000`

## 5. Run Live Poller (Automatic Stats)
Use the built-in MLB StatsAPI provider:
```powershell
python backend/scripts/live_stats_poller.py --source-provider mlb-statsapi --sport MLB --week 1 --mlb-live-only --api-base http://127.0.0.1:8000 --token <ADMIN_BEARER_TOKEN> --interval-seconds 60
```

## 6. Poller Wrapper Script (Recommended)
Create `C:\matchupmarket\run_poller.ps1`:
```powershell
$ErrorActionPreference = "Stop"

$apiBase = "http://127.0.0.1:8000"
$username = "ForeverHopeful"
$password = "<ADMIN_PASSWORD>"

$body = @{ username = $username; password = $password } | ConvertTo-Json
$resp = Invoke-RestMethod -Method POST -Uri "$apiBase/auth/login" -ContentType "application/json" -Body $body
$token = $resp.access_token

python C:\dev\nfl-fantasy-market\backend\scripts\live_stats_poller.py `
  --source-provider mlb-statsapi `
  --sport MLB `
  --week 1 `
  --mlb-live-only `
  --api-base $apiBase `
  --token $token `
  --interval-seconds 60
```

## 7. Auto-Start on Reboot (Task Scheduler)
Create a task:
- Name: `MatchupMarket Poller`
- Trigger: `At startup`
- Action:
  - Program: `powershell.exe`
  - Args: `-ExecutionPolicy Bypass -File C:\matchupmarket\run_poller.ps1`
- Check: `Run whether user is logged on or not`
- Settings: restart on failure every 1 minute

Optional second task for stack startup:
- Program: `C:\Program Files\Docker\Docker\resources\bin\docker.exe`
- Args: `compose -f C:\dev\nfl-fantasy-market\docker-compose.selfhost.yml up -d`
- Trigger: `At startup`

## 8. Public Access (Domain + HTTPS)
Best practical path on home internet:
1. Use Cloudflare DNS.
2. Run Cloudflare Tunnel from mini PC to avoid opening router ports directly.
3. Map:
   - `app.yourdomain.com` -> `http://localhost:3000`
   - `api.yourdomain.com` -> `http://localhost:8000`
4. Update:
   - `NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com`
   - `ALLOWED_ORIGINS=https://app.yourdomain.com`
5. Rebuild frontend container after changing `NEXT_PUBLIC_API_BASE_URL`.

## 9. Backups and Reliability
- Backup Postgres volume (`pgdata`) daily.
- Keep Docker Desktop auto-start enabled.
- Add Windows auto-login-disabled hardening and strong local admin password.
- Monitor disk space and Windows updates.

## 10. Update Workflow
```powershell
cd C:\dev\nfl-fantasy-market
git pull origin main
$env:NEXT_PUBLIC_API_BASE_URL = "http://192.168.1.50:8000"
docker compose -f docker-compose.selfhost.yml up -d --build
```

If frontend API URL changed, always rebuild frontend service.
