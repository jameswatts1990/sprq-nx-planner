import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { BacklogPage } from "@/pages/BacklogPage";
import { CellDetailPage } from "@/pages/CellDetailPage";
import { CellsPage } from "@/pages/CellsPage";
import { HistoryRunsPage } from "@/pages/HistoryRunsPage";
import { HistorySamplesPage } from "@/pages/HistorySamplesPage";
import { ImportPage } from "@/pages/ImportPage";
import { PlanPage } from "@/pages/PlanPage/PlanPage";
import { RunDetailPage } from "@/pages/RunDetailPage";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/plan" replace />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/backlog" element={<BacklogPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/cells" element={<CellsPage />} />
        <Route path="/cells/:cellId" element={<CellDetailPage />} />
        <Route path="/history/runs" element={<HistoryRunsPage />} />
        <Route path="/history/runs/:scheduleId" element={<RunDetailPage />} />
        <Route path="/history/samples" element={<HistorySamplesPage />} />
        <Route path="*" element={<Navigate to="/plan" replace />} />
      </Routes>
    </AppShell>
  );
}
