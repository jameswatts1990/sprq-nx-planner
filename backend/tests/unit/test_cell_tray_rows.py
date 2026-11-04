"""Cells page tray rows: grouping serialized cells into whole trays and ordering them for paging."""
from datetime import UTC, date, datetime, timedelta

from app.schemas.cell import CellOut
from app.services.cell_tray_rows import group_tray_rows, sort_tray_rows

T0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)


def _cell(cell_id: int, tray_id: int | None, position: int | None, **overrides) -> CellOut:
    base = {
        "id": cell_id,
        "code": f"C0{position or 0}-T{tray_id}",
        "cell_type": "sprq_nx",
        "max_uses": 3,
        "status": "open",
        "uses_consumed": 0,
        "uses_remaining": 3,
        "burned_barcodes": [],
        "window_hours_elapsed": None,
        "window_breached": False,
        "current_instrument_serial": "84047",
        "current_well": None,
        "last_use_run_date": None,
        "reuse_ready_at": None,
        "first_use_started_at": None,
        "first_use_planned_start_at": None,
        "created_at": T0,
        "stopped_reason": None,
        "stopped_at": None,
        "discarded_reason": None,
        "discarded_at": None,
        "has_failed_use": False,
        "needs_qc_report": False,
        "awaiting_credit": False,
        "internal_report_id": None,
        "internal_report_at": None,
        "pacbio_case_number": None,
        "pacbio_reported_at": None,
        "pacbio_credit_confirmed_at": None,
        "credit_acquisitions": None,
        "credit_notes": None,
        "credit_received_at": None,
        "credit_owner": None,
        "tray_id": tray_id,
        "tray_position": position,
        "tray_size": 4,
        "tray_reuse_disabled": False,
    }
    return CellOut(**{**base, **overrides})


def test_group_keeps_whole_tray_in_position_order_and_marks_matches():
    matched = [_cell(3, 7, 3), _cell(1, 7, 1)]
    siblings = [_cell(4, 7, 4), _cell(2, 7, 2)]
    (row,) = group_tray_rows(matched, siblings)
    assert row.tray_id == 7
    assert [c.tray_position for c in row.cells] == [1, 2, 3, 4]
    assert row.matched_cell_ids == [1, 3]


def test_trayless_cells_each_get_their_own_row():
    rows = group_tray_rows([_cell(1, None, None), _cell(2, None, None)], [])
    assert sorted(len(r.cells) for r in rows) == [1, 1]
    assert all(r.tray_id is None for r in rows)


def test_row_figures_come_from_open_cells_only():
    started = T0 - timedelta(hours=100)
    cells = [
        _cell(1, 7, 1, uses_consumed=2, uses_remaining=1, window_hours_elapsed=100.0, first_use_started_at=started,
              last_use_run_date=date(2026, 10, 30)),
        _cell(2, 7, 2, uses_consumed=1, uses_remaining=2, window_hours_elapsed=20.0,
              first_use_started_at=T0 - timedelta(hours=20), last_use_run_date=date(2026, 11, 1)),
        # A stopped cell's leftover capacity isn't usable and its window no longer matters.
        _cell(3, 7, 3, status="stopped", uses_consumed=1, uses_remaining=2, window_hours_elapsed=110.0,
              first_use_started_at=T0 - timedelta(hours=110)),
        # Not used yet as of now, but two of its uses are already booked - only one is free.
        _cell(4, 7, 4, first_use_planned_start_at=T0 + timedelta(days=1), uses_scheduled_later=2),
    ]
    (row,) = group_tray_rows(cells, [])
    assert row.uses_left == 1 + 2 + 1
    assert row.expires_in_hours == 8.0
    assert row.expires_at == started + timedelta(hours=108)
    assert row.first_use_at == T0 - timedelta(hours=110)
    assert row.last_run_date == date(2026, 11, 1)


def test_sort_puts_missing_values_last_in_both_directions_with_newest_tray_tiebreak():
    rows = group_tray_rows(
        [
            _cell(1, 1, 1, window_hours_elapsed=90.0, first_use_started_at=T0),  # 18h left
            _cell(2, 2, 1),  # never used - no window
            _cell(3, 3, 1, window_hours_elapsed=10.0, first_use_started_at=T0),  # 98h left
            _cell(4, 4, 1, window_hours_elapsed=90.0, first_use_started_at=T0),  # 18h left, newer tray
        ],
        [],
    )
    assert [r.tray_id for r in sort_tray_rows(rows, "expiry", "asc")] == [4, 1, 3, 2]
    assert [r.tray_id for r in sort_tray_rows(rows, "expiry", "desc")] == [3, 4, 1, 2]
    assert [r.tray_id for r in sort_tray_rows(rows, "tray", "asc")] == [1, 2, 3, 4]
