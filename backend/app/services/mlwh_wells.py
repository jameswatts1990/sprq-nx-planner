"""SMRT-cell wells read from MLWH, and how each one is matched to the RunNx run and use it was
loaded as. Shared by QC Review (qc_review.py), run results (run_sequencing.py), sequencing history
(sequencing_history.py) and the Stats reuse tiles (sequencing_stats.py).

Every MLWH read goes through `fetch()`, which protects RunNx from the warehouse being slow, down or
asked the same thing over and over (RunNx runs ONE uvicorn process, so one in-process cache is
shared by every user):
- a result is cached for a TTL, so the Today page polling QC Review in several tabs, or a run's
  page and its slot popover, cost MLWH one query between them;
- only one query per key runs at a time (single-flight); the others wait for its answer;
- after a failure every read answers with that failure straight away for RETRY_AFTER_S, so an
  unreachable MLWH costs one connect timeout a minute instead of one per page view. `refresh=True`
  (the UI's Retry / Refresh) always tries.

Callers must not hold a RunNx transaction while they wait on MLWH: read RunNx's inputs, call
`db.rollback()` to hand the connection back to RunNx's small pool, then fetch.

Follows the pacbio-dashboard's reading of the warehouse:
- a well is keyed run|plate|well, because both plates of a Revio run label their wells A1-D1;
- Sequel wells are left out;
- P1 % is p1 / (p0 + p1 + p2), never / productive_zmws_num (which reads up to 129% on some wells);
- a pooled tube has one pac_bio_run row per member, so tubes are read at product grain and
  collapsed in Python - never GROUP_CONCAT, which truncates silently on a 96-plex well.
"""
from __future__ import annotations

import re
import threading
from collections import defaultdict
from collections.abc import Callable, Hashable, Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from time import monotonic
from typing import TypeVar

from sqlalchemy import Engine, bindparam, select, text
from sqlalchemy.orm import Session, selectinload

from app.models.cell import Cell
from app.models.schedule import CellUse, Cycle, RunBatch
from app.services import mlwh

T = TypeVar("T")

# How long every MLWH read answers "unreachable" after a failure before trying again.
RETRY_AFTER_S = 60
# IN-lists are sent in chunks of this many values.
CHUNK = 500
# Most results kept at once; the soonest to expire goes first.
MAX_CACHED = 500

# --- Reading wells ---------------------------------------------------------------------------

# The well columns every feature reads, all ones the pacbio-dashboard already reads live.
_WELL_COLUMNS = {
    "well_pk": "m.id_pac_bio_rw_metrics_tmp",
    "run_name": "m.pac_bio_run_name",
    "plate_number": "m.plate_number",
    "well_label": "m.well_label",
    "instrument_name": "m.instrument_name",
    "qc_state": "m.qc_seq_state",
    "qc_date": "m.qc_seq_date",
    "well_start": "m.well_start",
    "well_complete": "m.well_complete",
    "run_status": "m.run_status",
    "well_status": "m.well_status",
    "smrt_cell_id": "m.cell_id",
    "cell_lot": "m.cell_lot_number",
    "cell_use_count": "m.cell_use_count",
    "is_multi_use": "m.is_cell_multi_use",
    "sequencing_kit": "m.sequencing_kit",
    "movie_name": "m.movie_name",
    "movie_minutes": "m.movie_minutes",
    "loading_conc": "m.loading_conc",
    "hifi_read_bases": "m.hifi_read_bases",
    "hifi_read_length_mean": "m.hifi_read_length_mean",
    "p0_num": "m.p0_num",
    "p1_num": "m.p1_num",
    "p2_num": "m.p2_num",
    "sl_hostname": "m.sl_hostname",
    "sl_run_uuid": "m.sl_run_uuid",
}

# The library tubes (and samples) loaded in each well, at product grain.
_TUBES_SQL = text(
    """
    SELECT DISTINCT p.id_pac_bio_rw_metrics_tmp AS well_pk,
           r.pac_bio_library_tube_barcode       AS tube,
           r.id_sample_tmp                      AS sample
    FROM pac_bio_product_metrics p
    JOIN pac_bio_run r ON r.id_pac_bio_tmp = p.id_pac_bio_tmp
    WHERE p.id_pac_bio_rw_metrics_tmp IN :pks
    """
).bindparams(bindparam("pks", expanding=True))


