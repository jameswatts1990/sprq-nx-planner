import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { instrumentsApi } from "@/api/instruments";
import { scheduleApi } from "@/api/schedule";
import { ScheduleCalendar } from "@/components/calendar/ScheduleCalendar";
import { CellLoadingMap } from "@/components/cells/CellLoadingMap";
import { ScheduleKpiTiles } from "@/components/shared/ScheduleKpiTiles";
import { SectionHeading, UseLegend } from "@/components/shared/SectionHeading";
import { Button } from "@/components/ui/Button";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { KpiTile } from "@/components/ui/KpiTile";
import { Note } from "@/components/ui/Note";
import { NotesPanel } from "@/components/ui/NotesPanel";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import { CommitBar } from "./CommitBar";
import { buildScheduleCsv, downloadTextFile } from "./exportCsv";
import { InProgressCellsReview } from "./InProgressCellsReview";
import styles from "./PlanPage.module.css";
import { RunDesignPanel } from "./RunDesignPanel";
import { settingsFromSearchParams, settingsToSearchParams } from "./urlSettings";

export function PlanPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [excludedCellIds, setExcludedCellIds] = useState<number[]>([]);

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });
  const availableInstruments = (instrumentsQuery.data ?? []).map((i) => i.serial_number);

  // Memoized on the serialized search string + instrument list (not on `searchParams`
  // itself, which is a fresh object every render) so this object reference is stable
  // across re-renders that don't actually change anything - required for
  // useDebouncedValue below to ever settle.
  const searchKey = searchParams.toString();
  const instrumentsKey = availableInstruments.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const settings = useMemo(
    () => settingsFromSearchParams(searchParams, availableInstruments),
    [searchKey, instrumentsKey],
  );

  function updateSettings(next: typeof settings) {
    setSearchParams(settingsToSearchParams(next), { replace: true });
  }

  const debouncedSettings = useDebouncedValue(settings, 400);
  const debouncedExcluded = useDebouncedValue(excludedCellIds, 400);
  const canPreview = debouncedSettings.instrument_ids.length > 0;

  const previewQuery = useQuery({
    queryKey: ["schedulePreview", debouncedSettings, debouncedExcluded],
    queryFn: () => scheduleApi.preview({ settings: debouncedSettings, excluded_cell_ids: debouncedExcluded }),
    enabled: canPreview,
    placeholderData: (prev) => prev,
  });

  const preview = previewQuery.data;

  function handleExportCsv() {
    if (!preview) return;
    const csv = buildScheduleCsv(preview.cycles, settings.start_date);
    downloadTextFile("revio-nx-schedule.csv", csv, "text/csv");
  }

  return (
    <div className={styles.page}>
      <KpiStrip>
        {preview ? (
          <ScheduleKpiTiles kpi={preview.kpi} />
        ) : (
          <>
            <KpiTile label="Acquisitions" value="—" unit="samples to run" />
            <KpiTile label="SMRT Cells" value="—" unit="new cells" accent="blue" />
            <KpiTile label="Cell trays" value="—" unit="Nx trays (4 cells)" accent="teal" />
            <KpiTile label="Duration" value="—" unit="calendar days" accent="purple" />
            <KpiTile label="Reagent cost" value="—" unit="estimate, USD" />
            <KpiTile label="vs single-use" value="—" unit="reagent delta" accent="blue" />
          </>
        )}
      </KpiStrip>

      {previewQuery.isError && (
        <Note tone="bad" icon="!">
          {previewQuery.error instanceof ApiError ? previewQuery.error.message : "Failed to compute schedule preview."}
        </Note>
      )}
      {!canPreview && (
        <Note tone="info" icon="i">
          Select at least one instrument to preview a schedule.
        </Note>
      )}
      {preview && (
        <NotesPanel
          conflictPairs={preview.notes.conflict_pairs}
          unplacedCount={preview.notes.unplaced_sample_ids.length}
          windowFlags={preview.notes.window_flags}
          runTimeHours={settings.run_time_hours}
        />
      )}

      <SectionHeading title="Weekly schedule" legend={<UseLegend />} />
      <ScheduleCalendar
        cycles={preview?.cycles ?? []}
        instrumentSerials={settings.instrument_ids}
        startDate={settings.start_date}
      />

      <SectionHeading
        title="Cell loading map"
        legend={<span className={styles.legendNote}>Each cell&apos;s uses carry unique barcodes - no carryover clash</span>}
      />
      <CellLoadingMap cells={preview?.cells ?? []} />

      <div className={styles.exportBar}>
        <Button variant="primary" onClick={handleExportCsv} disabled={!preview || preview.cycles.length === 0}>
          Download schedule CSV
        </Button>
      </div>

      <div className={styles.panels}>
        <RunDesignPanel settings={settings} onChange={updateSettings} />
        <InProgressCellsReview excludedCellIds={excludedCellIds} onChange={setExcludedCellIds} />
        <CommitBar
          settings={settings}
          excludedCellIds={excludedCellIds}
          preview={preview}
          previewIsFetching={previewQuery.isFetching}
          previewIsError={previewQuery.isError}
        />
      </div>
    </div>
  );
}
