import { api } from "./client";
import type { InstrumentCreate, InstrumentOut, InstrumentUpdate } from "@/types/instrument";

export const instrumentsApi = {
  list: (activeOnly = false) =>
    api.get<InstrumentOut[]>(`/api/instruments${activeOnly ? "?active_only=true" : ""}`),
  create: (req: InstrumentCreate) => api.post<InstrumentOut>("/api/instruments", req),
  update: (id: number, req: InstrumentUpdate) => api.patch<InstrumentOut>(`/api/instruments/${id}`, req),
};
