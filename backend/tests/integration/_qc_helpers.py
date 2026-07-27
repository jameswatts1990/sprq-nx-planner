"""Shared Cell-QC test helpers. The unified QC flow (POST /api/cells/{id}/qc/preview then
/qc/commit) replaced the old POST /stop, /retire and /undo-stop endpoints; these wrappers give
other test modules a one-call equivalent for setup (auto-dispositioning affected samples)."""


def qc_preview(client, cell_id, verdict, cell_use_id=None):
    return client.post(
        f"/api/cells/{cell_id}/qc/preview", json={"verdict": verdict, "cell_use_id": cell_use_id}
    )


def qc_commit(client, cell_id, verdict, cell_use_id=None, dispositions=None, reason="test", actor=None):
    body = {"verdict": verdict, "reason": reason}
    if cell_use_id is not None:
        body["cell_use_id"] = cell_use_id
    if dispositions is not None:
        body["dispositions"] = dispositions
    if actor is not None:
        body["actor"] = actor
    return client.post(f"/api/cells/{cell_id}/qc/commit", json=body)


def _apply(client, cell_id, verdict, cell_use_id, disposition, reason):
    preview = qc_preview(client, cell_id, verdict, cell_use_id)
    if preview.status_code != 200:
        return preview
    affected = preview.json()["affected_samples"]
    dispositions = {a["sample_id"]: disposition for a in affected if a["disposition_required"]}
    return qc_commit(client, cell_id, verdict, cell_use_id, dispositions, reason)


def qc_stop(client, cell_id, cell_use_id=None, *, disposition="recoverable", reason="test"):
    """Fail-and-Stop a cell, auto-dispositioning every must-dispose sample - the closest
    one-call equivalent of the old POST /stop, for test setup."""
    return _apply(client, cell_id, "fail_and_stop", cell_use_id, disposition, reason)


def qc_retire(client, cell_id, cell_use_id=None, *, disposition="recoverable", reason="test"):
    return _apply(client, cell_id, "retire", cell_use_id, disposition, reason)
