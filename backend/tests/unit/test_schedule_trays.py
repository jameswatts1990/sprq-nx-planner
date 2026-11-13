"""services/schedule_trays.py's tray founding/eviction ports and keep rule, against the golden
fixture the frontend's twins (waitingCells.ts) are also asserted on - see
frontend/src/components/scheduler/scheduleTrays.golden.test.ts."""
import json
from datetime import date
from pathlib import Path

from app.schemas.cell import ScheduleTrayCellOut
from app.services.schedule_trays import (
    compute_tray_eviction_dates,
    compute_tray_founding_dates,
    kept_tray_ids,
)

# Kept in frontend/ (its image builds with only frontend/ as context); pytest runs from a full checkout.
GOLDEN_PATH = Path(__file__).parents[3] / "frontend/src/components/scheduler/__fixtures__/schedule_trays_golden.json"
GOLDEN = json.loads(GOLDEN_PATH.read_text("utf-8"))
CELLS = [ScheduleTrayCellOut.model_validate(c) for c in GOLDEN["cells"]]


def _iso(m: dict[int, date]) -> dict[str, str]:
    return {str(k): v.isoformat() for k, v in m.items()}


def test_founding_dates_match_the_golden_fixture():
    assert _iso(compute_tray_founding_dates(CELLS)) == GOLDEN["expected_founding"]


def test_eviction_dates_match_the_golden_fixture():
    founding = compute_tray_founding_dates(CELLS)
    assert _iso(compute_tray_eviction_dates(CELLS, founding)) == GOLDEN["expected_eviction"]


def test_keep_rule_matches_the_golden_fixture():
    evictions = compute_tray_eviction_dates(CELLS, compute_tray_founding_dates(CELLS))
    kept = kept_tray_ids(CELLS, evictions, date.fromisoformat(GOLDEN["date_from"]))
    assert sorted(kept) == GOLDEN["expected_kept_tray_ids"]


def test_kept_trays_keep_their_residency_from_date_from_on():
    """Recomputing the maps over only the kept cells (what the frontend does) gives every kept
    tray the same founding date, and an eviction that is either unchanged or - for a tray kept only
    for its stopped/open cell whose successor was dropped - still on or before date_from, so the
    tray reads not-resident on every day from date_from on either way."""
    date_from = date.fromisoformat(GOLDEN["date_from"])
    founding = compute_tray_founding_dates(CELLS)
    evictions = compute_tray_eviction_dates(CELLS, founding)
    kept = kept_tray_ids(CELLS, evictions, date_from)
    subset = [c for c in CELLS if c.tray_id in kept]
    sub_founding = compute_tray_founding_dates(subset)
    sub_evictions = compute_tray_eviction_dates(subset, sub_founding)
    assert sub_founding == {t: d for t, d in founding.items() if t in kept}
    for tray_id in kept:
        full, sub = evictions.get(tray_id), sub_evictions.get(tray_id)
        assert full == sub or (full is not None and sub is not None and full <= date_from and sub <= date_from)
    # Tray 4 (kept for its stopped cell) is the case that moves: its successor tray 5 was dropped.
    assert (evictions[4], sub_evictions[4]) == (date(2026, 1, 19), date(2026, 3, 9))
