import { describe, expect, it } from "vitest";

import type { PacbioCaseOut } from "@/types/pacbioCase";

import {
  acquisitionsToCells,
  acquisitionsToTrays,
  CREDIT_OVERDUE_DAYS,
  creditBucket,
  creditCaseAge,
  formatQuantity,
  getCreditStages,
  localDateOnly,
} from "./creditCase";
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
  credit_owner: null,
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

describe("acquisition → cell / tray conversion (1 cell = 3 acq = 0.25 tray)", () => {
  it("matches PacBio's FOC tracker units", () => {
    expect(acquisitionsToCells(3)).toBe(1);
    expect(acquisitionsToTrays(3)).toBe(0.25);
    expect(formatQuantity(acquisitionsToTrays(9))).toBe("0.75");
    expect(formatQuantity(acquisitionsToTrays(2))).toBe("0.17");
    expect(formatQuantity(acquisitionsToTrays(12))).toBe("1");
  });
});

describe("creditCaseAge", () => {
  const DAY = 86_400_000;
  const failed = Date.parse("2026-08-01T00:00:00Z");

  it("counts days open, and the wait from the latest completed step", () => {
    const reported = { ...NO_CELL_CASE, pacbio_case_number: "1", pacbio_reported_at: new Date(failed + 10 * DAY).toISOString() };
    const age = creditCaseAge(reported, failed, failed + 25 * DAY)!;
    expect(age.daysOpen).toBe(25);
    expect(age.waitDays).toBe(15);
    expect(age.overdue).toBe(false);
    expect(age.waitingFor).toBe("Add internal report");
  });

  it("flags a stage stalled past the overdue limit", () => {
    const age = creditCaseAge(NO_CELL_CASE, failed, failed + (CREDIT_OVERDUE_DAYS + 1) * DAY)!;
    expect(age.overdue).toBe(true);
    expect(age.waitingFor).toBe("Report to PacBio");
  });

  it("is null once the credit is received", () => {
    const settled = { ...NO_CELL_CASE, pacbio_reported_at: "2026-08-02T00:00:00Z", credit_received_at: "2026-08-20T00:00:00Z", internal_report_at: "2026-08-03T00:00:00Z", pacbio_credit_confirmed_at: "2026-08-10T00:00:00Z" };
    expect(creditCaseAge(settled, failed, failed + 90 * DAY)).toBeNull();
  });
});