def run_key(name: str | None) -> str | None:
    """A Traction run name, normalised so the name the lab typed into RunNx matches MLWH's:
    case and spacing are ignored, and "TRACTION-RUN-1234", "traction run 1234" and a bare "1234"
    are all the same run."""
    s = " ".join((name or "").split()).upper()
    if not s:
        return None
    m = re.fullmatch(r"(?:TRACTION[-_ ]?RUN[-_ ]?)?0*(\d+)", s)
    return f"TRACTION-RUN-{m.group(1)}" if m else s


def well_key(run_name: str, plate_number: int, well_label: str) -> str:
    """A well's identity across RunNx and MLWH: "<Traction run name>|<plate>|<well>". Not MLWH's
    row id, which the warehouse documents as liable to change."""
    return f"{run_name.strip()}|{plate_number}|{well_label.strip().upper()}"


@dataclass
class MlwhWell:
    run_name: str
    plate_number: int
    well_label: str
    instrument_name: str | None
    # LangQC's verdict; "" while there's none yet.
    qc_state: str
    qc_date: datetime | None
    well_start: datetime | None
    well_complete: datetime | None
    smrt_cell_id: str | None
    cell_lot: str | None
    cell_use_count: int | None
    is_multi_use: bool | None
    sequencing_kit: str | None
    movie_name: str | None
    movie_minutes: float | None
    loading_conc: float | None
    hifi_read_bases: float | None
    sl_hostname: str | None
    sl_run_uuid: str | None
    run_status: str | None = None
    well_status: str | None = None
    hifi_read_length_mean: float | None = None
    p1_pct: float | None = None
    well_pk: int | None = None
    # Library tube barcode -> the MLWH sample ids loaded from it in this well.
    tubes: dict[str, set[int]] = field(default_factory=dict)

    @property
    def key(self) -> str:
        return well_key(self.run_name, self.plate_number, self.well_label)

    @property
    def start_day(self) -> date | None:
        moment = self.well_start or self.well_complete
        return moment.date() if moment else None

    @property
    def library_barcodes(self) -> list[str]:
        return sorted(self.tubes)

    @property
    def sample_count(self) -> int:
        return len(set().union(*self.tubes.values())) if self.tubes else 0

    @property
    def hifi_yield_gb(self) -> float | None:
        return round(self.hifi_read_bases / 1e9, 2) if self.hifi_read_bases is not None else None


def _dt(value) -> datetime | None:
    """MySQL hands back datetimes; the SQLite stand-in the tests use hands back strings."""
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _num(value) -> float | None:
    """MySQL hands DECIMAL columns back as Decimal; the API wants plain numbers."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _str(value) -> str | None:
    s = str(value).strip() if value is not None else ""
    return s or None


def p1_percent(p0, p1, p2) -> float | None:
    """P1 loading %: the share of the P0+P1+P2 partition that single-loaded."""
    parts = [_num(v) for v in (p0, p1, p2)]
    if any(v is None for v in parts) or sum(parts) <= 0:
        return None
    return round(parts[1] / sum(parts) * 100, 1)


def _well_from_row(row) -> MlwhWell:
    multi = row["is_multi_use"]
    use_count = row["cell_use_count"]
    return MlwhWell(
        well_pk=row["well_pk"],
        run_name=_str(row["run_name"]) or "",
        plate_number=int(row["plate_number"] or 1),
        well_label=(_str(row["well_label"]) or "").upper(),
        instrument_name=_str(row["instrument_name"]),
        qc_state=_str(row["qc_state"]) or "",
        qc_date=_dt(row["qc_date"]),
        well_start=_dt(row["well_start"]),
        well_complete=_dt(row["well_complete"]),
        run_status=_str(row["run_status"]),
        well_status=_str(row["well_status"]),
        smrt_cell_id=_str(row["smrt_cell_id"]),
        cell_lot=_str(row["cell_lot"]),
        cell_use_count=int(use_count) if use_count is not None else None,
        is_multi_use=bool(multi) if multi is not None else None,
        sequencing_kit=_str(row["sequencing_kit"]),
        movie_name=_str(row["movie_name"]),
        movie_minutes=_num(row["movie_minutes"]),
        loading_conc=_num(row["loading_conc"]),
        hifi_read_bases=_num(row["hifi_read_bases"]),
        hifi_read_length_mean=_num(row["hifi_read_length_mean"]),
        p1_pct=p1_percent(row["p0_num"], row["p1_num"], row["p2_num"]),
        sl_hostname=_str(row["sl_hostname"]),
        sl_run_uuid=_str(row["sl_run_uuid"]),
    )


def chunks(values: Iterable[T], size: int = CHUNK) -> list[list[T]]:
    items = list(values)
    return [items[i : i + size] for i in range(0, len(items), size)]


def fetch_wells(
    engine: Engine,
    where: str,
    params: dict,
    *,
    expanding: tuple[str, ...] = (),
    order_by: str = "m.well_start",
) -> list[MlwhWell]:
    """The Revio wells matching `where` (an SQL condition on `m`, pac_bio_run_well_metrics, with
    bound parameters; `expanding` names the ones that are IN-lists), with the library tubes each
    loaded. Raises on any MLWH failure. Every caller should reach this through `fetch()`."""
    columns = ", ".join(f"{expr} AS {name}" for name, expr in _WELL_COLUMNS.items())
    sql = text(
        f"SELECT {columns} FROM pac_bio_run_well_metrics m"
        f" WHERE ({where}) AND COALESCE(m.instrument_type, '') NOT LIKE :sequel_pattern"
        f" ORDER BY {order_by}"
    ).bindparams(*(bindparam(name, expanding=True) for name in expanding))
    with engine.connect() as conn:
        rows = conn.execute(sql, {**params, "sequel_pattern": "Sequel%"}).mappings().all()
        wells = [_well_from_row(r) for r in rows]
        by_pk = {w.well_pk: w for w in wells}
        for pks in chunks(by_pk):
            for row in conn.execute(_TUBES_SQL, {"pks": pks}).mappings():
                barcode = _str(row["tube"])
                if barcode:
                    by_pk[row["well_pk"]].tubes.setdefault(barcode, set()).add(row["sample"])
    return [w for w in wells if w.run_name and w.well_label]


def smrt_link_url(well: MlwhWell) -> str | None:
    """SMRT Link's own page for the run: its server (read from MLWH - more than one is in use)
    and its SMRT Link run uuid, which is not Traction's run uuid."""
    if not well.sl_hostname or not well.sl_run_uuid:
        return None
    return f"https://{well.sl_hostname}:8243/sl/runs/{well.sl_run_uuid}"


