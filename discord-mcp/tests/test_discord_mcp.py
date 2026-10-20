#!/usr/bin/env python3
"""Unit tests for the InfiniteRealms Discord MCP server (#850, audit F21).

No third-party dependencies are needed to run these tests: the modules the
server imports (aiohttp, dotenv, mcp) are stubbed before the server module is
loaded. The Discord HTTP layer (discord_request) is replaced with a fake that
captures the built endpoint.

Run:  python3 tests/test_discord_mcp.py   (from the discord-mcp directory)
"""

import asyncio
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
GUILD_ID = "123456789"


def _stub_modules():
    """Insert stdlib-only stand-ins for the server's third-party imports."""
    aiohttp_stub = types.ModuleType("aiohttp")
    sys.modules["aiohttp"] = aiohttp_stub

    dotenv_stub = types.ModuleType("dotenv")
    dotenv_stub.load_dotenv = lambda *args, **kwargs: False
    sys.modules["dotenv"] = dotenv_stub

    fastmcp_stub = types.ModuleType("mcp.server.fastmcp")

    class FastMCP:
        def __init__(self, name: str):
            self.name = name

        def tool(self, *args, **kwargs):
            # The real FastMCP.tool() registers the function and returns it
            # unchanged, so tests can call the plain coroutine.
            def decorator(fn):
                return fn

            return decorator

        def run(self, *args, **kwargs):  # pragma: no cover
            raise RuntimeError("mcp.run must not be called in tests")

    fastmcp_stub.FastMCP = FastMCP
    server_stub = types.ModuleType("mcp.server")
    server_stub.fastmcp = fastmcp_stub
    mcp_stub = types.ModuleType("mcp")
    mcp_stub.server = server_stub
    sys.modules["mcp"] = mcp_stub
    sys.modules["mcp.server"] = server_stub
    sys.modules["mcp.server.fastmcp"] = fastmcp_stub


def _load_server():
    _stub_modules()
    spec = importlib.util.spec_from_file_location(
        "discord_mcp", SERVER_DIR / "discord_mcp.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.DISCORD_GUILD_ID = GUILD_ID
    return module


discord_mcp = _load_server()


class FakeDiscord:
    """Captures the endpoint search_members hands to discord_request."""

    def __init__(self):
        self.calls = []
        self.members = [
            {
                "user": {"id": "42", "username": "A&B", "global_name": "A B C"},
                "nick": None,
                "joined_at": "2024-01-01T00:00:00Z",
            }
        ]

    async def __call__(self, method, endpoint, json_data=None):
        self.calls.append({"method": method, "endpoint": endpoint})
        return self.members


class SearchMembersQueryEncodingTest(unittest.TestCase):
    def setUp(self):
        self.fake = FakeDiscord()
        self._real = discord_mcp.discord_request
        discord_mcp.discord_request = self.fake

    def tearDown(self):
        discord_mcp.discord_request = self._real

    def _search(self, query, limit=10):
        return asyncio.run(discord_mcp.search_members(query, limit))

    def test_special_characters_are_percent_encoded(self):
        """#850: 'A&B #C' must not split the query or move limit into the fragment."""
        self._search("A&B #C")
        self.assertEqual(len(self.fake.calls), 1)
        call = self.fake.calls[0]
        self.assertEqual(call["method"], "GET")
        self.assertEqual(
            call["endpoint"],
            f"/guilds/{GUILD_ID}/members/search?query=A%26B%20%23C&limit=10",
        )

    def test_plain_query_stays_readable(self):
        """Encoding must not mangle a query with no special characters."""
        self._search("Rob")
        self.assertEqual(
            self.fake.calls[0]["endpoint"],
            f"/guilds/{GUILD_ID}/members/search?query=Rob&limit=10",
        )

    def test_limit_still_applies(self):
        """The limit clamp and parameter must survive the encoding change."""
        self._search("A&B", limit=25)
        self.assertTrue(
            self.fake.calls[-1]["endpoint"].endswith("?query=A%26B&limit=25")
        )
        # Clamped to the 1..100 range, same as before.
        self._search("A&B", limit=1000)
        self.assertTrue(
            self.fake.calls[-1]["endpoint"].endswith("?query=A%26B&limit=100")
        )

    def test_response_shape_unchanged(self):
        """The tool still returns the member list parsed from the API response."""
        result = json.loads(self._search("A&B #C"))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["username"], "A&B")
        self.assertEqual(result[0]["display_name"], "A B C")


if __name__ == "__main__":
    unittest.main(verbosity=2)
