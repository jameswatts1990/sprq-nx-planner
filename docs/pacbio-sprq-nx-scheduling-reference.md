# PacBio SPRQ-Nx / Revio scheduling reference

Distilled from PacBio's *Technical overview: Revio system v13.5 + SPRQ-Nx chemistry and SMRT Link v26.1* (PN 103-849-300 Rev 01, May 2026 — PacBio confidential vendor material; the PDF itself is not checked into this repo). This file captures the engineering-relevant facts only, mapped onto this app's actual entities, for whoever next touches cell-reuse or scheduling logic.

Page numbers below refer to that source deck.

## Vocabulary map

| PacBio term | This app's term | Notes |
|---|---|---|
| Acquisition (one load-and-sequence event) | `CellUse` | one sample, one cell, one well, one run — `models/schedule.py` |
| Multi-use SMRT Cell | `Cell` | `code`, `max_uses`, `status`, `first_use_started_at`, `window_breached` — `models/cell.py` |
| "Use 1 / 2 / 3" | consumed `CellUse` rows for a `Cell` | derived live in `derive_cell_state()`, never hand-entered — `services/cell_service.py` |
| SMRT Cell tray (4 cells) | not a modeled entity | no cost/KPI-grouping code exists today — the original `engine/kpis.py` port from `revio-nx-planner.html` was removed as dead code (never wired to any router/service); see the "Numbers" section below if reintroducing it |
| One instrument, one calendar day | `RunBatch` | unique on `(instrument_id, run_date)` |
| A run's timing/status, up to 4 wells | `Cycle` (DB model, `models/schedule.py`) | 1:1 with `RunBatch`. Don't confuse with `engine/types.py`'s internal `Cycle` dataclass — that's a private, never-persisted scheduling-batch type from the porting of `revio-nx-planner.html` |
| Expired cell, auto-discarded, unusable | `Cell.status == "window_expired"` | sticky once flagged |
| No acquisitions left on a cell | `Cell.status == "exhausted"` | derived, `remaining <= 0` |

## Hard constraints from the instrument — already modeled correctly

1. **Max 3 uses per multi-use SMRT Cell.** PacBio: "Each multi-use SMRT Cell supports up to 3 acquisitions (uses)" (p.10, p.25). App: `Cell.max_uses` defaults to 3, capped `Literal[1, 2, 3]` (`schemas/run.py:58,71`); consumption is always derived live from non-cancelled `CellUse` rows in `derive_cell_state()` (`services/cell_service.py:44-55`), never re-entered by hand — this mirrors the instrument's own auto-tracking rather than trusting operator bookkeeping.

2. **The 108-hour window is one absolute deadline from Use 1, not a per-use timer.** PacBio: "Once removed from cell tray for 1st use, the 3rd use (Use 3) must start within 108 hours (= 4.5 days)"; the countdown "starts when SMRT Cell is first removed from the cell tray for 1st use" (p.25, p.28) — it does **not** reset at Use 2. App: `CELL_LIFETIME_H = 108` (`engine/constants.py:8`), checked as elapsed hours from `Cell.first_use_started_at` in `recompute_status()` (`services/cell_service.py:30-33`). This is the right semantics — resist any "fix" that turns it into a per-use reset.

3. **Expired or exhausted cells are terminal — the instrument allows no override.** PacBio: "NO option to use expired multi-use SMRT Cells for a sequencing run" (p.25, pp.28-30) — enforced by the instrument itself, not a soft warning. App: `remaining <= 0` → `status = "exhausted"`; `window_breached` → `status = "window_expired"` (`services/cell_service.py:36-39`); `place_sample()` raises 409 when a cell has no remaining uses (`services/placement_service.py:125-128`). **Asymmetry to note:** placement does *not* currently 409 on `window_breached` the same way it does on exhaustion — window state today only surfaces as a scheduling-time warning (`window_flags`). See Gaps below.

4. **A cell, once broken out of its tray, never goes back — reuse is strictly sequential.** PacBio: "Once removed from tray, a SMRT Cell is never returned to the tray" (p.25). Starting Use 1 commits a cell to the 108h clock with no undo. App's requirement that a cell's next use fall on a strictly later date (no same-day or out-of-order reuse) is consistent with this — don't add a path that lets a scheduled use be reordered ahead of an earlier one on the same cell.

5. **Reuse is always prioritized over opening a new cell.** PacBio: the instrument "automatically tracks SMRT Cell uses and prioritizes allocation of samples to used cells before new cells" (p.24), explicitly so operators skip loading a second tray when reuse capacity already covers the remaining samples ("There is no need to load SMRT Cell tray 2," p.24). App: both `pack_cells()` and `fill_slots()` sort candidates `(0 if prior else 1, -len(uses))` (`engine/packing.py:69`, `engine/slot_scheduling.py:25`) — reusable cells always sort before fresh ones, most-used first. Already correct; also a good source of user-facing copy if the UI ever wants to explain *why* it picked particular cells ("N reuse slots available — no new cells needed").

