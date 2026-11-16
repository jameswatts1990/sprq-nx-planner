// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QcNavCountBadge } from "./QcNavCount";

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

describe("QcNavCountBadge", () => {
  it("shows nothing when no case needs action", () => {
    act(() => root.render(<QcNavCountBadge summary={{ needs_report: 0, awaiting_credit: 5, overdue: 0, total_action: 0 }} />));
    expect(host.textContent).toBe("");
  });

  it("shows the action count, with the breakdown as its accessible name", () => {
    act(() => root.render(<QcNavCountBadge summary={{ needs_report: 2, awaiting_credit: 4, overdue: 2, total_action: 3 }} />));
    expect(host.textContent).toBe("3");
    const badge = host.querySelector('[role="img"]')!;
    expect(badge.getAttribute("aria-label")).toBe("3 credit cases need action: 2 need a report, 2 overdue");
  });

  it("reads in the singular for one case", () => {
    act(() => root.render(<QcNavCountBadge summary={{ needs_report: 1, awaiting_credit: 0, overdue: 0, total_action: 1 }} />));
    expect(host.querySelector('[role="img"]')!.getAttribute("title")).toBe(
      "1 credit case needs action: 1 needs a report, 0 overdue",
    );
  });
});
