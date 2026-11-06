/** Something an audit row touched that still exists - the Activity page links to it. */
export interface AuditLink {
  kind: "run" | "sample" | "cell" | "tray" | "instrument";
  id: number;
  label: string;
}

export interface AuditLogOut {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details_json: Record<string, unknown>;
  links: AuditLink[];
}
