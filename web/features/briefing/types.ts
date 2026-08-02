/** Espelha `src/application/briefing/dto.ts` e `src/domain/briefing/briefing.model.ts` (backend,
 * Sprint 07). Contrato validado por `scripts/check-contract-drift.mjs` (Fase 15) — nunca deixar
 * este arquivo divergir silenciosamente do backend. */

export const BRIEFING_TYPES = ["campaign_creation", "campaign_edit", "content_request", "knowledge_query", "asset_search", "generic_task"] as const;
export type BriefingType = (typeof BRIEFING_TYPES)[number];

export const BRIEFING_STATUSES = ["collecting", "awaiting_confirmation", "ready", "completed", "cancelled", "expired"] as const;
export type BriefingStatus = (typeof BRIEFING_STATUSES)[number];

export type Briefing = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  type: BriefingType;
  status: BriefingStatus;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
};

export const BRIEFING_SOURCES = ["user_message", "conversation_memory", "workspace", "company_knowledge", "asset_metadata", "system_inference", "ai_extraction"] as const;
export type BriefingSource = (typeof BRIEFING_SOURCES)[number];

export const BRIEFING_ANSWER_TYPES = ["text", "single_choice", "multi_choice", "date", "confirmation"] as const;
export type BriefingAnswerType = (typeof BRIEFING_ANSWER_TYPES)[number];

export type BriefingFieldSummaryDto = {
  fieldKey: string;
  label: string;
  value: string;
  source: BriefingSource;
  confirmedByUser: boolean;
  requiresConfirmation: boolean;
};

export type BriefingSummaryDto = {
  briefingId: string;
  type: BriefingType;
  status: BriefingStatus;
  revision: number;
  knownFields: readonly BriefingFieldSummaryDto[];
  missingRequiredFields: readonly string[];
  ambiguousFields: readonly string[];
  unconfirmedSuggestedFields: readonly string[];
};

export type BriefingQuestionDto = {
  id: string;
  text: string;
  reason: string;
  answerType: BriefingAnswerType;
  options?: readonly string[];
  fieldKeys: readonly string[];
};

export type BriefingReadiness = {
  isReadyForConfirmation: boolean;
  isConfirmed: boolean;
  requiredFields: readonly string[];
  missingRequiredFields: readonly string[];
  invalidFields: readonly string[];
  ambiguousFields: readonly string[];
  unconfirmedSuggestedFields: readonly string[];
  optionalHighImpactFields: readonly string[];
  readinessScore: number;
  reason: string;
};

export const PREPARED_COMMAND_STATUSES = ["prepared", "superseded"] as const;
export type PreparedCommandStatus = (typeof PREPARED_COMMAND_STATUSES)[number];

export type PreparedCommandSummaryDto = {
  id: string;
  type: BriefingType;
  briefingRevision: number;
  status: PreparedCommandStatus;
  fieldCount: number;
  unresolvedOptionalFieldCount: number;
};
