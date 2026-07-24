/** Display label for a run: the lab-assigned name given when it was locked (e.g.
 * "TRACTION-RUN-1234"), falling back to "#<run id>" when none was set. Accepts anything
 * carrying the run's id + name - a RunOut ({run_id}) or a nested cell-use record whose run
 * is carried as run_batch_id (pass it in as run_id at the call site). */
export function runLabel(run: { run_id: number; run_name: string | null }): string {
  return run.run_name ?? `#${run.run_id}`;
}
