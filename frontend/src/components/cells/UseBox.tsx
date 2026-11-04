import type { CellType } from "@/types/common";
import { classForCell } from "@/utils/useIndexClass";

import styles from "./UseBox.module.css";

/** The boxed use number [1]/[2]/[3], mirroring the scheduler ticket-stub's boxed use square
 * (SchedulerSlotView's .stubUseBox) but on a light surface - a small bordered box tinted in
 * the app-wide Use 1/2/3 palette (magenta/blue/teal), or indigo for a single-use SPRQ cell.
 * Used wherever a use needs to read as a number AND a colour at once (the cell card's Samples
 * list, the cell-life timeline). */
export function UseBox({ use, cellType }: { use: number; cellType?: CellType }) {
  return <span className={`${styles.box} ${styles[classForCell(use, cellType)]}`}>{use}</span>;
}
