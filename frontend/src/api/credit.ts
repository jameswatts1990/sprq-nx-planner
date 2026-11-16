import { api, buildQuery } from "./client";

/** Another credit case already carrying a PacBio case number: a cell's own case (label = cell
 * code) or one logged without a cell (label = its summary). */
export interface CaseNumberMatch {
  kind: "cell" | "case";
  id: number;
  label: string;
}

export const creditApi = {
  /** Other cases with this case number (trimmed, case-insensitive) - an inline, never-blocking
   * warning while typing it. Leave out the case being edited via its cell or case id. */
  caseNumberCheck: (number: string, exclude: { cellId?: number; caseId?: number } = {}) =>
    api.get<CaseNumberMatch[]>(
      `/api/credit/case-number-check${buildQuery({
        number,
        exclude_cell_id: exclude.cellId,
        exclude_case_id: exclude.caseId,
      })}`,
    ),
};
