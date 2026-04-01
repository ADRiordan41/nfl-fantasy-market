import os
import unittest
from datetime import timedelta
from pathlib import Path

TEST_DB_PATH = Path(__file__).resolve().with_name("test_dynamic_pricing.sqlite3")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH.as_posix()}"

from sqlalchemy import select

try:
    from backend.app.db import Base, SessionLocal, engine
    from backend.app.time_utils import chicago_now
    from backend.app.main import (
        AuthContext,
        admin_stats_publish,
        buy,
        get_pricing_context,
        get_stats_snapshot_by_player,
        portfolio,
        quote_buy,
        short,
        upsert_weekly_stat,
    )
    from backend.app.models import Player, PlayerGamePoint, User, WeeklyStat
    from backend.app.schemas import AdminStatsPreviewIn, StatIn, TradeIn
except ModuleNotFoundError:
    from app.db import Base, SessionLocal, engine
    from app.time_utils import chicago_now
    from app.main import (
        AuthContext,
        admin_stats_publish,
        buy,
        get_pricing_context,
        get_stats_snapshot_by_player,
        portfolio,
        quote_buy,
        short,
        upsert_weekly_stat,
    )
    from app.models import Player, PlayerGamePoint, User, WeeklyStat
    from app.schemas import AdminStatsPreviewIn, StatIn, TradeIn


class DynamicPricingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def setUp(self) -> None:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()

    def tearDown(self) -> None:
        self.db.close()

    def make_user(self, *, username: str = "foreverhopeful", cash_balance: float = 100000.0) -> User:
        user = User(
            username=username,
            email=f"{username}@example.com",
            cash_balance=cash_balance,
            password_hash="test",
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def make_player(
        self,
        *,
        name: str = "Test Player",
        team: str = "BUF",
        sport: str = "NFL",
        position: str = "QB",
        base_price: float = 120.0,
        k: float = 0.002,
    ) -> Player:
        player = Player(
            sport=sport,
            name=name,
            team=team,
            position=position,
            ipo_open=True,
            ipo_season=2026,
            ipo_opened_at=chicago_now() - timedelta(days=1),
            live_now=False,
            base_price=base_price,
            k=k,
            total_shares=0.0,
        )
        self.db.add(player)
        self.db.commit()
        self.db.refresh(player)
        return player

    def auth_for(self, user: User) -> AuthContext:
        return AuthContext(user=user, session=None)  # type: ignore[arg-type]

    def test_stats_upsert_updates_game_history_and_dynamic_price(self) -> None:
        admin = self.make_user()
        player = self.make_player()

        baseline_fundamental, _, _ = get_pricing_context(
            player,
            get_stats_snapshot_by_player(self.db, [int(player.id)]),
        )

        upsert_weekly_stat(
            StatIn(
                player_id=int(player.id),
                week=1,
                fantasy_points=0.0,
                live_game_id="BUF-W1",
                live_game_label="BUF @ NYJ",
                live_game_status="Final",
                live_game_fantasy_points=0.0,
            ),
            self.auth_for(admin),
            self.db,
        )

        low_fundamental, _, _ = get_pricing_context(
            player,
            get_stats_snapshot_by_player(self.db, [int(player.id)]),
        )
        game_rows = self.db.execute(
            select(PlayerGamePoint).where(PlayerGamePoint.player_id == int(player.id))
        ).scalars().all()

        self.assertEqual(1, len(game_rows))
        self.assertLess(float(low_fundamental), float(baseline_fundamental))

        upsert_weekly_stat(
            StatIn(
                player_id=int(player.id),
                week=1,
                fantasy_points=30.0,
                live_game_id="BUF-W1",
                live_game_label="BUF @ NYJ",
                live_game_status="Final",
                live_game_fantasy_points=30.0,
            ),
            self.auth_for(admin),
            self.db,
        )

        high_fundamental, _, _ = get_pricing_context(
            player,
            get_stats_snapshot_by_player(self.db, [int(player.id)]),
        )
        updated_game_rows = self.db.execute(
            select(PlayerGamePoint).where(PlayerGamePoint.player_id == int(player.id))
        ).scalars().all()

        self.assertEqual(1, len(updated_game_rows))
        self.assertGreater(float(high_fundamental), float(low_fundamental))
        self.assertGreater(float(high_fundamental), float(baseline_fundamental))

    def test_short_position_pnl_moves_with_dynamic_price(self) -> None:
        user = self.make_user(cash_balance=100000.0)
        admin = self.make_user(username="admin2", cash_balance=50000.0)
        player = self.make_player(base_price=120.0)

        short(
            TradeIn(player_id=int(player.id), shares=5),
            self.auth_for(user),
            self.db,
        )
        after_open = portfolio(self.auth_for(user), self.db)
        opened_row = next(row for row in after_open.holdings if row.player_id == int(player.id))

        self.assertLess(after_open.cash_balance, 100000.0)
        self.assertLess(opened_row.shares_owned, 0)

        upsert_weekly_stat(
            StatIn(
                player_id=int(player.id),
                week=1,
                fantasy_points=0.0,
                live_game_id="BUF-W1",
                live_game_label="BUF @ NYJ",
                live_game_status="Final",
                live_game_fantasy_points=0.0,
            ),
            self.auth_for(admin),
            self.db,
        )
        favorable = portfolio(self.auth_for(user), self.db)
        favorable_row = next(row for row in favorable.holdings if row.player_id == int(player.id))

        upsert_weekly_stat(
            StatIn(
                player_id=int(player.id),
                week=1,
                fantasy_points=30.0,
                live_game_id="BUF-W1",
                live_game_label="BUF @ NYJ",
                live_game_status="Final",
                live_game_fantasy_points=30.0,
            ),
            self.auth_for(admin),
            self.db,
        )
        adverse = portfolio(self.auth_for(user), self.db)
        adverse_row = next(row for row in adverse.holdings if row.player_id == int(player.id))

        self.assertGreater(favorable_row.market_value, opened_row.market_value)
        self.assertGreater(favorable.equity, after_open.equity)
        self.assertLess(adverse_row.market_value, favorable_row.market_value)
        self.assertLess(adverse.equity, favorable.equity)

    def test_second_buy_moves_first_long_holder_only_on_same_player(self) -> None:
        first_user = self.make_user(username="usera", cash_balance=100000.0)
        second_user = self.make_user(username="userb", cash_balance=100000.0)
        pca = self.make_player(name="Pete Crow-Armstrong", team="CHC", sport="MLB", position="OF", base_price=160.0, k=0.0021)
        skenes = self.make_player(name="Paul Skenes", team="PIT", sport="MLB", position="SP", base_price=185.0, k=0.0020)
        ohtani = self.make_player(name="Shohei Ohtani", team="LAD", sport="MLB", position="DH", base_price=190.0, k=0.0021)

        buy(
            TradeIn(player_id=int(pca.id), shares=1),
            self.auth_for(first_user),
            self.db,
        )
        after_first_buy = portfolio(self.auth_for(first_user), self.db)
        pca_row_after_first_buy = next(row for row in after_first_buy.holdings if row.player_id == int(pca.id))

        self.assertAlmostEqual(
            pca_row_after_first_buy.average_entry_price,
            pca_row_after_first_buy.spot_price,
            places=6,
        )
        self.assertAlmostEqual(pca_row_after_first_buy.unrealized_pnl, 0.0, places=6)

        buy(
            TradeIn(player_id=int(skenes.id), shares=1),
            self.auth_for(first_user),
            self.db,
        )
        buy(
            TradeIn(player_id=int(ohtani.id), shares=1),
            self.auth_for(first_user),
            self.db,
        )
        baseline_portfolio = portfolio(self.auth_for(first_user), self.db)
        baseline_rows = {row.player_id: row for row in baseline_portfolio.holdings}

        buy(
            TradeIn(player_id=int(pca.id), shares=1),
            self.auth_for(second_user),
            self.db,
        )
        after_second_buy = portfolio(self.auth_for(first_user), self.db)
        rows_after_second_buy = {row.player_id: row for row in after_second_buy.holdings}

        self.assertGreater(
            rows_after_second_buy[int(pca.id)].spot_price,
            baseline_rows[int(pca.id)].spot_price,
        )
        self.assertGreater(
            rows_after_second_buy[int(pca.id)].market_value,
            baseline_rows[int(pca.id)].market_value,
        )
        self.assertAlmostEqual(
            rows_after_second_buy[int(skenes.id)].spot_price,
            baseline_rows[int(skenes.id)].spot_price,
            places=6,
        )
        self.assertAlmostEqual(
            rows_after_second_buy[int(ohtani.id)].spot_price,
            baseline_rows[int(ohtani.id)].spot_price,
            places=6,
        )

    def test_same_user_scale_in_stays_flat_but_later_other_user_buy_creates_gain(self) -> None:
        first_user = self.make_user(username="scalea", cash_balance=100000.0)
        second_user = self.make_user(username="scaleb", cash_balance=100000.0)
        player = self.make_player(name="Pete Crow-Armstrong", team="CHC", sport="MLB", position="OF", base_price=160.0, k=0.0021)

        buy(
            TradeIn(player_id=int(player.id), shares=1),
            self.auth_for(first_user),
            self.db,
        )
        after_first_buy = portfolio(self.auth_for(first_user), self.db)
        row_after_first_buy = next(row for row in after_first_buy.holdings if row.player_id == int(player.id))
        self.assertAlmostEqual(row_after_first_buy.average_entry_price, row_after_first_buy.spot_price, places=6)
        self.assertAlmostEqual(row_after_first_buy.unrealized_pnl, 0.0, places=6)

        buy(
            TradeIn(player_id=int(player.id), shares=1),
            self.auth_for(first_user),
            self.db,
        )
        after_scale_in = portfolio(self.auth_for(first_user), self.db)
        row_after_scale_in = next(row for row in after_scale_in.holdings if row.player_id == int(player.id))
        self.assertAlmostEqual(row_after_scale_in.average_entry_price, row_after_scale_in.spot_price, places=6)
        self.assertAlmostEqual(row_after_scale_in.unrealized_pnl, 0.0, places=6)

        buy(
            TradeIn(player_id=int(player.id), shares=1),
            self.auth_for(second_user),
            self.db,
        )
        after_other_user_buy = portfolio(self.auth_for(first_user), self.db)
        row_after_other_user_buy = next(row for row in after_other_user_buy.holdings if row.player_id == int(player.id))
        self.assertGreater(row_after_other_user_buy.spot_price, row_after_scale_in.spot_price)
        self.assertGreater(row_after_other_user_buy.market_value, row_after_scale_in.market_value)

    def test_equal_dollar_buy_impact_is_not_extreme_across_price_levels(self) -> None:
        user = self.make_user(username="dollarimpact", cash_balance=200000.0)
        low_price_player = self.make_player(
            name="Low Price Player",
            team="L",
            base_price=40.0,
            k=0.0020,
        )
        high_price_player = self.make_player(
            name="High Price Player",
            team="H",
            base_price=240.0,
            k=0.0020,
        )

        target_notional = 4000.0
        low_shares = max(1, int(target_notional / float(low_price_player.base_price)))
        high_shares = max(1, int(target_notional / float(high_price_player.base_price)))

        low_quote = quote_buy(
            TradeIn(player_id=int(low_price_player.id), shares=low_shares),
            self.auth_for(user),
            self.db,
        )
        high_quote = quote_buy(
            TradeIn(player_id=int(high_price_player.id), shares=high_shares),
            self.auth_for(user),
            self.db,
        )

        low_pct_move = (low_quote.spot_price_after - low_quote.spot_price_before) / low_quote.spot_price_before
        high_pct_move = (high_quote.spot_price_after - high_quote.spot_price_before) / high_quote.spot_price_before
        ratio = low_pct_move / high_pct_move if high_pct_move > 0 else float("inf")

        self.assertGreater(low_pct_move, 0.0)
        self.assertGreater(high_pct_move, 0.0)
        self.assertLess(ratio, 2.0)

    def test_second_equal_dollar_buy_moves_less_than_first_for_same_player(self) -> None:
        user = self.make_user(username="decayimpact", cash_balance=200000.0)
        player = self.make_player(
            name="Decay Test Player",
            team="D",
            base_price=120.0,
            k=0.0020,
        )

        target_notional = 4000.0

        first_shares = max(1, int(target_notional / float(player.base_price)))
        first_quote = quote_buy(
            TradeIn(player_id=int(player.id), shares=first_shares),
            self.auth_for(user),
            self.db,
        )
        first_pct_move = (first_quote.spot_price_after - first_quote.spot_price_before) / first_quote.spot_price_before

        buy(
            TradeIn(player_id=int(player.id), shares=first_shares),
            self.auth_for(user),
            self.db,
        )

        second_shares = max(1, int(target_notional / float(first_quote.spot_price_after)))
        second_quote = quote_buy(
            TradeIn(player_id=int(player.id), shares=second_shares),
            self.auth_for(user),
            self.db,
        )
        second_pct_move = (second_quote.spot_price_after - second_quote.spot_price_before) / second_quote.spot_price_before

        self.assertGreater(first_pct_move, 0.0)
        self.assertGreater(second_pct_move, 0.0)
        self.assertLess(second_pct_move, first_pct_move)

    def test_admin_publish_accepts_multiple_games_same_week(self) -> None:
        admin = self.make_user()
        player = self.make_player(name="Josh Allen", team="BUF")

        payload = AdminStatsPreviewIn(
            csv_text=(
                "player_name,team,week,fantasy_points,game_id,game_label,game_status,game_fantasy_points,season_fantasy_points\n"
                "Josh Allen,BUF,1,10,GAME-1,BUF @ NYJ,Final,10,10\n"
                "Josh Allen,BUF,1,12,GAME-2,MIA @ BUF,Final,12,22\n"
            ),
            week_override=None,
        )
        result = admin_stats_publish(payload, self.auth_for(admin), self.db)

        weekly_row = self.db.execute(
            select(WeeklyStat).where(WeeklyStat.player_id == int(player.id), WeeklyStat.week == 1)
        ).scalar_one()
        game_rows = self.db.execute(
            select(PlayerGamePoint)
            .where(PlayerGamePoint.player_id == int(player.id))
            .order_by(PlayerGamePoint.game_id.asc())
        ).scalars().all()
        snapshot = get_stats_snapshot_by_player(self.db, [int(player.id)])[int(player.id)]

        self.assertEqual(1, result.applied_count)
        self.assertEqual(1, result.created_count)
        self.assertEqual(22.0, float(weekly_row.fantasy_points))
        self.assertEqual(2, len(game_rows))
        self.assertEqual(22.0, float(snapshot.points_to_date))
        self.assertEqual(2, snapshot.latest_week)

    def test_weekly_stats_fallback_without_game_history(self) -> None:
        player = self.make_player()
        self.db.add(
            WeeklyStat(
                player_id=int(player.id),
                week=3,
                fantasy_points=18.5,
            )
        )
        self.db.commit()

        snapshot = get_stats_snapshot_by_player(self.db, [int(player.id)])[int(player.id)]
        fundamental, points_to_date, latest_week = get_pricing_context(
            player,
            get_stats_snapshot_by_player(self.db, [int(player.id)]),
        )

        self.assertEqual(18.5, float(snapshot.points_to_date))
        self.assertEqual(3, snapshot.latest_week)
        self.assertEqual(18.5, float(points_to_date))
        self.assertEqual(3, latest_week)
        self.assertGreater(float(fundamental), 0.0)


if __name__ == "__main__":
    unittest.main()

