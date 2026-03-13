import os
import logging
from time import perf_counter

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def normalize_database_url(value: str) -> str:
    """
    Render commonly provides Postgres URLs as `postgres://...` or `postgresql://...`.

    SQLAlchemy defaults `postgresql://` to the psycopg2 driver when no driver is specified.
    This app uses psycopg v3 (`psycopg`), so normalize to `postgresql+psycopg://...`.
    """

    url = value.strip()
    if url.startswith("postgresql+psycopg://"):
        return url
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


DATABASE_URL = normalize_database_url(os.environ["DATABASE_URL"])
SLOW_QUERY_LOG_MS = max(1, int(os.environ.get("SLOW_QUERY_LOG_MS", "250")))
DB_LOG_SQL_TEXT_MAX_LENGTH = max(80, int(os.environ.get("DB_LOG_SQL_TEXT_MAX_LENGTH", "400")))

logger = logging.getLogger("matchupmarket.db")

DB_POOL_SIZE = max(1, int(os.environ.get("DB_POOL_SIZE", "10")))
DB_MAX_OVERFLOW = max(0, int(os.environ.get("DB_MAX_OVERFLOW", "20")))
DB_POOL_TIMEOUT_SECONDS = max(1, int(os.environ.get("DB_POOL_TIMEOUT_SECONDS", "30")))
DB_POOL_RECYCLE_SECONDS = max(30, int(os.environ.get("DB_POOL_RECYCLE_SECONDS", "1800")))

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_timeout=DB_POOL_TIMEOUT_SECONDS,
    pool_recycle=DB_POOL_RECYCLE_SECONDS,
)


@event.listens_for(engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    _ = cursor, parameters, context, executemany
    query_start_times = conn.info.setdefault("query_start_times", [])
    query_start_times.append(perf_counter())


@event.listens_for(engine, "after_cursor_execute")
def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    _ = cursor, parameters, context, executemany
    query_start_times = conn.info.get("query_start_times")
    if not query_start_times:
        return
    started_at = query_start_times.pop()
    duration_ms = (perf_counter() - started_at) * 1000
    if duration_ms < SLOW_QUERY_LOG_MS:
        return
    normalized_statement = " ".join(str(statement).split())
    if len(normalized_statement) > DB_LOG_SQL_TEXT_MAX_LENGTH:
        normalized_statement = normalized_statement[: DB_LOG_SQL_TEXT_MAX_LENGTH - 3] + "..."
    logger.warning(
        "slow_query duration_ms=%.1f executemany=%s sql=%s",
        duration_ms,
        bool(executemany),
        normalized_statement,
    )


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
