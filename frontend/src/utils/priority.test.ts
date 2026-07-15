import { describe, expect, it } from "vitest";

import { priorityRank, priorityTone } from "./priority";

describe("priorityRank", () => {
  it("extracts the trailing rank number", () => {
    expect(priorityRank("High (1)")).toBe(1);
    expect(priorityRank("Standard (3)")).toBe(3);
  });

  it("ranks unlabelled or null priorities last", () => {
    expect(priorityRank(null)).toBe(999);
    expect(priorityRank("")).toBe(999);
    expect(priorityRank("Whatever")).toBe(999);
  });
});

describe("priorityTone", () => {
  it("uses danger for rank 1", () => {
    expect(priorityTone("High (1)")).toBe("danger");
  });

  it("uses warning for rank 2", () => {
    expect(priorityTone("Medium (2)")).toBe("warning");
  });

  it("uses default for rank 3 and unlabelled priorities", () => {
    expect(priorityTone("Standard (3)")).toBe("default");
    expect(priorityTone(null)).toBe("default");
  });
});