# --- The guarded read: cache, single-flight, circuit breaker ----------------------------------


class MlwhUnavailable(Exception):
    """MLWH couldn't be read (or failed within the last RETRY_AFTER_S). The message is one a user
    can act on, never including the password."""


class _Flight:
    def __init__(self) -> None:
        self.done = threading.Event()
        self.value = None
        self.error: str | None = None


_lock = threading.Lock()
_cache: dict[Hashable, tuple[float, object]] = {}
_inflight: dict[Hashable, _Flight] = {}
_down: tuple[float, str] | None = None  # (until, message) while the circuit is open


def engine() -> Engine:
    """Seam for the tests, which stand an SQLite copy of the MLWH tables in for the warehouse."""
    return mlwh.get_engine()


def reset() -> None:
    """Forget every cached result and any recent failure (tests; never needed in the app)."""
    global _down
    with _lock:
        _cache.clear()
        _inflight.clear()
        _down = None


def fetch(key: Hashable, read: Callable[[Engine], T], *, ttl: float | Callable[[T], float], refresh: bool = False) -> T:
    """`read(engine)` - one MLWH read - through the cache. `ttl` is seconds, or a function of the
    result (a finished run's results can be kept longer than a running one's). Raises
    MlwhUnavailable on failure, including for RETRY_AFTER_S after any failure unless `refresh`."""
    global _down
    now = monotonic()
    with _lock:
        if not refresh:
            cached = _cache.get(key)
            if cached and cached[0] > now:
                return cached[1]  # type: ignore[return-value]
            if _down and _down[0] > now:
                raise MlwhUnavailable(_down[1])
        flight = _inflight.get(key)
        leader = flight is None
        if leader:
            flight = _inflight[key] = _Flight()
    assert flight is not None
    if not leader:
        # Someone is already asking MLWH this; their answer is ours.
        flight.done.wait(timeout=mlwh.CONNECT_TIMEOUT_S + mlwh.READ_TIMEOUT_S + 5)
        if flight.error is not None or not flight.done.is_set():
            raise MlwhUnavailable(flight.error or "MLWH took too long to answer.")
        return flight.value  # type: ignore[return-value]

    try:
        value = read(engine())
    except Exception as exc:  # noqa: BLE001 - a bad URL, DNS, TLS, auth or SQL error is a state to show
        message = mlwh.error_message(exc)
        with _lock:
            _down = (monotonic() + RETRY_AFTER_S, message)
        flight.error = message
        raise MlwhUnavailable(message) from exc
    else:
        lifetime = ttl(value) if callable(ttl) else ttl
        with _lock:
            stamp = monotonic()
            for stale in [k for k, (until, _) in _cache.items() if until <= stamp]:
                del _cache[stale]
            if len(_cache) >= MAX_CACHED:
                del _cache[min(_cache, key=lambda k: _cache[k][0])]
            _cache[key] = (stamp + lifetime, value)
            _down = None
        flight.value = value
        return value
    finally:
        with _lock:
            _inflight.pop(key, None)
        flight.done.set()


