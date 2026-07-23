"""Single source of truth for the lab's "sequencing tracker" Google Sheet layout.

Both the schedule CSV export and the tracker import read this so their column order
and header strings can never drift apart. The layout is 56 columns wide, including one
blank separator column (index 49) and one trailing unnamed column (index 55) that the
sheet uses for a TRUE/FALSE flag. Nine headers contain embedded newlines (e.g.
"Library Size\n(bp)"); these MUST be reproduced verbatim on export, which is why the
header strings live here as literals rather than being reconstructed.

Scope is intentionally P1-only: the app persists ~14 of these 56 fields. Every other
column is emitted header-present / value-blank on export and ignored on import.
"""
from __future__ import annotations

import re

# --- field keys for the columns the app actually stores -------------------------------
# Used as the link between a header position and a Sample/run field. Columns with key
# None are structural or out-of-scope and always export blank.
K_DATE_RUN_STARTED = "date_run_started"
K_TRACTION_RUN_ID = "traction_run_id"
K_INSTRUMENT = "instrument"
K_PLATE_ID = "plate_id"
K_TRACTION_ID = "traction_id"
K_SANGER = "sanger"
K_POOL_ID = "pool_id"
K_PORTION = "portion_of_smrt_cell"
K_SEQ_COMMENTS = "sequencing_comments"
K_CELL_LOCATION = "cell_location"
K_RUN_TIME = "run_time_hr"
K_TARGET_OPLC = "target_oplc"
K_BARCODES = "barcodes"
K_LOADING_CONC = "loading_conc"
K_CCS_KINETICS = "ccs_kinetics"
K_STATUS = "status"
K_PRIORITY = "priority"

# The barcodes currently live in the column headed "Complex Batch ID" — a temporary
# stopgap the lab uses because the sheet has no dedicated barcode column. Isolated here
# so that relabelling later (or moving to a real "Barcodes" column) is a one-line change.
TRACKER_BARCODE_HEADER = "Complex Batch ID"

# --- the layout: ordered (header, field-key) pairs, verbatim ---------------------------
TRACKER_COLUMNS: list[tuple[str, str | None]] = [
    ("Date run started", K_DATE_RUN_STARTED),
    ("Traction Run ID", K_TRACTION_RUN_ID),
    ("Instrument", K_INSTRUMENT),
    ("Run Count", None),
    ("Plate ID", K_PLATE_ID),
    ("Traction ID", K_TRACTION_ID),
    ("Sanger Sample ID", K_SANGER),
    ("Pool ID", K_POOL_ID),
    ("Portion of SMRT Cell", K_PORTION),
    ("Plate Number", None),
    ("cell location", K_CELL_LOCATION),
    ("Run Time (hr)", K_RUN_TIME),
    ("Pre Extention time (Mins)", None),
    ("Polymerase Kit Version", None),
    ("Auto Batch ID", None),
    ("Sequencing Comments", K_SEQ_COMMENTS),
    ("Target Loading Concentration (pM)", K_TARGET_OPLC),
    (TRACKER_BARCODE_HEADER, K_BARCODES),
    ("User ID (Complexes)", None),
    ("Library Volume Taken for Complex (uL)", None),
    ("Library Type", None),
    ("Library Size\n(bp)", None),
    ("Complex Pre Cleanup QC\n(ng/ul)", None),
    ("Complex Post Cleanup QC\n(ng/ul)", None),
    ("Complex\nRecovery\n(%)", None),
    ("Date Complex Complete", None),
    ("Date Complex Clean", None),
    ("Complex Status", None),
    ("Complex Volume\n(uL)", None),
    ("Max possible Loading Conc.\n(pM)", None),
    ("Loading Conc.\n(pM)", K_LOADING_CONC),
    ("Cleaned complex volume for desired OPLC (uL)", None),
    ("Loading buffer volume (uL)", None),
    ("Volume of Control Dilution 3 (uL)", None),
    ("Instrument Loader", None),
    ("CCS Output Include Kinetics Information", K_CCS_KINETICS),
    ("CCS Output Include Low Quality Reads", None),
    ("Include 5mC Calls In CpG Motifs", None),
    ("Run Comments", None),
    ("Well Status \n(From LangQC)", None),
    ("PacBio Case ID", None),
    ("Reason for Failure", None),
    ("Credit Status", None),
    ("Credit Comments", None),
    ("Study ID", None),
    ("Cost Code", None),
    ("Date Charged \n(Month/Year)", None),
    ("Charging Status", None),
    ("Charging Comments", None),
    ("", None),  # blank separator column (index 49)
    ("Status", K_STATUS),
    ("Prioity", K_PRIORITY),  # [sic] - the sheet misspells "Priority"
    ("Date in Progress", None),
    ("Date Pending", None),
    ("Charge Name", None),
    ("", None),  # trailing unnamed TRUE/FALSE flag column (index 55)
]

# The exact header row, in order — used verbatim as the first CSV line on export.
TRACKER_HEADER: list[str] = [header for header, _ in TRACKER_COLUMNS]


def normalize_header(header: str) -> str:
    """Collapse whitespace (incl. the embedded newlines) and lowercase, so import can match
    a header regardless of how the sheet wrapped it. "Loading Conc.\\n(pM)" -> "loading conc. (pm)"."""
    return re.sub(r"\s+", " ", header).strip().lower()


# normalized-header -> field key, for the columns the importer reads. Built from
# TRACKER_COLUMNS so it stays in lockstep with the export layout.
TRACKER_KEY_BY_HEADER: dict[str, str] = {
    normalize_header(header): key for header, key in TRACKER_COLUMNS if key is not None and header
}
