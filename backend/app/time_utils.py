from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

CHICAGO_TZ = ZoneInfo("America/Chicago")


def chicago_now() -> datetime:
    # Store and compare naive datetimes in Chicago local time across the app.
    return datetime.now(CHICAGO_TZ).replace(tzinfo=None)


def chicago_start_of_day(now: datetime | None = None) -> datetime:
    current = now or chicago_now()
    return current.replace(hour=0, minute=0, second=0, microsecond=0)
