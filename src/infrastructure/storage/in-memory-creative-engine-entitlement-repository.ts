import {
  CREATIVE_ENGINE_CAPABILITY,
  type CreativeEngineEntitlementAuditEntry,
  type CreativeEngineEntitlementRepositoryPort,
  type CreativeEngineGlobalSettings,
  type CreativeEngineWorkspaceEntitlement,
  type SetCreativeEngineWorkspaceEntitlementInput,
} from "../../application/ports/creative-engine-entitlement-repository.port.js";

const keyOf = (tenantId: string, workspaceId: string) => `${tenantId}:${workspaceId}`;
const idOf = () => `cee-audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryCreativeEngineEntitlementRepository implements CreativeEngineEntitlementRepositoryPort {
  private readonly entitlements = new Map<string, CreativeEngineWorkspaceEntitlement>();
  private readonly audit: CreativeEngineEntitlementAuditEntry[] = [];
  private globalSettings: CreativeEngineGlobalSettings = { enabled: true, updatedAt: new Date(0).toISOString() };

  async getGlobalSettings(): Promise<CreativeEngineGlobalSettings> {
    return { ...this.globalSettings };
  }

  async setGlobalEnabled(input: { enabled: boolean; actorUserId?: string; reason?: string }): Promise<CreativeEngineGlobalSettings> {
    const now = new Date().toISOString();
    this.audit.unshift({
      id: idOf(),
      tenantId: "__global__",
      workspaceId: "__global__",
      capability: CREATIVE_ENGINE_CAPABILITY,
      oldValue: this.globalSettings.enabled,
      newValue: input.enabled,
      actorUserId: input.actorUserId,
      reason: input.reason,
      occurredAt: now,
    });
    this.globalSettings = { enabled: input.enabled, updatedAt: now, updatedBy: input.actorUserId };
    return { ...this.globalSettings };
  }

  async getWorkspaceEntitlement(input: { tenantId: string; workspaceId: string }): Promise<CreativeEngineWorkspaceEntitlement | undefined> {
    const entitlement = this.entitlements.get(keyOf(input.tenantId, input.workspaceId));
    return entitlement ? { ...entitlement } : undefined;
  }

  async setWorkspaceEntitlement(input: SetCreativeEngineWorkspaceEntitlementInput): Promise<CreativeEngineWorkspaceEntitlement> {
    const key = keyOf(input.tenantId, input.workspaceId);
    const existing = this.entitlements.get(key);
    const now = new Date().toISOString();
    const entitlement: CreativeEngineWorkspaceEntitlement = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      capability: CREATIVE_ENGINE_CAPABILITY,
      enabled: input.enabled,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: input.actorUserId,
      reason: input.reason,
    };
    this.entitlements.set(key, entitlement);
    this.audit.unshift({
      id: idOf(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      capability: CREATIVE_ENGINE_CAPABILITY,
      oldValue: existing?.enabled,
      newValue: input.enabled,
      actorUserId: input.actorUserId,
      reason: input.reason,
      occurredAt: now,
    });
    return { ...entitlement };
  }

  async listEnabledWorkspaces(input: { tenantId?: string; limit?: number; offset?: number } = {}): Promise<CreativeEngineWorkspaceEntitlement[]> {
    return Array.from(this.entitlements.values())
      .filter((item) => item.enabled)
      .filter((item) => (input.tenantId ? item.tenantId === input.tenantId : true))
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 100))
      .map((item) => ({ ...item }));
  }

  async listAudit(input: { tenantId?: string; workspaceId?: string; limit?: number }): Promise<CreativeEngineEntitlementAuditEntry[]> {
    return this.audit
      .filter((entry) => (input.tenantId ? entry.tenantId === input.tenantId : true))
      .filter((entry) => (input.workspaceId ? entry.workspaceId === input.workspaceId : true))
      .slice(0, input.limit ?? 50)
      .map((entry) => ({ ...entry }));
  }
}
