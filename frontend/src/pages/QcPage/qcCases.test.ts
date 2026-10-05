import { describe, expect, it } from "vitest";

import type { PacbioCaseOut } from "@/types/pacbioCase";

import { QC_CSV_HEADERS, type QcCase, qcCaseCsvRow, qcCaseMatches } from "./qcCases";

const CASE: PacbioCaseOut = {
  id: 7,
  summary: "Tray damaged on arrival",
  occurred_on: "2026-09-01",
  instrument_id: 2,
  instrument_serial: "84098",
  run_name: "TRACTION-RUN-2568",
  pool_id: "TRAC-2-22952",
  expected_acquisitions: 3,
  created_by: "unknown",
  created_at: "2026-09-01T09:00:00Z",
  internal_report_id: "26_NC_S_004",
  internal_report_at: "2026-09-03T09:00:00Z",
  pacbio_case_number: "00316913",
  pacbio_reported_at: "2026-09-02T09:00:00Z",
  pacbio_credit_confirmed_at: "2026-09-10T09:00:00Z",
  credit_acquisitions: 9,
  credit_notes: null,
  credit_received_at: null,
  credit_owner: "jw24",
};
const item: QcCase = { kind: "no_cell", pacbioCase: CASE };

describe("qcCaseMatches", () => {
  it("matches any searchable field, case-insensitively", () => {
    expect(qcCaseMatches(item, "")).toBe(true);
    expect(qcCaseMatches(item, "JW24")).toBe(true);
    expect(qcCaseMatches(item, "damaged")).toBe(true);
    expect(qcCaseMatches(item, "run-2568")).toBe(true);
    expect(qcCaseMatches(item, "26_nc_s")).toBe(true);
    expect(qcCaseMatches(item, "zzz")).toBe(false);
  });

  it("matches a case number with or without PacBio's leading zeros", () => {
    expect(qcCaseMatches(item, "00316913")).toBe(true);
    expect(qcCaseMatches(item, "316913")).toBe(true);
    const unpadded: QcCase = { kind: "no_cell", pacbioCase: { ...CASE, pacbio_case_number: "316913" } };
    expect(qcCaseMatches(unpadded, "00316913")).toBe(true);
  });
});

describe("qcCaseCsvRow", () => {
  it("gives credited acquisitions as cells and trays too, one value per header", () => {
    const row = qcCaseCsvRow(item, Date.parse("2026-09-20T12:00:00Z"));
    expect(row).toHaveLength(QC_CSV_HEADERS.length);
    const col = (h: string) => row[QC_CSV_HEADERS.indexOf(h)];
    expect(col("Kind")).toBe("No cell");
    expect(col("PacBio case number")).toBe("00316913");
    expect(col("Owner")).toBe("jw24");
    expect(col("Acquisitions credited")).toBe("9");
    expect(col("Cells credited")).toBe("3");
    expect(col("Trays credited")).toBe("0.75");
    expect(col("Next step")).toBe("Mark received in lab");
    expect(col("Credit confirmed")).toBe("2026-09-10");
  });
});
