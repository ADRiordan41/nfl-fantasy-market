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

    # 1) Create tables (fresh DB should be empty).
    init_db()

    # 2) Seed is designed to be idempotent. Run twice to verify "from scratch" and "restart" behavior.
    db = SessionLocal()
    try:
        seed(db)
        seed(db)

        user_count = db.query(User).count()
        player_count = db.query(Player).count()
        forum_count = db.query(ForumPost).count()
        dm_thread_count = db.query(DirectThread).count()
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

