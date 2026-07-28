import { cellPositionLabel } from "@/utils/plateWell";

import styles from "./CellFoilStub.module.css";

export interface CellFoilStubProps {
  /** Physical tray position 1-4 (falls back to the home-well letter for a legacy tray-less cell). */
  trayPosition: number | null;
  homeWell?: string | null;
  /** Uses consumed so far (0-3) - drives the stub colour and boxed number. */
  useNumber: number;
  /** Printed as microtext along the bottom edge (a cell's tray "family" number). */
  trayId: number | null;
  /** Stable per-cell seed (the cell id) for the holographic hue, so two cells with the same
   * cell+use label still catch the light differently - mirrors the scheduler seal. */
  seedId: number;
}

/**
 * The cell card's right-edge "ticket stub": a use-coloured, holographic strip showing the
 * physical cell position (▣1-▣4) over its boxed current-use number, with the tray id as
 * microprint. A calmer sibling of SchedulerSlotView's grid stub - the foil is frozen at rest
 * and only shimmers on hover, since a Cells page can show ~100 of these at once. Decorative:
 * the same code/status/uses are already exposed as text on the card, so this is aria-hidden.
 */
export function CellFoilStub({ trayPosition, homeWell, useNumber, trayId, seedId }: CellFoilStubProps) {
  const cell = cellPositionLabel(trayPosition, homeWell);
  const u = Math.min(Math.max(useNumber, 0), 3);
  const useClass = u === 0 ? styles.u0 : u === 3 ? styles.u3 : u === 2 ? styles.u2 : styles.u1;
  const hue = Math.round((seedId * 137.508) % 360);
  const micro = trayId != null ? String(trayId) : "";

  return (
    <div
      className={`${styles.stub} ${useClass}`}
      style={{ ["--seal-hue" as string]: `${hue}deg` }}
      title={`${cell.replace("▣", "Cell ")} · ${u === 0 ? "not yet used" : `use ${u} of 3`}`}
      aria-hidden="true"
    >
      <span className={styles.sheen} />
      {micro && <span className={styles.micro}>{micro}</span>}
      <span className={styles.label}>
        <span className={styles.cell}>
          <span className={styles.glyph}>{cell.slice(0, 1)}</span>
          {cell.slice(1)}
        </span>
        <span className={styles.useBox}>{u === 0 ? "–" : u}</span>
      </span>
    </div>
  );
}
