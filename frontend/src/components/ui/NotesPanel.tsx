import type { ReactNode } from "react";

import type { ConflictPairOut, WindowFlagOut } from "@/types/schedule";

import { Note } from "./Note";
import styles from "./NotesPanel.module.css";

export interface NotesPanelProps {
  conflictPairs: ConflictPairOut[];
  unplacedCount: number;
  windowFlags: WindowFlagOut[];
  /** When 12, shows the prototype's small-insert reminder note. */
  runTimeHours?: number;
}

/** Ports the prototype's renderNotes(): a small rules engine over the preview's notes
 * payload, falling back to a single "all clear" note when nothing is flagged. */
export function NotesPanel({ conflictPairs, unplacedCount, windowFlags, runTimeHours }: NotesPanelProps) {
  const notes: ReactNode[] = [];

  if (conflictPairs.length > 0) {
    const shown = conflictPairs.slice(0, 6);
    notes.push(
      <Note key="conflicts" tone="info" icon="↔">
        <b>
          {conflictPairs.length} barcode clash{conflictPairs.length > 1 ? "es" : ""}
        </b>{" "}
        handled — these samples were kept on separate cells:{" "}
        {shown.map((p, i) => (
          <span key={`${p.a}-${p.b}`}>
            {i > 0 && " · "}
            {p.a} ↔ {p.b} <code>{p.shared.join(", ")}</code>
          </span>
        ))}
        {conflictPairs.length > 6 ? " …" : ""}
      </Note>,
    );
  }

  if (unplacedCount > 0) {
    notes.push(
      <Note key="unplaced" tone="bad" icon="!">
        <b>{unplacedCount} sample(s) unplaced.</b> Increase max uses per cell or reduce prior-cell restrictions.
      </Note>,
    );
  }

  if (windowFlags.length > 0) {
    notes.push(
      <Note key="window" tone="warn" icon="⏱">
        <b>108 h window exceeded</b> on {windowFlags.map((w) => w.cell_ref).join(", ")} at this run time — use 3
        would start beyond 4.5 days from breakout.
      </Note>,
    );
  }

  if (runTimeHours === 12) {
    notes.push(
      <Note key="12h" tone="warn" icon="i">
        12 h movies are typically small inserts. Multi-use Nx is validated for inserts ≥5 kb — for inserts
        under 5 kb, use single-use cells (set max uses to 1×).
      </Note>,
    );
  }

  if (notes.length === 0) {
    notes.push(
      <Note key="ok" tone="good" icon="✓">
        No barcode clashes detected across cell uses. Schedule is clean.
      </Note>,
    );
  }

  return <div className={styles.notes}>{notes}</div>;
}
