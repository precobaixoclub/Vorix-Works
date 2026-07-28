import type { TenantActor, TenantPlanCode, TenantSocialNetwork } from "./valentina.types.js";

export type ValentinaLogAction =
  | "TenantCreated"
  | "TenantUpdated"
  | "TenantActivated"
  | "TenantSuspended"
  | "TenantDeleted"
  | "PlanChanged"
  | "CreditsConsumed"
  | "CreditsAdded"
  | "IntegrationConnected"
  | "IntegrationDisconnected"
  | "TenantRequested"
  | "TenantDelivered"
  | "LimitChecked";

export type ValentinaLogEntry = {
  id: string;
  occurredAt: string;
  action: ValentinaLogAction;
  message: string;
  actor?: TenantActor;
  tenantId?: string;
  clientId?: string;
  plan?: TenantPlanCode;
  network?: TenantSocialNetwork;
  version?: number;
  metadata?: Record<string, unknown>;
};

export type ValentinaLoggerPort = {
  record(entry: ValentinaLogEntry): Promise<void>;
};
