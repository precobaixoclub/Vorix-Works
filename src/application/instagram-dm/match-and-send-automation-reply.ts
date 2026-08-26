import type { AIProviderPort } from "../ports/ai-provider.port.js";
import type { InstagramDmAutomationRule, InstagramDmAutomationRuleRepositoryPort, InstagramDmAutomationMatchType } from "../ports/instagram-dm-automation-rule-repository.port.js";
import type { InstagramDmConversation } from "../ports/instagram-dm-conversation-repository.port.js";
import type { InstagramDmMessage } from "../ports/instagram-dm-message-repository.port.js";
import { generateAiDmReply } from "./generate-ai-dm-reply.js";
import { sendInstagramDm, type SendInstagramDmDeps } from "./send-instagram-dm.js";

/**
 * Casamento de palavra-chave + envio da resposta automática — módulo Instagram DM Automation,
 * Fase 5. Regras são avaliadas em ordem de `priority`; a PRIMEIRA que casar vence — nunca duas
 * respostas pra uma mensagem só. Conversa marcada `automationMuted` (humano assumiu manualmente)
 * nunca dispara automação, mesmo com uma regra batendo.
 */

function matchesKeywords(normalizedIncoming: string, matchType: InstagramDmAutomationMatchType, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return false;
    if (matchType === "exact") return normalizedIncoming === normalizedKeyword;
    if (matchType === "starts_with") return normalizedIncoming.startsWith(normalizedKeyword);
    return normalizedIncoming.includes(normalizedKeyword);
  });
}

export type MatchAndSendAutomationReplyDeps = SendInstagramDmDeps & {
  automationRuleRepository: InstagramDmAutomationRuleRepositoryPort;
  /** Só é necessário quando alguma regra ativa usa `replyMode: "ai"` — ausente, essas regras são
   * puladas (nunca lançam erro pro webhook inteiro falhar por causa de UMA regra mal configurada). */
  aiReplyProvider?: AIProviderPort;
};

export type MatchAndSendAutomationReplyInput = {
  tenantId: string;
  workspaceId: string;
  conversation: InstagramDmConversation;
  incomingText: string;
  accountName?: string;
};

export type MatchAndSendAutomationReplyResult = { matched: boolean; rule?: InstagramDmAutomationRule; message?: InstagramDmMessage; skippedReason?: string };

export async function matchAndSendAutomationReply(deps: MatchAndSendAutomationReplyDeps, input: MatchAndSendAutomationReplyInput): Promise<MatchAndSendAutomationReplyResult> {
  if (input.conversation.automationMuted) return { matched: false, skippedReason: "AUTOMATION_MUTED" };

  const normalizedIncoming = input.incomingText.trim().toLowerCase();
  if (!normalizedIncoming) return { matched: false, skippedReason: "EMPTY_MESSAGE" };

  const rules = await deps.automationRuleRepository.listByAccount({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    instagramBusinessAccountId: input.conversation.instagramBusinessAccountId,
    onlyEnabled: true,
  });

  const rule = rules.find((candidate) => matchesKeywords(normalizedIncoming, candidate.matchType, candidate.keywords));
  if (!rule) return { matched: false, skippedReason: "NO_RULE_MATCHED" };

  let replyText: string;
  if (rule.replyMode === "fixed") {
    if (!rule.replyText) return { matched: true, rule, skippedReason: "FIXED_REPLY_TEXT_MISSING" };
    replyText = rule.replyText;
  } else {
    if (!deps.aiReplyProvider) return { matched: true, rule, skippedReason: "AI_REPLY_NOT_CONFIGURED" };
    replyText = await generateAiDmReply(deps.aiReplyProvider, { incomingMessage: input.incomingText, instructions: rule.aiInstructions, accountName: input.accountName });
  }

  const message = await sendInstagramDm(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, conversation: input.conversation, text: replyText, sender: "automation" });
  return { matched: true, rule, message };
}