## Rules worth mirroring in validation/messaging (not fully enforced yet)

- **Barcode carryover between uses is real, just small.** PacBio quantifies it: "Revio SPRQ-Nx use-to-use barcode carryover level is typically <0.1%" (p.19 footnote) — non-zero, which is exactly why this app's burned-barcode conflict guard exists. `place_sample()` rejects reusing a cell if the new sample shares an already-burned barcode (`services/placement_service.py:129-130`), covered by `test_place_sample_rejects_barcode_conflict_on_existing_cell` (`tests/integration/test_placement_api.py:80`), `test_cell_with_remaining_capacity_is_reused_across_days_and_burned_barcodes_respected` (`tests/integration/test_cell_reuse_across_placements.py:39`), and `test_pack_excludes_prior_cell_when_sample_shares_a_burned_barcode` (`tests/unit/test_packing.py:52`). This is a stricter, zero-tolerance rule than PacBio's own instrument (which tolerates the <0.1% and demultiplexes anyway) — a deliberate safety margin, not a bug; don't loosen it without weighing that tradeoff explicitly.

- **Later uses of a cell tend to yield less.** PacBio's own HG002 WGS data across 3 uses of the same cell (p.35) shows Use 3 consistently lower than Use 1/2 (e.g. 143.9 / 144.2 / 119.9 Gb; 147.0 / 148.6 / 124.7 Gb; 148.9 / 154.5 / 136.7 Gb), attributed to lower P1 loading efficiency on later uses — an expected pattern, not an anomaly (footnote, pp.35-36). This app doesn't model per-use yield/coverage at all today (the removed `engine/kpis.py` only ever did cost). If yield estimation is ever added, don't assume flat output across Uses 1-3 of a cell.

- **Sub-5kb amplicon libraries shouldn't go on multi-use cells.** PacBio: "For amplicon libraries <5 kb, using Revio SPRQ sequencing plate with multi-use Revio SMRT Cells may result in reduced P1/.HiFi yield performance for Use 2 and/or Use 3" (p.14) — the recommended path for those is single-use cells instead. `ParsedSample` carries `oplc`/volume but has no insert-size- or library-type-aware validation today — if insert size ever gets captured, this is a concrete rule to enforce (hard block or at least a scheduling warning), not something to infer later from yield data.

## Numbers that trace back to this class of document (cost/KPI code removed — kept here for provenance)

The original `engine/kpis.py` / `engine/scheduling.py` port from `revio-nx-planner.html` (and the `CELLS_PER_TRAY`, `COST_BY_DEPTH = {1: 1480, 2: 888, 3: 690}`, `SINGLE_USE_PER_ACQ = 995` constants it depended on) was removed as dead code: never called by any router or service, exercised only by its own now-deleted unit tests. These numbers matched PacBio's own "cost per acquisition" chart for SPRQ-Nx vs. single-use SPRQ almost exactly (p.12: Nx costs $1,480 / $888 / $690 at 1/2/3 uses, against a flat single-use reference of $995; ≈30% savings and ≈$345/genome at 3 uses pooling 2 genomes/acquisition) — the prototype's numbers were themselves sourced from this PacBio economics data, not made up.

**If cost/KPI computation is ever reintroduced, re-check this table against current PacBio pricing before reusing `COST_BY_DEPTH` / `SINGLE_USE_PER_ACQ` verbatim** — they were last verified against the deck version this doc was written from, not a fresh source.

## Cadence / batching details consistent with current design

- One `movie_hours` value (12h/24h/30h) per run, never mixed — matches PacBio run design, where one acquisition time applies to every well in a plate/run.
- 4 wells per run, 4 cells per tray (`STAGES_PER_MACHINE = 4`, `WELLS` in `engine/constants.py`) — matches the Revio's 4-stage deck.
- This app's weekday-only run cadence matches the cadence PacBio itself uses in its own multi-use scheduling examples (Mon/Wed/Fri runs — pp.19, 24-25, 32-33), though that reads as a lab-staffing choice layered on top, not an instrument limitation. Worth remembering if this planner is ever used by a lab that runs weekends.
- Reuse cell-prep is modeled as faster than first-use prep (`FIRST_PREP_H = 2`, `REUSE_PREP_H = 0.75`) — qualitatively consistent with PacBio's description of reuse skipping full cell immobilization ("automatic washing, no manual steps," cells "stay in instrument," p.19). Note PacBio's own *quantified* figure is a different comparison: "+45 min added to cell prep time for Use 2 and Use 3 ... compared to cell prep time for single-use SMRT Cells" (p.33 footnote) — i.e. multi-use reuse vs. a single-use cell's one-time prep, not multi-use Use 1 vs. multi-use Use 2/3 on the same cell. Don't assume `FIRST_PREP_H`/`REUSE_PREP_H` are literally sourced from that +45min figure; keep the two comparisons distinct if turnaround timing is ever recalibrated against vendor numbers.

