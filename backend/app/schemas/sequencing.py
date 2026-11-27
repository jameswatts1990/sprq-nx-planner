"""What MLWH recorded about RunNx's runs and samples: a run's per-well results (with where they
disagree with the plan), a sample's sequencing history, and the Stats reuse tiles. Every response
is a 200 carrying configured / ok / error, so a page can say MLWH is unset or unreachable without
anything else on it failing. MLWH's timestamps are passed through as recorded (no timezone)."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

FlagKind = Literal["pool_differs", "movie_differs", "use_differs", "cell_differs", "not_in_plan"]


class MlwhAvailability(BaseModel):
    configured: bool
    ok: bool = False
    error: str | None = None


class SequencingFlagOut(BaseModel):
    """Where MLWH's record of a well disagrees with RunNx's plan. A warning, never a block."""

    kind: FlagKind
    label: str
    detail: str


class MlwhWellFactsOut(BaseModel):
    """One SMRT-cell well as MLWH recorded it."""

    qc_state: str | None  # LangQC's verdict; null while there's none yet
    qc_date: datetime | None
    well_start: datetime | None
    well_complete: datetime | None
    run_status: str | None
    well_status: str | None
    smrt_cell_id: str | None
    cell_lot: str | None
    cell_use_count: int | None
    is_multi_use: bool | None
    sequencing_kit: str | None
    movie_name: str | None
    movie_minutes: float | None
    loading_conc: float | None
    hifi_yield_gb: float | None
    hifi_read_length_kb: float | None
    p1_pct: float | None
    library_barcodes: list[str]
    sample_count: int


class RunSequencingWellOut(BaseModel):
    """One well of a run: RunNx's use and MLWH's record of it, side by side. Either side can be
    missing - a use MLWH hasn't recorded yet, or a cell MLWH recorded where RunNx planned nothing."""

    key: str
    plate_number: int
    # RunNx's own well name (A01-D02) when it has a use here, else Traction's (A1-D1).
    well: str
    cell_use_id: int | None = None
    cell_id: int | None = None
    cell_code: str | None = None
    use_number: int | None = None
    sample_id: int | None = None
    pool_id: str | None = None
    planned_hours: int | None = None
    planned_oplc: float | None = None
    mlwh: MlwhWellFactsOut | None = None
    flags: list[SequencingFlagOut] = []


class RunSequencingOut(MlwhAvailability):
    """GET /api/cycles/{run_id}/sequencing."""

    # "run_name": found by the run's Traction run name. "instrument_date": the run has no name, so
    # its wells were matched by instrument + load day - worth a second look. Null: nothing found.
    matched_by: Literal["run_name", "instrument_date"] | None = None
    mlwh_run_name: str | None = None
    smrt_link_url: str | None = None
    wells: list[RunSequencingWellOut] = []


class SequencingMemberOut(BaseModel):
    """One sample in a pooled loading: what it got out of the cell."""

    sanger_sample_id: str | None
    hifi_gb: float | None
    pct_of_cell: float | None
    # Under 85% of an even share of the pool (the pacbio-dashboard's rule).
    below_even: bool = False
    # One of the sample's own Sanger IDs (marks it in a pool found under another tube).
    mine: bool = False


class SequencingLoadingOut(BaseModel):
    """One SMRT cell a library tube was loaded on, as MLWH recorded it."""

    key: str
    run_name: str
    run_id: int | None  # the RunNx run, when RunNx has one by that Traction name
    plate_number: int
    well_label: str
    run_date: date | None
    tube: str
    # Set when the loading was found through one of the sample's Sanger IDs under ANOTHER tube.
    via_other_tube: bool = False
    loading_conc: float | None
    tube_hifi_gb: float | None
    cell_hifi_gb: float | None
    pct_of_cell: float | None  # the tube's share of the cell's HiFi
    # What THIS sample got: the tube's figures for its own tube, its own members' share when the
    # loading was found through a Sanger ID under another tube.
    own_hifi_gb: float | None = None
    own_pct_of_cell: float | None = None
    plex: int
    hifi_read_length_kb: float | None
    qc_state: str | None
    movie_minutes: float | None
    smrt_link_url: str | None
    members: list[SequencingMemberOut] = []


class SequencingSummaryOut(BaseModel):
    """The highlights of a sample's sequencing history."""

    cells: int
    hifi_gb: float
    last_run_name: str | None = None
    last_run_date: date | None = None
    last_well: str | None = None
    last_loading_conc: float | None = None
    last_hifi_gb: float | None = None
    last_pct_of_cell: float | None = None
    last_plex: int | None = None
    last_qc_state: str | None = None


class SequencingSummariesOut(MlwhAvailability):
    """GET /api/samples/sequencing-history - summaries for a page of samples, keyed by sample id."""

    samples: dict[int, SequencingSummaryOut] = {}


class SequencingHistoryOut(MlwhAvailability):
    """GET /api/samples/{sample_id}/sequencing-history - one sample's loadings, oldest first."""

    summary: SequencingSummaryOut | None = None
    loadings: list[SequencingLoadingOut] = []


class UseOutcomeOut(BaseModel):
    use: int
    cells: int
    median_hifi_gb: float | None
    median_p1_pct: float | None


class SequencingStatsOut(MlwhAvailability):
    """GET /api/stats/sequencing - HiFi yield and P1 loading by Use 1/2/3, for the runs in range
    that carry a Traction run name."""

    runs_named: int = 0
    runs_total: int = 0
    by_use: list[UseOutcomeOut] = []
