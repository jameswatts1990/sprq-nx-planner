/** Display label for a run: the lab-assigned name given when it was locked (e.g.
 * "TRACTION-RUN-1234"), falling back to "#<cycle id>" when none was set. */
export function runLabel(run: { cycle_id: number; run_name: string | null }): string {
  return run.run_name ?? `#${run.cycle_id}`;
}
