import type { PlanCapability, PlanLimitResource } from "./plan-entitlements.model.js";

export type TenantAccessMode = "inherit" | "enabled" | "blocked";
export type TenantControls = {
  tenantId: string;
  displayName?: string;
  accessMode: TenantAccessMode;
  capabilities: Partial<Record<PlanCapability, boolean>>;
  limits: Partial<Record<PlanLimitResource, number | null>>;
  version: number;
  updatedAt?: string;
};
export type TenantControlChange = {
  id: string; tenantId: string; actorUserId?: string; reason: string;
  before: TenantControls; after: TenantControls; occurredAt: string;
};
export const defaultTenantControls = (tenantId: string): TenantControls => ({ tenantId, accessMode: "inherit", capabilities: {}, limits: {}, version: 0 });
