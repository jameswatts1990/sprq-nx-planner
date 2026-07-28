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
from app.services.settings_service import get_sample_defaults, set_sample_defaults

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
