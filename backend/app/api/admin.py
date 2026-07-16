"""Dev-only raw database inspection/mutation tools.

Not gated by environment - remove or gate this router explicitly before a
real production launch (see CLAUDE.md "Help Tab Maintenance" /
RunNx Admin notes).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import Table, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models  # noqa: F401  ensures every model is registered on Base.metadata
from app.api.deps import SessionDep, pagination
from app.db import Base
from app.models.cell import Cell
from app.models.sample import SAMPLE_TERMINAL_STATUSES, Sample
from app.models.schedule import CellUse, Cycle, RunBatch
from app.services.cell_service import recompute_status
from app.timeutil import utcnow

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Tables whose rows disappearing (directly, or via an ON DELETE CASCADE from one of the
# others) needs cleanup beyond what FK constraints alone provide - see _affected_cell_use_rows
# and _reconcile_after_cell_use_removal below. Every other table's dependents are already
# protected by a plain FK (no ondelete=CASCADE declared -> the DB just rejects the delete
# with a 409 if anything still references the row), so they need no special handling here.
_CASCADE_AWARE_TABLES = {"run_batches", "cycles", "cell_uses"}


def _affected_cell_use_rows(db: Session, table_name: str, pk_values: list[Any]) -> list[tuple[int | None, int]]:
    """(sample_id, cell_id) pairs for every CellUse that deleting these rows from
    `table_name` will remove, directly or via cascade - captured *before* the delete,
    since once the cascade runs there's nothing left to query to find out what it removed."""
    if not pk_values:
        return []
    if table_name == "cell_uses":
        stmt = select(CellUse.sample_id, CellUse.cell_id).where(CellUse.id.in_(pk_values))
    elif table_name == "cycles":
        stmt = select(CellUse.sample_id, CellUse.cell_id).where(CellUse.cycle_id.in_(pk_values))
    elif table_name == "run_batches":
        stmt = (
            select(CellUse.sample_id, CellUse.cell_id)
            .join(Cycle, Cycle.id == CellUse.cycle_id)
            .where(Cycle.run_batch_id.in_(pk_values))
        )
    else:
        return []
    return list(db.execute(stmt).all())


def _reconcile_after_cell_use_removal(db: Session, affected: list[tuple[int | None, int]]) -> None:
    """Mirrors the side effects placement_service.remove_sample applies when a placement
    is removed normally - needed here because deleting rows straight out of a table
    bypasses that path (and the FK cascade it relies on) entirely. Without this, a sample
    is left stuck showing "scheduled" forever, and a cell's derived status/window fields
    go stale relative to its now-different (or now-empty) cell_uses."""
    sample_ids = {sid for sid, _cell_id in affected if sid is not None}
    cell_ids = {cid for _sid, cid in affected}
    if sample_ids:
        db.execute(
            update(Sample)
            .where(Sample.id.in_(sample_ids), Sample.status.notin_(SAMPLE_TERMINAL_STATUSES))
            .values(status="backlog")
        )
    now = utcnow()
    for cell_id in cell_ids:
        cell = db.get(Cell, cell_id)
        if cell is None:
            continue
        db.refresh(cell, attribute_names=["cell_uses"])
        if cell.cell_uses:
            recompute_status(cell, now)
        else:
            # Same rule as remove_sample/cancel_run: a cell left with no uses at all was
            # only ever a placeholder for the use(s) just removed - don't leave behind an
            # orphan "open, 0/3" cell that can never legitimately exist.
            db.delete(cell)


def _delete_orphaned_run_batches(db: Session) -> None:
    """RunBatch has no FK pointing at Cycle, so nothing cascades in this direction: a
    RunBatch whose only Cycle was just deleted (directly, or by clearing/deleting from
    `cycles`) survives as an empty husk otherwise - and a later placement attempt on that
    same (instrument, run_date) would then fail on RunBatch's own unique constraint
    instead of just reusing the slot (see placement_service.get_or_create_run, which is
    now tolerant of this same state - this just avoids leaving the junk row behind)."""
    stmt = select(RunBatch).outerjoin(Cycle, Cycle.run_batch_id == RunBatch.id).where(Cycle.id.is_(None))
    for run_batch in db.scalars(stmt).unique().all():
        db.delete(run_batch)


