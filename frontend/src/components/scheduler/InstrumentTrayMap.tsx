import { memo, type KeyboardEvent, type MouseEvent } from "react";
import { Link } from "react-router-dom";

import { CELL_STATUS_LABEL } from "@/utils/cellStatus";
import { formatShortDateUTC, parseDateOnly, shortWeekdayUTC } from "@/utils/calendarDates";

import styles from "./InstrumentTrayMap.module.css";
import type { InstrumentTrayMap as TrayMap, TrayPositionView, TrayView } from "./instrumentTrayMaps";

/** Formats an ISO datetime as "DD/MM" (UTC) - the compact expiry label the lab uses. */
function formatDayMonthUTC(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function positionTitle(p: TrayPositionView): string {
  const parts = [
    `Cell ${p.cellNumber} · ${p.code}`,
    CELL_STATUS_LABEL[p.status],
    `${p.usesRemaining} use${p.usesRemaining === 1 ? "" : "s"} left`,
  ];
  if (p.expiryAt) {
    parts.push(`expires ${formatDayMonthUTC(p.expiryAt)}${p.expiryEstimated ? " (estimated)" : ""}`);
  }
  return parts.join(" · ");
}

/** Which visual tone a position cell carries. `soon` (amber) = the actionable "use it before
 * its window closes" highlight; `spent` (grey) = benignly used up or written off; `danger`
 * (red) = timed out / QC-stopped, i.e. capacity lost or unusable; else neutral. */
function positionTone(p: TrayPositionView): string | undefined {
  if (p.urgency === "soon") return styles.soon;
  if (p.status === "exhausted" || p.status === "retired") return styles.spent;
  if (p.urgency === "expired") return styles.danger;
  return undefined;
}

function TrayPositionCell({ p }: { p: TrayPositionView }) {
  return (
    <div className={[styles.cell, positionTone(p)].filter(Boolean).join(" ")} title={positionTitle(p)}>
      <span className={styles.letter}>C{p.cellNumber}</span>
      <span className={styles.uses}>{p.usesRemaining}</span>
      {p.expiryAt ? (
        <span className={p.expiryEstimated ? `${styles.exp} ${styles.expEstimated}` : styles.exp}>
          {p.expiryEstimated ? "~" : ""}
          {formatDayMonthUTC(p.expiryAt)}
        </span>
      ) : (
        <span className={styles.expNone}>—</span>
      )}
    </div>
  );
}

function TrayStrip({ tray }: { tray: TrayView }) {
  return (
    <div className={styles.strip}>
      <Link
        className={styles.trayHeader}
        to={`/trays/${tray.trayId}`}
        title={`Tray ${tray.trayId} - view this tray's 4 cells`}
      >
        TRAY #{tray.trayId}
      </Link>
      <div className={styles.cells}>
        {tray.positions.map((p) => (
          <TrayPositionCell key={p.cellId} p={p} />
        ))}
      </div>
    </div>
  );
}

function EmptyCarousel() {
  return (
    <div className={`${styles.strip} ${styles.empty}`} title="No tray loaded in this carousel position">
      <div className={styles.emptyLabel}>load tray</div>
    </div>
  );
}

export interface InstrumentTrayMapProps {
  map: TrayMap | undefined;
}

/** The at-a-glance map of physical SMRT-cell trays currently on one instrument, projected to
 * the latest scheduled state, rendered beneath the instrument serial in the schedule grid's
 * left column. Mirrors the two-plate deck: carousel[0] = Plate 1 tray, carousel[1] = Plate 2.
 * Read-only; each tray header links to that tray's own page. */
export const InstrumentTrayMap = memo(function InstrumentTrayMap({ map }: InstrumentTrayMapProps) {
  if (!map || (map.carousel[0] === null && map.carousel[1] === null)) return null;

  const caption = map.asOfDate
    ? `as of ${shortWeekdayUTC(parseDateOnly(map.asOfDate))} ${formatShortDateUTC(parseDateOnly(map.asOfDate))}`
    : "current";

  // Clicks/keys inside the map are informational and must not trigger the row header's
  // "select this instrument's open days" behaviour on the enclosing <th>.
  function stop(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
  }

  return (
    <div className={styles.map} onClick={stop} onKeyDown={stop} role="presentation">
      <div className={styles.caption} title="Projected cell state as of the latest scheduled day this week">
        {caption}
      </div>
      <div className={styles.carousels}>
        {map.carousel[0] ? <TrayStrip tray={map.carousel[0]} /> : <EmptyCarousel />}
        {map.carousel[1] ? <TrayStrip tray={map.carousel[1]} /> : <EmptyCarousel />}
      </div>
    </div>
  );
});
