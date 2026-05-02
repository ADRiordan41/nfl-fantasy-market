import os
import unittest
from pathlib import Path

TEST_DB_PATH = Path(__file__).resolve().with_name("test_season_admin_auth.sqlite3")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH.as_posix()}"

from fastapi.routing import APIRoute

from backend.app.main import app, get_admin_context


class SeasonAdminAuthTests(unittest.TestCase):
    def route_dependency_calls(self, path: str) -> list[object]:
        for route in app.routes:
            if isinstance(route, APIRoute) and route.path == path:
                return [dependency.call for dependency in route.dependant.dependencies]
        self.fail(f"Route {path} not found")

    def test_season_close_requires_admin_dependency(self) -> None:
        self.assertIn(get_admin_context, self.route_dependency_calls("/season/close/{season}"))

    def test_season_reset_requires_admin_dependency(self) -> None:
        self.assertIn(get_admin_context, self.route_dependency_calls("/season/reset/{season}"))


if __name__ == "__main__":
    unittest.main()
