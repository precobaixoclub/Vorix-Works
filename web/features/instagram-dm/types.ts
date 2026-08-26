/** Módulo Instagram DM Automation — Fase 5. Ver `src/application/ports/instagram-dm-*` no
 * backend. */

export type InstagramDmSender = "user" | "page" | "automation";

export type InstagramDmConversation = {
  id: string;
  instagramBusinessAccountId: string;
  participantId: string;
  participantUsername?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastMessageFrom: InstagramDmSender;
  unread: boolean;
  automationMuted: boolean;
};

export type InstagramDmMessage = {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  sender: InstagramDmSender;
  messageText?: string;
  sentAt: string;
};

export type InstagramDmAutomationMatchType = "contains" | "exact" | "starts_with";
export type InstagramDmAutomationReplyMode = "fixed" | "ai";

export type InstagramDmAutomationRule = {
  id: string;
  instagramBusinessAccountId: string;
  name: string;
  enabled: boolean;
  matchType: InstagramDmAutomationMatchType;
  keywords: readonly string[];
  replyMode: InstagramDmAutomationReplyMode;
  replyText?: string;
  aiInstructions?: string;
  priority: number;
};

export type CreateInstagramDmAutomationRuleInput = {
  instagramBusinessAccountId: string;
  name: string;
  enabled?: boolean;
  matchType: InstagramDmAutomationMatchType;
  keywords: readonly string[];
  replyMode: InstagramDmAutomationReplyMode;
  replyText?: string;
  aiInstructions?: string;
  priority?: number;
};

export type UpdateInstagramDmAutomationRuleInput = Partial<Omit<CreateInstagramDmAutomationRuleInput, "instagramBusinessAccountId">>;
