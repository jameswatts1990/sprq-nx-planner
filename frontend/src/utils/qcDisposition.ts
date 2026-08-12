import type { Disposition } from "@/types/qc";

/** Full human-readable label for a QC disposition — used by qcDispositionLabel() to show a
 * sample's stored qc_disposition tag (e.g. in the Backlog's Recoverable Samples table). */
export const DISPOSITION_LABEL: Record<Disposition, string> = {
  lost: "Lost",
  repeatable_complex: "Repeatable — from complex",
  repeatable: "Repeatable — from library",
  recoverable: "Recoverable",
};

/** Compact label for the QC modal's SegmentedControl (space is tight at 4–5 options across).
 * The per-row volume readout + Traction link give the "complex"/"library" options their
 * context, so the short forms stay unambiguous. */
export const DISPOSITION_SHORT: Record<Disposition, string> = {
  lost: "Lost",
  repeatable_complex: "Complex",
  repeatable: "Library",
  recoverable: "Recoverable",
};

/** One-word destination/action hint under each SegmentedControl option. */
export const DISPOSITION_HINT: Record<Disposition, string> = {
  lost: "Top-up",
  repeatable_complex: "Repeat",
  repeatable: "Repeat",
  recoverable: "Backlog",
};

/** A stored qc_disposition string → full label (used by the Backlog Recoverable Samples table),
 * tolerant of unknown/legacy tags (returns the raw tag rather than throwing so old data never
 * renders blank), and null for an untagged sample. */
export function qcDispositionLabel(tag: string | null): string | null {
  if (!tag) return null;
  return (DISPOSITION_LABEL as Record<string, string>)[tag] ?? tag;
}
