/** Display rules for what MLWH recorded (LangQC verdicts, yields, loadings) - shared by run
 * results, sequencing history and Stats so one fact reads the same everywhere. */
import type { BadgeTone } from "@/components/ui/Badge";
import type { SequencingSummary } from "@/types/sequencing";

import { formatDateUTC, formatShortDateUTC, parseDateOnly } from "./calendarDates";

/** A LangQC verdict's badge tone, by the app's one status-colour rule (Help > Glossary & Legend):
 * no verdict yet = default (waiting), passed = success, a SMRT cell / instrument failure = orange
 * (a cell failure - a PacBio credit case), anything else wrong (the sample missed its metrics, on
 * hold, aborted - or a state LangQC adds later) = warning. Matched by shape, like the backend. */
export function langQcTone(state: string | null | undefined): BadgeTone {
  const s = (state ?? "").trim().toLowerCase();
  if (!s || s.includes("pending")) return "default";
  if (s.includes("pass")) return "success";
  if (s.includes("claim")) return "info";
  if (s.includes("fail") && /smrt|cell|instrument/.test(s)) return "orange";
  return "warning";
}

export function langQcLabel(state: string | null | undefined): string {
  return state?.trim() || "Awaiting QC";
}

/** "12.5 Gb", "0.31 Gb" - two significant decimals at most, never a trailing ".0". */
export function formatGb(gb: number | null | undefined): string | null {
  if (gb == null) return null;
  return `${+gb.toFixed(gb < 1 ? 2 : 1)} Gb`;
}

export function formatPm(pm: number | null | undefined): string | null {
  return pm == null ? null : `${+pm.toFixed(1)} pM`;
}

export function formatPct(pct: number | null | undefined): string | null {
  return pct == null ? null : `${+pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

/** A movie length in minutes as "24 h" / "23.5 h". */
export function formatMovie(minutes: number | null | undefined): string | null {
  return minutes == null ? null : `${+(minutes / 60).toFixed(1)} h`;
}

function cellsLabel(n: number): string {
  return `${n} cell${n === 1 ? "" : "s"}`;
}

/** The inline highlight: "2 cells · 48 Gb · last 210 pM". */
export function summaryChipText(s: SequencingSummary): string {
  const parts = [cellsLabel(s.cells), formatGb(s.hifi_gb)];
  const pm = formatPm(s.last_loading_conc);
  if (pm) parts.push(`last ${pm}`);
  return parts.filter(Boolean).join(" · ");
}

/** The whole last loading, for the chip's tooltip. */
export function summaryTitle(s: SequencingSummary): string {
  const last = [
    s.last_run_date && formatDateUTC(parseDateOnly(s.last_run_date)),
    s.last_run_name,
    s.last_well,
  ]
    .filter(Boolean)
    .join(", ");
  const facts = [
    formatPm(s.last_loading_conc),
    formatGb(s.last_hifi_gb),
    s.last_pct_of_cell != null && `${formatPct(s.last_pct_of_cell)} of the cell`,
    s.last_plex && s.last_plex > 1 && `pool of ${s.last_plex}`,
    `LangQC ${langQcLabel(s.last_qc_state)}`,
  ].filter(Boolean);
  return (
    `Sequenced on ${cellsLabel(s.cells)}, ${formatGb(s.hifi_gb)} HiFi in all (MLWH). ` +
    `Last loaded ${last}: ${facts.join(" · ")}. Click for every loading.`
  );
}

/** The edit dialog's one line under Target OPLC: "Last loaded 210 pM · 12 Nov · 24 Gb (26% of the cell)". */
export function lastLoadingLine(s: SequencingSummary): string {
  const when = s.last_run_date ? formatShortDateUTC(parseDateOnly(s.last_run_date)) : null;
  const gb = formatGb(s.last_hifi_gb);
  const share = s.last_pct_of_cell != null ? ` (${formatPct(s.last_pct_of_cell)} of the cell)` : "";
  return ["Last loaded " + (formatPm(s.last_loading_conc) ?? "at an unrecorded concentration"), when, gb && gb + share]
    .filter(Boolean)
    .join(" · ");
}
