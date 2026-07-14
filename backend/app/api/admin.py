"""Dev-only raw database inspection/mutation tools.

Not gated by environment - remove or gate this router explicitly before a
real production launch (see CLAUDE.md "Help Tab Maintenance" /
sprq-nx-planner Admin notes).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import Table, delete, func, select
from sqlalchemy.exc import IntegrityError

from app import models  # noqa: F401  ensures every model is registered on Base.metadata
from app.api.deps import SessionDep, pagination
from app.db import Base

router = APIRouter(prefix="/api/admin", tags=["admin"])


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
    try:
        result = db.execute(delete(table).where(pk_col == typed_id))
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
    try:
        result = db.execute(delete(table))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, f"Cannot clear table: {exc.orig}") from exc
    return ClearResult(table=table_name, deleted=result.rowcount)
