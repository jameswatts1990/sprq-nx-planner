import { describe, expect, it } from "vitest";

import { classForCell, classForUseIndex } from "./useIndexClass";

describe("classForUseIndex", () => {
  it("maps Use 1/2/3 to u1/u2/u3 and clamps out-of-range numbers", () => {
    expect(classForUseIndex(1)).toBe("u1");
    expect(classForUseIndex(2)).toBe("u2");
    expect(classForUseIndex(3)).toBe("u3");
    expect(classForUseIndex(4)).toBe("u3");
    expect(classForUseIndex(0)).toBe("u1");
  });
});

describe("classForCell", () => {
  it("gives a single-use SPRQ cell its own colour whatever its use number", () => {
    expect(classForCell(1, "sprq")).toBe("sprq");
    expect(classForCell(2, "sprq")).toBe("sprq");
  });

  it("keeps the Use 1/2/3 colours for SPRQ-Nx (and an unknown type)", () => {
    expect(classForCell(2, "sprq_nx")).toBe("u2");
    expect(classForCell(3, undefined)).toBe("u3");
  });
});
