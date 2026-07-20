/** Fabricated example data shared across Help sections, purely so the visual states
 * they describe render from the real app components (SchedulerSlotView, CellStatusCard,
 * WindowMeter, TraySiblingList) instead of being hand-described in prose - see CLAUDE.md's
 * "Help Tab Maintenance" section. Centralized here (rather than duplicated per-section)
 * so the same example cell/stage shows up consistently everywhere it's referenced. */
import type { CellGhost } from "@/components/scheduler/waitingCells";
import type { CellOut } from "@/types/cell";
import type { StageOut } from "@/types/schedule";

export const EXAMPLE_CELL: CellOut = {
  id: 0,
  code: "CELL-000042",
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
  pacbio_case_number: null,
  pacbio_reported_at: null,
  pacbio_credit_confirmed_at: null,
  credit_received_at: null,
  discarded_reason: null,
  discarded_at: null,
  tray_id: 7,
  tray_position: 2,
  tray_size: 4,
};

export const EXAMPLE_CELL_UNREPORTED: CellOut = {
  ...EXAMPLE_CELL,
  code: "CELL-000058",
  has_failed_use: true,
  needs_qc_report: true,
  burned_barcodes: ["bc4010"],
};

export const EXAMPLE_CELL_EXHAUSTED: CellOut = {
  ...EXAMPLE_CELL,
  code: "CELL-000019",
  status: "exhausted",
  uses_consumed: 3,
  uses_remaining: 0,
  window_hours_elapsed: null,
};

// One physical tray's four sibling cells, in tray-position order - for TraySiblingList.
export const EXAMPLE_TRAY_SIBLINGS: CellOut[] = [
  { ...EXAMPLE_CELL, id: 101, code: "CELL-A000042", tray_position: 1 },
  { ...EXAMPLE_CELL, id: 102, code: "CELL-B000042", tray_position: 2, window_hours_elapsed: 98 },
  { ...EXAMPLE_CELL_EXHAUSTED, id: 103, code: "CELL-C000042", tray_position: 3 },
  {
    ...EXAMPLE_CELL,
    id: 104,
    code: "CELL-D000042",
    tray_position: 4,
    uses_consumed: 0,
    uses_remaining: 3,
    window_hours_elapsed: null,
    current_well: null,
  },
];

export const GHOST_EXAMPLE_FADING: CellGhost = {
  cell: EXAMPLE_CELL,
  useNumber: 2,
  isHardCutoff: false,
  fadeOpacity: 0.65,
  cutoffDate: "2026-07-17",
  deadlineAt: "2026-07-18T00:00:00Z",
  deadlineIsEstimated: false,
};
export const GHOST_EXAMPLE_CUTOFF: CellGhost = { ...GHOST_EXAMPLE_FADING, isHardCutoff: true };
export const GHOST_EXAMPLE_UNUSED: CellGhost = {
  cell: { ...EXAMPLE_CELL, code: "CELL-000043", uses_consumed: 0, uses_remaining: 3, current_well: "B01" },
  useNumber: 1,
  isHardCutoff: false,
  fadeOpacity: 1,
  cutoffDate: "2026-07-13",
  deadlineAt: "",
  deadlineIsEstimated: false,
  unused: true,
};
export const GHOST_EXAMPLE_EXHAUSTED: CellGhost = {
  ...GHOST_EXAMPLE_FADING,
  cell: EXAMPLE_CELL_EXHAUSTED,
  terminalStatus: "exhausted",
};
export const GHOST_EXAMPLE_SCHEDULED: CellGhost = {
  ...GHOST_EXAMPLE_FADING,
  pendingTerminalStatus: "exhausted",
};

export const STAGE_EXAMPLE_SOURCE: StageOut = {
  slot_index: 0,
  well: "A01",
  cell_use_id: 1,
  cell_id: 42,
  cell_ref: "CELL-000042",
  use_number: 1,
  sample_id: 1,
  sample_external_id: "SAMPLE-101",
  barcodes: ["bc1001"],
  cell_use_status: "completed",
  cell_status: "open",
  tray_position: 2,
  tray_id: 7,
  window_hours_elapsed: 60,
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
  cell_ref: "CELL-000099",
  sample_id: 3,
  sample_external_id: "SAMPLE-310",
  barcodes: ["bc3010"],
};

// 95 of 108 hours elapsed - near enough its deadline to show the fade clearly.
export const STAGE_EXAMPLE_WINDOW_NEAR_DEADLINE: StageOut = {
  ...STAGE_EXAMPLE_SOURCE,
  cell_use_id: 5,
  cell_id: 55,
  cell_ref: "CELL-000055",
  sample_id: 5,
  sample_external_id: "SAMPLE-509",
  barcodes: ["bc5009"],
  window_hours_elapsed: 95,
};

export const STAGE_EXAMPLE_ABORTED: StageOut = {
  ...STAGE_EXAMPLE_SOURCE,
  cell_use_id: 6,
  cell_id: 9,
  cell_ref: "CELL-000009",
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
  cell_ref: "CELL-000007",
  sample_id: 4,
  sample_external_id: "SAMPLE-410",
  barcodes: ["bc4010"],
  cell_use_status: "failed",
};
export const STAGE_EXAMPLE_STOPPED: StageOut = {
  ...STAGE_EXAMPLE_FAILED,
  cell_use_id: 5,
  cell_id: 8,
  cell_ref: "CELL-000008",
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
  cell_ref: "CELL-000010",
  sample_id: 7,
  sample_external_id: "SAMPLE-719",
  barcodes: ["bc7019"],
  cell_use_status: "cancelled",
  cell_status: "stopped",
};
