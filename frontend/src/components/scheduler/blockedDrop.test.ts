// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import type { RunOut } from "@/types/schedule";
import { formatTimeLocal } from "@/utils/calendarDates";

import {
  blockAttrs,
  blockedDropMessageAt,
  continuationBlock,
  downBlock,
  lockedRunBlock,
  WEEKEND_BLOCK,
} from "./blockedDrop";

const NOW = new Date("2026-11-10T09:00:00Z");
const LOCK = "2026-11-10T14:00:00Z";
const lockText = `${formatTimeLocal(LOCK)} ${new Date(LOCK).toLocaleDateString("en-GB", { weekday: "short" })}`;

function run(overrides: Partial<RunOut> = {}): RunOut {
  return { run_id: 12, run_name: null, load_date: "2026-11-09", status: "running", lock_until: LOCK, plates: [], ...overrides } as RunOut;
}

describe("blocked-drop messages", () => {
  it("weekend", () => {
    expect(WEEKEND_BLOCK.detail).toBe("Runs can only be loaded on weekdays.");
  });

  it("down quotes the date and the note, without doubling its full stop", () => {
    expect(downBlock("Revio 84093", "2026-11-12", "Laser swap.").detail).toBe("Revio 84093 is down from 12 Nov: Laser swap.");
    expect(downBlock("Revio 84093", "2026-11-12", null).detail).toBe("Revio 84093 is down from 12 Nov.");
  });

  it("a loaded run names its lock while it lasts, then how to unload", () => {
    expect(lockedRunBlock("Revio 84047", run(), NOW).detail).toBe(`Revio 84047 is locked until ${lockText} (run loaded).`);
    expect(lockedRunBlock("Revio 84047", run({ run_name: "TR-9" }), new Date("2026-11-11T00:00:00Z")).detail).toBe(
      "Run TR-9 is loaded — unload it (its RUNNING tag) to change it.",
    );
  });

  it("a finished run says so", () => {
    expect(lockedRunBlock("Revio 84047", run({ status: "completed" }), NOW).detail).toBe(
      "Run #12 has finished (completed) — it can't take samples.",
    );
  });

  it("a continuation day names the run occupying it", () => {
    const acquiring = continuationBlock("Revio 84047", "2026-11-11", { run: run(), acquiresToday: true });
    expect(acquiring).toEqual({ reason: "continuation", detail: "Wed is taken by Monday's run (Plate 2 acquiring)." });
    const lock = continuationBlock("Revio 84047", "2026-11-10", { run: run(), acquiresToday: false });
    expect(lock.detail).toBe(`Revio 84047 is locked until ${lockText} (Monday's run loading).`);
  });
});

describe("blockedDropMessageAt", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads the nearest marked area under the point, past the drag overlay", () => {
    const td = document.createElement("td");
    Object.entries(blockAttrs(WEEKEND_BLOCK)).forEach(([k, v]) => td.setAttribute(k, v));
    const inner = document.createElement("span");
    td.appendChild(inner);
    const overlay = document.createElement("div");
    document.body.append(td, overlay);
    document.elementsFromPoint = () => [overlay, inner, td, document.body];
    expect(blockedDropMessageAt(10, 10)).toBe("Runs can only be loaded on weekdays.");
  });

  it("is null over an unmarked area", () => {
    document.elementsFromPoint = () => [document.body];
    expect(blockedDropMessageAt(10, 10)).toBeNull();
  });

  it("blockAttrs spreads nothing for an open area", () => {
    expect(blockAttrs(null)).toEqual({});
  });
});
