"""Re-importing pools that are already in RunNx: the preview's pool check, and Skip / Update /
Add at commit (Int #1). Waiting and scheduled pools are skipped by default, finished ones come
back as flagged repeats, and an Update rewrites the waiting copy without wiping blank fields."""
from app.models.audit import AuditLog
from app.models.sample import Sample

HEADER = "Pool ID,Barcodes,Plate ID,Target OPLC,Priority"


def _csv(*rows: str) -> str:
    return "\n".join([HEADER, *rows])


def _import(client, text: str, existing: dict | None = None) -> dict:
    resp = client.post("/api/imports", json={"raw_text": text, "existing": existing or {}})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _set_status(db_session, sample_id: int, status: str) -> None:
    db_session.get(Sample, sample_id).status = status
    db_session.commit()


def _check(client, *pools: tuple[str, str | None]) -> dict:
    resp = client.post(
        "/api/imports/pool-check", json={"pools": [{"pool_id": p, "plate_id": plate} for p, plate in pools]}
    )
    assert resp.status_code == 200, resp.text
    return {(p["pool_id"], p["plate_id"]): p for p in resp.json()["pools"]}


def test_pool_check_classifies_each_state(client, db_session):
    first = _import(client, _csv("WAIT,bc1,,,", "RUN,bc2,,,", "DONE,bc3,,,", "GONE,bc4,,,"))
    ids = {s["pool_id"]: s["id"] for s in first["samples"]}
    _set_status(db_session, ids["RUN"], "in_progress")
    _set_status(db_session, ids["DONE"], "completed")
    _set_status(db_session, ids["GONE"], "cancelled")

    found = _check(client, ("WAIT", None), ("RUN", None), ("DONE", None), ("GONE", None), ("NEW", None))
    assert {k[0]: v["state"] for k, v in found.items()} == {
        "WAIT": "waiting",
        "RUN": "active",
        "DONE": "finished",
        "GONE": "finished",
        "NEW": "new",
    }
    assert found[("WAIT", None)]["sample_count"] == 1
    assert found[("NEW", None)]["sample_count"] == 0


def test_waiting_copy_outranks_a_finished_one(client, db_session):
    first = _import(client, _csv("P,bc1,,,"))
    _set_status(db_session, first["samples"][0]["id"], "completed")
    _import(client, _csv("P,bc1,,,"))  # finished -> imported again as a repeat, now waiting

    assert _check(client, ("P", None))[("P", None)] == {
        "pool_id": "P", "plate_id": None, "state": "waiting", "sample_count": 2,
    }


def test_plate_id_only_compared_when_both_sides_have_one(client):
    _import(client, _csv("P,bc1,PLATE-1,,", "Q,bc2,,,"))
    found = _check(client, ("P", "PLATE-1"), ("P", "PLATE-2"), ("P", None), ("Q", "PLATE-9"))
    assert found[("P", "PLATE-1")]["state"] == "waiting"
    assert found[("P", "PLATE-2")]["state"] == "new"  # same Pool ID, different plate
    assert found[("P", None)]["state"] == "waiting"  # the row has no plate to compare
    assert found[("Q", "PLATE-9")]["state"] == "waiting"  # the stored sample has no plate


def test_reimporting_the_same_file_skips_everything(client):
    text = _csv("A,bc1,,,", "B,bc2,,,")
    _import(client, text)
    again = _import(client, text)
    assert again["imported_count"] == 0
    assert again["updated_count"] == 0
    assert again["skipped_count"] == 2
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 2


def test_scheduled_pool_is_skipped_and_a_finished_one_comes_back_as_a_flagged_repeat(client, db_session):
    first = _import(client, _csv("SCHED,bc1,,,", "DONE,bc2,,,"))
    ids = {s["pool_id"]: s["id"] for s in first["samples"]}
    _set_status(db_session, ids["SCHED"], "scheduled")
    _set_status(db_session, ids["DONE"], "failed")

    body = _import(client, _csv("SCHED,bc1,,,", "DONE,bc2,,,"))
    assert [s["pool_id"] for s in body["samples"]] == ["DONE"]
    assert body["skipped"] == [{"identifier": "SCHED", "reason": "Already scheduled or running"}]
    assert body["duplicates"] == [{"pool_id": "DONE", "created_now": 1, "total_seen": 2}]


