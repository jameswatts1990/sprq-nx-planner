import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { BacklogPage } from "@/pages/BacklogPage";
import { CellDetailPage } from "@/pages/CellDetailPage";
import { CellsPage } from "@/pages/CellsPage";
import { HistoryRunsPage } from "@/pages/HistoryRunsPage";
import { HistorySamplesPage } from "@/pages/HistorySamplesPage";
import { InstrumentsPage } from "@/pages/InstrumentsPage";
import { QcPage } from "@/pages/QcPage/QcPage";
import { RunDetailPage } from "@/pages/RunDetailPage";
import { SampleDetailPage } from "@/pages/SampleDetailPage";
import { SchedulePage } from "@/pages/SchedulePage/SchedulePage";

// Rare / heavy routes are code-split so their large dependencies stay out of the initial
// bundle that gates first paint of the default (Schedule) screen: StatsPage pulls in recharts,
// ImportPage pulls in read-excel-file, BatchSheetPage is a print-only view, and SettingsPage/
// HelpPage are visited rarely. The daily-workflow routes above stay eagerly imported.
const StatsPage = lazy(() => import("@/pages/StatsPage/StatsPage").then((m) => ({ default: m.StatsPage })));
const ImportPage = lazy(() => import("@/pages/ImportPage").then((m) => ({ default: m.ImportPage })));
const BatchSheetPage = lazy(() =>
  import("@/pages/BatchSheetPage/BatchSheetPage").then((m) => ({ default: m.BatchSheetPage })),
);
const SettingsPage = lazy(() => import("@/pages/SettingsPage/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const HelpPage = lazy(() => import("@/pages/HelpPage/HelpPage").then((m) => ({ default: m.HelpPage })));

/** Shown while a lazily-loaded route chunk is fetched - the AppShell (nav) stays mounted
 * around it, so only the page body swaps to this brief placeholder. */
function RouteFallback() {
  return <div style={{ padding: "2rem", color: "var(--grey)" }}>Loading…</div>;
}

/** The dedicated Tray page was folded into the Cells page as a `?tray=` filter; this keeps old
 * `/trays/:trayId` links and bookmarks working by redirecting to the equivalent filtered view. */
function TrayRedirect() {
  const { trayId } = useParams<{ trayId: string }>();
  return <Navigate to={trayId ? `/cells?tray=${trayId}` : "/cells"} replace />;
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/schedule" replace />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/backlog" element={<BacklogPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/print/batch-sheet" element={<BatchSheetPage />} />
          <Route path="/cells" element={<CellsPage />} />
          <Route path="/cells/:cellId" element={<CellDetailPage />} />
          <Route path="/qc" element={<QcPage />} />
          <Route path="/instruments" element={<InstrumentsPage />} />
          <Route path="/trays/:trayId" element={<TrayRedirect />} />
          <Route path="/history/runs" element={<HistoryRunsPage />} />
          <Route path="/history/runs/:runId" element={<RunDetailPage />} />
          <Route path="/history/samples" element={<HistorySamplesPage />} />
          <Route path="/samples/:sampleId" element={<SampleDetailPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Old bookmark: the Admin tab was renamed Settings. */}
          <Route path="/admin" element={<Navigate to="/settings" replace />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/schedule" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
