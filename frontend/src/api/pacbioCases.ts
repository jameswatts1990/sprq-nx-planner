import { api } from "./client";
import type {
  CreditConfirmRequest,
  CreditInternalReportRequest,
  CreditNotesRequest,
  CreditOwnerRequest,
  CreditReportToPacbioRequest,
} from "@/types/credit";
import type { PacbioCaseCreate, PacbioCaseDetailsIn, PacbioCaseOut } from "@/types/pacbioCase";

/** PacBio credit cases logged without a RunNx cell. The stage actions mirror cellsApi's. */
export const pacbioCasesApi = {
  list: () => api.get<PacbioCaseOut[]>("/api/pacbio-cases"),
  create: (req: PacbioCaseCreate) => api.post<PacbioCaseOut>("/api/pacbio-cases", req),
  update: (id: number, req: PacbioCaseDetailsIn) => api.put<PacbioCaseOut>(`/api/pacbio-cases/${id}`, req),
  del: (id: number) => api.del<void>(`/api/pacbio-cases/${id}`),
  reportToPacbio: (id: number, req: CreditReportToPacbioRequest) =>
    api.post<PacbioCaseOut>(`/api/pacbio-cases/${id}/report-to-pacbio`, req),
  setInternalReport: (id: number, req: CreditInternalReportRequest) =>
    api.post<PacbioCaseOut>(`/api/pacbio-cases/${id}/internal-report`, req),
  confirmCredit: (id: number, req: CreditConfirmRequest) =>
    api.post<PacbioCaseOut>(`/api/pacbio-cases/${id}/confirm-credit`, req),
  /** Set who is chasing the case (free text). Editable at any stage; empty clears it. */
  setCreditOwner: (id: number, req: CreditOwnerRequest) =>
    api.post<PacbioCaseOut>(`/api/pacbio-cases/${id}/credit-owner`, req),
  setCreditNotes: (id: number, req: CreditNotesRequest) =>
    api.post<PacbioCaseOut>(`/api/pacbio-cases/${id}/credit-notes`, req),
  receiveCredit: (id: number) => api.post<PacbioCaseOut>(`/api/pacbio-cases/${id}/receive-credit`, {}),
};
