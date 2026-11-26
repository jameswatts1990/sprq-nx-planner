from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.common import CellType


class QcReviewMatchOut(BaseModel):
    """The RunNx run (and, when found, the cell use) an MLWH well corresponds to."""

    # "run_name": the RunNx run carries this Traction run name. "instrument_date": the RunNx run
    # has no run name, so it was matched by instrument + load day instead - worth a second look.
    by: Literal["run_name", "instrument_date"]
    run_batch_id: int
    run_label: str
    # Null when RunNx has the run but nothing in this plate/well.
    cell_use_id: int | None = None
    cell_id: int | None = None
    cell_code: str | None = None
    cell_type: CellType | None = None
    cell_status: str | None = None
    use_number: int | None = None
    use_status: str | None = None
    sample_id: int | None = None
    pool_id: str | None = None
    # False when RunNx's Pool ID for this well isn't one of the library tubes MLWH loaded there;
    # null when either side has none to compare.
    pool_matches: bool | None = None
    # Whether "Confirm fail" can run the Cell QC Fail on this use right now; when not, why.
    can_fail: bool = False
    blocked_reason: str | None = None
    # True when RunNx has no use to fail here - nothing in this plate/well, or a run it recorded as
    # completed/aborted - so the well is logged as a case without a cell instead. False while the
    # use is merely not failable *yet* (run not confirmed loaded, cell retired): fix that, then fail.
    log_instead: bool = False


class QcReviewIgnoreOut(BaseModel):
    reason: str
    ignored_by: str | None
    ignored_at: datetime


class QcReviewWellOut(BaseModel):
    """One SMRT-cell well the QC team failed in LangQC (MLWH pac_bio_run_well_metrics). MLWH's
    timestamps are passed through as recorded (no timezone)."""

    key: str
    run_name: str
    plate_number: int
    well_label: str
    instrument_name: str | None
    qc_state: str
    qc_date: datetime | None
    well_start: datetime | None
    well_complete: datetime | None
    # The SMRT cell's own barcode (MLWH cell_id), its lot, and which use of it this was.
    smrt_cell_id: str | None
    cell_lot: str | None
    cell_use_count: int | None
    is_multi_use: bool | None
    sequencing_kit: str | None
    movie_name: str | None
    movie_minutes: float | None
    loading_conc: float | None
    hifi_yield_gb: float | None
    library_barcodes: list[str]
    sample_count: int
    smrt_link_url: str | None
    match: QcReviewMatchOut | None
    ignored: QcReviewIgnoreOut | None = None


class QcReviewOut(BaseModel):
    """The QC page's QC Review queue. Always returned with a 200: MLWH being unset or unreachable
    is a state the page shows (configured / ok / error), never an API failure."""

    configured: bool
    ok: bool
    error: str | None = None
    lookback_days: int
    since: date
    pending: list[QcReviewWellOut] = []
    ignored: list[QcReviewWellOut] = []
    # Failed wells in the window that need nothing from the queue: RunNx already failed them, or
    # they were logged as a case without a cell from it.
    already_failed: int = 0
    already_logged: int = 0


class QcReviewIgnoreRequest(BaseModel):
    key: str
    reason: str
    actor: str | None = None


class QcReviewRestoreRequest(BaseModel):
    key: str
    actor: str | None = None
