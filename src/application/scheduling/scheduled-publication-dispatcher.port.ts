import type { ScheduleOccurrence } from "../../domain/scheduling/scheduling.model.js";
import type { TenantRole } from "../../domain/identity/identity.model.js";

export type ScheduledPublicationDispatchInput = {
  occurrence: ScheduleOccurrence;
  actor: {
    userId: string;
    role: TenantRole;
    sessionId?: string;
  };
  requestId?: string;
};

export type ScheduledPublicationDispatchResult =
  | { dispatched: true; executionReference: NonNullable<ScheduleOccurrence["executionReference"]>; safeMessage: string }
  | { dispatched: false; category: "policy" | "credential" | "provider" | "dispatch"; code: string; safeMessage: string; retryAtUtc?: string; deadLetter?: boolean };

export type ScheduledPublicationDispatcherPort = {
  dispatch(input: ScheduledPublicationDispatchInput): Promise<ScheduledPublicationDispatchResult>;
};
