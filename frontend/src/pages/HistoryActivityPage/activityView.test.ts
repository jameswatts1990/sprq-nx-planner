import { describe, expect, it } from "vitest";

import { ACTION_GROUPS, actionLabel, describeAuditDetails } from "@/utils/auditLabels";
import { writeListView } from "@/utils/listView";

import { ACTIVITY_VIEW, activityHref, activityParams, DEFAULT_ACTIVITY_VIEW } from "./activityView";

describe("ACTIVITY_VIEW", () => {
  it("falls back to the defaults for a bare or garbled URL", () => {
    expect(ACTIVITY_VIEW.read(new URLSearchParams())).toEqual(DEFAULT_ACTIVITY_VIEW);
    // A scope needs both a known kind and an id.
    expect(ACTIVITY_VIEW.read(new URLSearchParams("what=gossip&for=tray&id=4&from=soon"))).toEqual(
      DEFAULT_ACTIVITY_VIEW,
    );
    expect(ACTIVITY_VIEW.read(new URLSearchParams("for=run&name=Run%20%2314"))).toEqual(DEFAULT_ACTIVITY_VIEW);
  });

  it("round-trips a detail page's View activity link into a scoped request", () => {
    const href = activityHref("sample", 12, "POOL-1");
    const view = ACTIVITY_VIEW.read(new URLSearchParams(href.split("?")[1]));
    expect(view).toMatchObject({ scopeKind: "sample", scopeId: 12, scopeLabel: "POOL-1" });
    expect(activityParams(view)).toMatchObject({ sample_id: 12, page: 1, page_size: 50 });
  });

  it("sends a group as its comma-separated actions, and clears a scope cleanly", () => {
    const view = ACTIVITY_VIEW.read(new URLSearchParams("what=instruments&who=Ade&for=run&id=3&name=x"));
    expect(activityParams(view)).toMatchObject({
      run_id: 3,
      actor: "Ade",
      action:
        "instrument_create,instrument_update,instrument_downtime_add,instrument_downtime_update,instrument_downtime_end," +
        "instrument_downtime_delete,instrument_down,instrument_online,instrument_delete",
    });
    const cleared = writeListView(ACTIVITY_VIEW, new URLSearchParams("for=run&id=3&name=x&who=Ade"), {
      scopeKind: "",
      scopeId: 0,
      scopeLabel: "",
    });
    expect(cleared.toString()).toBe("who=Ade");
  });
});

describe("auditLabels", () => {
  it("never puts an action in two groups", () => {
    const all = ACTION_GROUPS.flatMap((g) => g.actions);
    expect(new Set(all).size).toBe(all.length);
  });

  it("names a run's status change by what the lab did", () => {
    expect(actionLabel({ action: "update_run_status", details_json: { status: "running" } })).toBe("Confirmed loaded");
    expect(actionLabel({ action: "update_run_status", details_json: { status: "planned" } })).toBe("Unlocked run");
    expect(actionLabel({ action: "some_new_action", details_json: {} })).toBe("Some new action");
  });

  it("describes an edit as before → after, in form words", () => {
    const lines = describeAuditDetails({
      action: "update_sample",
      details_json: {
        priority: { from: "Standard (3)", to: "High (1)" },
        barcodes: { from: ["bc1"], to: ["bc1", "bc9"] },
        notes: { from: null, to: "low yield" },
      },
    });
    expect(lines).toEqual(["Priority: Standard (3) → High (1)", "Barcodes: bc1 → bc1, bc9", "Note: — → low yield"]);
  });

  it("summarises a placement and an import", () => {
    expect(
      describeAuditDetails({
        action: "place_sample",
        details_json: { well: "B01", instrument_serial: "84047", load_date: "2026-11-09" },
      }),
    ).toEqual(["Well B01 · 84047 · loads 9 Nov 2026"]);
    expect(
      describeAuditDetails({ action: "import_samples", details_json: { imported_count: 12, source_filename: null } }),
    ).toEqual(["12 sample(s) from pasted text"]);
  });
});
