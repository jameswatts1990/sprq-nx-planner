import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { batchSheetApi } from "@/api/batchSheet";
import { settingsApi, type SampleDefaults } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { BatchSheetPlateOut, BatchSheetRunOut, BatchSheetWellOut } from "@/types/batchSheet";
import { formatShortDateTimeLocal, parseDateOnly } from "@/utils/calendarDates";
import { plateWellFromSlot } from "@/utils/plateWell";
import { runLabel } from "@/utils/runLabel";

import styles from "./BatchSheetPage.module.css";

function formatFullDate(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Compact "Thu 24 Jul" for a plate's acquisition day. */
function formatAcquireDate(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "Plate 1 · acquires Thu 24 Jul" / "Plate 2 · acquires Fri 25 Jul · reuse (Use 2)". */
function plateHeading(plate: BatchSheetPlateOut): string {
  const parts = [`Plate ${plate.plate_number}`, `acquires ${formatAcquireDate(plate.acquire_date)}`];
  if (plate.is_reuse) {
    const use = plate.wells[0]?.use_number;
    parts.push(use ? `reuse (Use ${use})` : "reuse");
  }
  return parts.join(" · ");
}

/** One setting in the well row's Settings cell. When the sample's value differs from the
 * configured Sample Default it prints bold with a trailing "*", so a non-default setting is
 * obvious at a glance (the "*" keeps it legible in black-and-white print). A blank/unknown
 * value or one equal to the default prints plainly. */
function SettingSpan({
  label,
  value,
  defaultValue,
}: {
  label: string;
  value: string | null;
  defaultValue?: string;
}) {
  const differs = value != null && defaultValue != null && value !== defaultValue;
  return (
    <span>
      {label} {differs ? <span className={styles.settingDiff}>{value}*</span> : value ?? "—"}
    </span>
  );
}

function WellRow({ well, defaults }: { well: BatchSheetWellOut; defaults?: SampleDefaults }) {
  return (
    <tr>
      <td>{plateWellFromSlot(well.slot_index, { qualified: true })}</td>
      <td>
        <div className={styles.cellCode}>{well.cell_ref}</div>
        <div className={styles.meta}>
          Use {well.use_number} of 3
          {!well.window_breached &&
            well.cell_window_deadline &&
            ` · reuse by ${formatShortDateTimeLocal(well.cell_window_deadline)}`}
        </div>
        {well.window_breached && <div className={styles.warn}>⚠ 108h window expired</div>}
      </td>
      <td>
        <div>{well.sample_external_id ?? "—"}</div>
      </td>
      <td>{well.parent_sample ?? "—"}</td>
      <td className={styles.settingsCell}>
        <span>Movie {well.run_time_hours}h</span>
        <SettingSpan label="Adaptive" value={well.adaptive_loading} defaultValue={defaults?.adaptive_loading} />
        <SettingSpan label="Kinetics" value={well.base_kinetics} defaultValue={defaults?.base_kinetics} />
        <SettingSpan
          label="baseQ"
          value={well.full_resolution_base_q}
          defaultValue={defaults?.full_resolution_base_q}
        />
      </td>
      <td>{well.actual_oplc ?? "—"}</td>
      <td className={styles.notesCell}>{well.notes ? well.notes : "—"}</td>
    </tr>
  );
}

/** A SOP 7.3 dilution-volume cell: prints the imported volume when the scheduler sheet
 * supplied one, otherwise a blank box to hand-write at the bench. */
function WorksheetVolumeCell({ value }: { value: number | null }) {
  return value != null ? <td>{value}</td> : <td className={styles.entryCell} />;
}

/** Control Dilution 3 is always 1 µL, so the batch sheet prints a fixed value rather than
 * carrying it per sample. */
const CONTROL_DILUTION_3_UL = 1;

/** Final loading volume = complex + loading buffer + the fixed 1 µL control dilution 3.
 * Computed only when the two per-sample inputs are known (they share the same all-or-nothing
 * import path); otherwise the cell is left blank to hand-write once the volumes are worked out
 * at the bench. Rounded to shed binary-float noise (e.g. 0.1 + 0.2). */
function finalVolume(w: BatchSheetWellOut): number | null {
  const { cleaned_complex_volume: c, loading_buffer_volume: b } = w;
  if (c == null || b == null) return null;
  return Number((c + b + CONTROL_DILUTION_3_UL).toFixed(2));
}

/** SOP 7.3 — Final complex loading dilution, per plate. One row per well; the app pre-fills
 * what it knows (well, Traction ID, the achieved/actual OPLC when recorded, the fixed 1 µL
 * control dilution 3, and — when the scheduler sheet supplied them — the complex and
 * loading-buffer volumes) and leaves anything unknown as blank cells to hand-write at the bench. */
function DilutionWorksheet({ plate }: { plate: BatchSheetPlateOut }) {
  return (
    <div className={styles.worksheetCol}>
      <div className={styles.sectionSub}>7.3 · Final complex loading dilution — {plateHeading(plate)}</div>
      <table className={styles.worksheetTable}>
        <thead>
          <tr>
            <th>Well</th>
            <th>Traction ID</th>
            <th>
              Complex vol <span className={styles.unit}>(µL)</span>
            </th>
            <th>
              Loading buffer <span className={styles.unit}>(µL)</span>
            </th>
            <th>
              Control Dil-3 <span className={styles.unit}>(µL)</span>
            </th>
            <th>
              Final vol <span className={styles.unit}>(µL)</span>
            </th>
            <th>
              Actual OPLC <span className={styles.unit}>(pM)</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {plate.wells.map((w) => (
            <tr key={w.slot_index}>
              <td>{plateWellFromSlot(w.slot_index, { qualified: true })}</td>
              <td>{w.sample_external_id ?? "—"}</td>
              {/* Pre-filled from import when the scheduler sheet supplied a value; otherwise a
                  blank box to hand-write at the bench. */}
              <WorksheetVolumeCell value={w.cleaned_complex_volume} />
              <WorksheetVolumeCell value={w.loading_buffer_volume} />
              {/* Control Dilution 3 is always 1 µL. */}
              <td>{CONTROL_DILUTION_3_UL}</td>
              {/* Final vol = complex + loading buffer + control dilution 3; blank to write in
                  when any input is missing. */}
              <WorksheetVolumeCell value={finalVolume(w)} />
              {/* Actual OPLC: pre-filled when recorded, otherwise a blank box to write in. */}
              <WorksheetVolumeCell value={w.actual_oplc} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** SOP 7.4 — Adding samples to the sequencing plate. One block per plate (both plates load in
 * the same session), with a QR/serial write-in, plate-prep ticks, and a per-well "23 µL loaded
 * / sealed" checklist. A reuse Plate 2 is loaded now too even though the instrument sequences
 * it a day later. */
function PlateLoadingChecklist({ plate }: { plate: BatchSheetPlateOut }) {
  return (
    <div className={styles.plateBlock}>
      <div className={styles.sectionSub}>7.4 · Plate loading — {plateHeading(plate)}</div>
      <div className={styles.qrLine}>
        Plate QR / serial no.: <span className={styles.qrBlank} />
      </div>
      <div className={styles.qrLine}>
        Time loaded: <span className={styles.qrBlankShort} />
      </div>
      <div className={styles.prepChecks}>
        <span>
          <span className={styles.check} />
          Humidity &gt;25%rH
        </span>
        <span>
          <span className={styles.check} />
          Tips Refilled
        </span>
        <span>
          <span className={styles.check} />
          Deck Reloaded
        </span>
        <span>
          <span className={styles.check} />
          Excess Cells Disposed (if required)
        </span>
      </div>
      <table className={styles.worksheetTable}>
        <thead>
          <tr>
            <th>Well</th>
            <th>Sample</th>
            <th>Control Dil. Added</th>
            <th>
              23 <span className={styles.unit}>µL</span> loaded
            </th>
          </tr>
        </thead>
        <tbody>
          {plate.wells.map((w) => (
            <tr key={w.slot_index}>
              <td>{plateWellFromSlot(w.slot_index, { qualified: true })}</td>
              <td>{w.sample_external_id ?? "—"}</td>
              <td>
                <span className={styles.check} />
              </td>
              <td>
                <span className={styles.check} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One run = one load session on one instrument, holding 1-2 plates. The well table splits
 * into a tbody per plate; the SOP 7.3/7.4 worksheets repeat per plate too. */
function RunSection({ run, defaults }: { run: BatchSheetRunOut; defaults?: SampleDefaults }) {
  const movieHours = run.plates.map((p) => p.movie_hours);
  const longestMovie = movieHours.length > 0 ? Math.max(...movieHours) : 0;

  return (
    <section className={styles.instrumentSection}>
      <div className={styles.runHeader}>
        <div>
          <h2 className={styles.instrumentTitle}>
            {run.instrument_name}
            {run.instrument_name !== run.instrument_serial && (
              <span className={styles.meta}> ({run.instrument_serial})</span>
            )}
            <span className={styles.meta}> · Run {runLabel(run)}</span>
          </h2>
          <div className={styles.instrumentMeta}>
            <span>Load day: {formatFullDate(run.load_date)}</span>
            <span>Plates: {run.plates.length}</span>
            <span>Movie time (longest): {longestMovie}h</span>
            <span>Status: {run.status}</span>
          </div>
        </div>
        {/* Sign-off box (top-right of each run's page) for the tech to date and initial. */}
        <div className={styles.signBlock}>
          <div className={styles.signLine}>
            Date: <span className={styles.signBlank} />
          </div>
          <div className={styles.signLine}>
            Signed / initials: <span className={styles.signBlank} />
          </div>
        </div>
      </div>

      <table className={styles.wellTable}>
        <thead>
          <tr>
            <th>Well</th>
            <th>Cell</th>
            <th>Container ID</th>
            <th>Parent sample</th>
            <th>Settings</th>
            <th>Actual OPLC</th>
            <th>Notes</th>
          </tr>
        </thead>
        {run.plates.map((plate) => (
          <tbody key={plate.plate_number}>
            <tr className={styles.trayHeader}>
              <td colSpan={7}>{plateHeading(plate)}</td>
            </tr>
            {plate.wells.map((w) => (
              <WellRow key={w.slot_index} well={w} defaults={defaults} />
            ))}
          </tbody>
        ))}
      </table>
      <div className={styles.footnote}>* differs from configured default</div>

      <div className={styles.worksheetRow}>
        {run.plates.map((plate) => (
          <DilutionWorksheet key={plate.plate_number} plate={plate} />
        ))}
      </div>
      <div className={styles.worksheetRow}>
        {run.plates.map((plate) => (
          <PlateLoadingChecklist key={plate.plate_number} plate={plate} />
        ))}
      </div>
    </section>
  );
}

/** Standalone printable batch sheet, opened in a new tab from the Schedule page's
 * "Print Batch Sheet" modal. Rendering is deliberately plain HTML + print CSS rather
 * than a generated PDF file - the browser's own print-to-PDF covers that, with no new
 * backend dependency and no native-library install headaches. */
export function BatchSheetPage() {
  const [params] = useSearchParams();
  const date = params.get("date") ?? "";
  const instrumentsParam = params.get("instruments") ?? "";
  const instrumentSerials = instrumentsParam ? instrumentsParam.split(",").filter(Boolean) : undefined;

  const query = useQuery({
    queryKey: ["batch-sheet", date, instrumentSerials],
    queryFn: () => batchSheetApi.get(date, instrumentSerials),
    enabled: date.length > 0,
  });

  // The configured Sample Defaults, so the Settings column can flag values that differ.
  const defaultsQuery = useQuery({
    queryKey: ["sample-defaults"],
    queryFn: () => settingsApi.getSampleDefaults(),
  });

  // Name the tab — and so the browser's Save-as-PDF default filename — "YYYY.MM.DD - Revio <serial>".
  // A sheet covering several Revios joins their serials; falls back to the picked date before data loads.
  useEffect(() => {
    const data = query.data;
    const isoDate = data?.load_date ?? date;
    const dotDate = isoDate ? isoDate.replace(/-/g, ".") : "";
    const serials = data
      ? Array.from(new Set(data.runs.map((r) => r.instrument_serial)))
      : instrumentsParam.split(",").filter(Boolean);
    const revioPart = serials.length > 0 ? ` - Revio ${serials.join(", ")}` : "";
    const previousTitle = document.title;
    document.title = dotDate ? `${dotDate}${revioPart}` : "Batch Sheet";
    return () => {
      document.title = previousTitle;
    };
  }, [query.data, date, instrumentsParam]);

  return (
    <div className={styles.page}>
      <div className={`${styles.controls} ${styles.noPrint}`}>
        <Link to="/schedule" className={styles.backLink}>
          ◂ Back to Schedule
        </Link>
        <Button variant="primary" onClick={() => window.print()} disabled={!query.data}>
          Print / Save as PDF
        </Button>
      </div>

      {!date && (
        <Note tone="bad" icon="!">
          No date specified.
        </Note>
      )}

      {query.isLoading && <div className={styles.status}>Loading batch sheet…</div>}
      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load batch sheet."}
        </Note>
      )}

      {query.data && (
        <>
          <h1 className={styles.title}>Batch Sheet — loaded {formatFullDate(query.data.load_date)}</h1>
          {query.data.runs.length === 0 && (
            <Note tone="info" icon="i">
              No runs loaded for the selected instrument(s) on this day.
            </Note>
          )}
          {query.data.runs.map((run) => (
            <RunSection key={run.run_id} run={run} defaults={defaultsQuery.data} />
          ))}
        </>
      )}
    </div>
  );
}
