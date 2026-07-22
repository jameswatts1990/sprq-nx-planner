import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { AdminPage } from "@/pages/AdminPage/AdminPage";
import { BacklogPage } from "@/pages/BacklogPage";
import { BatchSheetPage } from "@/pages/BatchSheetPage/BatchSheetPage";
import { CellDetailPage } from "@/pages/CellDetailPage";
import { CellsPage } from "@/pages/CellsPage";
import { HelpPage } from "@/pages/HelpPage/HelpPage";
import { HistoryRunsPage } from "@/pages/HistoryRunsPage";
import { HistorySamplesPage } from "@/pages/HistorySamplesPage";
import { ImportPage } from "@/pages/ImportPage";
import { RunDetailPage } from "@/pages/RunDetailPage";
import { SchedulePage } from "@/pages/SchedulePage/SchedulePage";
import { StatsPage } from "@/pages/StatsPage/StatsPage";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/schedule" replace />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/backlog" element={<BacklogPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/print/batch-sheet" element={<BatchSheetPage />} />
        <Route path="/cells" element={<CellsPage />} />
        <Route path="/cells/:cellId" element={<CellDetailPage />} />
        <Route path="/history/runs" element={<HistoryRunsPage />} />
        <Route path="/history/runs/:cycleId" element={<RunDetailPage />} />
        <Route path="/history/samples" element={<HistorySamplesPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/schedule" replace />} />
      </Routes>
    </AppShell>
  );
}
