import type { DowntimeOut } from "@/types/instrument";
import type { RunOut } from "@/types/schedule";
import { downtimeReason, formatDowntimeSpan } from "@/utils/downtime";
import { formatTimeLocal, parseDateOnly, shortWeekdayUTC } from "@/utils/calendarDates";
import { runLabel } from "@/utils/runLabel";
import { RUN_STATUS_LABEL } from "@/utils/cycleStatus";

import type { Continuation } from "./groupCyclesByInstrumentAndDay";

/** Why a grid area can't take a drop. These areas register no dnd-kit droppable (so collision
 * detection stays untouched), which leaves dnd-kit unable to say what a rejected drop hit -
 * so each one is stamped with these attributes and useSchedulerDnd reads them back from the
 * DOM at drop time (blockedDropMessageAt). */
export type BlockReason = "weekend" | "down" | "locked" | "continuation";

export interface BlockMarker {
  reason: BlockReason;
  /** The sentence shown when a drop lands here. */
  detail: string;
}

export const BLOCK_REASON_ATTR = "data-block-reason";
export const BLOCK_DETAIL_ATTR = "data-block-detail";

/** Spread onto the blocked area's element. */
export function blockAttrs(marker: BlockMarker | null): Record<string, string> {
  return marker ? { [BLOCK_REASON_ATTR]: marker.reason, [BLOCK_DETAIL_ATTR]: marker.detail } : {};
}

/** "Tue 14:00" on the lab's (local) clock - when a lock releases. Day first, like every date-time. */
function weekdayAndTimeLocal(iso: string): string {
  return `${new Date(iso).toLocaleDateString("en-GB", { weekday: "short" })} ${formatTimeLocal(iso)}`;
}

function longWeekday(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

export const WEEKEND_BLOCK: BlockMarker = { reason: "weekend", detail: "Runs can only be loaded on weekdays." };

/** "Revio 84093 is down 12–14 Nov (planned): Laser swap." */
export function downBlock(instrumentLabel: string, period: DowntimeOut): BlockMarker {
  const span = formatDowntimeSpan(period);
  const when = period.end_date === period.start_date ? `on ${span}` : span;
  const why = downtimeReason(period);
  return {
    reason: "down",
    detail: `${instrumentLabel} is down ${when} (${period.kind})${why ? `: ${why}` : ""}.`,
  };
}

/** A day whose own run is no longer planned (loaded, or finished). */
export function lockedRunBlock(instrumentLabel: string, run: RunOut, now: Date = new Date()): BlockMarker {
  if (run.status !== "running") {
    return { reason: "locked", detail: `Run ${runLabel(run)} has finished (${RUN_STATUS_LABEL[run.status].toLowerCase()}) — it can't take samples.` };
  }
  return {
    reason: "locked",
    detail:
      new Date(run.lock_until) > now
        ? `${instrumentLabel} is locked until ${weekdayAndTimeLocal(run.lock_until)} (run loaded).`
        : `Run ${runLabel(run)} is loaded — unload it (its RUNNING tag) to change it.`,
  };
}

/** A day with no run of its own that an earlier run still occupies. */
export function continuationBlock(instrumentLabel: string, loadDate: string, continuation: Continuation): BlockMarker {
  const owner = `${longWeekday(continuation.run.load_date)}'s run`;
  return {
    reason: "continuation",
    detail: continuation.acquiresToday
      ? `${shortWeekdayUTC(parseDateOnly(loadDate))} is taken by ${owner} (Plate 2 acquiring).`
      : `${instrumentLabel} is locked until ${weekdayAndTimeLocal(continuation.run.lock_until)} (${owner} loading).`,
  };
}

/** Fallback for an in-grid drop that hit nothing marked (the instrument column, a header, a
 * stopped cell's Blocked marker). */
export const GENERIC_BLOCKED_DROP = "Can't drop here — drop onto an empty slot of a day that's open for scheduling.";

/** The message for a drop released at (x, y): the nearest blocked area's detail under the
 * pointer, else null. Scans every element at the point (elementsFromPoint), not just the top
 * one, because the drag overlay can still be under the pointer as the drop ends. */
export function blockedDropMessageAt(x: number, y: number): string | null {
  if (typeof document === "undefined" || typeof document.elementsFromPoint !== "function") return null;
  for (const el of document.elementsFromPoint(x, y)) {
    const marked = el.closest(`[${BLOCK_REASON_ATTR}]`);
    if (marked) return marked.getAttribute(BLOCK_DETAIL_ATTR);
  }
  return null;
}
