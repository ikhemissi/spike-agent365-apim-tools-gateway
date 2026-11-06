"""Notes MCP server: read tools (list_notes, count_notes) and a write tool (add_note) over streamable HTTP at /mcp,
stateless, meant to be called through an MCP gateway. Who may call it is decided by its Container Apps ingress
(infra/notes-mcp), not here. The tool logic is in notes.py; notes are in an Azure Table reached with the app's
managed identity (AZURE_CLIENT_ID)."""

import logging
import os
from functools import cache

from azure.data.tables import TableClient, TableServiceClient
from azure.identity import DefaultAzureCredential
from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse

import notes
from caller_auth import CallerPolicy, RequireCaller

TABLE_NAME = "notes"
logger = logging.getLogger("notes")
server = MCPServer(
    name="notes",
    instructions="Read and add short team notes. Notes are visible to everyone who can use this server: "
    "never store secrets or personal data.",
    version="1.0.0",
)


@cache
def notes_table() -> TableClient:
    """The notes table, created on first use."""
    service = TableServiceClient(endpoint=os.environ["NOTES_TABLE_ENDPOINT"], credential=DefaultAzureCredential())
    return service.create_table_if_not_exists(TABLE_NAME)


@server.tool(description="Add a short team note. Notes are visible to everyone who can use this server.")
def add_note(text: str) -> dict[str, str]:
    """text: the note, at most 1000 characters. No secrets or personal data."""
    valid_text = notes.text_to_add({"text": text})
    created = notes.add_note(notes_table(), valid_text)
    logger.info("add_note id=%s length=%d", created["id"], len(valid_text))
    return created


@server.tool(
    description="List the most recent team notes, newest first."
)
def list_notes(limit: int = notes.DEFAULT_LIMIT) -> list[dict[str, str]]:
    """limit: how many notes to return, from 1 to 50."""
    valid_limit = notes.limit_to_list({"limit": limit})
    found = notes.list_notes(notes_table(), valid_limit)
    logger.info("list_notes count=%d", len(found))
    return found


@server.tool(description="Count all team notes.")
def count_notes() -> dict[str, int]:
    total = notes.count_notes(notes_table())
    logger.info("count_notes total=%d", total)
    return {"count": total}


@server.custom_route("/health", methods=["GET"])
async def health(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def create_app(env=os.environ, signing_key_for=None):
    """The ASGI app serving /mcp and /health (a new one each call: its session manager runs once per app), behind the
    caller check when the environment names the one allowed caller."""
    app = server.streamable_http_app(
        stateless_http=True,
        json_response=True,
        # DNS-rebinding protection guards servers on localhost against browsers; this one runs behind Container Apps'
        # ingress, under a host name that depends on the environment.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    policy = CallerPolicy.from_env(env)
    return RequireCaller(app, policy, signing_key_for) if policy else app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = create_app()
