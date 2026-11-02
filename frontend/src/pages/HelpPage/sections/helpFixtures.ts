/** Fabricated example data shared across Help sections, purely so the visual states
 * they describe render from the real app components (SchedulerSlotView, TrayCellStrip,
 * RunWellStrip, SampleRunChips, WindowMeter, TraySiblingList) instead of being hand-described in prose - see CLAUDE.md's
 * "Help Tab Maintenance" section. Centralized here (rather than duplicated per-section)
 * so the same example cell/stage shows up consistently everywhere it's referenced. */
import type { CellOut, CellUseSummaryOut } from "@/types/cell";
import type { SampleCellUseOut } from "@/types/sample";
import type { RunHistoryWellOut, StageOut } from "@/types/schedule";

export const EXAMPLE_CELL: CellOut = {
  id: 0,
  code: "C02-T7",
  max_uses: 3,
  cell_type: "sprq_nx",
  status: "open",
  uses_consumed: 1,
  uses_remaining: 2,
  uses_scheduled_later: 0,
  burned_barcodes: [],
  window_hours_elapsed: 60,
  window_breached: false,
  current_instrument_serial: "84047",
  current_well: "A01",
  last_use_run_date: "2026-07-13",
  reuse_ready_at: null,
  first_use_started_at: "2026-07-13T12:00:00Z",
  first_use_planned_start_at: "2026-07-13T12:00:00Z",
  created_at: "2026-07-13T12:00:00Z",
  stopped_reason: null,
  stopped_at: null,
  has_failed_use: false,
  needs_qc_report: false,
  awaiting_credit: false,
  internal_report_id: null,
  internal_report_at: null,
  pacbio_case_number: null,
  pacbio_reported_at: null,
  pacbio_credit_confirmed_at: null,
  credit_acquisitions: null,
  credit_notes: null,
  credit_received_at: null,
  credit_owner: null,
  discarded_reason: null,
  discarded_at: null,
  tray_id: 7,
  tray_position: 2,
  tray_size: 4,
  tray_reuse_disabled: false,
  uses: [
    {
      id: 1,
      run_batch_id: 1,
      run_name: "TRACTION-RUN-1234",
      sample_id: 1,
      sample_pool_id: "SAMPLE-101",
      well: "A01",
      status: "completed",
      run_started: true,
      breakout_anchor_at: null,
      plate_index: null,
      instrument_serial: null,
      started_at: null,
      completed_at: null,
      outcome_notes: null,
    },
    {
      id: 2,
      run_batch_id: 2,
      run_name: null,
      sample_id: 2,
      sample_pool_id: "SAMPLE-205",
      well: "A01",
      status: "planned",
      run_started: false,
      breakout_anchor_at: null,
      plate_index: null,
      instrument_serial: null,
      started_at: null,
      completed_at: null,
      outcome_notes: null,
    },
  ],
};

export const EXAMPLE_CELL_EXHAUSTED: CellOut = {
  ...EXAMPLE_CELL,
  code: "C02-T9",
  tray_id: 9,
  status: "exhausted",
  uses_consumed: 3,
  uses_remaining: 0,
  window_hours_elapsed: null,
};

// One physical tray's four sibling cells, in tray-position order - for TraySiblingList.
export const EXAMPLE_TRAY_SIBLINGS: CellOut[] = [
  { ...EXAMPLE_CELL, id: 101, code: "C01-T42", tray_id: 42, tray_position: 1 },
  { ...EXAMPLE_CELL, id: 102, code: "C02-T42", tray_id: 42, tray_position: 2, window_hours_elapsed: 98 },
  { ...EXAMPLE_CELL_EXHAUSTED, id: 103, code: "C03-T42", tray_id: 42, tray_position: 3 },
  {
    ...EXAMPLE_CELL,
    id: 104,
    code: "C04-T42",
    tray_id: 42,
    tray_position: 4,
    uses_consumed: 0,
    uses_remaining: 3,
    window_hours_elapsed: null,
    current_well: null,
  },
];

function exampleUse(id: number, status: string): CellUseSummaryOut {
  return { ...EXAMPLE_CELL.uses[0], id, status };
}

