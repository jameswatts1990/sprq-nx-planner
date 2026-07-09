import type { CycleOut } from "@/types/schedule";
import { addDaysUTC, formatShortDateUTC, formatTimeOfDay, parseDateOnly } from "@/utils/calendarDates";

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Client-side CSV export of a schedule preview - there is no backend endpoint for
 * this, so it is built entirely from the already-loaded preview.cycles. */
export function buildScheduleCsv(cycles: CycleOut[], startDate: string): string {
  const rows: string[][] = [["Instrument", "Day", "Time", "Use", "Well", "Cell", "Sample", "Barcodes"]];

  const sorted = [...cycles].sort(
    (a, b) => a.machine_idx - b.machine_idx || a.day_idx - b.day_idx || a.time_of_day_hours - b.time_of_day_hours,
  );

  for (const cycle of sorted) {
    const date = addDaysUTC(parseDateOnly(startDate), cycle.day_idx);
    const dayLabel = `${formatShortDateUTC(date)} (day ${cycle.day_idx + 1})`;
    const timeLabel = formatTimeOfDay(cycle.time_of_day_hours);
    for (const stage of cycle.stages) {
      rows.push([
        cycle.instrument_serial,
        dayLabel,
        timeLabel,
        `Use ${cycle.use_idx + 1}`,
        stage.well,
        stage.cell_ref,
        stage.sample_external_id ?? "",
        stage.barcodes.join(" "),
      ]);
    }
  }

  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export function downloadTextFile(filename: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
