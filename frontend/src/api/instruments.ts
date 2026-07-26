import { api } from "./client";
import type {
  InstrumentCreate,
  InstrumentMaintenanceIn,
  InstrumentOut,
  InstrumentStatsOut,
  InstrumentUpdate,
} from "@/types/instrument";

export const instrumentsApi = {
  list: (activeOnly = false) =>
    api.get<InstrumentOut[]>(`/api/instruments${activeOnly ? "?active_only=true" : ""}`),
  stats: () => api.get<InstrumentStatsOut[]>("/api/instruments/stats"),
  create: (req: InstrumentCreate) => api.post<InstrumentOut>("/api/instruments", req),
  update: (id: number, req: InstrumentUpdate) => api.patch<InstrumentOut>(`/api/instruments/${id}`, req),
  // Mark down for maintenance from a date / bring back online (clears the flag). Dedicated
  // actions rather than PATCH so the field can be cleared - see backend instruments router.
  markDown: (id: number, req: InstrumentMaintenanceIn) =>
    api.post<InstrumentOut>(`/api/instruments/${id}/maintenance`, req),
  markOnline: (id: number) => api.post<InstrumentOut>(`/api/instruments/${id}/online`),
  // Hard-delete an instrument with no run/tray history; the backend 409s otherwise.
  del: (id: number) => api.del<void>(`/api/instruments/${id}`),
};
