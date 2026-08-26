import type { InstagramDmAccountRouteRepositoryPort } from "../ports/instagram-dm-account-route-repository.port.js";
import { matchAndSendAutomationReply, type MatchAndSendAutomationReplyDeps } from "./match-and-send-automation-reply.js";

/**
 * Recebimento do webhook de Mensageria do Instagram — módulo Instagram DM Automation, Fase 5.
 *
 * Formato do payload é fixo pela Meta (Messenger Platform, reaproveitado pela Instagram Messaging
 * API): `{object, entry: [{id: <ig-business-account-id>, messaging: [{sender, recipient,
 * timestamp, message: {mid, text, is_echo?}}]}]}`. `is_echo: true` marca um evento que é a própria
 * mensagem que ESTA aplicação enviou sendo ecoada de volta pelo webhook — pular sempre, tratar
 * como novo inbound criaria um loop (a automação responderia à própria resposta).
 *
 * Uma conta cujo `entry.id` não tem rota conhecida (`instagram-dm-account-route-repository`) é
 * ignorada silenciosamente, nunca lança erro — o webhook é único por App Meta inteiro; eventos de
 * contas de OUTRO app/integração não deveriam nem chegar aqui, mas o handshake de assinatura é por
 * App, não por conta, então isto é a defesa de última linha.
 */

type MetaMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

type MetaWebhookEntry = { id?: string; time?: number; messaging?: MetaMessagingEvent[] };

type MetaInstagramWebhookPayload = { object?: string; entry?: MetaWebhookEntry[] };

export type ReceiveInstagramDmWebhookDeps = MatchAndSendAutomationReplyDeps & {
  accountRouteRepository: InstagramDmAccountRouteRepositoryPort;
  /** Nome da conta pra contexto do reply de IA — resolvido pelo caller (rota) a partir da
   * credencial de publicação; opcional, `generateAiDmReply` degrada bem sem ele. */
  resolveAccountName?: (input: { tenantId: string; workspaceId: string; instagramBusinessAccountId: string }) => Promise<string | undefined>;
};

export type ReceiveInstagramDmWebhookResult = { processed: number; skipped: number; automationReplies: number };

export async function receiveInstagramDmWebhook(deps: ReceiveInstagramDmWebhookDeps, payload: unknown): Promise<ReceiveInstagramDmWebhookResult> {
  const entries = isMetaPayload(payload) ? payload.entry ?? [] : [];
  let processed = 0;
  let skipped = 0;
  let automationReplies = 0;

  for (const entry of entries) {
    const instagramBusinessAccountId = entry.id;
    if (!instagramBusinessAccountId) {
      skipped += entry.messaging?.length ?? 1;
      continue;
    }

    const route = await deps.accountRouteRepository.findByInstagramBusinessAccountId(instagramBusinessAccountId);
    if (!route) {
      skipped += entry.messaging?.length ?? 1;
      continue;
    }

    for (const messaging of entry.messaging ?? []) {
      if (messaging.message?.is_echo) {
        skipped++;
        continue;
      }
      const participantId = messaging.sender?.id;
      const text = messaging.message?.text;
      if (!participantId || !text) {
        skipped++;
        continue;
      }

      const sentAt = messaging.timestamp ? new Date(messaging.timestamp).toISOString() : new Date().toISOString();
      const existing = await deps.conversationRepository.findByParticipant({ tenantId: route.tenantId, workspaceId: route.workspaceId, instagramBusinessAccountId, participantId });

      const conversation = await deps.conversationRepository.upsertConversation({
        tenantId: route.tenantId,
        workspaceId: route.workspaceId,
        instagramBusinessAccountId,
        participantId,
        lastMessageAt: sentAt,
        lastMessagePreview: text.slice(0, 200),
        lastMessageFrom: "user",
        unread: true,
        automationMuted: existing?.automationMuted ?? false,
      });

      await deps.messageRepository.recordMessage({
        tenantId: route.tenantId,
        workspaceId: route.workspaceId,
        conversationId: conversation.id,
        direction: "inbound",
        sender: "user",
        messageId: messaging.message?.mid,
        messageText: text,
        rawPayload: messaging,
        sentAt,
      });
      processed++;

      const accountName = await deps.resolveAccountName?.({ tenantId: route.tenantId, workspaceId: route.workspaceId, instagramBusinessAccountId });
      const automation = await matchAndSendAutomationReply(deps, { tenantId: route.tenantId, workspaceId: route.workspaceId, conversation, incomingText: text, accountName });
      if (automation.message) automationReplies++;
    }
  }

  return { processed, skipped, automationReplies };
}

function isMetaPayload(payload: unknown): payload is MetaInstagramWebhookPayload {
  return !!payload && typeof payload === "object";
}
