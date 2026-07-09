"""The proof that the prototype's manual "in-progress cells" hack is truly gone:
a cell with remaining capacity and burned barcodes from an EARLIER commit is
automatically pulled into a LATER preview/commit with zero manual re-entry, and a
new sample sharing a burned barcode is correctly barred from it.
"""
from datetime import date


def settings_for(instrument="84047", max_uses=3):
    return {
        "instrument_ids": [instrument],
        "max_uses": max_uses,
        "run_time_hours": 24,
        "objective": "fewest",
        "start_date": date.today().isoformat(),
    }


def _stage_for(cycles, external_id):
    for cycle in cycles:
        for stage in cycle["stages"]:
            if stage["sample_external_id"] == external_id:
                return stage
    raise AssertionError(f"no stage found for {external_id}")


def test_cell_with_remaining_capacity_is_reused_and_burned_barcodes_are_respected(client):
    # --- round 1: two non-clashing samples land on the same fresh cell (cap 3) ---
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nS1,bc1\nS2,bc2"})
    preview1 = client.post("/api/schedule/preview", json={"settings": settings_for()}).json()
    assert len(preview1["cells"]) == 1
    assert preview1["cells"][0]["future_uses"] == 2

    schedule1 = client.post(
        "/api/schedule/commit",
        json={"settings": settings_for(), "expected_backlog_hash": preview1["backlog_hash"]},
    ).json()
    detail1 = client.get(f"/api/schedules/{schedule1['id']}").json()

    s1_stage = _stage_for(detail1["cycles"], "S1")
    s2_stage = _stage_for(detail1["cycles"], "S2")
    cell_id = s1_stage["cell_id"]
    assert s2_stage["cell_id"] == cell_id

    # mark both real-world uses complete, as ops would after the actual run finishes
    for stage in (s1_stage, s2_stage):
        resp = client.patch(f"/api/cell-uses/{stage['cell_use_id']}", json={"status": "completed"})
        assert resp.status_code == 200, resp.text

    cell_after_round1 = client.get(f"/api/cells/{cell_id}").json()
    assert cell_after_round1["status"] == "open"  # 2 of 3 uses consumed, still has capacity
    assert cell_after_round1["uses_consumed"] == 2
    assert cell_after_round1["uses_remaining"] == 1
    assert cell_after_round1["burned_barcodes"] == ["bc1", "bc2"]

    # --- round 2: a NEW sample sharing a burned barcode, and one that doesn't ---
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nS3,bc1\nS4,bc3"})
    preview2 = client.post("/api/schedule/preview", json={"settings": settings_for()}).json()

    prior_cell_ref = next(c for c in preview2["cells"] if c["is_prior"])
    fresh_cell_ref = next(c for c in preview2["cells"] if not c["is_prior"])

    assert prior_cell_ref["cell_id"] == cell_id
    prior_cell_sample_ids = {u["sample_external_id"] for u in prior_cell_ref["uses"]}
    fresh_cell_sample_ids = {u["sample_external_id"] for u in fresh_cell_ref["uses"]}

    # S3 (bc1) must be barred from the cell that already burned bc1 - zero manual input
    assert "S3" not in prior_cell_sample_ids
    assert "S3" in fresh_cell_sample_ids
    # S4 (bc3) has no conflict and is free to reuse the existing cell's last slot
    assert "S4" in prior_cell_sample_ids

    # committing round 2 must reuse the SAME db cell row, now reaching its cap
    schedule2 = client.post(
        "/api/schedule/commit",
        json={"settings": settings_for(), "expected_backlog_hash": preview2["backlog_hash"]},
    ).json()
    detail2 = client.get(f"/api/schedules/{schedule2['id']}").json()
    s4_stage = _stage_for(detail2["cycles"], "S4")
    assert s4_stage["cell_id"] == cell_id

    cell_after_round2 = client.get(f"/api/cells/{cell_id}").json()
    assert cell_after_round2["uses_consumed"] == 3
    assert cell_after_round2["uses_remaining"] == 0
    assert cell_after_round2["status"] == "exhausted"
