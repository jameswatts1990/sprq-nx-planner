import { api } from "./client";
import type { CommitRequest, PreviewRequest, PreviewResponse, ScheduleOut } from "@/types/schedule";

export const scheduleApi = {
  preview: (req: PreviewRequest) => api.post<PreviewResponse>("/api/schedule/preview", req),
  commit: (req: CommitRequest) => api.post<ScheduleOut>("/api/schedule/commit", req),
};