# --- Matching MLWH wells to RunNx -------------------------------------------------------------

# Matching an unnamed RunNx run by instrument: its load day may be up to this many days before the
# well started (cells prep for up to ~38 h after loading; a reuse Plate 2 waits for Plate 1).
UNNAMED_RUN_MAX_LEAD_DAYS = 3

# Everything matching, Use numbering and the cell-identity check read from a run: its uses' samples
# and cells, and each cell's other uses down to the run they were on.
RUN_OPTIONS = (
    selectinload(RunBatch.instrument),
    selectinload(RunBatch.cycles).selectinload(Cycle.cell_uses).selectinload(CellUse.sample),
    selectinload(RunBatch.cycles)
    .selectinload(Cycle.cell_uses)
    .selectinload(CellUse.cell)
    .selectinload(Cell.cell_uses)
    .selectinload(CellUse.cycle)
    .selectinload(Cycle.run_batch),
)


def load_runs(db: Session, earliest: date, *, instrument_serial: str | None = None, latest: date | None = None) -> list[RunBatch]:
    """The RunNx runs loaded from `earliest` (to `latest`), optionally on one instrument, with
    everything matching and Use numbering read."""
    stmt = select(RunBatch).where(RunBatch.load_date >= earliest).options(*RUN_OPTIONS)
    if latest is not None:
        stmt = stmt.where(RunBatch.load_date <= latest)
    if instrument_serial is not None:
        from app.models.instrument import Instrument

        stmt = stmt.join(RunBatch.instrument).where(Instrument.serial_number == instrument_serial)
    return list(db.scalars(stmt))


def use_at(run: RunBatch, plate_number: int, well_label: str) -> CellUse | None:
    """The use in this plate/well of a RunNx run. Traction's well is the RunNx well's row letter
    on that plate (both a fresh A02 and a reuse A01 on Plate 2 are Traction's Plate 2 A1)."""
    letter = well_label[:1].upper()
    plate = next((c for c in run.cycles if c.plate_index == plate_number), None)
    if plate is None or not letter:
        return None
    uses = [cu for cu in plate.cell_uses if cu.well[:1].upper() == letter]
    # A cancelled use is a Stop-cell "Blocked" marker, not something that loaded.
    return next((cu for cu in uses if cu.status != "cancelled"), None)


class RunIndex:
    def __init__(self, runs: list[RunBatch]) -> None:
        self.by_name: dict[str, list[RunBatch]] = defaultdict(list)
        self.unnamed_by_instrument: dict[str, list[RunBatch]] = defaultdict(list)
        for run in runs:
            key = run_key(run.run_name)
            if key:
                self.by_name[key].append(run)
            elif run.instrument is not None:
                self.unnamed_by_instrument[run.instrument.serial_number.strip().upper()].append(run)

    def match(self, well: MlwhWell) -> tuple[RunBatch, CellUse | None, str] | None:
        """The RunNx run (and use) for a well: by Traction run name; failing that, a RunNx run
        that has no run name, on the same instrument, loaded up to a few days before the well
        started (the latest such run - the one on the instrument at the time)."""
        named = self.by_name.get(run_key(well.run_name) or "", [])
        if named:
            for run in named:
                use = use_at(run, well.plate_number, well.well_label)
                if use is not None:
                    return run, use, "run_name"
            return named[0], None, "run_name"
        if not well.instrument_name or well.start_day is None:
            return None
        lead = timedelta(days=UNNAMED_RUN_MAX_LEAD_DAYS)
        candidates = [
            run
            for run in self.unnamed_by_instrument.get(well.instrument_name.strip().upper(), [])
            if well.start_day - lead <= run.load_date <= well.start_day
        ]
        if not candidates:
            return None
        run = max(candidates, key=lambda r: r.load_date)
        return run, use_at(run, well.plate_number, well.well_label), "instrument_date"


def run_ids_by_key(db: Session) -> dict[str, int]:
    """Traction run key -> RunNx run id, for every named RunNx run: a slim column query (no ORM
    graph), so linking MLWH loadings back to RunNx stays cheap however many runs there are."""
    out: dict[str, int] = {}
    for run_id, name in db.execute(select(RunBatch.id, RunBatch.run_name).where(RunBatch.run_name.is_not(None))):
        key = run_key(name)
        if key and key not in out:
            out[key] = run_id
    return out
