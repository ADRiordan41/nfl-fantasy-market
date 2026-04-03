from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

CHICAGO_TZ = ZoneInfo("America/Chicago")


def chicago_now() -> datetime:
    # Store and compare naive datetimes in Chicago local time across the app.
    return datetime.now(CHICAGO_TZ).replace(tzinfo=None)


def chicago_rollover_start(*, rollover_hour: int, now: datetime | None = None) -> datetime:
    current = now or chicago_now()
    normalized_hour = max(0, min(23, int(rollover_hour)))
    rollover = current.replace(hour=normalized_hour, minute=0, second=0, microsecond=0)
    if current < rollover:
        rollover -= timedelta(days=1)
    return rollover


def chicago_start_of_day(now: datetime | None = None) -> datetime:
    return chicago_rollover_start(rollover_hour=0, now=now)
