import { api, buildQuery } from "./client";
import type { ScheduleNoteCreate, ScheduleNoteMove, ScheduleNoteOut, ScheduleNoteUpdate } from "@/types/scheduleNote";

export const scheduleNotesApi = {
  list: (params: { date_from: string; date_to: string }) =>
    api.get<ScheduleNoteOut[]>(`/api/schedule-notes${buildQuery(params)}`),
  create: (req: ScheduleNoteCreate) => api.post<ScheduleNoteOut>("/api/schedule-notes", req),
  update: (id: number, req: ScheduleNoteUpdate) => api.put<ScheduleNoteOut>(`/api/schedule-notes/${id}`, req),
  move: (id: number, req: ScheduleNoteMove) => api.post<ScheduleNoteOut>(`/api/schedule-notes/${id}/move`, req),
  del: (id: number) => api.del<void>(`/api/schedule-notes/${id}`),
};
