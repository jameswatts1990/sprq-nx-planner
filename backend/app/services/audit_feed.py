"""Read side of the audit trail for the Activity page (GET /api/audit-log). A row only stores
entity_type + entity_id (plus free-form details), so two things are worked out here at read time:
which rows belong to a run / sample / cell (`related_clause`), and what each row links to
(`resolve_links`, a few batched queries per page)."""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.cell import Cell
from app.models.cell_tray import CellTray
from app.models.instrument import Instrument
from app.models.sample import Sample
from app.models.schedule import CellUse, Cycle, RunBatch
from app.models.topup import SampleTopup
from app.schemas.audit import AuditLinkKind, AuditLinkOut

_ENTITY_LINK_KIND: dict[str, AuditLinkKind] = {
    "sample": "sample",
    "run_batch": "run",
    "cell": "cell",
    "cell_tray": "tray",
    "instrument": "instrument",
}


def related_clause(
    *, run_id: int | None = None, sample_id: int | None = None, cell_id: int | None = None
) -> ColumnElement[bool] | None:
    """Rows about this run / sample / cell, including the placements on it. A placement that's
    since been removed or moved is matched through the ids its own row recorded (details
    sample_id / cell_id / cycle_id), since its cell_use row is gone."""
    et, eid, details = AuditLog.entity_type, AuditLog.entity_id, AuditLog.details_json
    clauses: list[ColumnElement[bool]] = []
    if sample_id is not None:
        clauses.append(
            or_(
                and_(et == "sample", eid == sample_id),
                and_(et == "cell_use", eid.in_(select(CellUse.id).where(CellUse.sample_id == sample_id))),
                and_(et == "cell_use", details["sample_id"].as_integer() == sample_id),
                and_(et == "sample_topup", eid.in_(select(SampleTopup.id).where(SampleTopup.sample_id == sample_id))),
            )
        )
    if run_id is not None:
        plates = select(Cycle.id).where(Cycle.run_batch_id == run_id)
        clauses.append(
            or_(
                and_(et == "run_batch", eid == run_id),
                and_(et == "cell_use", eid.in_(select(CellUse.id).where(CellUse.cycle_id.in_(plates)))),
                and_(et == "cell_use", details["cycle_id"].as_integer().in_(plates)),
            )
        )
    if cell_id is not None:
        clauses.append(
            or_(
                and_(et == "cell", eid == cell_id),
                and_(et == "cell_use", eid.in_(select(CellUse.id).where(CellUse.cell_id == cell_id))),
                and_(et == "cell_use", details["cell_id"].as_integer() == cell_id),
            )
        )
    return and_(*clauses) if clauses else None


def _int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def resolve_links(db: Session, rows: Sequence[AuditLog]) -> dict[int, list[AuditLinkOut]]:
    """Each row's links (keyed by audit row id), only to things that still exist. A placement
    links to its sample, run and cell - from the live cell_use, or from the ids its row recorded
    once the use is gone."""
    use_ids = {r.entity_id for r in rows if r.entity_type == "cell_use" and r.entity_id is not None}
    uses = {
        cu_id: (sample_id, run_id, cell_id)
        for cu_id, sample_id, run_id, cell_id in db.execute(
            select(CellUse.id, CellUse.sample_id, Cycle.run_batch_id, CellUse.cell_id)
            .join(Cycle, CellUse.cycle_id == Cycle.id)
            .where(CellUse.id.in_(use_ids))
        )
    }
    gone_use_plates = {
        _int((r.details_json or {}).get("cycle_id") or (r.details_json or {}).get("to_cycle_id"))
        for r in rows
        if r.entity_type == "cell_use" and r.entity_id not in uses
    } - {None}
    plate_runs = dict(db.execute(select(Cycle.id, Cycle.run_batch_id).where(Cycle.id.in_(gone_use_plates))).all())

    targets: dict[int, list[tuple[AuditLinkKind, int]]] = {}
    for r in rows:
        details = r.details_json or {}
        found: list[tuple[AuditLinkKind, int | None]] = []
        if r.entity_type in _ENTITY_LINK_KIND:
            found.append((_ENTITY_LINK_KIND[r.entity_type], r.entity_id))
        elif r.entity_type == "sample_topup":
            found.append(("sample", _int(details.get("sample_id"))))
        elif r.entity_type == "cell_use":
            if r.entity_id in uses:
                sample_id, run_id, cell_id = uses[r.entity_id]
            else:
                sample_id = _int(details.get("sample_id"))
                run_id = plate_runs.get(_int(details.get("cycle_id") or details.get("to_cycle_id")))
                cell_id = _int(details.get("cell_id"))
            found += [("sample", sample_id), ("run", run_id), ("cell", cell_id)]
        targets[r.id] = [(kind, i) for kind, i in found if i is not None]

    wanted: dict[AuditLinkKind, set[int]] = defaultdict(set)
    for links in targets.values():
        for kind, i in links:
            wanted[kind].add(i)
    labels: dict[AuditLinkKind, dict[int, str]] = {
        "sample": dict(db.execute(select(Sample.id, Sample.pool_id).where(Sample.id.in_(wanted["sample"]))).all()),
        "cell": dict(db.execute(select(Cell.id, Cell.code).where(Cell.id.in_(wanted["cell"]))).all()),
        "run": {
            i: name or f"Run #{i}"
            for i, name in db.execute(select(RunBatch.id, RunBatch.run_name).where(RunBatch.id.in_(wanted["run"])))
        },
        "tray": {i: f"Tray {i}" for i in db.scalars(select(CellTray.id).where(CellTray.id.in_(wanted["tray"])))},
        "instrument": {
            i: name or serial
            for i, name, serial in db.execute(
                select(Instrument.id, Instrument.name, Instrument.serial_number).where(
                    Instrument.id.in_(wanted["instrument"])
                )
            )
        },
    }
    return {
        row_id: [AuditLinkOut(kind=kind, id=i, label=labels[kind][i]) for kind, i in links if i in labels[kind]]
        for row_id, links in targets.items()
    }
