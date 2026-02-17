import os
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import select
from .models import User, Player
from .db import Base, engine

import time
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from .db import Base, engine

def init_db():
    # Wait for Postgres to accept connections
    for attempt in range(30):  # ~30 seconds
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            break
        except OperationalError:
            time.sleep(1)
    else:
        raise RuntimeError("Database not ready after 30 seconds")

    # Now create tables
    Base.metadata.create_all(bind=engine)

    Base.metadata.create_all(bind=engine)

def seed(db: Session):
    user = db.execute(select(User).where(User.username == "sandbox")).scalar_one_or_none()
    if not user:
        starting_cash = Decimal(os.environ.get("STARTING_CASH", "100000"))
        user = User(username="sandbox", cash_balance=float(starting_cash))
        db.add(user)

    if db.execute(select(Player)).first() is None:
        players = [
            Player(name="Patrick Mahomes", team="KC", position="QB", base_price=35, k=0.0020),
            Player(name="Justin Jefferson", team="MIN", position="WR", base_price=30, k=0.0022),
            Player(name="Christian McCaffrey", team="SF", position="RB", base_price=32, k=0.0024),
            Player(name="Travis Kelce", team="KC", position="TE", base_price=22, k=0.0020),
        ]
        db.add_all(players)

    db.commit()
