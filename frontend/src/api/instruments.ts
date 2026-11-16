import { api } from "./client";
import type {
  DowntimeIn,
  DowntimeWriteOut,
  InstrumentCreate,
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
  // Downtime periods. Add/edit return the runs already booked inside the period (never moved).
  addDowntime: (id: number, req: DowntimeIn) =>
    api.post<DowntimeWriteOut>(`/api/instruments/${id}/downtimes`, req),
  updateDowntime: (id: number, downtimeId: number, req: DowntimeIn) =>
    api.put<DowntimeWriteOut>(`/api/instruments/${id}/downtimes/${downtimeId}`, req),
  // Back online from backOnlineOn (default today): the last down day becomes the day before.
  endDowntime: (id: number, downtimeId: number, backOnlineOn?: string) =>
    api.post<DowntimeWriteOut>(`/api/instruments/${id}/downtimes/${downtimeId}/end`, {
      back_online_on: backOnlineOn ?? null,
    }),
  deleteDowntime: (id: number, downtimeId: number) =>
    api.del<void>(`/api/instruments/${id}/downtimes/${downtimeId}`),
  // Bring online = end the period covering today.
  markOnline: (id: number) => api.post<InstrumentOut>(`/api/instruments/${id}/online`),
  // Hard-delete an instrument with no run/tray history; the backend 409s otherwise.
  del: (id: number) => api.del<void>(`/api/instruments/${id}`),
};
