"""Optional lab-assigned run name (e.g. "TRACTION-RUN-1234"), settable only at the
moment a run is locked (Confirm loaded = status -> "running"), overriding the plain
cycle id wherever a run is displayed."""
from datetime import date, timedelta


def _past_weekday() -> str:
    d = date.today() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def _sid(client, external_id: str) -> int:
    items = client.get("/api/samples", params={"page_size": 200}).json()["items"]
    return next(s["id"] for s in items if s["external_id"] == external_id)


def test_run_name_set_on_lock_and_round_trips(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nR1,bcr1"})
    past = _past_weekday()

    r1 = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "R1"),
            "instrument_serial": "84047",
            "run_date": past,
            "slot_index": 0,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
        },
    )
    assert r1.status_code == 201, r1.text
    cycle_id = r1.json()["cycle_id"]
    assert r1.json()["run_name"] is None

    lock = client.patch(f"/api/cycles/{cycle_id}", json={"status": "running", "run_name": "TRACTION-RUN-1234"})
    assert lock.status_code == 200, lock.text
    assert lock.json()["run_name"] == "TRACTION-RUN-1234"

    fetched = client.get(f"/api/cycles/{cycle_id}").json()
    assert fetched["run_name"] == "TRACTION-RUN-1234"


def test_run_name_survives_unlock_and_blank_clears_it(client):
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nR2,bcr2"})
    past = _past_weekday()

    r1 = client.post(
        "/api/cell-uses",
        json={
            "sample_id": _sid(client, "R2"),
            "instrument_serial": "84098",
            "run_date": past,
            "slot_index": 0,
            "cell_choice": {"mode": "new"},
            "run_time_hours": 24,
        },
    )
    assert r1.status_code == 201, r1.text
    cycle_id = r1.json()["cycle_id"]

    assert client.patch(
        f"/api/cycles/{cycle_id}", json={"status": "running", "run_name": "TRACTION-RUN-9999"}
    ).status_code == 200

    # Unlock (running -> planned) doesn't touch run_name, even with no run_name in the body
    unlock = client.patch(f"/api/cycles/{cycle_id}", json={"status": "planned"})
    assert unlock.status_code == 200, unlock.text
    assert unlock.json()["run_name"] == "TRACTION-RUN-9999"

    # Re-locking with blank/whitespace clears it
    relock = client.patch(f"/api/cycles/{cycle_id}", json={"status": "running", "run_name": "   "})
    assert relock.status_code == 200, relock.text
    assert relock.json()["run_name"] is None
