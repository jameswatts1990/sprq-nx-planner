"""App-wide settings endpoints. Currently just the sample defaults (the loading options
pre-filled on newly created/imported samples), surfaced/edited from the Admin panel and
read by the manual add-sample form to pre-fill its controls.

Not admin-gated: the read is needed by the ordinary add-sample form, so it lives under its
own /api/settings router rather than under the dev-only admin router."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.deps import ActorDep, SessionDep
from app.engine.constants import (
    CELL_LIFETIME_H,
    CELL_MAX_USES,
    CELLS_PER_TRAY,
    LOCK_BUFFER_HOURS,
    MOVIE_HOURS_CHOICES,
    REUSE_PREP_H,
    WELLS,
)
from app.models.audit import AuditLog
from app.services.cell_timing import PPA_H, PPA_LANES, PREP_H, SEQ_LANES, STAGGER_H
from app.services.settings_service import (
    get_credit_email,
    get_day_start_hour,
    get_default_movie_hours,
    get_insert_size_reuse_threshold,
    get_movie_cell_position,
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
    # Default hour (UTC, 0-23) a run loads - seeds the Schedule grid's load-time dial.
    day_start_hour: int
    # Movie length (h) assumed when a sample's own is missing (one of MOVIE_HOURS_CHOICES).
    default_movie_hours: int
    # movie length -> carousel cell position (within_tray_pos 0-3) it's confined to under Auto
    # Schedule; null = any cell. One entry per movie choice. JSON object keys are strings.
    movie_cell_position: dict[int, int | None]


class SchedulingSettingsUpdate(BaseModel):
    """Optional so the client can send just what changed; omitted fields keep their stored value."""

    insert_size_reuse_threshold_bp: int | None = None
    day_start_hour: int | None = None
    default_movie_hours: int | None = None
    movie_cell_position: dict[int, int | None] | None = None


def _scheduling_out(db: SessionDep) -> SchedulingSettingsOut:
    return SchedulingSettingsOut(
        insert_size_reuse_threshold_bp=get_insert_size_reuse_threshold(db),
        day_start_hour=get_day_start_hour(db),
        default_movie_hours=get_default_movie_hours(db),
        movie_cell_position=get_movie_cell_position(db),
    )


@router.get("/scheduling", response_model=SchedulingSettingsOut)
def read_scheduling_settings(db: SessionDep) -> SchedulingSettingsOut:
    return _scheduling_out(db)


@router.put("/scheduling", response_model=SchedulingSettingsOut)
def update_scheduling_settings(
    req: SchedulingSettingsUpdate, db: SessionDep, actor: ActorDep
) -> SchedulingSettingsOut:
    # Each field is stored as text; the map is JSON-encoded (its keys back to strings) before the
    # service validates/canonicalizes it. Scalars stringify directly.
    values: dict[str, str] = {}
    if req.insert_size_reuse_threshold_bp is not None:
        values["insert_size_reuse_threshold_bp"] = str(req.insert_size_reuse_threshold_bp)
    if req.day_start_hour is not None:
        values["day_start_hour"] = str(req.day_start_hour)
    if req.default_movie_hours is not None:
        values["default_movie_hours"] = str(req.default_movie_hours)
    if req.movie_cell_position is not None:
        values["movie_cell_position"] = json.dumps({str(k): v for k, v in req.movie_cell_position.items()})
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
    return _scheduling_out(db)


class TimingLadderOut(BaseModel):
    """The vendor-derived per-cell instrument timing constants (services/cell_timing.py)."""

    prep_h: float
    reuse_prep_h: float
    stagger_h: float
    ppa_h: float
    seq_lanes: int
    ppa_lanes: int
    lock_buffer_h: int


class SchedulingFactsOut(BaseModel):
    """Read-only instrument/scheduling facts: the vendor-locked or physical constants the app
    enforces (108h window, 3-use cap, tray-of-4, deck wells, movie-length values, timing ladder).
    Surfaced so an instance owner can see the rules without being able to edit them - the Settings
    'Instrument & scheduling facts' card renders these, never forking the values."""

    cell_lifetime_h: int
    cell_max_uses: int
    cells_per_tray: int
    wells: list[str]
    movie_hours_choices: list[int]
    timing: TimingLadderOut


@router.get("/facts", response_model=SchedulingFactsOut)
def read_scheduling_facts() -> SchedulingFactsOut:
    return SchedulingFactsOut(
        cell_lifetime_h=CELL_LIFETIME_H,
        cell_max_uses=CELL_MAX_USES,
        cells_per_tray=CELLS_PER_TRAY,
        wells=list(WELLS),
        movie_hours_choices=list(MOVIE_HOURS_CHOICES),
        timing=TimingLadderOut(
            prep_h=PREP_H,
            reuse_prep_h=REUSE_PREP_H,
            stagger_h=STAGGER_H,
            ppa_h=PPA_H,
            seq_lanes=SEQ_LANES,
            ppa_lanes=PPA_LANES,
            lock_buffer_h=LOCK_BUFFER_HOURS,
        ),
    )
