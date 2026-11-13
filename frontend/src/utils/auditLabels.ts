import type { AuditLogOut } from "@/types/audit";
import { formatDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { SAMPLE_STATUS_LABEL } from "@/utils/sampleStatus";
import { cellUseStatusLabel } from "@/utils/useStatusTone";

/** Plain-language names for the audit trail (History → Activity): what each action is called,
 * the groups the Activity filter offers, and a one-line summary of what a row changed. The
 * backend writes `action` codes (services/audit_util.log_action); this is the one place that
 * turns them into lab words. An action missing here still shows, as its code made readable. */

export const ACTION_LABEL: Record<string, string> = {
  // Schedule
  place_sample: "Placed sample",
  move_sample: "Moved sample",
  swap_samples: "Swapped samples",
  remove_sample: "Removed from schedule",
  restore_sample: "Restored placement (Undo)",
  return_cancelled_use_to_backlog: "Returned blocked sample to backlog",
  auto_fill: "Autoschedule",
  update_cell_use_run_time: "Changed movie time",
  update_cell_use_notes: "Edited well note",
  create_schedule_note: "Added day note",
  update_schedule_note: "Edited day note",
  move_schedule_note: "Moved day note",
  delete_schedule_note: "Deleted day note",
  // Runs
  update_run_status: "Changed run status",
  reschedule_run: "Rescheduled run",
  cancel_run: "Cancelled run",
  update_cell_use_status: "Changed well status",
  undo_cell_use_status: "Undid well status",
  // Samples & imports
  import_samples: "Imported samples",
  undo_import: "Undid import",
  create_sample: "Added sample",
  update_sample: "Edited sample",
  update_sample_notes: "Edited sample note",
  cancel_sample: "Cancelled sample",
  requeue_sample: "Requeued sample",
  topup_request_sent: "Resupply requested",
  topup_cancelled: "Resupply cancelled",
  // Cells & QC
  bootstrap_cell: "Added cell",
  discard_cell: "Discarded cell",
  rotate_tray: "Rotated tray",
  restore_tray: "Restored tray",
  tray_skip_reuse: "Stopped tray reuse",
  tray_resume_reuse: "Resumed tray reuse",
  qc_commit: "Cell QC",
  qc_undo: "Undid cell QC",
  // Credits
  set_cell_internal_report: "Logged internal report",
  set_case_internal_report: "Logged internal report",
  report_cell_to_pacbio: "Reported to PacBio",
  report_case_to_pacbio: "Reported to PacBio",
  confirm_cell_credit: "Credit confirmed",
  confirm_case_credit: "Credit confirmed",
  receive_cell_credit: "Credit received",
  receive_case_credit: "Credit received",
  set_cell_credit_owner: "Set case owner",
  set_case_credit_owner: "Set case owner",
  set_cell_credit_notes: "Edited case notes",
  set_case_credit_notes: "Edited case notes",
  create_pacbio_case: "Added credit case",
  update_pacbio_case: "Edited credit case",
  delete_pacbio_case: "Deleted credit case",
  // Instruments
  instrument_create: "Added instrument",
  instrument_update: "Edited instrument",
  // instrument_down / instrument_online: the pre-0.74 single "down from" flag, kept for old rows.
  instrument_down: "Marked down",
  instrument_online: "Back online",
  instrument_downtime_add: "Added downtime",
  instrument_downtime_update: "Edited downtime",
  instrument_downtime_end: "Ended downtime",
  instrument_downtime_delete: "Deleted downtime",
  instrument_delete: "Deleted instrument",
  // Settings
  update_sample_defaults: "Changed sample defaults",
  update_scheduling_settings: "Changed scheduling settings",
  update_credit_email: "Changed credit email",
};

/** "Planned · 12 Nov 2026 → 14 Nov 2026: Laser swap" (one day: just the date) from a downtime audit row's snapshot. */
function downtimeSummary(d: Record<string, unknown>): string {
  const kind = d.kind === "planned" ? "Planned" : "Unplanned";
  const span = !d.end_date
    ? `from ${formatAuditValue(d.start_date)}`
    : d.end_date === d.start_date
      ? formatAuditValue(d.start_date)
      : `${formatAuditValue(d.start_date)} → ${formatAuditValue(d.end_date)}`;
  return `${kind} · ${span}${d.note ? `: ${formatAuditValue(d.note)}` : ""}`;
}

/** The Activity page's "What" filter: each group sends its actions as one comma-separated list. */
export const ACTION_GROUPS: { value: string; label: string; actions: string[] }[] = [
  {
    value: "schedule",
    label: "Schedule",
    actions: [
      "place_sample",
      "move_sample",
      "swap_samples",
      "remove_sample",
      "restore_sample",
      "return_cancelled_use_to_backlog",
      "auto_fill",
      "update_cell_use_run_time",
      "update_cell_use_notes",
      "create_schedule_note",
      "update_schedule_note",
      "move_schedule_note",
      "delete_schedule_note",
    ],
  },
  {
    value: "runs",
    label: "Runs loaded & outcomes",
    actions: ["update_run_status", "reschedule_run", "cancel_run", "update_cell_use_status", "undo_cell_use_status"],
  },
  {
    value: "samples",
    label: "Samples & imports",
    actions: [
      "import_samples",
      "undo_import",
      "create_sample",
      "update_sample",
      "update_sample_notes",
      "cancel_sample",
      "requeue_sample",
      "topup_request_sent",
      "topup_cancelled",
    ],
  },
  {
    value: "cells",
    label: "Cells, trays & QC",
    actions: [
      "bootstrap_cell",
      "discard_cell",
      "rotate_tray",
      "restore_tray",
      "tray_skip_reuse",
      "tray_resume_reuse",
      "qc_commit",
      "qc_undo",
    ],
  },
  {
    value: "credits",
    label: "PacBio credits",
    actions: [
      "create_pacbio_case",
      "update_pacbio_case",
      "delete_pacbio_case",
      "report_cell_to_pacbio",
      "report_case_to_pacbio",
      "set_cell_internal_report",
      "set_case_internal_report",
      "confirm_cell_credit",
      "confirm_case_credit",
      "receive_cell_credit",
      "receive_case_credit",
      "set_cell_credit_owner",
      "set_case_credit_owner",
      "set_cell_credit_notes",
      "set_case_credit_notes",
    ],
  },
  {
    value: "instruments",
    label: "Instruments",
    actions: [
      "instrument_create",
      "instrument_update",
      "instrument_downtime_add",
      "instrument_downtime_update",
      "instrument_downtime_end",
      "instrument_downtime_delete",
      "instrument_down",
      "instrument_online",
      "instrument_delete",
    ],
  },
  {
    value: "settings",
    label: "Settings",
    actions: ["update_sample_defaults", "update_scheduling_settings", "update_credit_email"],
  },
];

export function actionLabel(row: Pick<AuditLogOut, "action" | "details_json">): string {
  // A run's status change is the Confirm loaded / Unlock / outcome action the lab knows by name.
  if (row.action === "update_run_status") {
    const status = row.details_json.status;
    if (status === "running") return "Confirmed loaded";
    if (status === "planned") return "Unlocked run";
    if (status === "aborted") return "Aborted run";
    if (status === "completed") return "Marked run completed";
  }
  return ACTION_LABEL[row.action] ?? readable(row.action);
}

/** Field names as the forms label them. */
const FIELD_LABEL: Record<string, string> = {
  barcodes: "Barcodes",
  // Downtime periods (instrument_downtime_update) - the only rows recording these.
  start_date: "First down day",
  end_date: "Last down day",
  sanger_ids: "Sanger IDs",
  plate_id: "Plate ID",
  pool_id: "Pool ID",
  target_oplc: "Target OPLC",
  actual_oplc: "Actual OPLC",
  cleaned_complex_volume: "Complex volume",
  loading_buffer_volume: "Buffer volume",
  adaptive_loading: "Adaptive loading",
  full_resolution_base_q: "Full-resolution base Q",
  priority: "Priority",
  base_kinetics: "Base kinetics",
  movie_time_hours: "Movie time",
  insert_size_bp: "Insert size",
  notes: "Note",
  status: "Status",
  serial_number: "Serial",
  name: "Name",
  location: "Location",
  asset_number: "Asset number",
  active: "Active",
  body: "Note",
  note_date: "Day",
  instruments: "Instruments",
  summary: "Summary",
  occurred_on: "Date",
  instrument_id: "Instrument",
  run_name: "Run",
  cell_type: "Cell type",
  expected_acquisitions: "Acquisitions to claim",
};

function readable(code: string): string {
  const words = code.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MAX_VALUE = 60;

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(formatAuditValue).join(", ") : "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateUTC(parseDateOnly(value));
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

function isChange(value: unknown): value is { from: unknown; to: unknown } {
  return typeof value === "object" && value !== null && "from" in value && "to" in value;
}

/** What a row changed, as short lines: an edit's "Priority: Standard → High", or the few facts
 * an action recorded ("Well B01 · 84047 · 9 Nov 2026"). Empty when there's nothing to add. */
export function describeAuditDetails(row: Pick<AuditLogOut, "action" | "details_json">): string[] {
  const d = row.details_json;
  const value = (key: string) => formatAuditValue(d[key]);
  switch (row.action) {
    case "place_sample":
      return [`Well ${value("well")} · ${value("instrument_serial")} · loads ${value("load_date")}`];
    case "restore_sample":
      return [`Well ${value("well")}${d.cell_changed ? " · on a different cell" : ""}`];
    case "move_sample":
      return [`To well ${value("well")}`];
    case "auto_fill":
      return [`${value("placed")} placed on ${value("runs")} run(s), ${value("unplaced")} left in the backlog`];
    case "update_cell_use_run_time":
      return [`Movie time: ${value("from")}h → ${value("to")}h`];
    case "update_cell_use_status":
      return [`Status: ${cellUseStatusLabel(String(d.status))}`, ...(d.notes ? [`Note: ${value("notes")}`] : [])];
    case "reschedule_run":
      return [`New load date: ${value("new_load_date")}`];
    case "cancel_run":
      return [`${value("reverted_sample_count")} sample(s) back to the backlog`];
    case "import_samples":
      return [`${value("imported_count")} sample(s) from ${d.source_filename ? value("source_filename") : "pasted text"}`];
    case "undo_import":
      return [`${value("removed_count")} sample(s) removed`];
    case "instrument_down":
      return [`From ${value("down_from")}${d.note ? `: ${value("note")}` : ""}`];
    case "instrument_downtime_add":
    case "instrument_downtime_delete":
      return [downtimeSummary(d)];
    case "instrument_downtime_end":
      return [
        d.removed
          ? `${downtimeSummary(d)} · removed (it hadn't started)`
          : `${downtimeSummary(d)} · back online ${value("back_online_on")}`,
      ];
    case "discard_cell":
    case "rotate_tray":
      return d.reason ? [`Reason: ${value("reason")}`] : [];
    case "qc_commit":
      return [`Verdict: ${value("verdict")}`, ...(d.reason ? [`Reason: ${value("reason")}`] : [])];
    case "report_cell_to_pacbio":
    case "report_case_to_pacbio":
      return [`Case number: ${value("case_number")}`];
    case "set_cell_internal_report":
    case "set_case_internal_report":
      return [`Report ID: ${value("report_id")}`];
    case "confirm_cell_credit":
    case "confirm_case_credit":
      return [`${value("acquisitions")} acquisition(s) credited`];
    case "set_cell_credit_owner":
    case "set_case_credit_owner":
      return [`Owner: ${value("owner")}`];
    case "set_cell_credit_notes":
    case "set_case_credit_notes":
      return [`Notes: ${value("notes")}`];
    case "create_schedule_note":
    case "delete_schedule_note":
      return [`${value("note_date")}: ${value("body")}`];
    case "update_credit_email":
      return [`Changed: ${formatAuditValue(d.fields)}`];
  }
  // An edit (audit_util.diff): one line per changed field.
  const changes = Object.entries(d).filter(([, v]) => isChange(v));
  if (changes.length) {
    return changes.map(([field, change]) => {
      const { from, to } = change as { from: unknown; to: unknown };
      // Only a sample's cancel / requeue records a status change.
      const show = (v: unknown) =>
        field === "status" && typeof v === "string" && v in SAMPLE_STATUS_LABEL
          ? SAMPLE_STATUS_LABEL[v as keyof typeof SAMPLE_STATUS_LABEL]
          : formatAuditValue(v);
      return `${FIELD_LABEL[field] ?? readable(field)}: ${show(from)} → ${show(to)}`;
    });
  }
  // A settings save records the values it set.
  if (row.action === "update_sample_defaults" || row.action === "update_scheduling_settings") {
    return Object.entries(d).map(([field, v]) => `${FIELD_LABEL[field] ?? readable(field)}: ${formatAuditValue(v)}`);
  }
  return [];
}