## Instrument load-lock timing

Distilled from three additional PacBio slides (Revio scheduling/utilization examples, not in the numbered deck above) showing per-well acquisition timing and two "high-utilization schedule" Gantt examples. These informed `instrument_lock.py::cycle_lock_until()` - the function that decides when an instrument becomes available to start a brand-new (instrument, day) run.

- **Per-well timing inside one run:** cell prep is ~4h, offset by 2h between wells; PPA (post-primary analysis) starts 28h after loading and recurs every 28h for back-to-back acquisitions (4h prep + 24h sequencing); PPA itself runs ~14h for 4 SMRT cells (a single 2h offset + two 6h units). This app doesn't model per-well PPA timing today - noted here only so a future addition doesn't have to re-derive it.
- **Example high-utilization cadences**, both averaging 24 SMRT cells/week: loading 8 cells per touch point (both trays at once) needs only 3 touch points/week (Mon/Wed/Fri, i.e. loads 48h apart); loading 4 cells per touch point (one tray) needs 6 touch points/week (Mon-Sat, loads 24h apart). The slides label the recurring per-touch-point window where the instrument accepts a new load as the "load window" - everything outside it is the instrument mid-run and unavailable to load.
- **The rule this app implements** (`cycle_lock_until()`): loading only tray 1 (≤4 wells, `WELLS[0:4]`) commits the instrument for `LOCK_BUFFER_HOURS` (6h) only - a short loading/setup window, after which the instrument is free again (to load tray 2 onto the same run, or start a different instrument-day). Loading tray 2 as well (any of `WELLS[4:8]`) commits the instrument to the full movie: locked until `movie_hours` completes, plus another `LOCK_BUFFER_HOURS` (6h) setup for whatever runs next. Both cases derive `lock_until` from the cycle's single `planned_start_at` - this app doesn't record a separate real-world timestamp for when tray 2 specifically went in, so the tray-2 case assumes it was loaded at/near the same time as tray 1.
- This lock is explicitly a **planning tool**: it only gates *creating a brand-new* (instrument, day) run (`placement_service.get_or_create_run`) so a user isn't invited to schedule a run the instrument can't have started yet - see the "Gaps" note below on `planned` vs `running`. Adding more wells to an already-existing run is never blocked by it.

## Gaps / open questions worth a deliberate decision

1. Should `window_breached` block placement (409) the same way exhaustion does, given PacBio treats both as equally hard, uncircumventable stops on the real instrument? Today only exhaustion blocks placement; window breach is scheduling-time-only (`window_flags`).
2. The 108h check applies uniformly regardless of which use is next (2nd or 3rd) — this matches PacBio's stated single-deadline behavior (see above), but if the instrument's actual firmware ever turns out to differentiate by use-index, or the SMRT Link "start within" countdown (p.29) implies something more granular, revisit `recompute_status()`.
3. No insert-size / library-type-aware validation exists — the planner will currently pack a <5kb amplicon sample onto a cell's 3rd use exactly like a WGS sample, which PacBio's own docs flag as a yield risk (see above).
4. Real instrument operators can manually discard *all* on-stage multi-use cells at once, not individually selectable (p.27) — physical instrument state can diverge from anything this planner scheduled, with no partial-recovery path. This app has no instrument integration today, so treat any generated schedule as advisory, not a guarantee of what will actually run.
5. Instrument locking (see "Instrument load-lock timing" above) is deliberately keyed off a `Cycle` merely being `planned`, not `running`/confirmed-loaded - the lock is a planning tool describing when the instrument *will* be busy once the plan is executed, not a report of real-world state. If this app ever integrates with the real instrument, revisit whether an unconfirmed `planned` cycle should still lock the next day the same way a confirmed one does.

## Explicitly out of scope

Part 2 of the source deck covers SMRT Link v26.1 *software* itself — 21 CFR Part 11 audit logging, asymmetric barcode demultiplexing UI, Ampli-Fi run design, methylation reports (5hmC/5mC/6mA). These are PacBio's own instrument-control-software features, not requirements for this planner. Noted here only so a future re-read of the source PDF doesn't get mistaken for a feature backlog — this app's job is scheduling/allocation, not replicating SMRT Link's UI.

## Keeping this current

Re-read the source PDF and revisit this file whenever:
- PacBio ships a new Revio/SPRQ chemistry or ICS/SMRT Link version that changes cell counts, the 108h window, cost-per-use, or reuse mechanics.
- Someone touches `engine/constants.py`, `services/cell_service.py::recompute_status`, or the reuse ordering in `engine/packing.py` / `engine/slot_scheduling.py`.
- Someone adds insert-size, library-type, or yield/coverage modeling to `ParsedSample` or the scheduling engine.
