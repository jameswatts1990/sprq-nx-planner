import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { batchSheetApi } from "@/api/batchSheet";
import { settingsApi } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";

import styles from "./BatchSheetPage.module.css";
import { formatFullDate, PrintedRun } from "./PrintedRun";
import { TractionRun } from "./TractionRun";

/** The day's Batch Sheet, opened in a new tab from the Schedule page's "Batch Sheet" modal.
 * On screen it is a virtual batch sheet laid out like Traction's run form (TractionRun), for
 * keying each run into Traction with one-click copies; printing swaps in the paper loading
 * sheet with its bench worksheets (PrintedRun). Rendering is deliberately plain HTML + print
 * CSS rather than a generated PDF file - the browser's own print-to-PDF covers that, with no
 * new backend dependency and no native-library install headaches. */
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

  // The configured Sample Defaults, so non-default settings can be flagged.
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

          <div className={styles.noPrint}>
            {query.data.runs.length > 0 && (
              <p className={styles.hint}>
                Each run is laid out like Traction&apos;s run form, top to bottom. Click a value to copy it, then
                paste it into the matching Traction field. <b>Print / Save as PDF</b> gives the paper loading sheet
                with the bench worksheets instead.
              </p>
            )}
            {query.data.runs.map((run) => (
              <TractionRun key={run.run_id} run={run} defaults={defaultsQuery.data} />
            ))}
          </div>

          {/* The paper sheet. Runs must stay siblings here: the print CSS starts each run after
              the first on a fresh page with an adjacent-sibling rule. */}
          <div className={styles.printOnly}>
            {query.data.runs.map((run) => (
              <PrintedRun key={run.run_id} run={run} defaults={defaultsQuery.data} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
