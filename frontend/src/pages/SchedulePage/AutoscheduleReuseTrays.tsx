import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { cellsApi } from "@/api/cells";
import { Badge } from "@/components/ui/Badge";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { CellOut } from "@/types/cell";
import { soonestTrayExpiry } from "@/utils/openTrays";

import styles from "./AutoscheduleReuseTrays.module.css";

interface ReuseTrayRow {
  trayId: number;
  instrument: string | null;
  /** How many of the tray's open cells still have capacity to be reused. */
  reusableCells: number;
  /** Highest use count reached by any cell in the tray - "used up to 2×". */
  maxConsumed: number;
  /** Soonest 108h window closure across the tray's cells, or null. */
  soonestExpiry: number | null;
  reuseDisabled: boolean;
}

/** Group the open cells into one row per physical tray that autoschedule could actually
 * reuse (partially-used trays with capacity left). A brand-new, never-used tray is a *fresh*
 * cell to the packer, not a reuse candidate, so it's deliberately left out - this list is
 * only about "trays I'm about to bin that autoschedule would otherwise reuse". */
function buildReuseTrayRows(cells: CellOut[]): ReuseTrayRow[] {
  const byTray = new Map<number, CellOut[]>();
  for (const cell of cells) {
    if (cell.tray_id === null || cell.uses_consumed === 0) continue;
    const list = byTray.get(cell.tray_id);
    if (list) list.push(cell);
    else byTray.set(cell.tray_id, [cell]);
  }

  const rows: ReuseTrayRow[] = [];
  for (const [trayId, trayCells] of byTray) {
    rows.push({
      trayId,
      instrument: trayCells.find((c) => c.current_instrument_serial)?.current_instrument_serial ?? null,
      reusableCells: trayCells.filter((c) => c.uses_remaining > 0).length,
      maxConsumed: Math.max(...trayCells.map((c) => c.uses_consumed)),
      soonestExpiry: soonestTrayExpiry(trayCells),
      reuseDisabled: trayCells.some((c) => c.tray_reuse_disabled),
    });
  }
  // Instrument then tray id, so the list reads in a stable, grouped order.
  rows.sort((a, b) => (a.instrument ?? "").localeCompare(b.instrument ?? "") || a.trayId - b.trayId);
  return rows;
}

function expiryText(hours: number): string {
  return hours <= 1 ? "<1h" : `${Math.ceil(hours)}h`;
}

export interface AutoscheduleReuseTraysProps {
  /** Every open cell (SchedulePage's waiting-ghosts query) - grouped into reuse-candidate trays here. */
  cells: CellOut[];
}

/** The Autoschedule drawer's "trays autoschedule will reuse" list. Each partially-used tray
 * gets a "Skip reuse" toggle: turning it on flags the whole tray for disposal so autoschedule
 * stops offering it and falls back to fresh cells (reversible - turn it off to restore). Lets
 * the lab plan a tray disposal before running Auto schedule, without loading a sample first. */
export function AutoscheduleReuseTrays({ cells }: AutoscheduleReuseTraysProps) {
  const queryClient = useQueryClient();
  const rows = useMemo(() => buildReuseTrayRows(cells), [cells]);

  const toggle = useMutation({
    mutationFn: (vars: { tray_id: number; disabled: boolean }) => cellsApi.setTraySkipReuse(vars),
    onSuccess: () => invalidateScheduleRelated(queryClient),
  });

  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>
        Reuse this week <span className={styles.hint}>skip a tray you plan to dispose</span>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>No part-used trays to reuse — autoschedule will open fresh cells.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => {
            const pending = toggle.isPending && toggle.variables?.tray_id === row.trayId;
            return (
              <li key={row.trayId} className={`${styles.row} ${row.reuseDisabled ? styles.skipped : ""}`}>
                <label className={styles.main}>
                  <input
                    type="checkbox"
                    checked={row.reuseDisabled}
                    disabled={pending}
                    onChange={(e) => toggle.mutate({ tray_id: row.trayId, disabled: e.target.checked })}
                  />
                  <span className={styles.text}>
                    <span className={styles.title}>
                      {row.instrument ?? "No instrument"} · Tray {row.trayId}
                    </span>
                    <span className={styles.sub}>
                      {row.reusableCells} cell{row.reusableCells === 1 ? "" : "s"} reusable · used up to{" "}
                      {row.maxConsumed}×
                    </span>
                  </span>
                </label>
                <span className={styles.badges}>
                  {row.reuseDisabled ? (
                    <Badge tone="warning">Reuse skipped</Badge>
                  ) : (
                    row.soonestExpiry !== null && (
                      <Badge tone={row.soonestExpiry <= 12 ? "danger" : "default"}>
                        {expiryText(row.soonestExpiry)}
                      </Badge>
                    )
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {toggle.isError && <p className={styles.error}>Couldn&apos;t update the tray — try again.</p>}
    </div>
  );
}