// A tray whose four cells show every chip and pip state - for TrayCellStrip: an open cell with a
// use spent and one running, a QC-stopped cell (one use completed, one failed, the last lost), an
// exhausted cell, and an unused one with its first use booked.
export const EXAMPLE_TRAY_STRIP: CellOut[] = [
  {
    ...EXAMPLE_CELL,
    id: 201,
    code: "C01-T51",
    tray_id: 51,
    tray_position: 1,
    uses_consumed: 2,
    uses_remaining: 1,
    window_hours_elapsed: 96,
    uses: [exampleUse(1, "completed"), exampleUse(2, "started")],
  },
  {
    ...EXAMPLE_CELL,
    id: 202,
    code: "C02-T51",
    tray_id: 51,
    tray_position: 2,
    status: "stopped",
    uses_consumed: 2,
    uses_remaining: 1,
    window_hours_elapsed: null,
    has_failed_use: true,
    needs_qc_report: true,
    uses: [exampleUse(3, "completed"), exampleUse(4, "failed")],
  },
  {
    ...EXAMPLE_CELL_EXHAUSTED,
    id: 203,
    code: "C03-T51",
    tray_id: 51,
    tray_position: 3,
    uses: [exampleUse(5, "completed"), exampleUse(6, "aborted"), exampleUse(7, "completed")],
  },
  {
    ...EXAMPLE_CELL,
    id: 204,
    code: "C04-T51",
    tray_id: 51,
    tray_position: 4,
    uses_consumed: 0,
    uses_remaining: 3,
    uses_scheduled_later: 1,
    window_hours_elapsed: null,
    uses: [],
  },
];

export const STAGE_EXAMPLE_SOURCE: StageOut = {
  slot_index: 0,
  well: "A01",
  cell_use_id: 1,
  cell_id: 42,
  cell_ref: "C02-T7",
  cell_home_well: "A01",
  use_number: 1,
  cell_max_uses: 3,
  cell_type: "sprq_nx",
  run_time_hours: 24,
  sample_id: 1,
  sample_pool_id: "SAMPLE-101",
  sample_plate_id: null,
  sample_sanger_ids: [],
  insert_size_bp: null,
  barcodes: ["bc1001"],
  cell_use_status: "completed",
  cell_status: "open",
  cell_has_failed_use: false,
  tray_position: 2,
  tray_id: 7,
  window_hours_elapsed: 60,
  reuse_not_ready_hours: null,
  notes: null,
};
export const STAGE_EXAMPLE_PEER: StageOut = {
  ...STAGE_EXAMPLE_SOURCE,
  slot_index: 4,
  well: "A02",
  cell_use_id: 2,
  use_number: 2,
  sample_id: 2,
  sample_pool_id: "SAMPLE-205",
  barcodes: ["bc2005"],
};
export const STAGE_EXAMPLE_UNRELATED: StageOut = {
  ...STAGE_EXAMPLE_SOURCE,
  slot_index: 1,
  well: "B01",
  cell_use_id: 3,
  cell_id: 99,
  cell_ref: "C02-T9",
  tray_id: 9,
  sample_id: 3,
  sample_pool_id: "SAMPLE-310",
  barcodes: ["bc3010"],
};

// 95 of 108 hours elapsed - near enough its deadline to show the fade clearly.
export const STAGE_EXAMPLE_WINDOW_NEAR_DEADLINE: StageOut = {
  ...STAGE_EXAMPLE_SOURCE,
  cell_use_id: 5,
  cell_id: 55,
  cell_ref: "C02-T5",
  tray_id: 5,
  sample_id: 5,
  sample_pool_id: "SAMPLE-509",
  barcodes: ["bc5009"],
  window_hours_elapsed: 95,
};

export const STAGE_EXAMPLE_ABORTED: StageOut = {
  ...STAGE_EXAMPLE_SOURCE,
  cell_use_id: 6,
  cell_id: 9,
  cell_ref: "C02-T3",
  tray_id: 3,
  sample_id: 6,
  sample_pool_id: "SAMPLE-618",
  barcodes: ["bc6018"],
  cell_use_status: "aborted",
  cell_status: "open",
};
export const STAGE_EXAMPLE_FAILED: StageOut = {
  ...STAGE_EXAMPLE_ABORTED,
  cell_use_id: 4,
  cell_id: 7,
  cell_ref: "C02-T4",
  tray_id: 4,
  sample_id: 4,
  sample_pool_id: "SAMPLE-410",
  barcodes: ["bc4010"],
  cell_use_status: "failed",
};
export const STAGE_EXAMPLE_STOPPED: StageOut = {
  ...STAGE_EXAMPLE_FAILED,
  cell_use_id: 5,
  cell_id: 8,
  cell_ref: "C02-T6",
  tray_id: 6,
  sample_id: 5,
  sample_pool_id: "SAMPLE-512",
  barcodes: ["bc5012"],
  // "started" (not yet its own recorded outcome) is what actually renders the Stopped
  // ring - a use that already completed/failed/aborted keeps showing that instead, even
  // once its cell is stopped (see SchedulerSlotView's qcAlert).
  cell_use_status: "started",
  cell_status: "stopped",
};
export const STAGE_EXAMPLE_CANCELLED: StageOut = {
  ...STAGE_EXAMPLE_FAILED,
  cell_use_id: 7,
  cell_id: 10,
  cell_ref: "C02-T10",
  tray_id: 10,
  sample_id: 7,
  sample_pool_id: "SAMPLE-719",
  barcodes: ["bc7019"],
  cell_use_status: "cancelled",
  cell_status: "stopped",
};

