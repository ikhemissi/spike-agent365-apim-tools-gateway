from datetime import UTC, datetime, timedelta

import pytest

import notes
from tests.fakes import FakeTable


def test_notes_are_listed_newest_first():
    table = FakeTable()
    start = datetime(2026, 11, 1, 18, 0, tzinfo=UTC)
    notes.add_note(table, "first", now=start)
    notes.add_note(table, "second", now=start + timedelta(seconds=1))

    listed = notes.list_notes(table, limit=10)

    assert [note["text"] for note in listed] == ["second", "first"]


def test_list_returns_at_most_the_limit():
    table = FakeTable()
    for index in range(5):
        notes.add_note(table, f"note {index}")

    assert len(notes.list_notes(table, limit=2)) == 2


@pytest.mark.parametrize("arguments", [{}, {"text": "  "}, {"text": 3}, {"text": "x" * 1001}])
def test_add_refuses_missing_blank_or_too_long_text(arguments):
    with pytest.raises(notes.InvalidArguments):
        notes.text_to_add(arguments)


@pytest.mark.parametrize(("arguments", "expected"), [({}, 10), ({"limit": 3}, 3), ({"limit": "7"}, 7)])
def test_limit_defaults_to_ten_and_accepts_numbers(arguments, expected):
    assert notes.limit_to_list(arguments) == expected


@pytest.mark.parametrize("limit", [0, 51, -1, 2.5, True, "many"])
def test_limit_outside_one_to_fifty_is_refused(limit):
    with pytest.raises(notes.InvalidArguments):
        notes.limit_to_list({"limit": limit})


def test_count_returns_every_note():
    table = FakeTable()
    for index in range(3):
        notes.add_note(table, f"note {index}")

    assert notes.count_notes(table) == 3
