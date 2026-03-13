import json
import os
import threading
from collections import defaultdict, deque
from time import monotonic
from typing import Any

try:
    import redis
except ModuleNotFoundError:  # pragma: no cover - optional dependency at runtime
    redis = None  # type: ignore[assignment]


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, *, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            window = self._events[key]
            while window and window[0] <= cutoff:
                window.popleft()
            if len(window) >= limit:
                retry_after = max(1, int(window[0] + window_seconds - now))
                return False, retry_after
            window.append(now)
            return True, 0


class RedisSlidingWindowRateLimiter:
    def __init__(self, client: "redis.Redis[Any]") -> None:
        self._client = client

    def allow(self, key: str, *, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = monotonic()
        cutoff = now - window_seconds
        window_key = f"rate:{key}"
        member = f"{now}:{os.getpid()}:{threading.get_ident()}"
        pipe = self._client.pipeline()
        pipe.zremrangebyscore(window_key, "-inf", cutoff)
        pipe.zcard(window_key)
        pipe.zadd(window_key, {member: now})
        pipe.expire(window_key, max(1, int(window_seconds)))
        _, count_before, _, _ = pipe.execute()
        if int(count_before) >= limit:
            self._client.zrem(window_key, member)
            oldest_rows = self._client.zrange(window_key, 0, 0, withscores=True)
            retry_after = window_seconds
            if oldest_rows:
                oldest_score = float(oldest_rows[0][1])
                retry_after = max(1, int(oldest_score + window_seconds - now))
            return False, retry_after
        return True, 0


class MemoryCache:
    def __init__(self) -> None:
        self._values: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()

    def get_json(self, key: str) -> Any | None:
        now = monotonic()
        with self._lock:
            row = self._values.get(key)
            if row is None:
                return None
            expires_at, payload = row
            if expires_at <= now:
                self._values.pop(key, None)
                return None
            return json.loads(payload)

    def set_json(self, key: str, value: Any, ttl_seconds: int) -> None:
        expires_at = monotonic() + max(1, int(ttl_seconds))
        payload = json.dumps(value, separators=(",", ":"))
        with self._lock:
            self._values[key] = (expires_at, payload)


class RedisCache:
    def __init__(self, client: "redis.Redis[Any]") -> None:
        self._client = client

    def get_json(self, key: str) -> Any | None:
        payload = self._client.get(f"cache:{key}")
        if not payload:
            return None
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        return json.loads(payload)

    def set_json(self, key: str, value: Any, ttl_seconds: int) -> None:
        self._client.setex(
            f"cache:{key}",
            max(1, int(ttl_seconds)),
            json.dumps(value, separators=(",", ":")),
        )


def build_redis_client() -> "redis.Redis[Any] | None":
    redis_url = (os.environ.get("REDIS_URL") or "").strip()
    if not redis_url or redis is None:
        return None
    client = redis.from_url(redis_url, decode_responses=False)
    try:
        client.ping()
    except Exception:
        return None
    return client


_redis_client = build_redis_client()
RATE_LIMITER = (
    RedisSlidingWindowRateLimiter(_redis_client)
    if _redis_client is not None
    else SlidingWindowRateLimiter()
)
CACHE = RedisCache(_redis_client) if _redis_client is not None else MemoryCache()
