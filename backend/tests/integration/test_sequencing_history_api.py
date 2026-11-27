"""A sample's sequencing history from MLWH (GET /api/samples/sequencing-history for a page's
highlights, GET /api/samples/{id}/sequencing-history for every loading): found by Pool ID or by
any Sanger ID, with a pool's member split. MLWH is the SQLite stand-in (tests/mlwh_fake.py)."""
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.services import mlwh, mlwh_wells


def _sample(client, pool_id: str, sanger_ids=()) -> int:
    resp = client.post("/api/samples", json={"pool_id": pool_id, "barcodes": ["bc1001"], "sanger_ids": list(sanger_ids)})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _history(client, sample_id: int, **params) -> dict:
    resp = client.get(f"/api/samples/{sample_id}/sequencing-history", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _summaries(client, *ids: int) -> dict:
    resp = client.get("/api/samples/sequencing-history", params=[("sample_id", i) for i in ids])
    assert resp.status_code == 200, resp.text
    return resp.json()


def _days_ago(n: int) -> datetime:
    return datetime.now().replace(microsecond=0) - timedelta(days=n)


def test_unknown_sample_is_404(client):
    assert client.get("/api/samples/999/sequencing-history").status_code == 404


def test_not_configured_and_unreachable_are_states(client, monkeypatch):
    sid = _sample(client, "TRAC-2-100")
    monkeypatch.setattr(mlwh, "is_configured", lambda: False)
    assert _history(client, sid)["configured"] is False
    assert _summaries(client, sid) == {"configured": False, "ok": False, "error": None, "samples": {}}

    empty = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    monkeypatch.setattr(mlwh, "is_configured", lambda: True)
    monkeypatch.setattr(mlwh_wells, "engine", lambda: empty)
    body = _history(client, sid)
    assert body["configured"] is True and body["ok"] is False and body["error"]


def test_a_sample_never_sequenced(client, fake_mlwh):
    sid = _sample(client, "TRAC-2-100")
    body = _history(client, sid)
    assert body["ok"] is True and body["summary"] is None and body["loadings"] == []
    assert _summaries(client, sid)["samples"] == {}


def test_every_loading_of_the_tube_oldest_first_with_the_last_one_highlighted(client, fake_mlwh):
    sid = _sample(client, "TRAC-2-100")
    fake_mlwh.add_well(run="TRACTION-RUN-1", start=_days_ago(20), state="Passed", loading_conc=180, hifi_read_bases=10e9)
    fake_mlwh.add_well(run="TRACTION-RUN-2", start=_days_ago(5), state="Passed", loading_conc=210, hifi_read_bases=24e9)
    fake_mlwh.add_well(run="TRACTION-RUN-3", libraries=("TRAC-2-999",))  # someone else's tube
    fake_mlwh.add_well(run="TRACTION-RUN-4", instrument_type="Sequel2e")  # Sequel - left out

    body = _history(client, sid)
    assert [ld["run_name"] for ld in body["loadings"]] == ["TRACTION-RUN-1", "TRACTION-RUN-2"]
    first, last = body["loadings"]
    assert first["loading_conc"] == 180 and first["tube_hifi_gb"] == 10 and first["pct_of_cell"] == 100
    assert (first["own_hifi_gb"], first["own_pct_of_cell"]) == (10, 100)  # its own tube: the same
    assert last["plex"] == 1 and last["members"] == [] and last["via_other_tube"] is False
    assert last["smrt_link_url"] == "https://smrtlink.example.org:8243/sl/runs/11111111-2222"

    summary = body["summary"]
    assert summary["cells"] == 2 and summary["hifi_gb"] == 34
    assert summary["last_run_name"] == "TRACTION-RUN-2" and summary["last_loading_conc"] == 210
    assert summary["last_hifi_gb"] == 24 and summary["last_pct_of_cell"] == 100
    assert summary["last_well"] == "Plate 1 A1" and summary["last_qc_state"] == "Passed"


def test_a_pool_shows_how_the_cell_split_between_its_members(client, fake_mlwh):
    sid = _sample(client, "TRAC-2-300", ["S1", "S2", "S3", "S4"])
    fake_mlwh.add_well(hifi_read_bases=20e9,
                       members={"TRAC-2-300": [("S1", 40), ("S2", 30), ("S3", 20), ("S4", 10)]})
    (loading,) = _history(client, sid)["loadings"]
    assert loading["plex"] == 4 and loading["pct_of_cell"] == 100 and loading["tube_hifi_gb"] == 20
    members = [(m["sanger_sample_id"], m["hifi_gb"], m["pct_of_cell"], m["below_even"]) for m in loading["members"]]
    # An even share is 5 Gb; under 85% of it (4.25 Gb) is below even.
    assert members == [("S1", 8, 40, False), ("S2", 6, 30, False), ("S3", 4, 20, True), ("S4", 2, 10, True)]


def test_a_sample_sequenced_before_under_another_tube_is_found_by_sanger_id(client, fake_mlwh):
    sid = _sample(client, "TRAC-2-NEW", ["S7"])
    fake_mlwh.add_well(run="TRACTION-RUN-1", hifi_read_bases=20e9, start=_days_ago(10),
                       members={"TRAC-2-OLD": [("S7", 25), ("S8", 75)]})
    (loading,) = _history(client, sid)["loadings"]
    assert loading["tube"] == "TRAC-2-OLD" and loading["via_other_tube"] is True
    # The row reads what this sample got; the tube's whole figures stay for the pool split.
    assert (loading["own_hifi_gb"], loading["own_pct_of_cell"]) == (5, 25)
    assert (loading["tube_hifi_gb"], loading["pct_of_cell"]) == (20, 100)
    assert [(m["sanger_sample_id"], m["mine"]) for m in loading["members"]] == [("S8", False), ("S7", True)]
    # What counts for this sample is its own share of that cell, not the other tube's whole yield.
    summary = _history(client, sid)["summary"]
    assert summary["hifi_gb"] == 5 and summary["last_hifi_gb"] == 5 and summary["last_pct_of_cell"] == 25


def test_a_loading_links_to_the_runnx_run_with_that_traction_name(client, fake_mlwh):
    sid = _sample(client, "TRAC-2-100")
    client.post("/api/imports", json={"raw_text": "sample,barcodes\nTRAC-2-500,bc9"})
    other = next(s["id"] for s in client.get("/api/samples", params={"page_size": 200}).json()["items"]
                 if s["pool_id"] == "TRAC-2-500")
    placed = client.post("/api/cell-uses", json={
        "sample_id": other, "instrument_serial": "84047", "load_date": (datetime.now().date() - timedelta(days=3)).isoformat(),
        "slot_index": 0, "cell_choice": {"mode": "new"}, "run_time_hours": 24,
    })
    assert placed.status_code == 201, placed.text
    run_id = placed.json()["run_id"]
    assert client.patch(f"/api/cycles/{run_id}", json={"status": "running", "run_name": "traction-run-77"}).status_code == 200
    fake_mlwh.add_well(run="TRACTION-RUN-77")
    assert _history(client, sid)["loadings"][0]["run_id"] == run_id


def test_summaries_for_a_page_are_keyed_by_sample(client, fake_mlwh):
    a = _sample(client, "TRAC-2-100")
    b = _sample(client, "TRAC-2-200")
    c = _sample(client, "TRAC-2-300")
    fake_mlwh.add_well(libraries=("TRAC-2-100",))
    fake_mlwh.add_well(well="B1", libraries=("TRAC-2-200",), loading_conc=199)
    body = _summaries(client, a, b, c)
    assert body["ok"] is True and set(body["samples"]) == {str(a), str(b)}
    assert body["samples"][str(b)]["last_loading_conc"] == 199
    assert "loadings" not in body["samples"][str(a)]


def test_a_page_is_capped_at_200_samples(client):
    resp = client.get("/api/samples/sequencing-history", params=[("sample_id", i) for i in range(201)])
    assert resp.status_code == 422
