import os
import sys
from pathlib import Path


def main() -> int:
    # Ensure `import app.*` works when running from repo root in CI.
    backend_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_dir))

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for CI smoke test")

    from app.db import SessionLocal
    from app.seed import init_db, seed
    from app.models import DirectThread, ForumPost, Player, User

    safe_url = database_url
    if "://" in safe_url and "@" in safe_url:
        scheme, rest = safe_url.split("://", 1)
        creds, host = rest.split("@", 1)
        if ":" in creds:
            user, _pw = creds.split(":", 1)
            safe_url = f"{scheme}://{user}:***@{host}"
    print("CI smoke DATABASE_URL:", safe_url)

    # 1) Create tables (fresh DB should be empty).
    init_db()

    # 2) Seed is designed to be idempotent. Run twice to verify "from scratch" and "restart" behavior.
    db = SessionLocal()
    try:
        seed(db)
        seed(db)

        # Use 2.0-style selects so the script stays compatible as SQLAlchemy evolves.
        from sqlalchemy import func, select

        user_count = int(db.execute(select(func.count()).select_from(User)).scalar_one())
        player_count = int(db.execute(select(func.count()).select_from(Player)).scalar_one())
        forum_count = int(db.execute(select(func.count()).select_from(ForumPost)).scalar_one())
        dm_thread_count = int(db.execute(select(func.count()).select_from(DirectThread)).scalar_one())
    finally:
        db.close()

    # These are intentionally loose assertions: we just want to ensure create_all + seed succeed.
    if user_count < 1:
        raise RuntimeError("Expected at least 1 seeded user")
    if player_count < 1:
        raise RuntimeError("Expected at least 1 seeded player")

    print(
        "OK create_all + seed",
        {
            "users": user_count,
            "players": player_count,
            "forum_posts": forum_count,
            "dm_threads": dm_thread_count,
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

