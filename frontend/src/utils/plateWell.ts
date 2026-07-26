/** Plate/well and cell-position display labels.
 *
 * PLATES use LETTERS, CELLS use NUMBERS - so the two never read alike (they used to both be
 * A/B/C/D, which lab users couldn't tell apart). A plate/well label is always that plate's
 * own column-1 position: the row letter (A-D) + "01", since samples are always loaded into
 * column 1 of the 96-well plate. The plate (1 or 2) is a display prefix shown only where the
 * surrounding UI doesn't already say which plate it is: the weekly grid has a "Plate 1"/
 * "Plate 2" column header, so its slots stay unqualified ("A01"); popovers, the batch sheet,
 * and the CSV export show the qualified "P1_A01".
 *
 * DERIVE THE PLATE FROM slot_index, NEVER by re-parsing the stored loading well: a *reuse*
 * into Plate 2 stores its CellUse.well as A01-D01 (the same letters as Plate 1), while a
 * *fresh* parallel Plate 2 stores A02-D02 - so the stored loading well can't tell you the
 * plate. slot_index (0-3 = Plate 1, 4-7 = Plate 2) always can. plateWellFromWell() is only
 * for a cell's canonical home_well (A01-D01 / A02-D02), whose "01"/"02" suffix IS reliable.
 */

const POSITION_LETTERS = ["A", "B", "C", "D"] as const;

export interface PlateWellOpts {
  /** Prefix the plate as "P1_"/"P2_" (e.g. "P1_A01"). */
  qualified?: boolean;
  /** Spell the plate out as "Plate 1 · A01" (implies qualified). */
  full?: boolean;
}

function format(plate: number, letter: string, opts?: PlateWellOpts): string {
  const well = `${letter}01`;
  if (opts?.full) return `Plate ${plate} · ${well}`;
  if (opts?.qualified) return `P${plate}_${well}`;
  return well;
}

/** Plate/well label from a grid slot index (0-7). The reliable source - see file header. */
export function plateWellFromSlot(slotIndex: number, opts?: PlateWellOpts): string {
  const letter = POSITION_LETTERS[slotIndex % POSITION_LETTERS.length];
  const plate = Math.floor(slotIndex / POSITION_LETTERS.length) + 1;
  return format(plate, letter, opts);
}

/** Plate/well label from a cell's canonical home_well ("A01".."D02"). Prefer
 *  plateWellFromSlot whenever a slot index is available; this is for cell.current_well,
 *  which is the cell's home_well (A01-D01 = Plate 1, A02-D02 = Plate 2). */
export function plateWellFromWell(well: string, opts?: PlateWellOpts): string {
  const letter = well.charAt(0).toUpperCase();
  const plate = Number(well.slice(1)) >= 2 ? 2 : 1;
  return format(plate, letter, opts);
}

/** Plate/well label from an authoritative plate index (1 or 2) plus a loading well
 *  ("A01".."D02"). Use when you know the plate (e.g. a use-history row's cycle.plate_index)
 *  but the stored loading well can't disambiguate it (a reuse Plate 2 stores A01-D01). Falls
 *  back to the well's own suffix if the plate index is missing. */
export function plateWellFromPlate(
  plateIndex: number | null | undefined,
  well: string,
  opts?: PlateWellOpts,
): string {
  if (!plateIndex) return plateWellFromWell(well, opts);
  return format(plateIndex, well.charAt(0).toUpperCase(), opts);
}

/** Cell position label "C1".."C4" (cells are NUMBERED, unlike lettered plate wells - this is
 *  PacBio's "cell 1 to cell 4"). Prefer trayPosition (1-4); fall back to mapping a legacy
 *  tray-less cell's home_well/loading-well letter A-D -> 1-4. */
export function cellPositionLabel(
  trayPosition: number | null | undefined,
  fallbackWell?: string | null,
): string {
  let n = trayPosition ?? 0;
  if (!n && fallbackWell) n = fallbackWell.charCodeAt(0) - 64; // "A" (65) -> 1 .. "D" (68) -> 4
  return n >= 1 && n <= 4 ? `C${n}` : "C?";
}
