import { describe, expect, it } from "vitest";

import {
  buildWeekDayMarks,
  clipToWeek,
  computeLoadingWindowBands,
  computeNoisyBands,
  filterVisibleTimings,
  mergeIntervals,
} from "./weekPlanTiming";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_START = Date.UTC(2026, 7, 3); // Mon 3 Aug 2026, 00:00 UTC
const WEEK_END = WEEK_START + 7 * DAY_MS;

describe("mergeIntervals", () => {
  it("returns an empty array for no spans", () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it("leaves disjoint spans separate", () => {
    const spans = [{ startMs: 0, endMs: 10 }, { startMs: 20, endMs: 30 }];
    expect(mergeIntervals(spans)).toEqual(spans);
  });

  it("merges overlapping spans", () => {
    const merged = mergeIntervals([{ startMs: 0, endMs: 10 }, { startMs: 5, endMs: 15 }]);
    expect(merged).toEqual([{ startMs: 0, endMs: 15 }]);
  });

  it("merges spans that only touch", () => {
    const merged = mergeIntervals([{ startMs: 0, endMs: 10 }, { startMs: 10, endMs: 20 }]);
    expect(merged).toEqual([{ startMs: 0, endMs: 20 }]);
  });

  it("sorts unordered input before merging", () => {
    const merged = mergeIntervals([{ startMs: 20, endMs: 30 }, { startMs: 0, endMs: 10 }]);
    expect(merged).toEqual([{ startMs: 0, endMs: 10 }, { startMs: 20, endMs: 30 }]);
  });
});

describe("clipToWeek", () => {
  it("passes a span fully inside the week through unclamped", () => {
    const span = clipToWeek(WEEK_START + DAY_MS, WEEK_START + 2 * DAY_MS, WEEK_START, WEEK_END);
    expect(span).toEqual({ leftPct: (1 / 7) * 100, widthPct: (1 / 7) * 100 });
  });

  it("returns null for a span entirely before the week", () => {
    expect(clipToWeek(WEEK_START - 2 * DAY_MS, WEEK_START - DAY_MS, WEEK_START, WEEK_END)).toBeNull();
  });

  it("returns null for a span entirely after the week", () => {
    expect(clipToWeek(WEEK_END + DAY_MS, WEEK_END + 2 * DAY_MS, WEEK_START, WEEK_END)).toBeNull();
  });

  it("returns null for a zero-width span sitting exactly on the start boundary", () => {
    expect(clipToWeek(WEEK_START - DAY_MS, WEEK_START, WEEK_START, WEEK_END)).toBeNull();
  });

  it("truncates a span that starts before the week to the left edge (0%)", () => {
    const span = clipToWeek(WEEK_START - DAY_MS, WEEK_START + DAY_MS, WEEK_START, WEEK_END);
    expect(span).toEqual({ leftPct: 0, widthPct: (1 / 7) * 100 });
  });

  it("truncates a span that ends after the week to the right edge (100%)", () => {
    const span = clipToWeek(WEEK_END - DAY_MS, WEEK_END + DAY_MS, WEEK_START, WEEK_END);
    expect(span).toEqual({ leftPct: (6 / 7) * 100, widthPct: (1 / 7) * 100 });
  });
});

describe("computeLoadingWindowBands", () => {
  it("bands one run from its load time to its last cell's prep-done time", () => {
    const bands = computeLoadingWindowBands([
      { runId: 1, prepPendingStartMs: 0, movieStartMs: 4 * HOUR_MS },
      { runId: 1, prepPendingStartMs: 2 * HOUR_MS, movieStartMs: 10 * HOUR_MS },
    ]);
    expect(bands).toEqual([{ startMs: 0, endMs: 10 * HOUR_MS }]);
  });

  it("keeps two well-separated runs as two bands", () => {
    const bands = computeLoadingWindowBands([
      { runId: 1, prepPendingStartMs: 0, movieStartMs: 4 * HOUR_MS },
      { runId: 2, prepPendingStartMs: DAY_MS, movieStartMs: DAY_MS + 4 * HOUR_MS },
    ]);
    expect(bands).toHaveLength(2);
  });

  it("merges two runs whose lock windows overlap", () => {
    const bands = computeLoadingWindowBands([
      { runId: 1, prepPendingStartMs: 0, movieStartMs: 10 * HOUR_MS },
      { runId: 2, prepPendingStartMs: 5 * HOUR_MS, movieStartMs: 15 * HOUR_MS },
    ]);
    expect(bands).toEqual([{ startMs: 0, endMs: 15 * HOUR_MS }]);
  });
});

describe("computeNoisyBands", () => {
  it("unions PPA spans across cells regardless of run", () => {
    const bands = computeNoisyBands([
      { ppaStartMs: 28 * HOUR_MS, ppaEndMs: 34 * HOUR_MS },
      { ppaStartMs: 30 * HOUR_MS, ppaEndMs: 36 * HOUR_MS },
    ]);
    expect(bands).toEqual([{ startMs: 28 * HOUR_MS, endMs: 36 * HOUR_MS }]);
  });

  it("keeps two non-overlapping PPA spans separate", () => {
    const bands = computeNoisyBands([
      { ppaStartMs: 0, ppaEndMs: 6 * HOUR_MS },
      { ppaStartMs: 20 * HOUR_MS, ppaEndMs: 26 * HOUR_MS },
    ]);
    expect(bands).toHaveLength(2);
  });
});

describe("filterVisibleTimings", () => {
  const inWeek = { prepPendingStartMs: WEEK_START + DAY_MS, ppaEndMs: WEEK_START + 2 * DAY_MS };
  const beforeWeek = { prepPendingStartMs: WEEK_START - 3 * DAY_MS, ppaEndMs: WEEK_START - 2 * DAY_MS };
  const afterWeek = { prepPendingStartMs: WEEK_END + DAY_MS, ppaEndMs: WEEK_END + 2 * DAY_MS };
  const straddlesStart = { prepPendingStartMs: WEEK_START - DAY_MS, ppaEndMs: WEEK_START + HOUR_MS };

  it("keeps a stage fully inside the week", () => {
    expect(filterVisibleTimings([inWeek], WEEK_START, WEEK_END)).toEqual([inWeek]);
  });

  it("drops a stage that finished entirely before the week", () => {
    expect(filterVisibleTimings([beforeWeek], WEEK_START, WEEK_END)).toEqual([]);
  });

  it("drops a stage that doesn't start until entirely after the week", () => {
    expect(filterVisibleTimings([afterWeek], WEEK_START, WEEK_END)).toEqual([]);
  });

  it("keeps a stage that straddles the start boundary", () => {
    expect(filterVisibleTimings([straddlesStart], WEEK_START, WEEK_END)).toEqual([straddlesStart]);
  });
});

describe("buildWeekDayMarks", () => {
  it("returns 7 marks, exactly one day apart, starting at weekStartMs", () => {
    const marks = buildWeekDayMarks(WEEK_START);
    expect(marks).toHaveLength(7);
    expect(marks[0].ms).toBe(WEEK_START);
    expect(marks[1].ms - marks[0].ms).toBe(DAY_MS);
    expect(marks[0].label).toBe("Mon 3 Aug");
    expect(marks[6].label).toBe("Sun 9 Aug");
  });
});
