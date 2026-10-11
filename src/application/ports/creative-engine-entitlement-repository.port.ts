export const CREATIVE_ENGINE_CAPABILITY = "creative_engine" as const;
export type CreativeEngineCapability = typeof CREATIVE_ENGINE_CAPABILITY;

export type CreativeEngineWorkspaceEntitlement = {
  tenantId: string;
  workspaceId: string;
  capability: CreativeEngineCapability;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  reason?: string;
};

export type CreativeEngineEntitlementAuditEntry = {
  id: string;
  tenantId: string;
  workspaceId: string;
  capability: CreativeEngineCapability;
  oldValue?: boolean;
  newValue: boolean;
  actorUserId?: string;
  reason?: string;
  occurredAt: string;
};

export type CreativeEngineGlobalSettings = {
  enabled: boolean;
  updatedAt: string;
  updatedBy?: string;
};

export type SetCreativeEngineWorkspaceEntitlementInput = {
  tenantId: string;
  workspaceId: string;
  enabled: boolean;
  actorUserId?: string;
  reason?: string;
};

export type CreativeEngineEntitlementRepositoryPort = {
  getGlobalSettings(): Promise<CreativeEngineGlobalSettings>;
  setGlobalEnabled(input: { enabled: boolean; actorUserId?: string; reason?: string }): Promise<CreativeEngineGlobalSettings>;
  getWorkspaceEntitlement(input: { tenantId: string; workspaceId: string }): Promise<CreativeEngineWorkspaceEntitlement | undefined>;
  setWorkspaceEntitlement(input: SetCreativeEngineWorkspaceEntitlementInput): Promise<CreativeEngineWorkspaceEntitlement>;
  listEnabledWorkspaces(input?: { tenantId?: string; limit?: number; offset?: number }): Promise<CreativeEngineWorkspaceEntitlement[]>;
  listAudit(input: { tenantId?: string; workspaceId?: string; limit?: number }): Promise<CreativeEngineEntitlementAuditEntry[]>;
};