def test_add_imports_a_copy_of_a_waiting_or_scheduled_pool(client, db_session):
    first = _import(client, _csv("WAIT,bc1,,,", "SCHED,bc2,,,"))
    _set_status(db_session, first["samples"][1]["id"], "scheduled")

    body = _import(client, _csv("WAIT,bc1,,,", "SCHED,bc2,,,"), {"WAIT": "add", "SCHED": "add"})
    assert sorted(s["pool_id"] for s in body["samples"]) == ["SCHED", "WAIT"]
    assert body["duplicate_count"] == 2


def test_update_rewrites_the_waiting_copy_and_keeps_blank_fields(client, db_session):
    first = _import(client, _csv("P,bc1;bc2,PLATE-1,120,High"))
    sample_id = first["samples"][0]["id"]

    # New barcodes and OPLC; Plate ID and Priority left blank in this file.
    body = _import(client, _csv("P,bc3,,150,"), {"P": "update"})
    assert body["imported_count"] == 0
    assert body["updated_count"] == 1
    assert body["updated"] == [
        {"sample_id": sample_id, "pool_id": "P", "changed_fields": ["barcodes", "target_oplc"]}
    ]

    sample = client.get(f"/api/samples/{sample_id}").json()
    assert sample["barcodes"] == ["bc3"]
    assert sample["target_oplc"] == 150
    assert sample["plate_id"] == "PLATE-1"  # blank in the file -> kept
    assert sample["priority"] == "High (1)"  # blank in the file -> kept

    rows = db_session.query(AuditLog).filter_by(action="update_sample", entity_id=sample_id).all()
    assert len(rows) == 1
    assert rows[0].details_json["target_oplc"] == {"from": 120, "to": 150}


def test_update_with_nothing_changed_writes_no_audit_row(client, db_session):
    first = _import(client, _csv("P,bc1,,120,"))
    body = _import(client, _csv("P,bc1,,120,"), {"P": "update"})
    assert body["updated"] == [{"sample_id": first["samples"][0]["id"], "pool_id": "P", "changed_fields": []}]
    assert db_session.query(AuditLog).filter_by(action="update_sample").count() == 0


def test_update_uses_the_first_row_when_the_file_repeats_a_pool(client):
    first = _import(client, _csv("P,bc1,,120,"))
    body = _import(client, _csv("P,bc1,,130,", "P,bc1,,140,"), {"P": "update"})
    assert body["updated_count"] == 1
    assert body["skipped"] == [{"identifier": "P", "reason": "Already updated from an earlier row"}]
    assert client.get(f"/api/samples/{first['samples'][0]['id']}").json()["target_oplc"] == 130


def test_a_stale_update_choice_cannot_touch_a_pool_scheduled_since_the_preview(client, db_session):
    first = _import(client, _csv("P,bc1,,120,"))
    sample_id = first["samples"][0]["id"]
    _set_status(db_session, sample_id, "scheduled")  # scheduled after the user chose Update

    body = _import(client, _csv("P,bc1,,999,"), {"P": "update"})
    assert body["updated_count"] == 0
    assert body["skipped"] == [{"identifier": "P", "reason": "Already scheduled or running"}]
    assert client.get(f"/api/samples/{sample_id}").json()["target_oplc"] == 120


def test_undo_removes_only_the_samples_an_import_added(client):
    first = _import(client, _csv("OLD,bc1,,120,"))
    old_id = first["samples"][0]["id"]
    body = _import(client, _csv("OLD,bc1,,150,", "NEW,bc2,,,"), {"OLD": "update"})
    assert body["imported_count"] == 1 and body["updated_count"] == 1

    undo = client.post(f"/api/imports/{body['import_batch_id']}/undo")
    assert undo.status_code == 200, undo.text
    assert undo.json()["removed_count"] == 1
    remaining = client.get("/api/samples", params={"status": "backlog"}).json()["items"]
    assert [(s["id"], s["target_oplc"]) for s in remaining] == [(old_id, 150)]  # the update stays


def test_an_import_that_added_nothing_cannot_be_undone(client):
    _import(client, _csv("A,bc1,,,"))
    again = _import(client, _csv("A,bc1,,,"))
    latest = client.get("/api/imports/latest").json()
    assert latest["id"] == again["import_batch_id"]
    assert latest["undoable"] is False
    assert "added no samples" in latest["undo_block_reason"]
