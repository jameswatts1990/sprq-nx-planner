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
      </td>
      <td>{well.barcodes.length > 0 ? well.barcodes.join(", ") : "—"}</td>
      <td>
        <div>Adaptive loading: {well.adaptive_loading ?? "—"}</div>
        <div>Include base kinetics: {well.ccs_kinetics ?? "—"}</div>
        <div>Full-res baseQ: {well.full_resolution_base_q ?? "—"}</div>
      </td>
      <td>{well.target_oplc ?? "—"}</td>
      <td>{well.volume ?? "—"}</td>
    </tr>
  );
}

/** SOP 7.3 — Final complex loading dilution. One row per well; the app pre-fills what it
 * knows (well, Traction ID, target OPLC) and leaves the dilution volumes and achieved OPLC as
 * blank cells to hand-write at the bench, since the app has no complex-concentration data. */
function DilutionWorksheet({ wells }: { wells: BatchSheetWellOut[] }) {
  return (
    <>
      <div className={styles.sectionSub}>7.3 · Final complex loading dilution</div>
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
          {wells.map((w) => (
            <tr key={w.well}>
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

/** SOP 7.4 — Adding samples to the sequencing plate. One block per physical plate (tray), with a
 * QR/serial write-in, plate-prep ticks, and a per-well "23 µL loaded / sealed" checklist. */
function PlateLoadingChecklist({ tray, wells }: { tray: 1 | 2; wells: BatchSheetWellOut[] }) {
  return (
    <div className={styles.plateBlock}>
      <div className={styles.sectionSub}>7.4 · Plate loading — Tray {tray}</div>
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
          {wells.map((w) => (
            <tr key={w.well}>
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
            <th>Container ID</th>
            <th>Barcodes</th>
            <th>Settings</th>
            <th>Target OPLC</th>
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

      <DilutionWorksheet wells={instrument.wells} />
      {tray1.length > 0 && <PlateLoadingChecklist tray={1} wells={tray1} />}
      {tray2.length > 0 && <PlateLoadingChecklist tray={2} wells={tray2} />}
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
