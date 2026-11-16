import { describe, expect, it } from "vitest";

import { buildReportFields, type IssueReportContext, unsetIssueReportSettings } from "./issueReport";

const CTX: IssueReportContext = {
  occurredOn: new Date(2026, 6, 24),
  problem: "Failed Cell Run 12 P1 A01 use 2",
  caseNumber: "00316913",
  sampleId: "TRAC-2-100",
  instrumentSerial: "84047",
  owner: "ab12",
};

const value = (fields: ReturnType<typeof buildReportFields>, label: string) =>
  fields.find((f) => f.label.startsWith(label))!.value;

describe("buildReportFields", () => {
  it("fills the team, equipment owner and manager columns from Settings", () => {
    const fields = buildReportFields(CTX, undefined, { team: "Seq_Team", equipment_owner: "Lab_Kit", manager: "A Manager" });
    expect(value(fields, "Team who identified")).toBe("Seq_Team");
    expect(value(fields, "Issue Owner")).toBe("Seq_Team");
    expect(value(fields, "Equipment Owner")).toBe("Lab_Kit");
    expect(value(fields, "Select appropriate manager")).toBe("A Manager");
    expect(value(fields, "Date of Occurrence")).toBe("24-Jul-2026");
    expect(value(fields, "Reported by")).toBe("ab12");
  });

  it("leaves those columns blank until they're set - no built-in team or person", () => {
    for (const settings of [undefined, { team: "", equipment_owner: "", manager: "" }]) {
      const fields = buildReportFields(CTX, undefined, settings);
      expect(value(fields, "Team who identified")).toBe("");
      expect(value(fields, "Issue Owner")).toBe("");
      expect(value(fields, "Equipment Owner")).toBe("");
      expect(value(fields, "Select appropriate manager")).toBe("");
    }
  });
});

describe("unsetIssueReportSettings", () => {
  it("names each blank setting", () => {
    expect(unsetIssueReportSettings({ team: "Seq_Team", equipment_owner: "", manager: "" })).toEqual([
      "Equipment owner",
      "Manager",
    ]);
    expect(unsetIssueReportSettings({ team: "a", equipment_owner: "b", manager: "c" })).toEqual([]);
    expect(unsetIssueReportSettings(undefined)).toEqual(["Team", "Equipment owner", "Manager"]);
  });
});
