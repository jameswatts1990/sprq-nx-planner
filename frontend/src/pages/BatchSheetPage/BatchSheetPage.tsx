import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { batchSheetApi } from "@/api/batchSheet";
import { settingsApi } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";

import styles from "./BatchSheetPage.module.css";
import { formatFullDate, PrintedRun } from "./PrintedRun";
import { TractionRun } from "./TractionRun";

/** The day's Batch Sheet, opened from the Schedule page's "Batch Sheet" modal. On screen it
 * is a virtual batch sheet laid out like Traction's run form (TractionRun), one instrument at
 * a time, for keying each run into Traction with one-click copies and then confirming it
 * loaded; printing swaps in the paper loading sheet for every selected instrument, with its
 * bench worksheets (PrintedRun). Rendering is deliberately plain HTML + print
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

  const runs = query.data?.runs ?? [];
  const [index, setIndex] = useState(0);
  const current = Math.min(index, Math.max(runs.length - 1, 0));

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
      {/* The title prints once, small, above the first run; PageHeader drops the back link and
          the Print button on paper. */}
      <div className={styles.sheetTitle}>
        <PageHeader
          title={query.data ? `Batch Sheet — loaded ${formatFullDate(query.data.load_date)}` : "Batch Sheet"}
          back={{ to: "/schedule", label: "Schedule" }}
          actions={
            <Button variant="primary" onClick={() => window.print()} disabled={!query.data}>
              Print / Save as PDF
            </Button>
          }
        />
      </div>

      {!date && (
        <Note tone="bad" icon="!">
          No date specified.
        </Note>
      )}

      {query.isLoading && <div className="status">Loading batch sheet…</div>}
      {query.isError && (
        <Note tone="bad" icon="!">
          {errorMessage(query.error, "Couldn't load the batch sheet.")}
        </Note>
      )}

      {query.data && (
        <>
          {query.data.runs.length === 0 && (
            <div className="status">No runs loaded for the selected instrument(s) on this day.</div>
          )}

          {/* One instrument on screen at a time. The others stay mounted (hidden) so their copied
              marks and pre-flight ticks survive stepping away and back. */}
          <div className={styles.noPrint}>
            {runs.map((run, i) => (
              <div key={run.run_id} hidden={i !== current}>
                <TractionRun
                  run={run}
                  defaults={defaultsQuery.data}
                  nav={{
                    position: i + 1,
                    total: runs.length,
                    prev: i > 0 ? { label: runs[i - 1].instrument_name, go: () => setIndex(i - 1) } : undefined,
                    next:
                      i < runs.length - 1
                        ? { label: runs[i + 1].instrument_name, go: () => setIndex(i + 1) }
                        : undefined,
                  }}
                />
              </div>
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