class TableInfo(BaseModel):
    name: str
    columns: list[str]
    primary_key: list[str]
    row_count: int


class RowPage(BaseModel):
    table: str
    columns: list[str]
    primary_key: list[str]
    rows: list[dict[str, Any]]
    total: int
    page: int
    page_size: int


class ClearResult(BaseModel):
    table: str
    deleted: int


def _get_table(table_name: str) -> Table:
    table = Base.metadata.tables.get(table_name)
    if table is None:
        raise HTTPException(404, f"Unknown table '{table_name}'")
    return table


def _pk_columns(table: Table) -> list[str]:
    return [c.name for c in table.primary_key.columns]


@router.get("/tables")
def list_tables(db: SessionDep) -> list[TableInfo]:
    result = []
    for name, table in sorted(Base.metadata.tables.items()):
        row_count = db.execute(select(func.count()).select_from(table)).scalar_one()
        result.append(
            TableInfo(
                name=name,
                columns=[c.name for c in table.columns],
                primary_key=_pk_columns(table),
                row_count=row_count,
            )
        )
    return result


@router.get("/tables/{table_name}/rows")
def list_rows(
    table_name: str, db: SessionDep, page_info: Annotated[tuple[int, int], Depends(pagination)]
) -> RowPage:
    table = _get_table(table_name)
    page, page_size = page_info
    pk_cols = list(table.primary_key.columns) or list(table.columns)[:1]
    total = db.execute(select(func.count()).select_from(table)).scalar_one()
    stmt = select(table).order_by(*pk_cols).limit(page_size).offset((page - 1) * page_size)
    rows = [dict(r._mapping) for r in db.execute(stmt)]
    return RowPage(
        table=table_name,
        columns=[c.name for c in table.columns],
        primary_key=_pk_columns(table),
        rows=rows,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.delete("/tables/{table_name}/rows/{row_id}", status_code=204)
def delete_row(table_name: str, row_id: str, db: SessionDep) -> Response:
    table = _get_table(table_name)
    pk_cols = list(table.primary_key.columns)
    if len(pk_cols) != 1:
        raise HTTPException(400, f"Table '{table_name}' does not have a single-column primary key")
    pk_col = pk_cols[0]
    try:
        typed_id = pk_col.type.python_type(row_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, f"Invalid id '{row_id}' for primary key column '{pk_col.name}'") from exc

    affected = (
        _affected_cell_use_rows(db, table_name, [typed_id]) if table_name in _CASCADE_AWARE_TABLES else []
    )
    try:
        result = db.execute(delete(table).where(pk_col == typed_id))
        if affected:
            _reconcile_after_cell_use_removal(db, affected)
        if table_name == "cycles":
            _delete_orphaned_run_batches(db)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, f"Cannot delete row: {exc.orig}") from exc
    if result.rowcount == 0:
        raise HTTPException(404, f"No row with {pk_col.name}={row_id} in '{table_name}'")
    return Response(status_code=204)


@router.post("/tables/{table_name}/clear")
def clear_table(table_name: str, db: SessionDep) -> ClearResult:
    table = _get_table(table_name)

    affected: list[tuple[int | None, int]] = []
    if table_name in _CASCADE_AWARE_TABLES:
        pk_col = list(table.primary_key.columns)[0]
        all_ids = list(db.scalars(select(pk_col)))
        affected = _affected_cell_use_rows(db, table_name, all_ids)

    try:
        result = db.execute(delete(table))
        if affected:
            _reconcile_after_cell_use_removal(db, affected)
        if table_name == "cycles":
            _delete_orphaned_run_batches(db)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, f"Cannot clear table: {exc.orig}") from exc
    return ClearResult(table=table_name, deleted=result.rowcount)
