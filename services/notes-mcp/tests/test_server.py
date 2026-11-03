"""The MCP endpoint as a client sees it: initialize, list the tools, call them (with an in-memory table)."""

import pytest
from starlette.testclient import TestClient

import server
from tests.fakes import FakeTable

HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


@pytest.fixture
def client(monkeypatch):
    table = FakeTable()
    monkeypatch.setattr(server, "notes_table", lambda: table)
    with TestClient(server.create_app()) as test_client:
        yield test_client


def rpc(client, method, params=None, request_id=1):
    message = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
    response = client.post("/mcp", json=message, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def test_health_answers_ok(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_the_server_offers_read_tools_and_a_write_tool(client):
    rpc(
        client,
        "initialize",
        {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}},
    )

    tools = rpc(client, "tools/list")["result"]["tools"]

    assert {tool["name"] for tool in tools} == {"add_note", "list_notes", "count_notes"}


def test_a_note_added_is_listed(client):
    rpc(client, "tools/call", {"name": "add_note", "arguments": {"text": "hello"}})

    listed = rpc(client, "tools/call", {"name": "list_notes", "arguments": {"limit": 5}})["result"]

    assert not listed.get("isError")
    assert "hello" in str(listed["structuredContent"])


def test_invalid_arguments_return_a_tool_error(client):
    result = rpc(client, "tools/call", {"name": "add_note", "arguments": {"text": " "}})["result"]

    assert result["isError"] is True
