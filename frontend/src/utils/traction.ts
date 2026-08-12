/** Deep-links into Traction (the LIMS that holds PacBio library/pool material), so a lab user
 * can check remaining library volume when deciding a QC repeat, or open a sample straight from
 * the edit modal.
 *
 * A sample is a POOL when it carries more than one Sanger ID (the same test the scheduler import
 * uses); a single otherwise. Pools live under Traction's /pools view, singles under /libraries.
 * Both are addressed by the Pool ID — a TRAC-2 barcode on RunNx — filtered on Traction's
 * `barcode` column. The base host is hardcoded (RunNx has no external-URL config; this mirrors
 * the navbar's GitHub link); change TRACTION_BASE here if Traction ever moves. */
const TRACTION_BASE = "https://traction.psd.sanger.ac.uk/#/pacbio";

export function isPool(sangerIdCount: number): boolean {
  return sangerIdCount > 1;
}

/** The Traction URL for a sample, or null when there's no Pool ID to link to (so callers can
 * hide the link rather than open a dead search). */
export function tractionUrl(poolId: string | null | undefined, sangerIdCount: number): string | null {
  if (!poolId) return null;
  const view = isPool(sangerIdCount) ? "pools" : "libraries";
  const query =
    `page_size=25&page_number=1&page_count=1` +
    `&filter_input=${encodeURIComponent(poolId)}&filter_value=barcode`;
  return `${TRACTION_BASE}/${view}?${query}`;
}
