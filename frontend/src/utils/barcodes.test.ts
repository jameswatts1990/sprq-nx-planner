import { describe, expect, it } from "vitest";

import { repeatedBarcodes, splitBarcodes } from "./barcodes";

describe("splitBarcodes", () => {
  it("splits on commas, semicolons, slashes and whitespace, keeping repeats", () => {
    expect(splitBarcodes(" bc1, bc2;bc3/bc4  bc1 ")).toEqual(["bc1", "bc2", "bc3", "bc4", "bc1"]);
    expect(splitBarcodes("")).toEqual([]);
  });
});

describe("repeatedBarcodes", () => {
  it("lists each barcode given more than once, in first-seen order", () => {
    expect(repeatedBarcodes("bc2 bc1 bc2 bc1 bc2")).toEqual(["bc2", "bc1"]);
    expect(repeatedBarcodes("bc1; bc2")).toEqual([]);
  });
});
