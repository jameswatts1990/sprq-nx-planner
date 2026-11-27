import { describe, expect, it } from "vitest";

import type { SequencingSummary } from "@/types/sequencing";

import {
  formatGb,
  formatMovie,
  formatPct,
  formatPm,
  langQcLabel,
  langQcTone,
  lastLoadingLine,
  summaryChipText,
  summaryTitle,
} from "./sequencing";

const SUMMARY: SequencingSummary = {
  cells: 2,
  hifi_gb: 48.04,
  last_run_name: "TRACTION-RUN-2589",
  last_run_date: "2026-11-12",
  last_well: "Plate 1 A1",
  last_loading_conc: 210,
  last_hifi_gb: 24.1,
  last_pct_of_cell: 26.4,
  last_plex: 4,
  last_qc_state: "Passed",
};

describe("LangQC verdicts", () => {
  it("follow the one status-colour rule, matched by shape", () => {
    expect(langQcTone(null)).toBe("default");
    expect(langQcTone("Pending")).toBe("default");
    expect(langQcTone("Passed")).toBe("success");
    expect(langQcTone("Claimed")).toBe("info");
    expect(langQcTone("Failed, SMRT cell")).toBe("orange");
    expect(langQcTone("Failed, Instrument")).toBe("orange");
    expect(langQcTone("Failed")).toBe("warning");
    expect(langQcTone("On hold")).toBe("warning");
    expect(langQcTone("Some new state")).toBe("warning");
  });

  it("read 'Awaiting QC' while there's no verdict", () => {
    expect(langQcLabel(null)).toBe("Awaiting QC");
    expect(langQcLabel("  ")).toBe("Awaiting QC");
    expect(langQcLabel("Passed")).toBe("Passed");
  });
});

describe("figures", () => {
  it("drop trailing zeros and keep small values readable", () => {
    expect(formatGb(12.5)).toBe("12.5 Gb");
    expect(formatGb(48.04)).toBe("48 Gb");
    expect(formatGb(0.314)).toBe("0.31 Gb");
    expect(formatGb(null)).toBeNull();
    expect(formatPm(210)).toBe("210 pM");
    expect(formatPct(26.4)).toBe("26%");
    expect(formatPct(4.25)).toBe("4.3%");
    expect(formatMovie(1440)).toBe("24 h");
    expect(formatMovie(1410)).toBe("23.5 h");
  });
});

describe("sequencing history highlights", () => {
  it("chip: cells, yield, last loading", () => {
    expect(summaryChipText(SUMMARY)).toBe("2 cells · 48 Gb · last 210 pM");
    expect(summaryChipText({ ...SUMMARY, cells: 1, last_loading_conc: null })).toBe("1 cell · 48 Gb");
  });

  it("tooltip carries the whole last loading", () => {
    const title = summaryTitle(SUMMARY);
    expect(title).toContain("12 Nov 2026, TRACTION-RUN-2589, Plate 1 A1");
    expect(title).toContain("210 pM · 24.1 Gb · 26% of the cell · pool of 4 · LangQC Passed");
  });

  it("edit dialog line", () => {
    expect(lastLoadingLine(SUMMARY)).toBe("Last loaded 210 pM · 12 Nov · 24.1 Gb (26% of the cell)");
  });
});
