import { describe, expect, it } from "vitest";

import { shouldAutoPlace, shouldShowCellChoiceModal } from "./cellChoiceGate";
import type { CellChoiceGateInput } from "./cellChoiceGate";

function baseInput(overrides: Partial<CellChoiceGateInput> = {}): CellChoiceGateInput {
  return {
    isMove: false,
    wellConflict: false,
    isNewRun: false,
    cellsLoading: false,
    cellsError: false,
    compatibleCount: 0,
    preselectedValid: false,
    preselectedBarcodeClash: false,
    ...overrides,
  };
}

describe("shouldShowCellChoiceModal", () => {
  it("stays hidden for a ghost-drop placement, even into a brand-new run", () => {
    const input = baseInput({ isNewRun: true, compatibleCount: 1, preselectedValid: true });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(false);
  });

  it("stays hidden when no reusable cell exists (forced new cell), even into a brand-new run", () => {
    const input = baseInput({ isNewRun: true, compatibleCount: 0 });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(false);
  });

  it("stays hidden for an ordinary placement into an existing run with no ambiguity", () => {
    const input = baseInput({ isNewRun: false, compatibleCount: 0 });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(false);
  });

  it("shows when there's real ambiguity (multiple compatible cells, no valid ghost), regardless of isNewRun", () => {
    const ambiguous = baseInput({ compatibleCount: 2, preselectedValid: false });
    expect(shouldShowCellChoiceModal({ ...ambiguous, isNewRun: false, mutationError: false })).toBe(true);
    expect(shouldShowCellChoiceModal({ ...ambiguous, isNewRun: true, mutationError: false })).toBe(true);
  });

  it("shows for a pure move (no well conflict) into a brand-new run - it has no auto-place path at all", () => {
    const input = baseInput({ isMove: true, isNewRun: true });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(true);
  });

  it("stays hidden for a pure move into an existing run", () => {
    const input = baseInput({ isMove: true, isNewRun: false });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(false);
  });

  it("stays hidden for a well-conflict move with no compatible cells (forced new cell), even into a brand-new run", () => {
    const input = baseInput({ isMove: true, wellConflict: true, isNewRun: true, compatibleCount: 0 });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(false);
  });

  it("stays hidden for a well-conflict move landing on a valid ghost preselect", () => {
    const input = baseInput({ isMove: true, wellConflict: true, compatibleCount: 1, preselectedValid: true });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(false);
  });

  it("shows for a well-conflict move with real ambiguity (multiple compatible cells)", () => {
    const input = baseInput({ isMove: true, wellConflict: true, compatibleCount: 2, preselectedValid: false });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(true);
  });

  it("shows when the compatible-cells fetch errors (non-move only)", () => {
    const input = baseInput({ cellsError: true });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(true);
  });

  it("shows when the mutation itself errored, regardless of the rest", () => {
    const input = baseInput({ isNewRun: true, compatibleCount: 1, preselectedValid: true });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: true })).toBe(true);
  });

  it("stays hidden while still loading compatible cells (not yet ambiguous)", () => {
    const input = baseInput({ cellsLoading: true, compatibleCount: 0 });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(false);
  });

  it("always shows for a preselected cell with a barcode clash, even when otherwise unambiguous", () => {
    const input = baseInput({ isNewRun: true, compatibleCount: 0, preselectedBarcodeClash: true });
    expect(shouldShowCellChoiceModal({ ...input, mutationError: false })).toBe(true);
  });
});

describe("shouldAutoPlace", () => {
  it("auto-places a ghost-drop into a brand-new run", () => {
    expect(shouldAutoPlace(baseInput({ isNewRun: true, compatibleCount: 1, preselectedValid: true }))).toBe(true);
  });

  it("auto-places a forced-new-cell drop into a brand-new run", () => {
    expect(shouldAutoPlace(baseInput({ isNewRun: true, compatibleCount: 0 }))).toBe(true);
  });

  it("does not auto-place a pure move (no well conflict) into a brand-new run", () => {
    expect(shouldAutoPlace(baseInput({ isMove: true, isNewRun: true }))).toBe(false);
  });

  it("auto-places a well-conflict move with no compatible cells, even into a brand-new run", () => {
    expect(shouldAutoPlace(baseInput({ isMove: true, wellConflict: true, isNewRun: true, compatibleCount: 0 }))).toBe(
      true,
    );
  });

  it("does not auto-place a well-conflict move while still loading compatible cells", () => {
    expect(shouldAutoPlace(baseInput({ isMove: true, wellConflict: true, cellsLoading: true }))).toBe(false);
  });

  it("does not auto-place a well-conflict move with real ambiguity", () => {
    expect(
      shouldAutoPlace(baseInput({ isMove: true, wellConflict: true, compatibleCount: 2, preselectedValid: false })),
    ).toBe(false);
  });

  it("does not auto-place while still loading compatible cells", () => {
    expect(shouldAutoPlace(baseInput({ cellsLoading: true }))).toBe(false);
  });

  it("does not auto-place on a fetch error", () => {
    expect(shouldAutoPlace(baseInput({ cellsError: true }))).toBe(false);
  });

  it("does not auto-place when there's real ambiguity", () => {
    expect(shouldAutoPlace(baseInput({ compatibleCount: 2, preselectedValid: false }))).toBe(false);
  });

  it("auto-places a plain move into an existing run (never touches cell choice)", () => {
    expect(shouldAutoPlace(baseInput({ isMove: true, isNewRun: false }))).toBe(true);
  });

  it("never auto-places a preselected cell with a barcode clash, even when otherwise unambiguous", () => {
    expect(
      shouldAutoPlace(baseInput({ isNewRun: true, compatibleCount: 0, preselectedBarcodeClash: true })),
    ).toBe(false);
  });
});
