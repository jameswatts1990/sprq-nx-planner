/** Fabricated example data shared across Help sections, purely so the visual states
 * they describe render from the real app components (SchedulerSlotView, CellStatusCard,
 * WindowMeter, TraySiblingList) instead of being hand-described in prose - see CLAUDE.md's
 * "Help Tab Maintenance" section. Centralized here (rather than duplicated per-section)
 * so the same example cell/stage shows up consistently everywhere it's referenced. */
import type { CellOut } from "@/types/cell";
import type { StageOut } from "@/types/schedule";

export const EXAMPLE_CELL: CellOut = {
  id: 0,
  code: "C02-T7",
  max_uses: 3,
  status: "open",
  uses_consumed: 1,
  uses_remaining: 2,
  burned_barcodes: [],
  window_hours_elapsed: 60,
  window_breached: false,
  current_instrument_serial: "84047",
  current_well: "A01",
  last_use_run_date: "2026-07-13",
  first_use_started_at: "2026-07-13T12:00:00Z",
  first_use_planned_start_at: "2026-07-13T12:00:00Z",
  created_at: "2026-07-13T12:00:00Z",
  stopped_reason: null,
  stopped_at: null,
  has_failed_use: false,
  needs_qc_report: false,
  awaiting_credit: false,
  internal_report_link: null,
  internal_report_at: null,
  pacbio_case_number: null,
  pacbio_reported_at: null,
  pacbio_credit_confirmed_at: null,
  credit_received_at: null,
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
      sample_external_id: "SAMPLE-101",
      well: "A01",
      status: "completed",
      run_started: true,
      breakout_anchor_at: null,
    },
    {
      id: 2,
      run_batch_id: 2,
      run_name: null,
      sample_id: 2,
      sample_external_id: "SAMPLE-205",
      well: "A01",
      status: "planned",
      run_started: false,
      breakout_anchor_at: null,
    },
  ],
};

export const EXAMPLE_CELL_UNREPORTED: CellOut = {
  ...EXAMPLE_CELL,
  code: "C02-T8",
  tray_id: 8,
  has_failed_use: true,
  needs_qc_report: true,
  burned_barcodes: ["bc4010"],
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

export const STAGE_EXAMPLE_SOURCE: StageOut = {
  slot_index: 0,
  well: "A01",
  cell_use_id: 1,
  cell_id: 42,
  cell_ref: "C02-T7",
  cell_home_well: "A01",
  use_number: 1,
  cell_max_uses: 3,
  run_time_hours: 24,
  sample_id: 1,
  sample_external_id: "SAMPLE-101",
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
  sample_external_id: "SAMPLE-205",
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
  sample_external_id: "SAMPLE-310",
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
  sample_external_id: "SAMPLE-509",
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
  sample_external_id: "SAMPLE-618",
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
  sample_external_id: "SAMPLE-410",
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
  sample_external_id: "SAMPLE-512",
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
  sample_external_id: "SAMPLE-719",
  barcodes: ["bc7019"],
  cell_use_status: "cancelled",
  cell_status: "stopped",
};
