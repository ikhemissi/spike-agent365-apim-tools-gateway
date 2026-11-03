"""Team notes kept in an Azure Table: the logic behind the MCP tools, independent of Azure Functions so that it can
be tested with a fake table. Newest notes come first because row keys count down with time."""

import uuid
from datetime import UTC, datetime
from itertools import islice
from typing import Any, Protocol

PARTITION = "notes"
MAX_TEXT_LENGTH = 1000
DEFAULT_LIMIT = 10
MAX_LIMIT = 50
# Row keys sort ascending: subtracting the time from a far-future value lists the newest note first.
FAR_FUTURE_MS = 10**13


class InvalidArguments(ValueError):
    """The tool was called with arguments it does not accept; the message is safe to show to the caller."""


class Table(Protocol):
    def create_entity(self, entity: dict[str, Any]) -> Any: ...
    def query_entities(self, query_filter: str, **kwargs: Any) -> Any: ...


def text_to_add(arguments: dict[str, Any]) -> str:
    text = arguments.get("text")
    if not isinstance(text, str) or not text.strip():
        raise InvalidArguments("text is required.")
    if len(text) > MAX_TEXT_LENGTH:
        raise InvalidArguments(f"text must be at most {MAX_TEXT_LENGTH} characters.")
    return text.strip()


def limit_to_list(arguments: dict[str, Any]) -> int:
    limit = arguments.get("limit", DEFAULT_LIMIT)
    if isinstance(limit, str) and limit.isdigit():
        limit = int(limit)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_LIMIT:
        raise InvalidArguments(f"limit must be a whole number from 1 to {MAX_LIMIT}.")
    return limit


def add_note(table: Table, text: str, now: datetime | None = None) -> dict[str, str]:
    created_at = now or datetime.now(UTC)
    row_key = f"{FAR_FUTURE_MS - int(created_at.timestamp() * 1000):013d}-{uuid.uuid4().hex[:8]}"
    table.create_entity(
        {"PartitionKey": PARTITION, "RowKey": row_key, "Text": text, "CreatedAt": created_at.isoformat()}
    )
    return {"id": row_key, "created_at": created_at.isoformat()}


def list_notes(table: Table, limit: int) -> list[dict[str, str]]:
    entities = table.query_entities(f"PartitionKey eq '{PARTITION}'", results_per_page=limit)
    return [
        {"id": entity["RowKey"], "text": entity["Text"], "created_at": entity["CreatedAt"]}
        for entity in islice(entities, limit)
    ]


def count_notes(table: Table) -> int:
    return sum(1 for _ in table.query_entities(f"PartitionKey eq '{PARTITION}'"))
