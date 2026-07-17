import { describe, expect, it, vi } from "vitest";

import type { CellOut } from "@/types/cell";

import { cellsApi } from "./cells";

function stubCell(id: number): CellOut {
  return { id, code: `CELL-${id}` } as CellOut;
}

describe("cellsApi.listAll", () => {
  it("makes a single request when everything fits on one page", async () => {
    const items = [stubCell(1), stubCell(2)];
    const list = vi.spyOn(cellsApi, "list").mockResolvedValueOnce({ items, total: 2 });

    const all = await cellsApi.listAll({ status: "open" });

    expect(all).toEqual(items);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("follows pagination until every matching cell is collected, not just the first page", async () => {
    // Mirrors the real-world case that slipped through: a fixed page_size silently
    // dropping the oldest still-open cells (e.g. an untouched tray sibling) once the
    // system holds more open cells than one page - see docs/pacbio-sprq-nx-scheduling-
    // reference.md's "Tray-of-4 eager population" bug log.
    const page1 = Array.from({ length: 500 }, (_, i) => stubCell(i + 1));
    const page2 = [stubCell(501), stubCell(502)];
    const list = vi
      .spyOn(cellsApi, "list")
      .mockResolvedValueOnce({ items: page1, total: 502 })
      .mockResolvedValueOnce({ items: page2, total: 502 });

    const all = await cellsApi.listAll({ status: "open" });

    expect(all).toHaveLength(502);
    expect(all.map((c) => c.id)).toEqual([...page1, ...page2].map((c) => c.id));
    expect(list).toHaveBeenNthCalledWith(1, { status: "open", page: 1, page_size: 500 });
    expect(list).toHaveBeenNthCalledWith(2, { status: "open", page: 2, page_size: 500 });
  });

  it("stops instead of looping forever if total overstates what the server actually returns", async () => {
    const list = vi
      .spyOn(cellsApi, "list")
      .mockResolvedValueOnce({ items: [stubCell(1)], total: 999 })
      .mockResolvedValueOnce({ items: [], total: 999 });

    const all = await cellsApi.listAll({ status: "open" });

    expect(all).toEqual([stubCell(1)]);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
