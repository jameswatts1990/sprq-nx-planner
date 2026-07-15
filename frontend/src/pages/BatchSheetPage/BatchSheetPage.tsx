import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { batchSheetApi } from "@/api/batchSheet";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { BatchSheetInstrumentOut, BatchSheetWellOut } from "@/types/batchSheet";
import { formatShortDateTimeUTC, parseDateOnly } from "@/utils/calendarDates";

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

function trayOf(well: BatchSheetWellOut): 1 | 2 {
  return well.slot_index < 4 ? 1 : 2;
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
        {well.sample_container_id && <div className={styles.meta}>Container {well.sample_container_id}</div>}
      </td>
      <td>{well.barcodes.length > 0 ? well.barcodes.join(", ") : "—"}</td>
      <td>
        <div>Adaptive loading: {well.adaptive_loading ?? "—"}</div>
        <div>CCS kinetics: {well.ccs_kinetics ?? "—"}</div>
        <div>Full-res baseQ: {well.full_resolution_base_q ?? "—"}</div>
      </td>
      <td>
        {well.oplc ?? "—"}
        {well.target_oplc != null && <div className={styles.meta}>Target {well.target_oplc}</div>}
      </td>
      <td>{well.volume ?? "—"}</td>
    </tr>
  );
}

function InstrumentSection({ instrument }: { instrument: BatchSheetInstrumentOut }) {
  const tray1 = instrument.wells.filter((w) => trayOf(w) === 1);
  const tray2 = instrument.wells.filter((w) => trayOf(w) === 2);

  return (
    <section className={styles.instrumentSection}>
      <h2 className={styles.instrumentTitle}>
        {instrument.instrument_name}
        {instrument.instrument_name !== instrument.instrument_serial && (
          <span className={styles.meta}> ({instrument.instrument_serial})</span>
        )}
      </h2>
      <div className={styles.instrumentMeta}>
        <span>Movie time: {instrument.movie_hours}h</span>
        <span>Planned start: {new Date(instrument.planned_start_at).toLocaleString()}</span>
        <span>Planned end: {new Date(instrument.planned_end_at).toLocaleString()}</span>
        <span>Status: {instrument.status}</span>
      </div>

      <table className={styles.wellTable}>
        <thead>
          <tr>
            <th>Well</th>
            <th>Cell</th>
            <th>Sample</th>
            <th>Barcodes</th>
            <th>Settings</th>
            <th>OPLC</th>
            <th>Volume</th>
          </tr>
        </thead>
        {tray1.length > 0 && (
          <tbody>
            <tr className={styles.trayHeader}>
              <td colSpan={7}>Tray 1</td>
            </tr>
            {tray1.map((w) => (
              <WellRow key={w.well} well={w} />
            ))}
          </tbody>
        )}
        {tray2.length > 0 && (
          <tbody>
            <tr className={styles.trayHeader}>
              <td colSpan={7}>Tray 2</td>
            </tr>
            {tray2.map((w) => (
              <WellRow key={w.well} well={w} />
            ))}
          </tbody>
        )}
      </table>
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
          <h1 className={styles.title}>Batch Sheet — {formatFullDate(query.data.run_date)}</h1>
          {query.data.instruments.length === 0 && (
            <Note tone="info" icon="i">
              No runs scheduled for the selected instrument(s) on this day.
            </Note>
          )}
          {query.data.instruments.map((instrument) => (
            <InstrumentSection key={instrument.cycle_id} instrument={instrument} />
          ))}
        </>
      )}
    </div>
  );
}
