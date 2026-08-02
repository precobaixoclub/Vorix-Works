/** Espelha `src/domain/conversation/conversation.model.ts` (backend, Sprint 06/07). */

export const CONVERSATION_STATES = [
  "idle",
  "processing",
  "awaiting_context",
  "waiting_action",
  "resolved",
  "collecting_briefing",
  "awaiting_confirmation",
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export type Conversation = {
  id: string;
  tenantId: string;
  workspaceId: string;
  status: "active" | "archived";
  state: ConversationState;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

export const USER_INTENT_TYPES = [
  "create_campaign",
  "edit_campaign",
  "answer_question",
  "query_workspace",
  "query_assets",
  "query_knowledge",
  "start_briefing",
  "free_chat",
  "unknown",
] as const;
export type UserIntentType = (typeof USER_INTENT_TYPES)[number];

export type UserIntent = {
  type: UserIntentType;
  confidence: number;
  rawText: string;
  matchedRule?: string;
};

export const CONVERSATION_ACTIONS = [
  "respond",
  "request_more_context",
  "call_caio",
  "call_clara",
  "call_assets",
  "start_briefing",
] as const;
export type ConversationAction = (typeof CONVERSATION_ACTIONS)[number];

export type ArthurDecision = {
  action: ConversationAction;
  reason: string;
  executed: false;
};

export type InternalCommand = {
  action: ConversationAction;
  intent: UserIntent;
  reason: string;
};

export const CONVERSATION_EVENT_TYPES = [
  "user_message",
  "intent_classified",
  "context_updated",
  "decision_made",
  "system_message",
  "state_changed",
  "briefing_started",
  "briefing_field_collected",
  "briefing_field_updated",
  "briefing_field_ambiguous",
  "briefing_question_created",
  "briefing_question_answered",
  "briefing_confirmation_requested",
  "briefing_confirmed",
  "briefing_cancelled",
  "briefing_suspended",
  "briefing_resumed",
  "command_prepared",
  "command_superseded",
] as const;
export type ConversationEventType = (typeof CONVERSATION_EVENT_TYPES)[number];

export type ConversationEvent = {
  id: string;
  conversationId: string;
  type: ConversationEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type SendMessageResult = {
  conversation: Conversation;
  intent: UserIntent;
  command: InternalCommand;
  decision: ArthurDecision;
  systemMessageText: string;
  events: ConversationEvent[];
  /** Presentes só quando o turno foi governado por um Briefing ativo (Sprint 07, Fase 13). */
  briefingSummary?: import("../briefing/types").BriefingSummaryDto;
  nextQuestion?: import("../briefing/types").BriefingQuestionDto;
  readiness?: import("../briefing/types").BriefingReadiness;
  confirmationRequired?: boolean;
  preparedCommandSummary?: import("../briefing/types").PreparedCommandSummaryDto;
  /** Sprint 08 — metadados públicos mínimos sobre IA neste turno. Nunca nome de modelo, tokens,
   * prompt ou confidence numérica (Fase 21: "a UI não deve virar um chat genérico de IA"). */
  aiAssisted?: boolean;
  aiFallbackUsed?: boolean;
  extractionWarnings?: readonly string[];
};
