import { KpiTile } from "@/components/ui/KpiTile";
import type { KPIOut } from "@/types/schedule";
import { formatMoney } from "@/utils/formatMoney";

export interface ScheduleKpiTilesProps {
  kpi: KPIOut;
}

function savingsValue(savings: number): string {
  return (savings >= 0 ? "−" : "+") + formatMoney(Math.abs(savings)).slice(1);
}

function savingsUnit(kpi: KPIOut): string {
  const pct = kpi.savings >= 0 ? kpi.savings_pct : -kpi.savings_pct;
  return `${pct}% ${kpi.savings >= 0 ? "cheaper" : "more"}`;
}

/** The prototype's 6-tile KPI strip content, shared between the Plan preview and the
 * read-only run-detail view (both render from a KPIOut). Caller wraps in <KpiStrip>. */
export function ScheduleKpiTiles({ kpi }: ScheduleKpiTilesProps) {
  return (
    <>
      <KpiTile label="Acquisitions" value={kpi.total_acq} unit="samples to run" />
      <KpiTile
        label="SMRT Cells"
        value={kpi.fresh_cells}
        unit={kpi.prior_cells > 0 ? `new + ${kpi.prior_cells} in-progress` : "new cells"}
        accent="blue"
      />
      <KpiTile label="Cell trays" value={kpi.trays} unit="Nx trays (4 cells)" accent="teal" />
      <KpiTile label="Duration" value={kpi.duration_days} unit="calendar days" accent="purple" />
      <KpiTile label="Reagent cost" value={formatMoney(kpi.nx_cost)} unit="estimate, USD" />
      <KpiTile
        label="vs single-use"
        value={savingsValue(kpi.savings)}
        unit={savingsUnit(kpi)}
        accent="blue"
        trend={kpi.savings >= 0 ? "down" : "up"}
      />
    </>
  );
}
