import { describe, expect, it } from "vitest";

import type { ScheduleNoteOut } from "@/types/scheduleNote";

import { moveNoteLocally, sortNotes } from "./noteMove";

function note(overrides: Partial<ScheduleNoteOut> = {}): ScheduleNoteOut {
  return {
    id: 1,
    note_date: "2026-10-19",
    body: "Engineer visit",
    instrument_ids: [10, 20],
    instrument_serials: ["84047", "84093"],
    created_by: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("moveNoteLocally", () => {
  it("moves the whole note to the new day on the same row", () => {
    const moved = moveNoteLocally(
      note(),
      { note_date: "2026-10-21", from_instrument_serial: "84047", to_instrument_serial: "84047" },
      10,
    );
    expect(moved.note_date).toBe("2026-10-21");
    expect(moved.instrument_serials).toEqual(["84047", "84093"]);
    expect(moved.instrument_ids).toEqual([10, 20]);
  });

  it("swaps just the dragged row for the target instrument, keeping ids in serial order", () => {
    const moved = moveNoteLocally(
      note(),
      { note_date: "2026-10-19", from_instrument_serial: "84093", to_instrument_serial: "84001" },
      30,
    );
    expect(moved.instrument_serials).toEqual(["84001", "84047"]);
    expect(moved.instrument_ids).toEqual([30, 10]);
  });

  it("merges onto a row the note is already on", () => {
    const moved = moveNoteLocally(
      note(),
      { note_date: "2026-10-20", from_instrument_serial: "84047", to_instrument_serial: "84093" },
      20,
    );
    expect(moved.instrument_serials).toEqual(["84093"]);
    expect(moved.instrument_ids).toEqual([20]);
  });
});

describe("sortNotes", () => {
  it("orders by day, then by id", () => {
    const notes = [note({ id: 3, note_date: "2026-10-20" }), note({ id: 2 }), note({ id: 1, note_date: "2026-10-20" })];
    expect(sortNotes(notes).map((n) => n.id)).toEqual([2, 1, 3]);
  });
});
