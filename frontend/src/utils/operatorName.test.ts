import { beforeEach, describe, expect, it, vi } from "vitest";

/** An in-memory localStorage - the test environment has none. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

/** A fresh copy of the module per test, so its cached name starts empty. */
async function load() {
  vi.resetModules();
  return import("./operatorName");
}

describe("operatorName", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));

  it("adopts the Batch Sheet loader's remembered name once, then forgets the old keys", async () => {
    localStorage.setItem("runnx.batchSheet.loadedBy", " Ade ");
    localStorage.setItem("runnx.credit.owner", "Bea");
    const { getOperatorName } = await load();
    expect(getOperatorName()).toBe("Ade");
    expect(localStorage.getItem("runnx.operator")).toBe("Ade");
    expect(localStorage.getItem("runnx.batchSheet.loadedBy")).toBeNull();
    expect(localStorage.getItem("runnx.credit.owner")).toBeNull();
  });

  it("falls back to the credit owner when there's no loader name", async () => {
    localStorage.setItem("runnx.credit.owner", "Bea");
    expect((await load()).getOperatorName()).toBe("Bea");
  });

  it("never re-adopts an old name after it's been cleared", async () => {
    localStorage.setItem("runnx.credit.owner", "Bea");
    const first = await load();
    first.getOperatorName();
    first.setOperatorName("   ");
    expect((await load()).getOperatorName()).toBe("");
  });

  it("trims, caps at 120 characters and keeps non-ASCII names", async () => {
    const { getOperatorName, setOperatorName } = await load();
    setOperatorName(`  ${"x".repeat(130)}  `);
    expect(getOperatorName()).toHaveLength(120);
    setOperatorName("Zoë O'Brien");
    expect(localStorage.getItem("runnx.operator")).toBe("Zoë O'Brien");
  });
});
