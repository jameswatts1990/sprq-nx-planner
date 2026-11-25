import { describe, expect, it } from "vitest";

import { visibleSections } from "./settingsSections";

const SECTIONS = ["sample-defaults", "facts"];
const DEV = "developer";

describe("visibleSections", () => {
  it("never lists the developer tools when the deployment has them off", () => {
    expect(visibleSections(SECTIONS, DEV, { devToolsEnabled: false, devShown: false })).toEqual(SECTIONS);
    // Even if the reveal was left open (e.g. the flag changed under a running page).
    expect(visibleSections(SECTIONS, DEV, { devToolsEnabled: false, devShown: true })).toEqual(SECTIONS);
  });

  it("keeps them behind the reveal when the deployment has them on", () => {
    expect(visibleSections(SECTIONS, DEV, { devToolsEnabled: true, devShown: false })).toEqual(SECTIONS);
    expect(visibleSections(SECTIONS, DEV, { devToolsEnabled: true, devShown: true })).toEqual([...SECTIONS, DEV]);
  });
});
