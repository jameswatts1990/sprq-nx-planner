from datetime import date

from pydantic import BaseModel

from app.schemas.cell import CellOut

# Verdicts the QC modal offers. "fail" loses just the triggering acquisition's sample and
# leaves the cell open; "fail_and_stop"/"retire" take the cell out of service and re-zip the
# tray's loading queue (see services/qc_service.py).
QC_VERDICTS = ("fail", "fail_and_stop", "retire")
# Per-sample fate chosen in the disposition step.
#   lost               - no material left; goes to the Top-up list (a fresh-material request).
#   repeatable_complex - re-load straight from the leftover cleaned complex (no re-prep); the
#                        cheap repeat, offered when enough complex remains (see qc_service /
#                        the QC modal's volume readout). New in the two-way repeat split.
#   repeatable         - "repeatable from library": re-make complex from the library material
#                        held in Traction. The original single "Repeatable" option.
#   recoverable        - data recoverable; back to the backlog for review.
# The three non-"lost" values all return the sample to the backlog (repeatable_complex and
# repeatable at Repeatable(0), recoverable at Recoverable(0)) and appear in the Backlog's
# "Recoverable Samples" section.
DISPOSITIONS = ("lost", "repeatable_complex", "repeatable", "recoverable")


class AffectedSampleOut(BaseModel):
    """One sample touched by a QC verdict, with the scheduling context the disposition modal
    shows so nothing is silently affected. `role` = why it appears:
      * "failed"     - the acquisition that failed (must dispose)
      * "displaced"  - shifted off the end of the tray queue, won't load (must dispose)
      * "reassigned" - ran/will run on a different cell than planned (flag; dispose optional)
    `barcode_clash` marks a reassignment whose new cell already burned a clashing barcode."""

    sample_id: int
    pool_id: str | None
    barcodes: list[str]
    # Sanger sample IDs on this sample - the modal uses the count to tell a single (1) from a
    # pool (>1) when building the correct Traction deep-link (libraries vs pools view).
    sanger_ids: list[str]
    # Volume (uL) of cleaned complex loaded for this sample (Sample.cleaned_complex_volume, may
    # be unrecorded/None). The modal derives leftover = total - used against the configured
    # totals on QcPreviewOut to suggest / flag a "repeat from complex".
    cleaned_complex_volume: float | None
    cell_use_id: int
    use_number: int
    run_date: date | None
    instrument_serial: str | None
    plate_index: int | None
    well: str
    planned_cell_code: str | None
    actual_cell_code: str | None
    role: str
    reassigned: bool
    barcode_clash: bool
    disposition_required: bool


class QcPreviewRequest(BaseModel):
    verdict: str
    # The acquisition the verdict is anchored on. Required for fail/fail_and_stop; optional
    # for a whole-cell retire.
    cell_use_id: int | None = None


class QcPreviewOut(BaseModel):
    verdict: str
    cell_use_id: int | None
    affected_samples: list[AffectedSampleOut]
    # False when nothing needs a decision - the frontend then commits immediately without
    # the disposition step.
    requires_disposition: bool
    # Configured cleaned-complex volumes (uL) the modal derives its "repeat from complex"
    # readout from: leftover = total_complex_ul - cleaned_complex_volume, "safe" to repeat when
    # leftover >= repeat_safe_min_ul, otherwise "at risk". See settings_service /
    # engine.constants DEFAULT_TOTAL_COMPLEX_UL / DEFAULT_REPEAT_SAFE_MIN_UL.
    total_complex_ul: float
    repeat_safe_min_ul: float


class QcCommitRequest(BaseModel):
    verdict: str
    cell_use_id: int | None = None
    reason: str | None = None
    # sample_id -> disposition. Must cover exactly the samples whose disposition_required is
    # True (failed + displaced); a flagged/clash sample may also be included to escalate it.
    dispositions: dict[int, str] = {}
    actor: str | None = None


class QcCommitOut(BaseModel):
    cell: CellOut
    failed_sample_ids: list[int] = []
    displaced_sample_ids: list[int] = []
    reassigned_cell_use_ids: list[int] = []
    clash_cell_use_ids: list[int] = []
    backlog_sample_ids: list[int] = []
    created_topup_ids: list[int] = []


class QcUndoOut(BaseModel):
    cell: CellOut
    reverted_cell_use_ids: list[int] = []
    # Uses/samples whose state had drifted since the commit (e.g. a sample requeued, or a
    # top-up already sent) and so were deliberately left as-is rather than reverted.
    drifted_cell_use_ids: list[int] = []
    deleted_topup_ids: list[int] = []
