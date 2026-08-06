import { memo, useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link } from "react-router-dom";

import { CELL_STATUS_LABEL } from "@/utils/cellStatus";
import { formatShortDateUTC, parseDateOnly, shortWeekdayUTC } from "@/utils/calendarDates";

import styles from "./InstrumentTrayMap.module.css";
import {
  cellExpiryState,
  usesRemainingAt,
  type CellExpiryState,
  type InstrumentTrayMap as TrayMap,
  type TrayPositionView,
  type TrayView,
} from "./instrumentTrayMaps";

/** Formats an ISO datetime as "DD/MM" (UTC) - the compact expiry label the lab uses. */
function formatDayMonthUTC(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

/** A terse relative span for a millisecond magnitude: "3d" / "18h" / "45m". */
function relSpan(ms: number): string {
  const hours = Math.abs(ms) / 3_600_000;
  if (hours >= 48) return `${Math.round(hours / 24)}d`;
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${Math.max(1, Math.round(Math.abs(ms) / 60_000))}m`;
}

/** Plain-language name for each expiry state, for tooltips / the no-date fallback line. */
const STATE_LABEL: Record<CellExpiryState, string> = {
  ok: "in window",
  soon: "expiring soon",
  expired: "expired",
  scheduled: "not broken out yet",
  spent: "used up",
  fresh: "unused",
};

/** The full countdown for the tooltip: it shifts with the reference instant (end-of-week vs
 * now), so the same cell reads "2d left" today and "expired 1d ago" projected to Fri. */
function verboseDetail(p: TrayPositionView, state: CellExpiryState, refMs: number): string | null {
  const expiryMs = p.expiryAt ? Date.parse(p.expiryAt) : null;
  const breakoutMs = p.breakoutAt ? Date.parse(p.breakoutAt) : null;
  if ((state === "ok" || state === "soon") && expiryMs !== null) return `${relSpan(expiryMs - refMs)} left`;
  if (state === "scheduled" && breakoutMs !== null) return `breaks out in ${relSpan(breakoutMs - refMs)}`;
  if (state === "expired" && p.status === "open" && expiryMs !== null) return `expired ${relSpan(expiryMs - refMs)} ago`;
  return null;
}

/** A terse countdown that fits the narrow cell (colour + icon already signal past vs future):
 * just the magnitude for a still-open window, nothing for the states the icon fully conveys. */
function inlineDetail(p: TrayPositionView, state: CellExpiryState, refMs: number): string | null {
  const expiryMs = p.expiryAt ? Date.parse(p.expiryAt) : null;
  if ((state === "ok" || state === "soon") && expiryMs !== null) return relSpan(expiryMs - refMs);
  return null;
}

const SVG_BASE = {
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Inline status icon (this project ships no icon library). Uses currentColor so the CSS state
 * tone colours it: a clock for a running/scheduled window, a warning triangle when it's closing
 * soon, a crossed circle once expired, a tick when spent, a dot when unused. */
function StateIcon({ state }: { state: CellExpiryState }) {
  switch (state) {
    case "soon":
      return (
        <svg {...SVG_BASE}>
          <path d="M12 4 21 19.5H3Z" />
          <line x1="12" y1="10" x2="12" y2="13.5" />
          <circle cx="12" cy="16.6" r="1.05" fill="currentColor" stroke="none" />
        </svg>
      );
    case "expired":
      return (
        <svg {...SVG_BASE}>
          <circle cx="12" cy="12" r="9" />
          <line x1="8.6" y1="8.6" x2="15.4" y2="15.4" />
          <line x1="15.4" y1="8.6" x2="8.6" y2="15.4" />
        </svg>
      );
    case "spent":
      return (
        <svg {...SVG_BASE}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5 11 15.5 16.2 9" />
        </svg>
      );
    case "fresh":
      return (
        <svg {...SVG_BASE}>
          <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "scheduled":
    case "ok":
    default:
      return (
        <svg {...SVG_BASE}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.4V12l3 2" />
        </svg>
      );
  }
}

/** A small spinner (270° arc) for the live "now" pill; CSS spins it, reduced-motion stops it. */
function NowSpinner() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden>
      <path d="M12 3a9 9 0 1 1-9 9" />
    </svg>
  );
}

function positionTitle(p: TrayPositionView, state: CellExpiryState, refMs: number, live: boolean): string {
  // Match the badge: the live view counts only uses broken out by now; the default view shows
  // the committed-plan figure. Spell out which basis so the number is never ambiguous. In the
  // live view that "broken out so far" basis applies both to an open cell and to a terminal cell
  // still holding a committed use that hasn't broken out yet (remaining > 0).
  const remaining = live ? usesRemainingAt(p, refMs) : p.usesRemaining;
  const basis = live
    ? p.status === "open" || remaining > 0
      ? " (broken out so far)"
      : ""
    : p.status === "open"
      ? " (after this week's plan)"
      : "";
  const parts = [
    `Cell ${p.cellNumber} · ${p.code}`,
    CELL_STATUS_LABEL[p.status],
    `${remaining} use${remaining === 1 ? "" : "s"} left${basis}`,
  ];
  if (p.expiryAt) {
    parts.push(`${STATE_LABEL[state]} · 108h window closes ${formatDayMonthUTC(p.expiryAt)}`);
    const detail = verboseDetail(p, state, refMs);
    if (detail) parts.push(detail);
  }
  parts.push(live ? "status as of now" : "projected to the end of this week");
  if (p.provisional) parts.push("planned load — not yet confirmed, so the date may shift");
  return parts.join(" · ");
}

/** Which visual tone a position cell carries: its expiry state at the current reference instant.
 * ok (green) = comfortable window; soon (amber) = closing within a day; expired (red) = past its
 * deadline or QC-stopped; scheduled (blue) = clock not started yet; spent (grey) = used up; fresh
 * = open but never on a clock. */
function TrayPositionCell({ p, refMs, live }: { p: TrayPositionView; refMs: number; live: boolean }) {
  const state = cellExpiryState(p, refMs, live);
  const detail = inlineDetail(p, state, refMs);
  // Live "now" view: count only uses that have actually broken out by now, so a cell reads its
  // real remaining capacity at this instant. Default (end-of-week) view keeps the committed-plan
  // figure - every scheduled use this week counted.
  const remaining = live ? usesRemainingAt(p, refMs) : p.usesRemaining;
  const className = [styles.cell, styles[`s_${state}`], p.provisional ? styles.provisional : null]
    .filter(Boolean)
    .join(" ");
  // Clicking a cell opens its detail page (status, uses, 108h window, QC actions all live
  // there). The enclosing map already stopPropagation()s pointer/keyboard events to protect
  // the row-header select, so navigating from here doesn't also toggle the instrument row.
  return (
    <Link className={className} to={`/cells/${p.cellId}`} title={positionTitle(p, state, refMs, live)}>
      {/* Cell position prefix is U+25A3 (▣), not "C" - a numbered cell position must never be
          misread as a plate well's column-C (see cellPositionLabel in utils/plateWell.ts). */}
      <span className={styles.letter}><span className={styles.cellGlyph}>▣</span>{p.cellNumber}</span>
      <span className={styles.uses}>{remaining}</span>
      <span className={styles.exp}>
        <span className={styles.expIcon}>
          <StateIcon state={state} />
        </span>
        {p.expiryAt ? (
          <>
            <span className={styles.expDate}>{formatDayMonthUTC(p.expiryAt)}</span>
            {detail && <span className={styles.expCount}>{detail}</span>}
          </>
        ) : (
          <span className={styles.expRel}>{STATE_LABEL[state]}</span>
        )}
      </span>
    </Link>
  );
}

function TrayStrip({ tray, refMs, live }: { tray: TrayView; refMs: number; live: boolean }) {
  return (
    <div className={styles.strip}>
      <Link
        className={styles.trayHeader}
        to={`/cells?tray=${tray.trayId}`}
        title={`Tray ${tray.trayId} - view this tray's 4 cells`}
      >
        TRAY #{tray.trayId}
      </Link>
      <div className={styles.cells}>
        {tray.positions.map((p) => (
          <TrayPositionCell key={p.cellId} p={p} refMs={refMs} live={live} />
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

/** The at-a-glance map of physical SMRT-cell trays currently on one instrument, rendered beneath
 * the instrument serial in the schedule grid's left column. Mirrors the two-plate deck:
 * carousel[0] = Plate 1 tray, carousel[1] = Plate 2. Each slot shows the tray resident by the
 * END of the viewed week (so a mid-week turnover shows the successor, not the departed tray),
 * and each cell is shaded by its own precise 108h expiry (each of a tray's 4 cells breaks out
 * ~2h apart, so they expire on a staggered ladder). By default every cell's state is projected
 * to the end of the viewed week; hovering the panel flips it to a live "now" reading, flagged by
 * a green "NOW" pill. Read-only; each tray header links to that tray's own page. */
export const InstrumentTrayMap = memo(function InstrumentTrayMap({ map }: InstrumentTrayMapProps) {
  const [hovering, setHovering] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Keep the live reading fresh only while hovering - refresh immediately on enter, then a slow
  // tick (the spinning pill already signals "live"; the hours/days figure only needs the minute).
  useEffect(() => {
    if (!hovering) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [hovering]);

  if (!map || (map.carousel[0] === null && map.carousel[1] === null)) return null;

  // End-of-week reference = the end of the last visible weekday, so a cell whose 108h window
  // closes any time that day reads as expired "by end of week". Hover swaps in the real now.
  const weekEndMs = map.weekEndDate
    ? parseDateOnly(map.weekEndDate).getTime() + (24 * 3600 - 1) * 1000
    : nowMs;
  const refMs = hovering ? nowMs : weekEndMs;
  const weekEndLabel = map.weekEndDate
    ? `${shortWeekdayUTC(parseDateOnly(map.weekEndDate))} ${formatShortDateUTC(parseDateOnly(map.weekEndDate))}`
    : null;

  // Clicks/keys inside the map are informational and must not trigger the row header's
  // "select this instrument's open days" behaviour on the enclosing <th>.
  function stop(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
  }

  return (
    <div
      className={styles.map}
      onClick={stop}
      onKeyDown={stop}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      role="presentation"
    >
      <div className={styles.captionRow}>
        {hovering ? (
          <span className={`${styles.pill} ${styles.nowPill}`} title="Live cell status as of right now">
            <span className={styles.nowSpinner}>
              <NowSpinner />
            </span>
            now
          </span>
        ) : (
          <span
            className={styles.pill}
            title="Each cell's expiry state projected to the end of this week — hover the map to see it as of right now"
          >
            by {weekEndLabel ?? "week end"}
          </span>
        )}
      </div>
      <div className={styles.carousels}>
        {map.carousel[0] ? (
          <TrayStrip tray={map.carousel[0]} refMs={refMs} live={hovering} />
        ) : (
          <EmptyCarousel />
        )}
        {map.carousel[1] ? (
          <TrayStrip tray={map.carousel[1]} refMs={refMs} live={hovering} />
        ) : (
          <EmptyCarousel />
        )}
      </div>
    </div>
  );
});
