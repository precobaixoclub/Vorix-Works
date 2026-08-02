/**
 * Auditoria — Sprint 05 (Fase 7). "Apenas estrutura", como pedido: grava o evento, não oferece
 * consulta/dashboard/alerta (observabilidade completa é explicitamente fora de escopo). Cada caso
 * de uso de identidade chama `record` no momento certo — login, logout, refresh, tentativa
 * inválida, troca de tenant.
 */
export const AUDIT_EVENT_TYPES = [
  "login_success",
  "login_failed",
  "logout",
  "refresh_success",
  "refresh_replay_detected",
  "tenant_switch",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type RecordAuditEventInput = {
  eventType: AuditEventType;
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogPort = {
  record(input: RecordAuditEventInput): Promise<void>;
};
