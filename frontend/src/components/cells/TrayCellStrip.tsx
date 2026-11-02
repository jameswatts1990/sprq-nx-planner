import { Link } from "react-router-dom";

import type { BadgeTone } from "@/components/ui/Badge";
import type { CellOut } from "@/types/cell";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE, discardedWithUsesLeft } from "@/utils/cellStatus";
import { formatHoursLeft, windowHoursRemaining } from "@/utils/openTrays";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";

import styles from "./TrayCellStrip.module.css";

/** Cell status -> chip colour, via the shared CELL_STATUS_TONE so a chip always matches the
 * status badge the same cell shows everywhere else. */
const TONE_CLASS: Partial<Record<BadgeTone, string>> = {
  success: styles.success,
  danger: styles.danger,
  warning: styles.warning,
};

/** Use status -> pip colour, following the app's status colour rule (grey waiting, blue active,
 * green done, amber run problem, orange cell failure). */
const PIP_CLASS: Record<string, string> = {
  planned: styles.pipPlanned,
  started: styles.pipStarted,
  completed: styles.pipCompleted,
  aborted: styles.pipAborted,
  failed: styles.pipFailed,
};

/** The full sentence a chip's tooltip and screen-reader label carry. */
export function describeCell(cell: CellOut): string {
  const parts = [
    cell.code,
    CELL_STATUS_LABEL[cell.status],
    `${cell.uses_consumed} of ${cell.max_uses} use${cell.max_uses === 1 ? "" : "s"} spent`,
  ];
  if (cell.uses_scheduled_later > 0) parts.push(`${cell.uses_scheduled_later} more booked later`);
  const uses = cell.uses.filter((u) => u.status !== "cancelled");
  if (uses.length > 0) parts.push(uses.map((u, i) => `use ${i + 1} ${u.status}`).join(", "));
  const left = windowHoursRemaining(cell);
  if (left !== null) parts.push(`${formatHoursLeft(left)} on its 108-hour window`);
  if (discardedWithUsesLeft(cell)) parts.push("discarded");
  if (cell.needs_qc_report) parts.push("QC unreported");
  else if (cell.awaiting_credit) parts.push("QC awaiting credit");
  return parts.join(" · ");
}

function UsePips({ cell }: { cell: CellOut }) {
  const uses = cell.uses.filter((u) => u.status !== "cancelled");
  const booked = cell.uses_consumed + cell.uses_scheduled_later;
  // Capacity a cell will never use (discarded, stopped, retired, window closed) reads as a dash,
  // so the open rings are exactly the uses still free to book.
  const unusedClass = cell.status === "open" ? styles.pipFree : styles.pipLost;
  return (
    <span className={styles.pips} aria-hidden="true">
      {Array.from({ length: cell.max_uses }, (_, i) => {
        let cls = unusedClass;
        if (i < cell.uses_consumed) cls = PIP_CLASS[uses[i]?.status ?? "planned"] ?? styles.pipPlanned;
        else if (i < booked) cls = styles.pipPlanned; // booked after the as-of instant
        return <span key={i} className={`${styles.pip} ${cls}`} />;
      })}
    </span>
  );
}

export interface TrayCellStripProps {
  /** The tray's cells (any order - laid out by tray position). */
  cells: CellOut[];
  /** Ring these cells as the ones a search matched; omit to ring none. */
  matchedIds?: ReadonlySet<number>;
  /** Router state for each chip's link, so the cell page's Back returns here. */
  linkState?: SampleDetailLocationState;
}

/** A physical tray at a glance: one chip per tray position (1-4), coloured by that cell's status,
 * with a pip per use - filled in the use's status colour once spent, grey while booked for later,
 * an open ring while still free to book, a dash for capacity it will never use. Each chip links to
 * the cell. A position with no cell shows as an empty dashed slot; a cell registered without a
 * tray shows as a lone chip. */
export function TrayCellStrip({ cells, matchedIds, linkState }: TrayCellStripProps) {
  const positioned = cells.length > 0 && cells.every((c) => c.tray_position != null);
  const slots: (CellOut | number)[] = positioned
    ? Array.from(
        { length: Math.max(cells[0].tray_size, cells.length) },
        (_, i) => cells.find((c) => c.tray_position === i + 1) ?? i + 1,
      )
    : cells;

  return (
    <span className={styles.strip}>
      {slots.map((slot) => {
        if (typeof slot === "number") {
          return (
            <span key={`empty-${slot}`} className={styles.empty} title={`Position ${slot} - no cell`}>
              {slot}
            </span>
          );
        }
        const label = describeCell(slot);
        const classes = [styles.chip, TONE_CLASS[CELL_STATUS_TONE[slot.status]] ?? styles.neutral];
        if (matchedIds?.has(slot.id)) classes.push(styles.matched);
        return (
          <Link
            key={slot.id}
            to={`/cells/${slot.id}`}
            state={linkState}
            className={classes.join(" ")}
            title={label}
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
          >
            <span className={styles.pos}>{slot.tray_position ?? "•"}</span>
            <UsePips cell={slot} />
          </Link>
        );
      })}
    </span>
  );
}
