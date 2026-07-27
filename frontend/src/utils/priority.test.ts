import { describe, expect, it } from "vitest";

import { priorityLabel, priorityRank, priorityTone } from "./priority";

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
  it("uses dark blue (info) for High / rank 1", () => {
    expect(priorityTone("High (1)")).toBe("info");
  });

  it("uses light blue for Medium / rank 2", () => {
    expect(priorityTone("Medium (2)")).toBe("blue");
  });

  it("uses default (grey) for Standard / rank 3 and unlabelled priorities", () => {
    expect(priorityTone("Standard (3)")).toBe("default");
    expect(priorityTone(null)).toBe("default");
  });

  it("uses purple for Aborted and QC-return-to-backlog labels", () => {
    expect(priorityTone("Aborted (0)")).toBe("purple");
    expect(priorityTone("Recoverable (0)")).toBe("purple");
    expect(priorityTone("Repeatable (0)")).toBe("purple");
  });
});

describe("priorityLabel", () => {
  it("returns the given priority verbatim", () => {
    expect(priorityLabel("High (1)")).toBe("High (1)");
  });

  it("defaults an empty or null priority to Standard", () => {
    expect(priorityLabel(null)).toBe("Standard");
    expect(priorityLabel("")).toBe("Standard");
    expect(priorityLabel("   ")).toBe("Standard");
  });
});
