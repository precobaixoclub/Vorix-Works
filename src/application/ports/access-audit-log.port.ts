/** Auditoria estruturada de alterações de acesso (migration 0173). Valores antes/depois em JSON —
 * nunca só uma frase de log. */
export const ACCESS_AUDIT_EVENT_TYPES = [
  "member_created",
  "member_removed",
  "member_disabled",
  "member_enabled",
  "role_changed",
  "permission_granted",
  "permission_revoked",
  "permission_reset",
  "team_member_added",
  "team_member_removed",
  "team_manager_granted",
  "team_manager_revoked",
  "invite_created",
] as const;
export type AccessAuditEventType = (typeof ACCESS_AUDIT_EVENT_TYPES)[number];

export type AccessAuditEntry = {
  id: string;
  tenantId: string;
  actorUserId: string;
  targetUserId?: string;
  teamId?: string;
  eventType: AccessAuditEventType;
  previousValue?: unknown;
  newValue?: unknown;
  createdAt: string;
};

export type AccessAuditLogPort = {
  record(entry: Omit<AccessAuditEntry, "id" | "createdAt">): Promise<void>;
  list(input: { tenantId: string; targetUserId?: string; limit?: number }): Promise<AccessAuditEntry[]>;
};
