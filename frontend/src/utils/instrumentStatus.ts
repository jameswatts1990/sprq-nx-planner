import type { BadgeTone } from "@/components/ui/Badge";
import type { InstrumentOut } from "@/types/instrument";

/** An instrument's at-a-glance state, derived from its flags (it isn't a stored enum).
 * Shared by the Instruments tab's status badge and the Help tab's Colour & Status Legend
 * so the two stay consistent (mirrors utils/cellStatus.ts's pattern). */
export type InstrumentStatus = "ready" | "running" | "down" | "inactive";

export const INSTRUMENT_STATUSES: InstrumentStatus[] = ["ready", "running", "down", "inactive"];

export const INSTRUMENT_STATUS_LABEL: Record<InstrumentStatus, string> = {
  ready: "Ready",
  running: "Running",
  down: "Down",
  inactive: "Inactive",
};

export const INSTRUMENT_STATUS_TONE: Record<InstrumentStatus, BadgeTone> = {
  ready: "success",
  running: "info",
  down: "orange",
  inactive: "default",
};

/** Precedence matters: a retired instrument reads Inactive even if it was down, and a
 * down instrument reads Down even if a run is still marked loaded on it. */
export function instrumentStatus(instrument: InstrumentOut): InstrumentStatus {
  if (!instrument.active) return "inactive";
  if (instrument.down_from) return "down";
  if (instrument.is_locked) return "running";
  return "ready";
}
