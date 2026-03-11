import os

from live_stats_poller import main as poller_main


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_value(name: str, default: str | None = None) -> str | None:
    raw = os.environ.get(name)
    if raw is None:
        return default
    value = raw.strip()
    return value or default


def build_argv() -> list[str]:
    argv: list[str] = []

    source_provider = env_value("LIVE_POLLER_SOURCE_PROVIDER", "mlb-statsapi")
    if source_provider:
        argv.extend(["--source-provider", source_provider])

    api_base = env_value("LIVE_POLLER_API_BASE", "http://localhost:8000")
    if api_base:
        argv.extend(["--api-base", api_base])

    sport = env_value("LIVE_POLLER_SPORT", "MLB")
    if sport:
        argv.extend(["--sport", sport])

    week = env_value("LIVE_POLLER_WEEK")
    if week:
        argv.extend(["--week", week])

    mlb_date = env_value("LIVE_POLLER_MLB_DATE")
    if mlb_date:
        argv.extend(["--mlb-date", mlb_date])

    interval_seconds = env_value("LIVE_POLLER_INTERVAL_SECONDS", "30")
    if interval_seconds:
        argv.extend(["--interval-seconds", interval_seconds])

    state_file = env_value("LIVE_POLLER_STATE_FILE", "/tmp/live_stats_state.json")
    if state_file:
        argv.extend(["--state-file", state_file])

    timeout = env_value("LIVE_POLLER_TIMEOUT", "20")
    if timeout:
        argv.extend(["--timeout", timeout])

    max_post_retries = env_value("LIVE_POLLER_MAX_POST_RETRIES", "3")
    if max_post_retries:
        argv.extend(["--max-post-retries", max_post_retries])

    retry_backoff = env_value("LIVE_POLLER_RETRY_BACKOFF", "1.5")
    if retry_backoff:
        argv.extend(["--retry-backoff", retry_backoff])

    token = env_value("LIVE_POLLER_TOKEN")
    auth_username = env_value("LIVE_POLLER_USERNAME")
    auth_password = env_value("LIVE_POLLER_PASSWORD")
    if token:
        argv.extend(["--token", token])
    elif auth_username and auth_password:
        argv.extend(["--auth-username", auth_username, "--auth-password", auth_password])

    if env_flag("LIVE_POLLER_MLB_LIVE_ONLY", True):
        argv.append("--mlb-live-only")
    if env_flag("LIVE_POLLER_DRY_RUN", False):
        argv.append("--dry-run")
    if env_flag("LIVE_POLLER_ONCE", False):
        argv.append("--once")

    return argv


if __name__ == "__main__":
    raise SystemExit(poller_main(build_argv()))
