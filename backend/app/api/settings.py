"""App-wide settings endpoints. Currently just the sample defaults (the loading options
pre-filled on newly created/imported samples), surfaced/edited from the Admin panel and
read by the manual add-sample form to pre-fill its controls.

Not admin-gated: the read is needed by the ordinary add-sample form, so it lives under its
own /api/settings router rather than under the dev-only admin router."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.deps import ActorDep, SessionDep
from app.models.audit import AuditLog
from app.services.settings_service import (
    get_credit_email,
    get_insert_size_reuse_threshold,
    get_sample_defaults,
    set_credit_email,
    set_sample_defaults,
    set_scheduling_settings,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SampleDefaultsOut(BaseModel):
    adaptive_loading: str
    full_resolution_base_q: str
    base_kinetics: str
    priority: str


class SampleDefaultsUpdate(BaseModel):
    """Every field optional so the client can PATCH just what changed; omitted fields keep
    their current stored value."""

    adaptive_loading: str | None = None
    full_resolution_base_q: str | None = None
    base_kinetics: str | None = None
    priority: str | None = None


@router.get("/sample-defaults", response_model=SampleDefaultsOut)
def read_sample_defaults(db: SessionDep) -> SampleDefaultsOut:
    return SampleDefaultsOut(**get_sample_defaults(db))


@router.put("/sample-defaults", response_model=SampleDefaultsOut)
def update_sample_defaults(
    req: SampleDefaultsUpdate, db: SessionDep, actor: ActorDep
) -> SampleDefaultsOut:
    values = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        defaults = set_sample_defaults(db, values)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    db.add(
        AuditLog(
            actor=actor,
            action="update_sample_defaults",
            entity_type="app_setting",
            entity_id=0,
            details_json=values,
        )
    )
    db.commit()
    return SampleDefaultsOut(**defaults)


class CreditEmailOut(BaseModel):
    to: str
    cc: str
    subject: str
    body: str


class CreditEmailUpdate(BaseModel):
    """Every field optional so the client can send just what changed; omitted fields keep
    their current stored value."""

    to: str | None = None
    cc: str | None = None
    subject: str | None = None
    body: str | None = None


@router.get("/credit-email", response_model=CreditEmailOut)
def read_credit_email(db: SessionDep) -> CreditEmailOut:
    return CreditEmailOut(**get_credit_email(db))


@router.put("/credit-email", response_model=CreditEmailOut)
def update_credit_email(
    req: CreditEmailUpdate, db: SessionDep, actor: ActorDep
) -> CreditEmailOut:
    values = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        template = set_credit_email(db, values)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    db.add(
        AuditLog(
            actor=actor,
            action="update_credit_email",
            entity_type="app_setting",
            entity_id=0,
            # Record which fields changed, not the (potentially long) body content itself.
            details_json={"fields": sorted(values)},
        )
    )
    db.commit()
    return CreditEmailOut(**template)


class SchedulingSettingsOut(BaseModel):
    # Insert size (bp) at/below which a library is kept on a cell's first use by Auto Schedule
    # and flagged if placed on a reuse. Read by the grid/backlog card flag and the reuse warning.
    insert_size_reuse_threshold_bp: int


class SchedulingSettingsUpdate(BaseModel):
    """Optional so the client can send just what changed; omitted fields keep their stored value."""

    insert_size_reuse_threshold_bp: int | None = None


@router.get("/scheduling", response_model=SchedulingSettingsOut)
def read_scheduling_settings(db: SessionDep) -> SchedulingSettingsOut:
    return SchedulingSettingsOut(insert_size_reuse_threshold_bp=get_insert_size_reuse_threshold(db))


@router.put("/scheduling", response_model=SchedulingSettingsOut)
def update_scheduling_settings(
    req: SchedulingSettingsUpdate, db: SessionDep, actor: ActorDep
) -> SchedulingSettingsOut:
    values = {k: str(v) for k, v in req.model_dump().items() if v is not None}
    try:
        set_scheduling_settings(db, values)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    db.add(
        AuditLog(
            actor=actor,
            action="update_scheduling_settings",
            entity_type="app_setting",
            entity_id=0,
            details_json=values,
        )
    )
    db.commit()
    return SchedulingSettingsOut(insert_size_reuse_threshold_bp=get_insert_size_reuse_threshold(db))
