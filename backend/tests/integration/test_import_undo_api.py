"""Undo the most recent import — allowed only while every sample it created is still an
untouched backlog row (nothing scheduled, cancelled, edited, or QC'd)."""


def _import(client, text: str):
    resp = client.post("/api/imports", json={"raw_text": text})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_undo_removes_a_pristine_import(client):
    batch = _import(client, "sample,barcodes\nA,bc1\nB,bc2\nC,bc3")
    assert batch["imported_count"] == 3

    resp = client.post(f"/api/imports/{batch['import_batch_id']}/undo")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"import_batch_id": batch["import_batch_id"], "removed_count": 3}

    # Samples gone, batch gone, nothing left to undo.
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0
    assert client.get("/api/imports/latest").json() is None
    assert client.get(f"/api/imports/{batch['import_batch_id']}").status_code == 404


def test_undo_is_blocked_once_a_sample_is_edited(client):
    batch = _import(client, "sample,barcodes\nA,bc1\nB,bc2")
    sample_id = batch["samples"][0]["id"]

    edit = client.patch(f"/api/samples/{sample_id}", json={"barcodes": ["bc1"], "priority": "High"})
    assert edit.status_code == 200, edit.text

    resp = client.post(f"/api/imports/{batch['import_batch_id']}/undo")
    assert resp.status_code == 409
    assert "edited" in resp.json()["detail"]
    # Nothing removed — both samples still in the backlog.
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 2


def test_undo_is_blocked_once_a_sample_is_progressed(client):
    batch = _import(client, "sample,barcodes\nA,bc1\nB,bc2")
    sample_id = batch["samples"][0]["id"]

    cancel = client.post(f"/api/samples/{sample_id}/cancel")
    assert cancel.status_code == 200, cancel.text

    resp = client.post(f"/api/imports/{batch['import_batch_id']}/undo")
    assert resp.status_code == 409
    assert "scheduled or edited" in resp.json()["detail"]


def test_only_the_most_recent_import_can_be_undone(client):
    first = _import(client, "sample,barcodes\nA,bc1")
    second = _import(client, "sample,barcodes\nB,bc2")

    # The older batch refuses — a newer import exists.
    older = client.post(f"/api/imports/{first['import_batch_id']}/undo")
    assert older.status_code == 409
    assert "most recent" in older.json()["detail"]

    # Undo the newest, and the previous one becomes undoable in turn.
    assert client.post(f"/api/imports/{second['import_batch_id']}/undo").status_code == 200
    assert client.post(f"/api/imports/{first['import_batch_id']}/undo").status_code == 200
    assert client.get("/api/samples", params={"status": "backlog"}).json()["total"] == 0


def test_latest_endpoint_reflects_undoability(client):
    batch = _import(client, "sample,barcodes\nA,bc1\nB,bc2")

    latest = client.get("/api/imports/latest").json()
    assert latest["id"] == batch["import_batch_id"]
    assert latest["imported_count"] == 2
    assert latest["undoable"] is True
    assert latest["undo_block_reason"] is None
    assert latest["blocking_count"] == 0

    client.post(f"/api/samples/{batch['samples'][0]['id']}/cancel")

    latest = client.get("/api/imports/latest").json()
    assert latest["undoable"] is False
    assert latest["blocking_count"] == 1
    assert latest["undo_block_reason"]


def test_undo_unknown_batch_is_404(client):
    assert client.post("/api/imports/999999/undo").status_code == 404
