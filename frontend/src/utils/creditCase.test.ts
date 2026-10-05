import { describe, expect, it } from "vitest";

import type { PacbioCaseOut } from "@/types/pacbioCase";

import { creditBucket, getCreditStages, localDateOnly } from "./creditCase";
import { buildPacbioCaseEmailContext, renderCreditEmail } from "./creditEmail";

const NO_CELL_CASE: PacbioCaseOut = {
  id: 7,
  summary: "Tray damaged on arrival",
  occurred_on: "2026-10-05",
  instrument_id: 2,
  instrument_serial: "84098",
  run_name: null,
  pool_id: "TRAC-2-1234",
  expected_acquisitions: 4,
  created_by: "unknown",
  created_at: "2026-10-05T09:00:00Z",
  internal_report_id: null,
  internal_report_at: null,
  pacbio_case_number: null,
  pacbio_reported_at: null,
  pacbio_credit_confirmed_at: null,
  credit_acquisitions: null,
  credit_notes: null,
  credit_received_at: null,
};

describe("localDateOnly", () => {
  it("keeps the calendar day in local time (Date('YYYY-MM-DD') would be UTC midnight)", () => {
    const d = localDateOnly("2026-10-05");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 5, 0]);
  });
});

describe("credit stages for a case without a cell", () => {
  it("buckets and stages from the shared credit fields alone", () => {
    expect(creditBucket(NO_CELL_CASE)).toBe("needs_report");
    expect(getCreditStages(NO_CELL_CASE).currentKey).toBe("pacbio");
    const reported = { ...NO_CELL_CASE, pacbio_case_number: "CS-1", pacbio_reported_at: "2026-10-05T10:00:00Z" };
    expect(creditBucket(reported)).toBe("awaiting");
    expect(getCreditStages(reported).currentKey).toBe("internal");
  });
});

describe("buildPacbioCaseEmailContext", () => {
  it("fills tokens from the typed-in details, with no cell-only identifiers", () => {
    const email = renderCreditEmail(
      { to: "x", cc: "", subject: "<summary>", body: "<sample name>|<run>|<instrument>|<reimbursement>|<well>|<cell code>" },
      buildPacbioCaseEmailContext(NO_CELL_CASE),
    );
    expect(email.subject).toBe("Tray damaged on arrival");
    expect(email.body).toBe("TRAC-2-1234|—|84098|4|—|—");
  });
});
