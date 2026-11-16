// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissToast, showToast, TOAST_ACTION_MS, TOAST_MS, ToastProvider } from "./Toast";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const region = () => host.querySelector('[role="status"]')!;
const toast = () => host.querySelector('[data-testid="toast"]');

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<ToastProvider>page</ToastProvider>));
});

afterEach(() => {
  act(() => dismissToast());
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("renders into an always-present polite live region", () => {
    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(toast()).toBeNull();
    act(() => void showToast({ message: "Saved." }));
    expect(region().textContent).toContain("Saved.");
  });

  it("shows one toast at a time - a new one replaces the old", () => {
    act(() => void showToast({ message: "First." }));
    act(() => void showToast({ message: "Second." }));
    expect(host.querySelectorAll('[data-testid="toast"]')).toHaveLength(1);
    expect(toast()!.textContent).toContain("Second.");
  });

  it("closes on ✕", () => {
    act(() => void showToast({ message: "Saved." }));
    act(() => (host.querySelector('[aria-label="Dismiss"]') as HTMLButtonElement).click());
    expect(toast()).toBeNull();
  });

  it("times out after 5 s, or 15 s when it offers an action", () => {
    act(() => void showToast({ message: "Saved." }));
    act(() => void vi.advanceTimersByTime(TOAST_MS));
    expect(toast()).toBeNull();

    const onClick = vi.fn();
    act(() => void showToast({ message: "Removed.", action: { label: "Undo", onClick } }));
    act(() => void vi.advanceTimersByTime(TOAST_MS));
    expect(toast()).not.toBeNull();
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    expect(onClick).toHaveBeenCalledOnce();
    act(() => void vi.advanceTimersByTime(TOAST_ACTION_MS));
    expect(toast()).toBeNull();
  });

  it("dismissToast(id) only closes that toast", () => {
    let first = 0;
    act(() => void (first = showToast({ message: "First." })));
    act(() => void showToast({ message: "Second." }));
    act(() => dismissToast(first));
    expect(toast()!.textContent).toContain("Second.");
  });
});
