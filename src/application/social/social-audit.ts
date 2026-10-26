import type { OperationalAuditRepositoryPort } from "../ports/operational-audit-repository.port.js";
import type { TenantRole } from "../../domain/identity/identity.model.js";

export const SOCIAL_AUDIT_EVENTS = [
  "SOCIAL_ACCOUNT_CONNECTED",
  "SOCIAL_ACCOUNT_RECONNECTED",
  "SOCIAL_ACCOUNT_DISCONNECTED",
  "SOCIAL_ACCOUNT_STATUS_CHANGED",
  "POST_SCHEDULED",
  "POST_PUBLISH_STARTED",
  "POST_PUBLISHED",
  "POST_FAILED",
  "POST_CANCELLED",
  "POST_RESCHEDULED",
  "POST_LATE_CONFIRMED",
  "POST_LATE_SKIPPED",
  "PROVIDER_CHANGED",
  "PROVIDER_POLICY_CHANGED",
  "PROVIDER_SWITCH_CHANGED",
  "PROVIDER_ENABLED_FOR_TENANT",
  "PROVIDER_DISABLED_FOR_TENANT",
  "MUSIC_SELECTED",
] as const;
export type SocialAuditEvent = (typeof SOCIAL_AUDIT_EVENTS)[number];

export type SocialAuditActor = { userId: string; role: TenantRole };

/** Ator de sistema (worker, health check). */
export const SOCIAL_SYSTEM_ACTOR: SocialAuditActor = { userId: "system:social", role: "owner" };

/** Chaves que NUNCA vão para auditoria, mesmo que alguém passe por engano. */
const FORBIDDEN_KEYS = /pass(word)?|cookie|token|secret|session|storage|header|authorization|mfa|recovery/i;

export class SocialAuditLog {
  constructor(private readonly repository: OperationalAuditRepositoryPort | undefined, private readonly idGenerator: () => string) {}

  async record(input: {
    tenantId: string;
    workspaceId?: string;
    event: SocialAuditEvent;
    actor: SocialAuditActor;
    resource: { type: "social_account" | "social_post" | "social_provider"; id: string };
    result?: { status: "success" | "failure" | "denied"; code?: string; safeMessage?: string };
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.repository) return;
    await this.repository.record({
      id: this.idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      eventType: input.event,
      actor: input.actor,
      resource: input.resource,
      context: {},
      result: input.result ?? { status: "success" },
      metadata: sanitize(input.metadata),
    }).catch(() => undefined);
  }
}

function sanitize(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) safe[key] = typeof value === "string" ? value.slice(0, 300) : value;
    else if (Array.isArray(value)) safe[key] = value.filter((item) => typeof item === "string" || typeof item === "number").slice(0, 20);
  }
  return safe;
}
