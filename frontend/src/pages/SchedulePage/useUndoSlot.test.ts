import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToastOptions } from "@/components/ui/Toast";

const toasts: { id: number; options: ToastOptions }[] = [];
const dismissed: number[] = [];

vi.mock("@/components/ui/Toast", () => ({
  showToast: (options: ToastOptions) => {
    toasts.push({ id: toasts.length + 1, options });
    return toasts.length;
  },
  dismissToast: (id?: number) => {
    if (id !== undefined) dismissed.push(id);
  },
}));

const { clearUndo, offerUndo, restoredMessage } = await import("./useUndoSlot");

const lastToast = () => toasts[toasts.length - 1];
const clickUndo = async () => {
  lastToast().options.action?.onClick();
  await vi.waitFor(() => expect(lastToast().options.action).toBeUndefined());
};

describe("the undo slot", () => {
  beforeEach(() => {
    clearUndo();
    toasts.length = 0;
    dismissed.length = 0;
  });

  it("offers Undo on a toast and confirms with what the undo returns", async () => {
    const undo = vi.fn().mockResolvedValue("Restored 2 samples.");
    const settled = vi.fn();
    offerUndo("Removed 2 samples from the schedule.", undo, settled);
    expect(lastToast().options).toMatchObject({ message: "Removed 2 samples from the schedule.", action: { label: "Undo" } });

    await clickUndo();
    expect(undo).toHaveBeenCalledOnce();
    expect(lastToast().options).toEqual({ message: "Restored 2 samples.", tone: "good" });
    expect(settled).toHaveBeenCalledOnce();
  });

  it("runs an undo at most once", async () => {
    const undo = vi.fn().mockResolvedValue("Done.");
    offerUndo("Moved A.", undo);
    const action = lastToast().options.action!;
    action.onClick();
    action.onClick();
    await vi.waitFor(() => expect(lastToast().options.message).toBe("Done."));
    expect(undo).toHaveBeenCalledOnce();
  });

  it("holds one entry: a newer edit replaces the older Undo", async () => {
    const older = vi.fn().mockResolvedValue("older");
    const newer = vi.fn().mockResolvedValue("newer");
    offerUndo("Moved A.", older);
    const olderAction = lastToast().options.action!;
    offerUndo("Moved B.", newer);

    olderAction.onClick();
    expect(older).not.toHaveBeenCalled();
    await clickUndo();
    expect(newer).toHaveBeenCalledOnce();
  });

  it("clearUndo forgets the entry and closes its toast", () => {
    const undo = vi.fn();
    offerUndo("Placed A.", undo);
    const { id, options } = lastToast();
    clearUndo();
    expect(dismissed).toContain(id);
    options.action!.onClick();
    expect(undo).not.toHaveBeenCalled();
  });

  it("reports a refused undo on a red toast", async () => {
    offerUndo("Placed A.", () => Promise.reject(new Error("well taken")));
    await clickUndo();
    expect(lastToast().options).toEqual({ message: "Couldn't undo. well taken", tone: "bad" });
  });
});

describe("restoredMessage", () => {
  const item = (cell_changed: boolean, from: string, to: string) => ({
    sample_id: 1,
    cell_use_id: 1,
    cell_changed,
    from_cell_code: from,
    to_cell_code: to,
  });

  it("is plain when every sample is back on its own cell", () => {
    expect(restoredMessage({ restored: [item(false, "C01-T1", "C01-T1")], runs: [] })).toBe("Restored 1 sample.");
  });

  it("names the cells that changed", () => {
    expect(
      restoredMessage({ restored: [item(true, "C02-T1", "C01-T7"), item(false, "C03-T1", "C03-T1")], runs: [] }),
    ).toBe("Restored 2 samples — 1 on a different cell (C02-T1 → C01-T7).");
  });
});
