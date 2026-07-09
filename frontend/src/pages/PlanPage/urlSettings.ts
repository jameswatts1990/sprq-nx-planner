import type { MaxUses, Objective, RunDesignSettings, RunTimeHours } from "@/types/schedule";

const DEFAULT_MAX_USES: MaxUses = 3;
const DEFAULT_RUN_TIME: RunTimeHours = 24;
const DEFAULT_OBJECTIVE: Objective = "fewest";

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseMaxUses(v: string | null): MaxUses {
  if (v === "1" || v === "2" || v === "3") return Number(v) as MaxUses;
  return DEFAULT_MAX_USES;
}

function parseRunTime(v: string | null): RunTimeHours {
  if (v === "12" || v === "24" || v === "30") return Number(v) as RunTimeHours;
  return DEFAULT_RUN_TIME;
}

function parseObjective(v: string | null): Objective {
  if (v === "fewest" || v === "balance" || v === "fastest") return v;
  return DEFAULT_OBJECTIVE;
}

/**
 * All Plan page run-design state lives in the URL (?instruments=...&maxUses=...&...)
 * so the page is shareable/bookmarkable/refresh-safe. `availableInstruments` is used
 * to pick a sane default (first two active instruments) when the URL doesn't specify
 * any, or specifies ones that no longer exist.
 */
export function settingsFromSearchParams(
  params: URLSearchParams,
  availableInstruments: string[],
): RunDesignSettings {
  const instrumentsParam = params.get("instruments");
  let instrumentIds = instrumentsParam ? instrumentsParam.split(",").filter(Boolean) : [];
  instrumentIds = instrumentIds.filter((id) => availableInstruments.includes(id));
  if (instrumentIds.length === 0 && availableInstruments.length > 0) {
    instrumentIds = availableInstruments.slice(0, Math.min(2, availableInstruments.length));
  }

  return {
    instrument_ids: instrumentIds,
    max_uses: parseMaxUses(params.get("maxUses")),
    run_time_hours: parseRunTime(params.get("runTime")),
    objective: parseObjective(params.get("objective")),
    start_date: params.get("startDate") || todayIso(),
  };
}

export function settingsToSearchParams(settings: RunDesignSettings): Record<string, string> {
  return {
    instruments: settings.instrument_ids.join(","),
    maxUses: String(settings.max_uses),
    runTime: String(settings.run_time_hours),
    objective: settings.objective,
    startDate: settings.start_date,
  };
}
