import { describe, expect, it } from "vitest";

import type { QcReviewWell } from "@/types/qcReview";

import {
  reviewCasePrefill,
  reviewExpectedAcquisitions,
  reviewFailReason,
  reviewWellMatches,
} from "./qcReview";

function well(overrides: Partial<QcReviewWell> = {}): QcReviewWell {
  return {
    key: "TRACTION-RUN-2589|1|A1",
    run_name: "TRACTION-RUN-2589",
    plate_number: 1,
    well_label: "A1",
    instrument_name: "84047",
    qc_state: "Failed, SMRT cell",
    qc_date: "2026-11-20T10:15:00",
    well_start: "2026-11-17T22:00:00",
    well_complete: "2026-11-18T22:00:00",
    smrt_cell_id: "EA330001",
    cell_lot: "LOT1",
    cell_use_count: 2,
    is_multi_use: true,
    sequencing_kit: "Revio SPRQ-Nx",
    movie_name: "m84047_1",
    movie_minutes: 1440,
    loading_conc: 250,
    hifi_yield_gb: 12.5,
    library_barcodes: ["TRAC-2-100"],
    sample_count: 1,
    smrt_link_url: null,
    match: null,
    ignored: null,
    ...overrides,
  };
}

describe("QC Review helpers", () => {
  it("names the LangQC verdict and the well in the Cell QC reason", () => {
    expect(reviewFailReason(well())).toBe(
      "QC Review: Failed, SMRT cell (LangQC, 20 Nov 2026) - TRACTION-RUN-2589 · Plate 1 · A1",
    );
    expect(reviewFailReason(well({ qc_date: null }))).toBe(
      "QC Review: Failed, SMRT cell (LangQC) - TRACTION-RUN-2589 · Plate 1 · A1",
    );
  });

  it("claims the failed use plus the uses the cell had left, as for a cell's own case", () => {
    expect(reviewExpectedAcquisitions(well({ cell_use_count: 1 }))).toBe(3);
    expect(reviewExpectedAcquisitions(well({ cell_use_count: 3 }))).toBe(1);
    expect(reviewExpectedAcquisitions(well({ cell_use_count: null }))).toBeNull();
    expect(reviewExpectedAcquisitions(well({ is_multi_use: false, cell_use_count: null }))).toBe(1);
  });

  it("pre-fills a case without a cell from the well, dated when the well finished", () => {
    const prefill = reviewCasePrefill(well({ library_barcodes: ["TRAC-2-100", "TRAC-2-101"] }));
    expect(prefill).toMatchObject({
      mlwhWellKey: "TRACTION-RUN-2589|1|A1",
      summary: "Failed, SMRT cell (LangQC) - TRACTION-RUN-2589 · Plate 1 · A1",
      occurredOn: "2026-11-18",
      instrumentSerial: "84047",
      runName: "TRACTION-RUN-2589",
      poolId: "TRAC-2-100, TRAC-2-101",
      cellType: "sprq_nx",
      expectedAcquisitions: 2,
    });
    expect(reviewCasePrefill(well({ is_multi_use: false })).cellType).toBe("sprq");
  });

  it("searches the run, well, SMRT cell, library tube and matched RunNx cell", () => {
    const w = well({
      match: {
        by: "run_name", run_batch_id: 1, run_label: "TRACTION-RUN-2589", cell_use_id: 5, cell_id: 3,
        cell_code: "C03-T7", cell_type: "sprq_nx", cell_status: "open", use_number: 2, use_status: "started",
        sample_id: 9, pool_id: "TRAC-2-100", pool_matches: true, can_fail: true, blocked_reason: null, log_instead: false,
      },
    });
    for (const q of ["run-2589", "plate 1 · a1", "ea330001", "trac-2-100", "c03-t7", "84047", "smrt cell", ""]) {
      expect(reviewWellMatches(w, q)).toBe(true);
    }
    expect(reviewWellMatches(w, "TRACTION-RUN-9")).toBe(false);
  });
});
