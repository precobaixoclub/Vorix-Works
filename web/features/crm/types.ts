export type ContactChannel = "whatsapp" | "instagram" | "facebook" | "tiktok";

export type Contact = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  company?: string;
  document?: string;
  origin?: string;
  ownerUserId?: string;
  teamId?: string;
  tags: readonly string[];
  customFields: Record<string, unknown>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt?: string;
};

export type ContactIdentity = {
  id: string;
  contactId: string;
  channel: ContactChannel;
  externalId: string;
  connectionId?: string;
  createdAt: string;
};

export type TimelineEntityType = "contact" | "deal" | "conversation" | "proposal" | "task";
export type TimelineActorType = "user" | "ai" | "automation" | "system";

export type TimelineEvent = {
  id: string;
  entityType: TimelineEntityType;
  entityId: string;
  eventType: string;
  actorType: TimelineActorType;
  actorId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type Pipeline = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PipelineStage = {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  createdAt: string;
};

export type Deal = {
  id: string;
  tenantId: string;
  workspaceId: string;
  pipelineId: string;
  stageId: string;
  contactId?: string;
  title: string;
  valueCents: number;
  currency: string;
  ownerUserId?: string;
  teamId?: string;
  origin?: string;
  lossReason?: string;
  wonAt?: string;
  lostAt?: string;
  expectedCloseDate?: string;
  createdAt: string;
  updatedAt: string;
  lastStageChangedAt: string;
};

export type DealStageSummary = {
  stageId: string;
  count: number;
  valueCentsSum: number;
};
