import type { GroupBy, StatsResponse } from "@/types/stats";
import { formatDateRangeUTC, formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { oneOf } from "@/utils/listView";
import { toCsv } from "@/utils/toCsv";

/** The Stats page's report settings - range, grouping and instrument - kept in the URL so a
 * report can be bookmarked or linked as-is. */

export const RANGE_PRESETS = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-quarter", label: "This quarter" },
  { value: "last-quarter", label: "Last quarter" },
  { value: "this-year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range…" },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]["value"];

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
  { value: "quarter", label: "By quarter" },
];

export interface StatsView {
  range: RangePreset;
  /** Custom range bounds (YYYY-MM-DD, "" = open) - only used when range is "custom". */
  from: string;
  to: string;
  group: GroupBy;
  instrument: string;
}

export const DEFAULT_STATS_VIEW: StatsView = { range: "90d", from: "", to: "", group: "week", instrument: "" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readStatsView(params: URLSearchParams): StatsView {
  const date = (raw: string | null) => (raw && ISO_DATE.test(raw) ? raw : "");
  return {
    range: oneOf(params.get("range"), RANGE_PRESETS.map((p) => p.value), DEFAULT_STATS_VIEW.range),
    from: date(params.get("from")),
    to: date(params.get("to")),
    group: oneOf(params.get("group"), GROUP_BY_OPTIONS.map((g) => g.value), DEFAULT_STATS_VIEW.group),
    instrument: params.get("instrument") ?? "",
  };
}

/** `prev` with `patch` applied; defaults are left out so the URL stays short. */
export function writeStatsView(prev: URLSearchParams, patch: Partial<StatsView>): URLSearchParams {
  const view = { ...readStatsView(prev), ...patch };
  const next = new URLSearchParams(prev);
  for (const key of Object.keys(DEFAULT_STATS_VIEW) as (keyof StatsView)[]) {
    if (view[key] === DEFAULT_STATS_VIEW[key]) next.delete(key);
    else next.set(key, view[key]);
  }
  return next;
}

/** A local calendar date as YYYY-MM-DD - the lab's own day, not UTC's. */
function isoLocal(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** The inclusive date_from / date_to a view asks the API for (either left out = open-ended). The
 * rolling presets end today; the calendar ones cover their whole month / quarter / year. */
export function resolveRange(view: StatsView, today: Date = new Date()): { from?: string; to?: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const span = (start: Date, end: Date) => ({ from: isoLocal(start), to: isoLocal(end) });
  const quarterStart = Math.floor(m / 3) * 3;
  switch (view.range) {
    case "30d":
    case "90d": {
      const start = new Date(y, m, today.getDate() - (view.range === "30d" ? 30 : 90));
      return span(start, today);
    }
    case "this-month":
      return span(new Date(y, m, 1), new Date(y, m + 1, 0));
    case "last-month":
      return span(new Date(y, m - 1, 1), new Date(y, m, 0));
    case "this-quarter":
      return span(new Date(y, quarterStart, 1), new Date(y, quarterStart + 3, 0));
    case "last-quarter":
      return span(new Date(y, quarterStart - 3, 1), new Date(y, quarterStart, 0));
    case "this-year":
      return span(new Date(y, 0, 1), new Date(y, 11, 31));
    case "all":
      return {};
    case "custom":
      return { from: view.from || undefined, to: view.to || undefined };
  }
}

/** "3 Aug – 31 Oct 2026", "from 3 Aug 2026", "up to 31 Oct 2026" or "All time". */
export function rangeLabel(range: { from?: string; to?: string }): string {
  const { from, to } = range;
  if (from && to) return formatDateRangeUTC(parseDateOnly(from), parseDateOnly(to));
  const full = (iso: string) =>
    parseDateOnly(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  if (from) return `From ${full(from)}`;
  if (to) return `Up to ${full(to)}`;
  return "All time";
}

/** A series point's period for an axis tick ("6 Jul", "Jul 2026", "Q3 2026"), or with `long` for a
 * tooltip or the CSV ("w/c 6 Jul 2026", "July 2026", "Q3 2026"). `iso` is the period's first day. */
export function formatPeriod(iso: string, group: GroupBy, long = false): string {
  const d = parseDateOnly(iso);
  if (group === "quarter") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  if (group === "month") {
    return d.toLocaleDateString("en-GB", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });
  }
  return long ? `w/c ${formatShortDateUTC(d)} ${d.getUTCFullYear()}` : formatShortDateUTC(d);
}

function pct(part: number, whole: number): string {
  return whole ? (Math.round((1000 * part) / whole) / 10).toString() : "";
}

/** The report as CSV: one row per period with every trend figure, then a Total row. */
export function statsCsv(data: StatsResponse): string {
  const group = data.group_by;
  const byPeriod = <T extends { period: string }>(rows: T[]) => new Map(rows.map((r) => [r.period, r]));
  const series = byPeriod(data.throughput.series);
  const fill = byPeriod(data.reuse.plate_fill);
  const failures = byPeriod(data.failures.failure_rate_trend);
  const avgUses = byPeriod(data.reuse.avg_uses_trend);
  const imports = byPeriod(data.inventory.import_volume);
  const periods = [...new Set([...series.keys(), ...fill.keys(), ...failures.keys(), ...avgUses.keys(), ...imports.keys()])].sort();

  const headers = [
    "Period",
    "Starts",
    "Runs completed",
    "Samples sequenced",
    "Planned runs",
    "Wells used",
    "Plate capacity (wells)",
    "Plate fill %",
    "Wells loaded",
    "Failed",
    "Failure rate %",
    "Avg uses per cell",
    "Samples imported",
  ];
  const rows = periods.map((p) => {
    const s = series.get(p);
    const f = fill.get(p);
    const fr = failures.get(p);
    return [
      formatPeriod(p, group, true),
      p,
      String(s?.runs_completed ?? 0),
      String(s?.samples_sequenced ?? 0),
      String(s?.planned_runs ?? 0),
      String(f?.filled ?? 0),
      String(f?.capacity ?? 0),
      pct(f?.filled ?? 0, f?.capacity ?? 0),
      String(fr?.total ?? 0),
      String(fr?.failed ?? 0),
      pct(fr?.failed ?? 0, fr?.total ?? 0),
      avgUses.has(p) ? String(avgUses.get(p)!.avg_uses) : "",
      String(imports.get(p)?.imported ?? 0),
    ];
  });

  const h = data.headline;
  const sum = <T>(m: Map<string, T>, get: (row: T) => number) => [...m.values()].reduce((n, r) => n + get(r), 0);
  rows.push([
    "Total",
    "",
    String(h.runs_completed),
    String(h.samples_sequenced),
    String(h.planned_runs),
    String(sum(fill, (r) => r.filled)),
    String(sum(fill, (r) => r.capacity)),
    String(h.plate_fill_pct),
    String(sum(failures, (r) => r.total)),
    String(sum(failures, (r) => r.failed)),
    String(h.failure_rate),
    String(h.avg_uses_per_cell),
    String(sum(imports, (r) => r.imported)),
  ]);
  return toCsv(headers, rows);
}

/** "runnx-stats_2026-08-01_2026-10-31_by-month[_84047].csv" */
export function statsCsvFilename(range: { from?: string; to?: string }, view: StatsView): string {
  const parts = ["runnx-stats", range.from ?? "start", range.to ?? "now", `by-${view.group}`];
  if (view.instrument) parts.push(view.instrument);
  return `${parts.join("_")}.csv`;
}
