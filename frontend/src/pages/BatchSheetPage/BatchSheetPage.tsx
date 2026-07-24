import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { batchSheetApi } from "@/api/batchSheet";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { BatchSheetPlateOut, BatchSheetRunOut, BatchSheetWellOut } from "@/types/batchSheet";
import { formatShortDateTimeUTC, parseDateOnly } from "@/utils/calendarDates";
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

function WellRow({ well }: { well: BatchSheetWellOut }) {
  return (
    <tr>
      <td>{well.well}</td>
      <td>
        <div className={styles.cellCode}>{well.cell_ref}</div>
        <div className={styles.meta}>Use {well.use_number} of 3</div>
        {well.window_breached && <div className={styles.warn}>⚠ 108h window expired</div>}
        {!well.window_breached && well.cell_window_deadline && (
          <div className={styles.meta}>Reuse by {formatShortDateTimeUTC(well.cell_window_deadline)}</div>
        )}
      </td>
      <td>
        <div>{well.sample_external_id ?? "—"}</div>
      </td>
      <td>{well.barcodes.length > 0 ? well.barcodes.join(", ") : "—"}</td>
      <td>
        <div>Movie time: {well.run_time_hours}h</div>
        <div>Adaptive loading: {well.adaptive_loading ?? "—"}</div>
        <div>Include base kinetics: {well.ccs_kinetics ?? "—"}</div>
        <div>Full-res baseQ: {well.full_resolution_base_q ?? "—"}</div>
      </td>
      <td>{well.target_oplc ?? "—"}</td>
      <td>{well.volume ?? "—"}</td>
      <td className={styles.notesCell}>{well.notes ? well.notes : "—"}</td>
    </tr>
  );
}

/** SOP 7.3 — Final complex loading dilution, per plate. One row per well; the app pre-fills
 * what it knows (well, Traction ID, target OPLC) and leaves the dilution volumes and achieved
 * OPLC as blank cells to hand-write at the bench, since the app has no complex-concentration
 * data. */
function DilutionWorksheet({ plate }: { plate: BatchSheetPlateOut }) {
  return (
    <>
      <div className={styles.sectionSub}>7.3 · Final complex loading dilution — {plateHeading(plate)}</div>
      <table className={styles.worksheetTable}>
        <thead>
          <tr>
            <th>Well</th>
            <th>Traction ID</th>
            <th>
              Target OPLC <span className={styles.unit}>(pM)</span>
            </th>
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
            <th>Init</th>
          </tr>
        </thead>
        <tbody>
          {plate.wells.map((w) => (
            <tr key={w.slot_index}>
              <td>{w.well}</td>
              <td>{w.sample_external_id ?? "—"}</td>
              <td>{w.target_oplc ?? ""}</td>
              <td className={styles.entryCell} />
              <td className={styles.entryCell} />
              <td className={styles.entryCell} />
              <td className={styles.entryCell} />
              <td className={styles.entryCell} />
              <td className={styles.entryCell} />
            </tr>
          ))}
        </tbody>
      </table>
    </>
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
      <div className={styles.prepChecks}>
        <span>
          <span className={styles.check} />
          Vortexed 1 min @ 1800
        </span>
        <span>
          <span className={styles.check} />
          Spun down
        </span>
        <span>
          <span className={styles.check} />
          Foil pierced (A1–D1)
        </span>
      </div>
      <table className={styles.worksheetTable}>
        <thead>
          <tr>
            <th>Well</th>
            <th>Sample</th>
            <th>
              23 <span className={styles.unit}>µL</span> loaded
            </th>
            <th>Sealed</th>
            <th>Init</th>
          </tr>
        </thead>
        <tbody>
          {plate.wells.map((w) => (
            <tr key={w.slot_index}>
              <td>{w.well}</td>
              <td>{w.sample_external_id ?? "—"}</td>
              <td>
                <span className={styles.check} />
              </td>
              <td>
                <span className={styles.check} />
              </td>
              <td className={styles.entryCell} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One run = one load session on one instrument, holding 1-2 plates. The well table splits
 * into a tbody per plate; the SOP 7.3/7.4 worksheets repeat per plate too. */
function RunSection({ run }: { run: BatchSheetRunOut }) {
  const movieHours = run.plates.map((p) => p.movie_hours);
  const longestMovie = movieHours.length > 0 ? Math.max(...movieHours) : 0;

  return (
    <section className={styles.instrumentSection}>
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

      <table className={styles.wellTable}>
        <thead>
          <tr>
            <th>Well</th>
            <th>Cell</th>
            <th>Container ID</th>
            <th>Barcodes</th>
            <th>Settings</th>
            <th>Target OPLC</th>
            <th>Volume</th>
            <th>Notes</th>
          </tr>
        </thead>
        {run.plates.map((plate) => (
          <tbody key={plate.plate_number}>
            <tr className={styles.trayHeader}>
              <td colSpan={8}>{plateHeading(plate)}</td>
            </tr>
            {plate.wells.map((w) => (
              <WellRow key={w.slot_index} well={w} />
            ))}
          </tbody>
        ))}
      </table>

      {run.plates.map((plate) => (
        <DilutionWorksheet key={plate.plate_number} plate={plate} />
      ))}
      {run.plates.map((plate) => (
        <PlateLoadingChecklist key={plate.plate_number} plate={plate} />
      ))}
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
            <RunSection key={run.run_id} run={run} />
          ))}
        </>
      )}
    </div>
  );
}
