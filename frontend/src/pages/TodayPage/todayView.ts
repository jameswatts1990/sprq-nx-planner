import type { CellTrayRowOut } from "@/types/cell";
import type { InstrumentOut } from "@/types/instrument";
import type { RunOut } from "@/types/schedule";
import { parseDateOnly } from "@/utils/calendarDates";
import { downtimeOn, downtimeReason, formatDowntime } from "@/utils/downtime";

/** Every Today card re-reads its source this often. */
export const TODAY_REFRESH_MS = 60_000;

/** "Monday 16 November" - the page's intro line. */
export function formatTodayHeading(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function wellCount(run: RunOut): number {
  return run.plates.reduce((n, plate) => n + plate.stages.length, 0);
}

/** Today's runs that have wells to load, grouped by instrument (an emptied run has nothing to load). */
export function runsLoadingToday(runs: RunOut[]): RunOut[] {
  return runs
    .filter((run) => wellCount(run) > 0)
    .sort((a, b) => a.instrument_serial.localeCompare(b.instrument_serial) || a.run_id - b.run_id);
}

/** When a confirmed-loaded run went on the instrument (its first plate's real start); null while planned. */
export function loadedAt(run: RunOut): string | null {
  if (run.status === "planned") return null;
  const starts = run.plates.map((p) => p.actual_start_at).filter((s): s is string => s !== null);
  return starts.length ? starts.sort()[0] : null;
}

/** Open trays whose soonest 108h window closes within `warnHours`, soonest first (the trays feed
 * already sorts by expiry). */
export function expiringTrays(rows: CellTrayRowOut[], warnHours: number): CellTrayRowOut[] {
  return rows.filter((row) => row.expires_in_hours !== null && row.expires_in_hours <= warnHours);
}

export function instrumentLabel(serial: string, instruments: Pick<InstrumentOut, "serial_number" | "name">[]): string {
  return instruments.find((i) => i.serial_number === serial)?.name || `Revio ${serial}`;
}

/** Down now (warn), else the next downtime ahead (info), as one line - null when neither. */
export function downtimeLine(
  instrument: Pick<InstrumentOut, "down_now" | "downtimes" | "next_downtime">,
  today: string,
): { tone: "warn" | "info"; text: string } | null {
  const current = instrument.down_now ? downtimeOn(instrument.downtimes, today) : null;
  const shown = current ?? instrument.next_downtime;
  if (!shown) return null;
  const why = downtimeReason(shown);
  return {
    tone: current ? "warn" : "info",
    text: `${current ? "Down now" : "Downtime ahead"}: ${formatDowntime(shown)}${why ? ` — ${why}` : ""}`,
  };
}
