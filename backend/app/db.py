import os

from sqlalchemy import create_engine
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

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
