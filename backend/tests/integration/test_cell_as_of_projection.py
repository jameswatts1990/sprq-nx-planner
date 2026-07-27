"""The Cells page's read-only "as of now / as of end of week" projection: serialize_cell(as_of=)
re-derives every time-derived field at a reference instant WITHOUT mutating the cell. A use
scheduled later this week doesn't count toward consumed capacity "as of now" but does "as of
end of week"; a window not yet breached now can be shown breached at a later instant. as_of=None
must reproduce today's persisted-status behaviour exactly."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.models.instrument import Instrument
from app.schemas.cell import CellBootstrapRequest
from app.services.cell_service import bootstrap_cell, serialize_cell


def _weekdays(n: int) -> list[str]:
    d = date.today() + timedelta(days=1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    out: list[str] = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def _cell(client, cell_id: int, as_of: str | None = None) -> dict:
    params = {"page_size": 200}
    if as_of is not None:
        params["as_of"] = as_of
    items = client.get("/api/cells", params=params).json()["items"]
    return next(c for c in items if c["id"] == cell_id)


def test_as_of_projects_a_future_use_out_of_the_consumed_count(client):
    """A cell whose only use is scheduled for a future weekday reads as 0 uses / open "as of
    now", but 1 use once the reference instant reaches that day. as_of=None keeps the
    persisted all-scheduled count (1)."""
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nA1,bc1"})
    (mon,) = _weekdays(1)
    r = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "A1"),
            "instrument_serial": "84047",
            "load_date": mon,
            "slot_index": 0,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
        },
    )
    assert r.status_code == 201, r.text
    cell_id = next(s for p in r.json()["plates"] for s in p["stages"])["cell_id"]

    now_iso = datetime.now(timezone.utc).isoformat()
    eow_iso = datetime.combine(date.fromisoformat(mon), datetime.min.time(), tzinfo=timezone.utc).replace(hour=23, minute=59).isoformat()

    now_view = _cell(client, cell_id, as_of=now_iso)
    assert now_view["uses_consumed"] == 0
    assert now_view["status"] == "open"

    eow_view = _cell(client, cell_id, as_of=eow_iso)
    assert eow_view["uses_consumed"] == 1

    # No as_of: persisted / all-scheduled behaviour is unchanged.
    assert _cell(client, cell_id)["uses_consumed"] == 1


def test_as_of_reveals_a_future_window_expiry(db_session):
    """A cell 50h into its 108h window is open now, but window_expired when viewed 70h later
    (120h elapsed > 108). The projection is read-only - the cell's persisted status is untouched."""
    instrument = db_session.scalar(select(Instrument).where(Instrument.serial_number == "84047"))
    assert instrument is not None
    started = datetime.now(timezone.utc) - timedelta(hours=50)
    cell = bootstrap_cell(
        db_session,
        CellBootstrapRequest(
            uses_consumed=1,
            burned_barcodes=["bcold"],
            first_use_started_at=started,
            instrument_serial="84047",
        ),
    )
    db_session.flush()

    now = serialize_cell(cell, as_of=datetime.now(timezone.utc))
    assert now.status == "open"
    assert now.window_breached is False

    later = serialize_cell(cell, as_of=datetime.now(timezone.utc) + timedelta(hours=70))
    assert later.window_breached is True
    assert later.status == "window_expired"

    # Read-only: the persisted status never changed.
    assert cell.status == "open"
