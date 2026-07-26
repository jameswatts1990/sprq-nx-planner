import { describe, expect, it } from "vitest";

import { cellPositionLabel, plateWellFromPlate, plateWellFromSlot, plateWellFromWell } from "./plateWell";

describe("plateWellFromSlot", () => {
  it("maps slots 0-3 to Plate 1 wells A01-D01", () => {
    expect(plateWellFromSlot(0)).toBe("A01");
    expect(plateWellFromSlot(3)).toBe("D01");
  });

  it("maps slots 4-7 to Plate 2, still column 01 (A01-D01)", () => {
    expect(plateWellFromSlot(4)).toBe("A01");
    expect(plateWellFromSlot(7)).toBe("D01");
  });

  it("qualifies with the plate prefix", () => {
    expect(plateWellFromSlot(0, { qualified: true })).toBe("P1_A01");
    expect(plateWellFromSlot(4, { qualified: true })).toBe("P2_A01");
    expect(plateWellFromSlot(7, { qualified: true })).toBe("P2_D01");
  });

  it("spells the plate out in full", () => {
    expect(plateWellFromSlot(0, { full: true })).toBe("Plate 1 · A01");
    expect(plateWellFromSlot(6, { full: true })).toBe("Plate 2 · C01");
  });
});

describe("plateWellFromWell (a cell's canonical home_well)", () => {
  it("reads the plate from the well's 01/02 suffix, always shows column 01", () => {
    expect(plateWellFromWell("A01", { qualified: true })).toBe("P1_A01");
    expect(plateWellFromWell("A02", { qualified: true })).toBe("P2_A01");
    expect(plateWellFromWell("D02", { qualified: true })).toBe("P2_D01");
  });
});

describe("plateWellFromPlate (authoritative plate index + loading well)", () => {
  it("both Plate 2 flavours read P2 - a reuse (stored A01) and a fresh parallel (stored A02)", () => {
    expect(plateWellFromPlate(2, "A01", { qualified: true })).toBe("P2_A01"); // reuse Plate 2
    expect(plateWellFromPlate(2, "A02", { qualified: true })).toBe("P2_A01"); // fresh parallel Plate 2
    expect(plateWellFromPlate(1, "A01", { qualified: true })).toBe("P1_A01");
  });

  it("falls back to the well's own suffix when the plate index is missing", () => {
    expect(plateWellFromPlate(null, "A02", { qualified: true })).toBe("P2_A01");
  });
});

describe("cellPositionLabel (cells are numbered ▣1-▣4 with a U+25A3 prefix, unlike lettered plates)", () => {
  it("uses the tray position", () => {
    expect(cellPositionLabel(1)).toBe("▣1");
    expect(cellPositionLabel(4)).toBe("▣4");
  });

  it("falls back to a legacy cell's home-well letter A-D -> 1-4", () => {
    expect(cellPositionLabel(null, "A01")).toBe("▣1");
    expect(cellPositionLabel(null, "C02")).toBe("▣3");
  });

  it("returns ▣? when the position is genuinely unknown", () => {
    expect(cellPositionLabel(null, null)).toBe("▣?");
  });
});
