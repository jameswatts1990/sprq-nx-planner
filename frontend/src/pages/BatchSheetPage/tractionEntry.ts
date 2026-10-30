/** Pure helpers behind the Batch Sheet's on-screen view, which mirrors Traction's run form
 * (Run Details → Well Defaults → Plates 1/2 with wells A1-D1) so a run can be keyed into
 * Traction straight off the screen.
 *
 * "Non-default" means "differs from Settings → Sample defaults / default movie hours" - the
 * same baseline as the printed sheet's "*" and MovieTimeFlag. Out of the box those match
 * Traction's own Well Defaults presets, so a flagged value is exactly one the user must change
 * in Traction's well form. A blank/unknown value is never flagged. */

import type { SampleDefaults } from "@/api/settings";
import type { NoteTone } from "@/components/ui/Note";
import type { BatchSheetPlateOut, BatchSheetRunOut, BatchSheetWellOut } from "@/types/batchSheet";
import { tractionWellFromSlot } from "@/utils/plateWell";

const POSITIONS_PER_PLATE = 4;

/** Traction's well form shows booleans as "True"/"False", the same strings RunNx stores. */
function differs(value: string | null, defaultValue: string | undefined): boolean {
  return value != null && defaultValue != null && value !== defaultValue;
}

/** "P2 A1": a well as Traction labels it, plus its plate, for run-level reminders. */
export function wellName(well: BatchSheetWellOut): string {
  return `P${well.plate_number} ${tractionWellFromSlot(well.slot_index)}`;
}

function allWells(run: BatchSheetRunOut): BatchSheetWellOut[] {
  return run.plates.flatMap((p) => p.wells);
}

/** A plate's four Traction positions A1-D1, each the well loaded there or null if empty.
 * Placed by slot_index (never the stored loading well - see utils/plateWell.ts). */
export function platePositions(plate: BatchSheetPlateOut): (BatchSheetWellOut | null)[] {
  const positions: (BatchSheetWellOut | null)[] = Array.from({ length: POSITIONS_PER_PLATE }, () => null);
  for (const w of plate.wells) positions[w.slot_index % POSITIONS_PER_PLATE] = w;
  return positions;
}

export interface SettingDiff {
  /** Traction's field label, e.g. "Include Base Kinetics". */
  field: string;
  /** Short chip label, e.g. "Kinetics". */
  short: string;
  value: string;
  defaultValue: string;
}

/** The per-well Traction settings (other than movie time, which MovieTimeFlag covers) that
 * differ from the defaults. Adaptive Loading is deliberately absent: Traction sets it once per
 * run, so it is handled by runAdaptiveLoading instead. */
export function wellSettingDiffs(well: BatchSheetWellOut, defaults: SampleDefaults | undefined): SettingDiff[] {
  if (!defaults) return [];
  const candidates: SettingDiff[] = [];
  if (well.base_kinetics != null) {
    candidates.push({
      field: "Include Base Kinetics",
      short: "Kinetics",
      value: well.base_kinetics,
      defaultValue: defaults.base_kinetics,
    });
  }
  if (well.full_resolution_base_q != null) {
    candidates.push({
      field: "Full Resolution Base Qual",
      short: "Full Res BaseQ",
      value: well.full_resolution_base_q,
      defaultValue: defaults.full_resolution_base_q,
    });
  }
  return candidates.filter((c) => differs(c.value, c.defaultValue));
}

/** Whether the well needs any change from Traction's Well Defaults in its own well form. */
export function wellIsNonDefault(
  well: BatchSheetWellOut,
  defaults: SampleDefaults | undefined,
  defaultHours: number,
): boolean {
  return well.run_time_hours !== defaultHours || wellSettingDiffs(well, defaults).length > 0;
}

export type RunAdaptiveLoading =
  | { kind: "unknown" }
  | { kind: "uniform"; value: string }
  | { kind: "mixed"; groups: { value: string; wells: string[] }[] };

/** The run's Adaptive Loading. Traction's "Use Adaptive Loading" is a single run-wide setting
 * (it overrides, and greys out, each well's own), so wells that disagree can't all be entered
 * as scheduled. Wells with no recorded value don't count either way. */
export function runAdaptiveLoading(run: BatchSheetRunOut): RunAdaptiveLoading {
  const byValue = new Map<string, string[]>();
  for (const w of allWells(run)) {
    if (w.adaptive_loading == null) continue;
    byValue.set(w.adaptive_loading, [...(byValue.get(w.adaptive_loading) ?? []), wellName(w)]);
  }
  if (byValue.size === 0) return { kind: "unknown" };
  if (byValue.size === 1) return { kind: "uniform", value: [...byValue.keys()][0] };
  return { kind: "mixed", groups: [...byValue].map(([value, wells]) => ({ value, wells })) };
}

export interface Reminder {
  tone: NoteTone;
  icon: string;
  text: string;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The run-level "check before you enter this in Traction" notes, pushed most serious first
 * (bad → warn → info). Empty when there's nothing to flag. */
export function runReminders(
  run: BatchSheetRunOut,
  defaults: SampleDefaults | undefined,
  defaultHours: number,
): Reminder[] {
  const wells = allWells(run);
  const reminders: Reminder[] = [];

  const expired = wells.filter((w) => w.window_breached).map(wellName);
  if (expired.length > 0) {
    reminders.push({
      tone: "bad",
      icon: "!",
      text:
        `${expired.join(", ")}: ${plural(expired.length, "the cell is", "these cells are")} past the ` +
        `108 h reuse window. Check with the scheduler before loading.`,
    });
  }

  const adaptive = runAdaptiveLoading(run);
  if (adaptive.kind === "mixed") {
    const listed = adaptive.groups.map((g) => `${g.value} on ${g.wells.join(", ")}`).join("; ");
    reminders.push({
      tone: "warn",
      icon: "!",
      text:
        `Wells disagree on Adaptive Loading (${listed}). Traction sets Use Adaptive Loading once for ` +
        `the whole run, so choose one value in Well Defaults.`,
    });
  } else if (adaptive.kind === "uniform" && differs(adaptive.value, defaults?.adaptive_loading)) {
    reminders.push({
      tone: "info",
      icon: "i",
      text:
        `Every well in this run uses Adaptive Loading ${adaptive.value}. Set Use Adaptive Loading to ` +
        `${adaptive.value} in Well Defaults (it applies to the whole run).`,
    });
  }

  const nonDefault = wells.filter((w) => wellIsNonDefault(w, defaults, defaultHours)).map(wellName);
  if (nonDefault.length > 0) {
    reminders.push({
      tone: "info",
      icon: "i",
      text:
        `${nonDefault.length} ${plural(nonDefault.length, "well has", "wells have")} settings that differ ` +
        `from the defaults (${nonDefault.join(", ")}). Change them in each well's form; they're marked below.`,
    });
  }

  const noConc = wells.filter((w) => w.actual_oplc == null).map(wellName);
  if (noConc.length > 0) {
    reminders.push({
      tone: "info",
      icon: "i",
      text:
        `Library Concentration isn't recorded for ${noConc.length} ` +
        `${plural(noConc.length, "well", "wells")} (${noConc.join(", ")}). Enter it in Traction by hand.`,
    });
  }

  return reminders;
}
