import { describe, expect, it } from "vitest";

import type { ExistingState } from "@/types/importing";

import { actionLabel, actionsFor, importOutcome, poolKey, resolveAction, statesByKey } from "./importExisting";
import type { PreviewRowKey } from "./importExisting";

function row(poolId: string, extra: Partial<PreviewRowKey> = {}): PreviewRowKey {
  return { poolId, plateId: "", hasBarcodes: true, included: true, ...extra };
}

const STATES = new Map<string, ExistingState>([
  [poolKey("WAIT", ""), "waiting"],
  [poolKey("RUN", ""), "active"],
  [poolKey("DONE", ""), "finished"],
]);

describe("resolveAction", () => {
  it("defaults waiting and scheduled pools to Skip, finished ones to a repeat", () => {
    expect(resolveAction("waiting", undefined)).toBe("skip");
    expect(resolveAction("active", undefined)).toBe("skip");
    expect(resolveAction("finished", undefined)).toBe("add");
    expect(resolveAction("new", undefined)).toBe("add");
  });

  it("ignores a choice the state doesn't offer", () => {
    expect(resolveAction("active", "update")).toBe("skip");
    expect(resolveAction("finished", "update")).toBe("add");
    expect(resolveAction("new", "skip")).toBe("add");
    expect(resolveAction("waiting", "update")).toBe("update");
  });
});

describe("actionsFor / actionLabel", () => {
  it("offers Update only for a pool waiting in the backlog", () => {
    expect(actionsFor("waiting")).toEqual(["skip", "update", "add"]);
    expect(actionsFor("active")).toEqual(["skip", "add"]);
    expect(actionsFor("finished")).toEqual(["add", "skip"]);
  });

  it("calls a finished pool's copy a repeat", () => {
    expect(actionLabel("finished", "add")).toBe("Import as a repeat");
    expect(actionLabel("waiting", "add")).toBe("Import as a copy");
    expect(actionLabel("waiting", "update")).toBe("Update");
  });
});

describe("statesByKey", () => {
  it("keys by Pool ID and Plate ID, a missing plate reading as blank", () => {
    const states = statesByKey([
      { pool_id: "P", plate_id: null, state: "waiting", sample_count: 1 },
      { pool_id: "P", plate_id: "PL-2", state: "new", sample_count: 0 },
    ]);
    expect(states.get(poolKey("P", ""))).toBe("waiting");
    expect(states.get(poolKey("P", "PL-2"))).toBe("new");
  });
});

describe("importOutcome", () => {
  it("counts what the commit will do with the defaults", () => {
    const out = importOutcome([row("NEW"), row("WAIT"), row("RUN"), row("DONE")], STATES, {});
    expect(out.rows.map((r) => r.action)).toEqual(["add", "skip", "skip", "add"]);
    expect(out).toMatchObject({ create: 2, update: 0, skip: 2 });
  });

  it("updates a pool from its first row only", () => {
    const out = importOutcome([row("WAIT"), row("WAIT")], STATES, { WAIT: "update" });
    expect(out.rows.map((r) => r.repeatUpdate)).toEqual([false, true]);
    expect(out).toMatchObject({ create: 0, update: 1, skip: 1 });
  });

  it("skips rows with no barcode and leaves un-ticked review pools out entirely", () => {
    const out = importOutcome(
      [row("NEW", { hasBarcodes: false }), row("NEW2", { included: false }), row("NEW3")],
      STATES,
      {},
    );
    expect(out).toMatchObject({ create: 1, update: 0, skip: 1 });
  });

  it("treats a row with no Pool ID as new", () => {
    expect(importOutcome([row("")], STATES, {}).rows[0].state).toBe("new");
  });
});
