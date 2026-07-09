export interface AuditLogOut {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details_json: Record<string, unknown>;
}
