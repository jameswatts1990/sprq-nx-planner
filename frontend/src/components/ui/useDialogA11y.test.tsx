// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(ui: React.ReactNode) {
  act(() => root.render(ui));
}

function press(key: string, shiftKey = false) {
  act(() => {
    const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
  });
}

const dialogs = () => Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));

describe("Modal + useDialogA11y", () => {
  it("names the box by its title and starts in its first field", () => {
    render(
      <Modal title="Your name" onClose={() => {}}>
        <input aria-label="Name" />
      </Modal>,
    );
    const [box] = dialogs();
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(box.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Your name");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name");
  });

  it("closes only the top-most dialog on Esc - a picker opened inside a drawer", () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(
      <Modal title="Drawer" onClose={closeOuter}>
        <Modal title="Picker" onClose={closeInner}>
          <input aria-label="Time" />
        </Modal>
      </Modal>,
    );
    press("Escape");
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });

  it("stacks a dialog opened later above the one already open", () => {
    const first = (
      <Modal key="drawer" title="Autoschedule" onClose={() => {}}>
        <button type="button">Clear schedule</button>
      </Modal>
    );
    render([first]);
    render([
      first,
      <Modal key="confirm" title="Clear this week?" onClose={() => {}}>
        <button type="button">Return samples</button>
      </Modal>,
    ]);
    const [below, above] = dialogs().map((d) => Number((d.parentElement as HTMLElement).style.zIndex));
    expect(above).toBeGreaterThan(below);
  });

  it("keeps Tab inside the dialog", () => {
    render(
      <Modal title="Confirm" onClose={() => {}}>
        <button type="button">Cancel</button>
        <button type="button">OK</button>
      </Modal>,
    );
    const ok = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "OK") as HTMLElement;
    act(() => ok.focus());
    press("Tab");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
  });

  it("ignores an Esc a field inside already handled", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Edit" onClose={onClose}>
        <input aria-label="Owner" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} />
      </Modal>,
    );
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the overlay only when the press started on it", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Edit" onClose={onClose}>
        <input aria-label="Owner" />
      </Modal>,
    );
    const overlay = dialogs()[0].parentElement as HTMLElement;
    const field = document.querySelector("input") as HTMLElement;
    // A text selection dragged out of the field: down inside, up (click) on the overlay.
    act(() => {
      field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives focus back to whatever opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    render(
      <Modal title="Confirm" onClose={() => {}}>
        <button type="button">OK</button>
      </Modal>,
    );
    expect(document.activeElement).not.toBe(opener);
    render(null);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("gives focus back to its opener even when a field inside took focus with autoFocus", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    render(
      <Modal title="Your name" onClose={() => {}}>
        <input aria-label="Name" autoFocus />
      </Modal>,
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name");
    render(null);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
