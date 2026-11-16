import type { ExistingAction, ExistingState, PoolCheckItem } from "@/types/importing";

/** The choices a preview row offers when its pool is already in RunNx, default first. Mirrors
 * backend services/import_service._ACTIONS, which re-applies them at commit. */
const ACTIONS: Record<ExistingState, ExistingAction[]> = {
  new: ["add"],
  waiting: ["skip", "update", "add"],
  active: ["skip", "add"],
  finished: ["add", "skip"],
};

export function actionsFor(state: ExistingState): ExistingAction[] {
  return ACTIONS[state];
}

/** The action that applies: the user's choice when the state allows it, else the default. */
export function resolveAction(state: ExistingState, chosen: ExistingAction | undefined): ExistingAction {
  const allowed = ACTIONS[state];
  return chosen && allowed.includes(chosen) ? chosen : allowed[0];
}

export function actionLabel(state: ExistingState, action: ExistingAction): string {
  if (action === "skip") return "Skip";
  if (action === "update") return "Update";
  return state === "finished" ? "Import as a repeat" : "Import as a copy";
}

/** Lookup key for a (Pool ID, Plate ID) pair - a blank Plate ID means "not compared". */
export function poolKey(poolId: string, plateId: string | null | undefined): string {
  return `${poolId}\u0000${(plateId ?? "").trim()}`;
}

export function statesByKey(items: PoolCheckItem[]): Map<string, ExistingState> {
  return new Map(items.map((p) => [poolKey(p.pool_id, p.plate_id), p.state]));
}

export interface PreviewRowKey {
  poolId: string;
  plateId: string;
  hasBarcodes: boolean;
  /** False for a scheduler review-pool left un-ticked - it isn't sent, so it isn't counted. */
  included: boolean;
}

export interface RowOutcome {
  state: ExistingState;
  action: ExistingAction;
  /** An Update row whose pool an earlier row already updates - the server skips it. */
  repeatUpdate: boolean;
}

export interface ImportOutcome {
  rows: RowOutcome[];
  create: number;
  update: number;
  skip: number;
}

/** What committing these rows will do, exactly as import_samples decides it: rows with no barcode
 * are skipped, a pool's first Update row updates its waiting copies (later ones are skipped), and
 * everything else follows resolveAction. */
export function importOutcome(
  rows: PreviewRowKey[],
  states: Map<string, ExistingState>,
  decisions: Record<string, ExistingAction>,
): ImportOutcome {
  const updatedPools = new Set<string>();
  const outcome: ImportOutcome = { rows: [], create: 0, update: 0, skip: 0 };
  for (const row of rows) {
    const state = (row.poolId && states.get(poolKey(row.poolId, row.plateId))) || "new";
    const action = resolveAction(state, decisions[row.poolId]);
    const repeatUpdate = action === "update" && updatedPools.has(row.poolId);
    outcome.rows.push({ state, action, repeatUpdate });
    if (!row.included) continue;
    if (!row.hasBarcodes || action === "skip" || repeatUpdate) outcome.skip += 1;
    else if (action === "update") {
      outcome.update += 1;
      updatedPools.add(row.poolId);
    } else outcome.create += 1;
  }
  return outcome;
}
