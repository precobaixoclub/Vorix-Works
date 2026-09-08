import type { TimelineEntityType, TimelineEvent, TimelineActorType } from "../../domain/crm/crm.model.js";

export type RecordTimelineEventInput = {
  tenantId: string;
  workspaceId: string;
  entityType: TimelineEntityType;
  entityId: string;
  eventType: string;
  actorType: TimelineActorType;
  actorId?: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
};

export type TimelineEventRepositoryPort = {
  record(input: RecordTimelineEventInput): Promise<TimelineEvent>;
  listByEntity(input: { entityType: TimelineEntityType; entityId: string; limit?: number }): Promise<TimelineEvent[]>;
};
