import type { Disposition } from "@/types/qc";

/** Full human-readable label for a QC disposition — used by qcDispositionLabel() to show a
 * sample's stored qc_disposition tag (e.g. in the Backlog's Recoverable samples table). */
export const DISPOSITION_LABEL: Record<Disposition, string> = {
  lost: "Lost",
  repeatable_complex: "Repeatable — from complex",
  repeatable: "Repeatable — from library",
  recoverable: "Recoverable — from instrument",
};

/** Compact label for the QC modal's SegmentedControl (space is tight at 4–5 options across).
 * The per-row volume readout + Traction link give the "complex"/"library" options their
 * context, and each option's tooltip carries DISPOSITION_DESCRIPTION, so the short forms stay
 * unambiguous. */
export const DISPOSITION_SHORT: Record<Disposition, string> = {
  lost: "Lost",
  repeatable_complex: "Complex",
  repeatable: "Library",
  recoverable: "Instrument",
};

/** One-word destination/action hint under each SegmentedControl option. */
export const DISPOSITION_HINT: Record<Disposition, string> = {
  lost: "Resupply",
  repeatable_complex: "Repeat",
  repeatable: "Repeat",
  recoverable: "Recover",
};

/** What each disposition means and does, in lab terms — the QC modal's option tooltips and its
 * legend, the Backlog's disposition-badge tooltip, and the Help text all say the same thing. */
export const DISPOSITION_DESCRIPTION: Record<Disposition, string> = {
  lost:
    "No usable material left. The sample is marked failed and added to the Backlog's Resupply requests list so you can ask the supplier for fresh sample.",
  repeatable_complex:
    "Enough leftover cleaned complex remains to re-load it directly — no new prep. Back to the backlog above High priority, with a 30-day countdown from this QC as a reminder to use the complex while it is fresh.",
  repeatable:
    "Not enough complex left, but library material is still held in Traction — re-make the complex from the library, then re-load. Back to the backlog above High priority.",
  recoverable:
    "The run's data can still be recovered from the instrument, so no new prep is needed. Back to the backlog at Recoverable priority so it stays visible until it is dealt with.",
};

/** A stored qc_disposition string → full label (used by the Backlog Recoverable samples table),
 * tolerant of unknown/legacy tags (returns the raw tag rather than throwing so old data never
 * renders blank), and null for an untagged sample. */
export function qcDispositionLabel(tag: string | null): string | null {
  if (!tag) return null;
  return (DISPOSITION_LABEL as Record<string, string>)[tag] ?? tag;
}

/** Same tolerance as qcDispositionLabel, for the description tooltip. */
export function qcDispositionDescription(tag: string | null): string | undefined {
  if (!tag) return undefined;
  return (DISPOSITION_DESCRIPTION as Record<string, string>)[tag];
}

/** Advisory shelf life of leftover cleaned complex after a "Repeatable — from complex" QC.
 * Display only: nothing is blocked or changed when it runs out. */
export const COMPLEX_REPEAT_WINDOW_DAYS = 30;

/** Whole days left (negative once expired) in the from-complex window, counted from the QC
 * date, or null when the sample isn't a from-complex repeat or predates the QC timestamp. */
export function complexDaysLeft(
  qcDisposition: string | null,
  qcDispositionAt: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (qcDisposition !== "repeatable_complex" || !qcDispositionAt) return null;
  const elapsedDays = Math.floor((now - new Date(qcDispositionAt).getTime()) / 86_400_000);
  return COMPLEX_REPEAT_WINDOW_DAYS - elapsedDays;
}
