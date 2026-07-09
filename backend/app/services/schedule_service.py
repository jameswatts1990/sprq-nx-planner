"""Serializes persisted Schedule/RunBatch/Cycle/CellUse rows back into the same
CycleOut/StageOut shapes the live preview uses, so the frontend's calendar and
cell-map components render a committed schedule and a preview identically."""
from __future__ import annotations

from app.engine.constants import WELLS
from app.models.schedule import Cycle, Schedule
from app.schemas.schedule import CycleOut, KPIOut, ScheduleDetailOut, ScheduleOut, StageOut


def _kpi_from_settings_json(settings_json: dict) -> KPIOut | None:
    kpi_dict = settings_json.get("kpi") if isinstance(settings_json, dict) else None
    return KPIOut(**kpi_dict) if kpi_dict else None


def _run_design_from_settings_json(settings_json: dict) -> dict:
    if isinstance(settings_json, dict) and "run_design" in settings_json:
        return settings_json["run_design"]
    return settings_json if isinstance(settings_json, dict) else {}


def serialize_schedule(schedule: Schedule) -> ScheduleOut:
    return ScheduleOut(
        id=schedule.id,
        created_at=schedule.created_at,
        created_by=schedule.created_by,
        status=schedule.status,
        start_date=schedule.start_date,
        settings_json=_run_design_from_settings_json(schedule.settings_json),
        kpi=_kpi_from_settings_json(schedule.settings_json),
    )


def cycle_out(cycle: Cycle) -> CycleOut:
    """Standalone serializer for a single Cycle, used both by the schedule-detail view
    and by the cross-schedule /api/cycles instrument calendar query."""
    run_batch = cycle.run_batch
    schedule = run_batch.schedule
    run_design = _run_design_from_settings_json(schedule.settings_json)
    instrument_order = run_design.get("instrument_ids", []) if isinstance(run_design, dict) else []
    serial = run_batch.instrument.serial_number if run_batch.instrument else "?"
    machine_idx = instrument_order.index(serial) if serial in instrument_order else 0

    stages = [
        StageOut(
            cell_ref=cu.cell.code if cu.cell else "?",
            cell_id=cu.cell_id,
            cell_is_prior=False,
            cell_use_id=cu.id,
            sample_id=cu.sample_id,
            sample_external_id=cu.sample.external_id if cu.sample else None,
            barcodes=cu.barcode_list,
            well=cu.well,
            stage_no=(WELLS.index(cu.well) + 1) if cu.well in WELLS else 0,
        )
        for cu in sorted(cycle.cell_uses, key=lambda x: x.well)
    ]
    day_idx = (cycle.planned_start_at.date() - schedule.start_date).days
    end_day_idx = (cycle.planned_end_at.date() - schedule.start_date).days

    return CycleOut(
        machine_idx=machine_idx,
        instrument_serial=serial,
        batch_idx=run_batch.batch_index,
        use_idx=cycle.use_index,
        day_idx=day_idx,
        time_of_day_hours=cycle.planned_start_at.hour + cycle.planned_start_at.minute / 60,
        end_day_idx=end_day_idx,
        stages=stages,
        cycle_id=cycle.id,
        status=cycle.status,
        planned_start_at=cycle.planned_start_at,
        planned_end_at=cycle.planned_end_at,
        actual_start_at=cycle.actual_start_at,
        actual_end_at=cycle.actual_end_at,
    )


def serialize_schedule_detail(schedule: Schedule) -> ScheduleDetailOut:
    base = serialize_schedule(schedule)
    cycles_out: list[CycleOut] = []
    for run_batch in sorted(schedule.run_batches, key=lambda rb: rb.batch_index):
        for cycle in sorted(run_batch.cycles, key=lambda c: c.use_index):
            cycles_out.append(cycle_out(cycle))
    return ScheduleDetailOut(**base.model_dump(), cycles=cycles_out)