// A Cell QC re-zip landed this sample on a cell that had already burned this barcode with a
// different sample - the most severe card marking, outranking every qcAlert state above.
export const STAGE_EXAMPLE_BARCODE_CLASH: StageOut = {
  ...STAGE_EXAMPLE_SOURCE,
  cell_use_id: 8,
  cell_id: 11,
  cell_ref: "C02-T11",
  tray_id: 11,
  sample_id: 8,
  sample_pool_id: "SAMPLE-822",
  barcodes: ["bc4010"],
  reassigned: true,
  barcode_clash: true,
};

// A small-insert (<= threshold) library sitting on a cell's 2nd use - the yield-loss case
// PacBio flags, so the stronger hazard-striped top edge shows (see InsertSizeFlag).
export const STAGE_EXAMPLE_SMALL_INSERT_REUSE: StageOut = {
  ...STAGE_EXAMPLE_SOURCE,
  cell_use_id: 9,
  cell_id: 12,
  cell_ref: "C02-T12",
  tray_id: 12,
  sample_id: 9,
  sample_pool_id: "SAMPLE-930",
  barcodes: ["bc9030"],
  use_number: 2,
  insert_size_bp: 3000,
};

function exampleWell(plate: number, well: string, status: string, useNumber: number, pool: string | null): RunHistoryWellOut {
  return {
    cell_use_id: plate * 10 + well.charCodeAt(0),
    plate_index: plate,
    well,
    status,
    use_number: useNumber,
    cell_id: 300 + plate * 10 + well.charCodeAt(0),
    cell_code: `C0${well.charCodeAt(0) - 64}-T60`,
    cell_max_uses: 3,
    tray_id: 60,
    sample_id: pool ? 900 + well.charCodeAt(0) : null,
    sample_pool_id: pool,
    barcodes: [],
    started_at: null,
    completed_at: null,
  };
}

/** A two-plate run for the Run history well strip: Plate 1 finished with one failed and one
 * aborted well; Plate 2 (a reuse of the same cells) is running, with a planned well, a blocked
 * well (its cell was stopped) and nothing loaded in D. */
export const EXAMPLE_RUN_WELLS: RunHistoryWellOut[] = [
  exampleWell(1, "A01", "completed", 1, "SAMPLE-101"),
  exampleWell(1, "B01", "completed", 1, "SAMPLE-102"),
  exampleWell(1, "C01", "failed", 1, "SAMPLE-103"),
  exampleWell(1, "D01", "aborted", 1, "SAMPLE-104"),
  exampleWell(2, "A01", "started", 2, "SAMPLE-105"),
  exampleWell(2, "B01", "planned", 2, "SAMPLE-106"),
  exampleWell(2, "C01", "cancelled", 2, null),
];

/** A sample that was aborted on one run, then re-run to completion on Plate 2 of another. */
export const EXAMPLE_SAMPLE_USES: SampleCellUseOut[] = [
  {
    id: 1,
    cycle_id: 1,
    run_name: null,
    run_batch_id: 412,
    load_date: "2026-10-12",
    instrument_serial: "84047",
    plate_number: 1,
    cell_id: 1,
    cell_code: "C01-T40",
    well: "A01",
    status: "aborted",
    started_at: null,
    completed_at: null,
    outcome_notes: null,
  },
  {
    id: 2,
    cycle_id: 2,
    run_name: "TRACTION-RUN-1234",
    run_batch_id: 420,
    load_date: "2026-10-15",
    instrument_serial: "84098",
    plate_number: 2,
    cell_id: 2,
    cell_code: "C02-T41",
    well: "B01",
    status: "completed",
    started_at: null,
    completed_at: null,
    outcome_notes: null,
  },
];
