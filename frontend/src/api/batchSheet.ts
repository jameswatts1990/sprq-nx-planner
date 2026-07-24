import { api } from "./client";
import type { BatchSheetOut } from "@/types/batchSheet";

export const batchSheetApi = {
  /** GET /api/batch-sheet?load_date=&instrument_serial=&instrument_serial=... - omit
   * instrumentSerials to include every instrument with a run loaded that day. */
  get: (loadDate: string, instrumentSerials?: string[]) => {
    const usp = new URLSearchParams({ load_date: loadDate });
    (instrumentSerials ?? []).forEach((serial) => usp.append("instrument_serial", serial));
    return api.get<BatchSheetOut>(`/api/batch-sheet?${usp.toString()}`);
  },
};
