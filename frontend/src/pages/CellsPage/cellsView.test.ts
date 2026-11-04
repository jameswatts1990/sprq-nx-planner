import { describe, expect, it } from "vitest";

import { DEFAULT_CELLS_VIEW, readCellsView, trayListParams, writeCellsView } from "./cellsView";

describe("readCellsView", () => {
  it("falls back to the defaults for a bare or garbled URL", () => {
    expect(readCellsView(new URLSearchParams())).toEqual(DEFAULT_CELLS_VIEW);
    expect(readCellsView(new URLSearchParams("status=bogus&sort=colour&page=-2&size=7&chem=x"))).toEqual(
      DEFAULT_CELLS_VIEW,
    );
  });

  it("reads the existing deep links (Instruments / QC pages)", () => {
    const view = readCellsView(new URLSearchParams("instrument=84047&status=all"));
    expect(view.instrument).toBe("84047");
    expect(view.status).toBe("all");
  });
});

describe("writeCellsView", () => {
  it("leaves defaults out of the URL and keeps unrelated params", () => {
    const next = writeCellsView(new URLSearchParams("tray=7&status=all"), { status: "open", sort: "tray", dir: "desc" });
    expect(next.get("status")).toBeNull();
    expect(next.get("sort")).toBe("tray");
    expect(next.get("dir")).toBe("desc");
    expect(next.get("tray")).toBe("7");
  });

  it("sends the list back to page 1 when a filter changes, but not for a no-op or a page change", () => {
    const onPage3 = new URLSearchParams("page=3&q=pool");
    expect(writeCellsView(onPage3, { status: "all" }).get("page")).toBeNull();
    expect(writeCellsView(onPage3, { q: "pool" }).get("page")).toBe("3");
    expect(writeCellsView(onPage3, { page: 4 }).get("page")).toBe("4");
  });
});

describe("trayListParams", () => {
  it("sends a QC choice as qc_status, not as a cell status", () => {
    const params = trayListParams({ ...DEFAULT_CELLS_VIEW, status: "unreported" }, "2026-11-02T09:00:00.000Z");
    expect(params.status).toBeUndefined();
    expect(params.qc_status).toBe("unreported");
  });

  it("omits 'any' filters", () => {
    const params = trayListParams({ ...DEFAULT_CELLS_VIEW, status: "all" }, "2026-11-02T09:00:00.000Z");
    expect(params).toMatchObject({ status: undefined, instrument_serial: undefined, cell_type: undefined, q: undefined });
  });
});
