"""An SQLite stand-in for the MLWH tables RunNx reads, so the real queries - their joins and
filters - run in tests, not just the Python around them. Every column created here is one the
pacbio-dashboard already reads from the live warehouse. Used through the `fake_mlwh` fixture
(tests/conftest.py)."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

_DDL = [
    """CREATE TABLE pac_bio_run_well_metrics (
        id_pac_bio_rw_metrics_tmp INTEGER PRIMARY KEY,
        pac_bio_run_name TEXT, plate_number INTEGER, well_label TEXT,
        instrument_name TEXT, instrument_type TEXT,
        qc_seq_state TEXT, qc_seq_date TEXT, well_start TEXT, well_complete TEXT, run_complete TEXT,
        run_status TEXT, well_status TEXT,
        cell_id TEXT, cell_lot_number TEXT, cell_use_count INTEGER, is_cell_multi_use INTEGER,
        sequencing_kit TEXT, movie_name TEXT, movie_minutes REAL, loading_conc REAL,
        hifi_read_bases REAL, hifi_read_length_mean REAL, p0_num REAL, p1_num REAL, p2_num REAL,
        sl_hostname TEXT, sl_run_uuid TEXT)""",
    """CREATE TABLE pac_bio_product_metrics (
        id_pac_bio_pr_metrics_tmp INTEGER PRIMARY KEY, id_pac_bio_rw_metrics_tmp INTEGER, id_pac_bio_tmp INTEGER,
        hifi_read_bases REAL, hifi_bases_percent REAL, qc INTEGER)""",
    """CREATE TABLE pac_bio_run (
        id_pac_bio_tmp INTEGER PRIMARY KEY, id_sample_tmp INTEGER, pac_bio_library_tube_barcode TEXT)""",
    """CREATE TABLE sample (id_sample_tmp INTEGER PRIMARY KEY, sanger_sample_id TEXT)""",
]
_FMT = "%Y-%m-%d %H:%M:%S"


class FakeMlwh:
    def __init__(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self._next = 0
        self._next_row = 0
        with self.engine.begin() as conn:
            for ddl in _DDL:
                conn.execute(text(ddl))

    def add_well(self, *, run="TRACTION-RUN-2589", plate=1, well="A1", state="Failed, SMRT cell",
                 qc_on: datetime | None = None, start: datetime | None = None, instrument="84047",
                 instrument_type="Revio", libraries=("TRAC-2-100",),
                 members: dict[str, list[tuple[str, float]]] | None = None, **extra) -> int:
        """One SMRT-cell well. Each entry in `libraries` is one pac_bio_run row (one sample) in the
        well, as a pooled tube carries one row per member. `members` instead names each tube's
        members as (Sanger sample id, share of the cell %); the well's HiFi bases are split by
        those shares. Returns the well's row id."""
        self._next += 1
        start = start or datetime.now() - timedelta(days=2)
        qc_on = qc_on or start + timedelta(days=2)
        row = {
            "id_pac_bio_rw_metrics_tmp": self._next, "pac_bio_run_name": run, "plate_number": plate,
            "well_label": well, "instrument_name": instrument, "instrument_type": instrument_type,
            "qc_seq_state": state, "qc_seq_date": qc_on.strftime(_FMT) if state else None,
            "well_start": start.strftime(_FMT), "well_complete": (start + timedelta(hours=24)).strftime(_FMT),
            "run_complete": None, "run_status": "Complete", "well_status": "Complete",
            "cell_id": f"EA{330000 + self._next}", "cell_lot_number": "LOT1", "cell_use_count": 1,
            "is_cell_multi_use": 1, "sequencing_kit": "Revio SPRQ-Nx", "movie_name": f"m84047_{self._next}",
            "movie_minutes": 1440, "loading_conc": 250, "hifi_read_bases": 12.5e9, "hifi_read_length_mean": 15000,
            "p0_num": 30e6, "p1_num": 60e6, "p2_num": 10e6,
            "sl_hostname": "smrtlink.example.org", "sl_run_uuid": "11111111-2222",
        } | extra
        if members is None:
            members = {}
            for tube in libraries:
                members.setdefault(tube, []).append(("", 100 / len(libraries)))
        with self.engine.begin() as conn:
            conn.execute(text(f"INSERT INTO pac_bio_run_well_metrics ({', '.join(row)}) VALUES "
                              f"({', '.join(':' + k for k in row)})"), row)
            for tube, tube_members in members.items():
                for sanger_id, share in tube_members:
                    self._next_row += 1
                    rid = self._next_row
                    conn.execute(text("INSERT INTO sample VALUES (:s, :sid)"), {"s": rid, "sid": sanger_id or f"SANGER{rid}"})
                    conn.execute(text("INSERT INTO pac_bio_run VALUES (:t, :s, :b)"), {"t": rid, "s": rid, "b": tube})
                    bases = (row["hifi_read_bases"] or 0) * share / 100
                    conn.execute(text("INSERT INTO pac_bio_product_metrics (id_pac_bio_rw_metrics_tmp, id_pac_bio_tmp, "
                                      "hifi_read_bases, hifi_bases_percent, qc) VALUES (:w, :t, :b, :p, 1)"),
                                 {"w": self._next, "t": rid, "b": bases, "p": share})
        return self._next
