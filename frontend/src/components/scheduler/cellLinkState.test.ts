import { describe, expect, it } from "vitest";

import type { StageOut } from "@/types/schedule";

import { deriveLinkState } from "./cellLinkState";

function baseStage(overrides: Partial<StageOut> = {}): StageOut {
  return {
    slot_index: 0,
    well: "A01",
    cell_use_id: 10,
    cell_id: 100,
    cell_ref: "CELL-000100",
    use_number: 1,
    sample_id: 1,
    sample_external_id: "SAMPLE-1",
    barcodes: [],
    cell_use_status: "planned",
    cell_status: "open",
    tray_position: 1,
    tray_id: null,
    window_hours_elapsed: null,
    ...overrides,
  };
}

describe("deriveLinkState", () => {
  it("is fully inert when nothing is active", () => {
    expect(deriveLinkState(null, baseStage())).toEqual({ isSource: false, isPeer: false, isDimmed: false });
  });

  it("is fully inert for a null stage (empty/ghost slot), even with an active target", () => {
    expect(deriveLinkState({ cellId: 100, sourceUseId: 10 }, null)).toEqual({
      isSource: false,
      isPeer: false,
      isDimmed: false,
    });
  });

  it("marks the exact hovered/pinned slot as the source", () => {
    const stage = baseStage({ cell_id: 100, cell_use_id: 10 });
    expect(deriveLinkState({ cellId: 100, sourceUseId: 10 }, stage)).toEqual({
      isSource: true,
      isPeer: false,
      isDimmed: false,
    });
  });

  it("marks another use of the same cell (different cell_use_id) as a peer", () => {
    const stage = baseStage({ cell_id: 100, cell_use_id: 11, use_number: 2 });
    expect(deriveLinkState({ cellId: 100, sourceUseId: 10 }, stage)).toEqual({
      isSource: false,
      isPeer: true,
      isDimmed: false,
    });
  });

  it("dims a slot for an unrelated cell", () => {
    const stage = baseStage({ cell_id: 200, cell_use_id: 20 });
    expect(deriveLinkState({ cellId: 100, sourceUseId: 10 }, stage)).toEqual({
      isSource: false,
      isPeer: false,
      isDimmed: true,
    });
  });
});
