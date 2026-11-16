import type { IssueReportSettings } from "@/api/settings";
import type { InstrumentOut } from "@/types/instrument";
import { csvSafe } from "@/utils/toCsv";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** DD-Mon-YYYY (e.g. 24-Jul-2026) for the exported "Date of Occurrence" column, matching the
 * date format the lab's issue-tracking sheet expects. */
function formatOccurrenceDate(d: Date | null): string {
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

export interface ReportField {
  label: string;
  value: string;
}

/** The case-specific inputs to the issue report - derived from a cell's triggering use, or taken
 * from what was typed in for a case logged without a cell. */
export interface IssueReportContext {
  occurredOn: Date | null;
  problem: string;
  caseNumber: string | null;
  sampleId: string;
  instrumentSerial: string | null;
  owner: string | null;
}

/** The Settings > Issue report values, as named in the Settings panel and the "Not set" note. */
export const ISSUE_REPORT_SETTING_LABEL: Record<keyof IssueReportSettings, string> = {
  team: "Team",
  equipment_owner: "Equipment owner",
  manager: "Manager",
};

/** Which Settings > Issue report values are blank (all of them until the settings load). */
export function unsetIssueReportSettings(settings: IssueReportSettings | undefined): string[] {
  const keys = Object.keys(ISSUE_REPORT_SETTING_LABEL) as (keyof IssueReportSettings)[];
  return keys.filter((k) => !settings?.[k]).map((k) => ISSUE_REPORT_SETTING_LABEL[k]);
}

/** The issue report as an ordered list of {column header, value} pairs, matching the lab's
 * central issue-tracking spreadsheet exactly. The team, equipment owner and notified manager come
 * from Settings > Issue report (blank until set - no team or person is ever named in code); the
 * generic constants (product line, stage, source, N/A) from the lab's agreed template; the variable
 * fields from the case context (incl. the case owner as "Reported by") and the instrument's
 * asset/location record. Columns the sheet fills itself (Study ID, Make/Model/Serial "auto fill")
 * stay blank. */
export function buildReportFields(
  ctx: IssueReportContext,
  instrument: InstrumentOut | undefined,
  settings: IssueReportSettings | undefined,
): ReportField[] {
  return [
    { label: "Date of Occurrence", value: formatOccurrenceDate(ctx.occurredOn) },
    { label: "Reported by (Sanger ID)", value: ctx.owner ?? "" },
    { label: "Team who identified the issue", value: settings?.team ?? "" },
    { label: "Issue Owner", value: settings?.team ?? "" },
    { label: "Project / Product Line", value: "PacBio" },
    { label: "Stage of Process Issue Identified", value: "Sequencing" },
    { label: "Source of Issue", value: "Consumables/Reagents" },
    { label: "Problem Statement", value: ctx.problem },
    { label: "Vendor/RT Support Ticket", value: ctx.caseNumber ?? "" },
    { label: "Equipment Software name (if applicable)", value: "N/A" },
    { label: "Equipment Program (If applicable)", value: "N/A" },
    { label: "Sample ID(s) e.g. Plate or Tube Barcode ID", value: ctx.sampleId },
    { label: "4 digit Study ID(s)", value: "" },
    { label: "Equipment Owner", value: settings?.equipment_owner ?? "" },
    { label: "Equipment Asset Number", value: instrument?.asset_number ?? "" },
    { label: "Make of Equipment (auto fill)", value: "" },
    { label: "Model of Equipment (auto fill)", value: "" },
    { label: "Serial number (auto fill)", value: "" },
    { label: "Location of equipment", value: instrument?.location ?? "" },
    {
      label:
        'Select appropriate manager or equivalent. Notify using the "right click and comment function" in the selected name cell',
      value: settings?.manager ?? "",
    },
  ];
}

/** One tab-separated row of the report values - tabs land in separate cells when pasted into a
 * spreadsheet, so it appends as a single new row under the sheet's existing column headers. */
export function reportRowTsv(fields: ReportField[]): string {
  return fields.map((f) => csvSafe(f.value)).join("\t");
}

/** A standalone CSV (header row + value row) for download - RFC-4180 quoting so commas, quotes,
 * and newlines inside a field (e.g. the manager-notification column) survive intact. */
export function reportCsv(fields: ReportField[]): string {
  const esc = (s: string) => `"${csvSafe(s).replace(/"/g, '""')}"`;
  const headers = fields.map((f) => esc(f.label)).join(",");
  const values = fields.map((f) => esc(f.value)).join(",");
  return `${headers}\r\n${values}\r\n`;
}
