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

  it("remembers every name picked in this browser, once each, and keeps them after signing out", async () => {
    const { getOperatorNames, setOperatorName } = await load();
    expect(getOperatorNames()).toEqual([]);
    setOperatorName("Ade");
    setOperatorName(" Bea ");
    setOperatorName("Ade");
    setOperatorName("");
    expect(getOperatorNames()).toEqual(["Ade", "Bea"]);
    expect((await load()).getOperatorNames()).toEqual(["Ade", "Bea"]);
  });

  it("starts the list with the name a browser already had", async () => {
    localStorage.setItem("runnx.operator", "Ade");
    expect((await load()).getOperatorNames()).toEqual(["Ade"]);
  });

  it("forgets a name, signing out when it's the current one", async () => {
    const { forgetOperatorName, getOperatorName, getOperatorNames, setOperatorName } = await load();
    setOperatorName("Ade");
    setOperatorName("Bea");
    forgetOperatorName("Ade");
    expect([getOperatorName(), getOperatorNames()]).toEqual(["Bea", ["Bea"]]);
    forgetOperatorName("Bea");
    expect([getOperatorName(), getOperatorNames()]).toEqual(["", []]);
    expect((await load()).getOperatorNames()).toEqual([]);
  });

  it("ignores an unreadable list", async () => {
    localStorage.setItem("runnx.operators", "{not json");
    localStorage.setItem("runnx.operator", "Ade");
    expect((await load()).getOperatorNames()).toEqual(["Ade"]);
  });
});
