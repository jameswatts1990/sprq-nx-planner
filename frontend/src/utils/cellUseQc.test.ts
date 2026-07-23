import { describe, expect, it } from "vitest";

import type { CellUseHistoryOut } from "@/types/cell";

import { canRecordQcOutcome, canUndoQcOutcome } from "./cellUseQc";

function baseUse(overrides: Partial<CellUseHistoryOut> = {}): CellUseHistoryOut {
  return {
    id: 1,
    run_batch_id: 1,
    cycle_id: 1,
    run_name: null,
    well: "A01",
    status: "planned",
    sample_id: 1,
    sample_external_id: "SAMPLE-1",
    sample_priority: null,
    sample_target_oplc: null,
    sample_adaptive_loading: null,
    sample_full_resolution_base_q: null,
    sample_ccs_kinetics: null,
    barcodes: [],
    instrument_serial: "84047",
    started_at: null,
    completed_at: null,
    outcome_notes: null,
    run_started: true,
    undo_available: false,
    ...overrides,
  };
}

describe("canRecordQcOutcome", () => {
  it("is false before the run has started, even if the status would otherwise allow it", () => {
    expect(canRecordQcOutcome(baseUse({ run_started: false, status: "planned" }))).toBe(false);
  });

  it("is true for a planned use once the run has started", () => {
    expect(canRecordQcOutcome(baseUse({ run_started: true, status: "planned" }))).toBe(true);
  });

  it("is true for a started use once the run has started", () => {
    expect(canRecordQcOutcome(baseUse({ run_started: true, status: "started" }))).toBe(true);
  });

  it("is false for a cancelled stopped-cell marker", () => {
    expect(canRecordQcOutcome(baseUse({ run_started: true, status: "cancelled" }))).toBe(false);
  });

  it("is false for an already-failed use", () => {
    expect(canRecordQcOutcome(baseUse({ run_started: true, status: "failed" }))).toBe(false);
  });

  it("is false for an already-aborted use", () => {
    expect(canRecordQcOutcome(baseUse({ run_started: true, status: "aborted" }))).toBe(false);
  });

  it("is false for an already-completed use", () => {
    expect(canRecordQcOutcome(baseUse({ run_started: true, status: "completed" }))).toBe(false);
  });
});

describe("canUndoQcOutcome", () => {
  it("defers entirely to the backend's undo_available flag for a failed use", () => {
    expect(canUndoQcOutcome(baseUse({ status: "failed", undo_available: true }))).toBe(true);
  });

  it("defers entirely to the backend's undo_available flag for an aborted use", () => {
    expect(canUndoQcOutcome(baseUse({ status: "aborted", undo_available: true }))).toBe(true);
  });

  it("is false once the backend reports the sample has moved on, even if status is still failed/aborted", () => {
    expect(canUndoQcOutcome(baseUse({ status: "failed", undo_available: false }))).toBe(false);
    expect(canUndoQcOutcome(baseUse({ status: "aborted", undo_available: false }))).toBe(false);
  });

  it("is false for a cancelled stopped-cell marker - that's undone via the cell, not the use", () => {
    expect(canUndoQcOutcome(baseUse({ status: "cancelled", undo_available: false }))).toBe(false);
  });

  it("is false for a planned, started, or completed use", () => {
    expect(canUndoQcOutcome(baseUse({ status: "planned", undo_available: false }))).toBe(false);
    expect(canUndoQcOutcome(baseUse({ status: "started", undo_available: false }))).toBe(false);
    expect(canUndoQcOutcome(baseUse({ status: "completed", undo_available: false }))).toBe(false);
  });
});
