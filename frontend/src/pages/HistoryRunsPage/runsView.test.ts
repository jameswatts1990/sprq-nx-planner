import { describe, expect, it } from "vitest";

import { writeListView } from "@/utils/listView";

import { DEFAULT_RUNS_VIEW, RUNS_VIEW, runHistoryParams } from "./runsView";

describe("RUNS_VIEW.read", () => {
  it("falls back to the defaults for a bare or garbled URL", () => {
    expect(RUNS_VIEW.read(new URLSearchParams())).toEqual(DEFAULT_RUNS_VIEW);
    expect(
      RUNS_VIEW.read(new URLSearchParams("status=lost&sort=colour&dir=up&page=0&size=9&chem=x&from=2026-13&to=soon")),
    ).toEqual(DEFAULT_RUNS_VIEW);
  });

  it("reads a filtered, dated, sorted view", () => {
    const view = RUNS_VIEW.read(
      new URLSearchParams("status=running&instrument=84047&from=2026-10-01&to=2026-10-31&sort=instrument&dir=asc&page=2"),
    );
    expect(view).toMatchObject({
      status: "running",
      instrument: "84047",
      from: "2026-10-01",
      to: "2026-10-31",
      sort: "instrument",
      dir: "asc",
      page: 2,
    });
  });
});

describe("runHistoryParams", () => {
  it("omits 'any' filters and empty dates", () => {
    expect(runHistoryParams(DEFAULT_RUNS_VIEW)).toMatchObject({
      status: undefined,
      instrument_serial: undefined,
      cell_type: undefined,
      date_from: undefined,
      date_to: undefined,
      q: undefined,
      sort_by: "load_date",
      sort_dir: "desc",
    });
  });

  it("round-trips a date range through the URL", () => {
    const url = writeListView(RUNS_VIEW, new URLSearchParams(), { from: "2026-10-01" });
    expect(url.toString()).toBe("from=2026-10-01");
    expect(runHistoryParams(RUNS_VIEW.read(url)).date_from).toBe("2026-10-01");
  });
});
