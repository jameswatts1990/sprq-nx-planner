"""The shared MLWH layer (services/mlwh_wells.py): run-name and well matching, P1 %, how tubes
are read, and the guarded read - cache, single-flight and circuit breaker."""
import threading
import time
from datetime import datetime

import pytest

from app.models.schedule import CellUse, Cycle, RunBatch
from app.services import mlwh_wells
from app.services.mlwh_wells import MlwhUnavailable, fetch, p1_percent, run_key, use_at, well_key


@pytest.mark.parametrize(
    "name", ["TRACTION-RUN-2589", "traction-run-2589", " Traction Run 2589 ", "TRACTION_RUN_02589", "2589"]
)
def test_run_names_normalise_to_one_key(name):
    assert run_key(name) == "TRACTION-RUN-2589"


def test_other_run_names_are_kept_and_blank_is_none():
    assert run_key("  my special run ") == "MY SPECIAL RUN"
    assert run_key("   ") is None and run_key(None) is None


def test_well_key():
    assert well_key(" TRACTION-RUN-2589 ", 2, "a1") == "TRACTION-RUN-2589|2|A1"


def _run(*plates: tuple[int, list[tuple[str, str]]]) -> RunBatch:
    return RunBatch(
        cycles=[
            Cycle(plate_index=p, cell_uses=[CellUse(well=w, status=s) for w, s in uses]) for p, uses in plates
        ]
    )


def test_traction_well_is_the_runnx_row_letter_on_that_plate():
    run = _run((1, [("A01", "started"), ("B01", "started")]), (2, [("A02", "started")]))
    assert use_at(run, 1, "B1").well == "B01"
    # A fresh parallel Plate 2 stores A02-D02, but Traction labels every plate A1-D1.
    assert use_at(run, 2, "A1").well == "A02"
    assert use_at(run, 2, "B1") is None
    assert use_at(run, 3, "A1") is None


def test_a_reuse_plate_2_in_a01_is_traction_plate_2_a1_and_blocked_markers_are_skipped():
    run = _run((1, [("A01", "started")]), (2, [("A01", "cancelled")]))
    assert use_at(run, 2, "A1") is None
    run = _run((1, [("A01", "started")]), (2, [("A01", "started")]))
    assert use_at(run, 2, "A1") is run.cycles[1].cell_uses[0]


# --- P1 and reading wells ---------------------------------------------------------------------


def test_p1_is_a_share_of_the_p0_p1_p2_partition():
    assert p1_percent(30, 60, 10) == 60.0
    # productive_zmws_num can be smaller than p1 on some wells; the partition can't exceed 100%.
    assert p1_percent(0, 129, 0) == 100.0
    assert p1_percent(None, 60, 10) is None and p1_percent(0, 0, 0) is None


def test_fetch_wells_collapses_pool_rows_and_leaves_sequel_out(fake_mlwh):
    fake_mlwh.add_well(libraries=("TRAC-2-200", "TRAC-2-200", "TRAC-2-201"))
    fake_mlwh.add_well(well="B1", instrument_type="Sequel2e")
    (well,) = mlwh_wells.fetch_wells(fake_mlwh.engine, "1 = 1", {})
    assert well.library_barcodes == ["TRAC-2-200", "TRAC-2-201"] and well.sample_count == 3
    assert well.p1_pct == 60.0 and well.hifi_yield_gb == 12.5
    assert well.well_start is not None and isinstance(well.well_start, datetime)


def test_fetch_wells_takes_in_lists(fake_mlwh):
    fake_mlwh.add_well(run="TRACTION-RUN-1")
    fake_mlwh.add_well(run="TRACTION-RUN-2")
    fake_mlwh.add_well(run="TRACTION-RUN-3")
    wells = mlwh_wells.fetch_wells(fake_mlwh.engine, "m.pac_bio_run_name IN :names",
                                   {"names": ["TRACTION-RUN-1", "TRACTION-RUN-3"]}, expanding=("names",))
    assert sorted(w.run_name for w in wells) == ["TRACTION-RUN-1", "TRACTION-RUN-3"]


# --- The guarded read -------------------------------------------------------------------------


class _Reader:
    def __init__(self, value="wells", fail=False, delay=0.0):
        self.calls = 0
        self.value, self.fail, self.delay = value, fail, delay

    def __call__(self, _engine):
        self.calls += 1
        time.sleep(self.delay)
        if self.fail:
            raise RuntimeError("Can't connect to MySQL server")
        return self.value


@pytest.fixture
def no_engine(monkeypatch):
    monkeypatch.setattr(mlwh_wells, "engine", lambda: None)


def test_a_result_is_cached_for_its_ttl_and_refresh_skips_the_cache(no_engine):
    read = _Reader()
    assert fetch("k", read, ttl=60) == "wells"
    assert fetch("k", read, ttl=60) == "wells" and read.calls == 1
    assert fetch("k", read, ttl=60, refresh=True) == "wells" and read.calls == 2
    assert fetch("other", read, ttl=60) == "wells" and read.calls == 3


def test_ttl_can_depend_on_the_result(no_engine):
    read = _Reader()
    fetch("k", read, ttl=lambda value: 0 if value == "wells" else 60)
    fetch("k", read, ttl=60)
    assert read.calls == 2  # a zero lifetime is never served from the cache


def test_a_failure_answers_at_once_until_retry(no_engine):
    failing = _Reader(fail=True)
    with pytest.raises(MlwhUnavailable, match="Can't connect"):
        fetch("k", failing, ttl=60)
    # Every read - any key - now answers with the failure without asking MLWH.
    working = _Reader()
    with pytest.raises(MlwhUnavailable, match="Can't connect"):
        fetch("other", working, ttl=60)
    assert working.calls == 0
    # Retry always asks, and a success closes the circuit for everyone.
    assert fetch("other", working, ttl=60, refresh=True) == "wells"
    assert fetch("third", working, ttl=60) == "wells" and working.calls == 2


def test_the_circuit_reopens_after_its_pause(no_engine, monkeypatch):
    monkeypatch.setattr(mlwh_wells, "RETRY_AFTER_S", 0)
    with pytest.raises(MlwhUnavailable):
        fetch("k", _Reader(fail=True), ttl=60)
    assert fetch("k", _Reader(), ttl=60) == "wells"


def test_concurrent_reads_of_one_key_ask_mlwh_once(no_engine):
    read = _Reader(delay=0.2)
    results = []
    threads = [threading.Thread(target=lambda: results.append(fetch("k", read, ttl=60))) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == ["wells"] * 5 and read.calls == 1


def test_the_cache_is_bounded(no_engine, monkeypatch):
    monkeypatch.setattr(mlwh_wells, "MAX_CACHED", 3)
    read = _Reader()
    for i in range(5):
        fetch(i, read, ttl=60 + i)
    assert len(mlwh_wells._cache) == 3 and set(mlwh_wells._cache) == {2, 3, 4}
