import type { InboxUseCaseDeps } from "../inbox/inbox-use-cases.js";
import { registerInboundMessage } from "../inbox/inbox-use-cases.js";
import type { InstagramDmAccountRouteRepositoryPort } from "../ports/instagram-dm-account-route-repository.port.js";
import { ensureInstagramMessagingConnection } from "./ensure-instagram-messaging-connection.js";

/**
 * Recebimento do webhook de Mensageria do Instagram — Instagram DM virou canal de primeira classe
 * do Inbox (pedido explícito do usuário: "junte só a tela, contabilizando no kanban também essas
 * conversas" — decisão tomada foi a opção completa). Achado de revisão: esta função ANTES gravava
 * em `instagram_dm_conversations`/`instagram_dm_messages` (tabelas próprias, paralelas) e disparava
 * `matchAndSendAutomationReply` (automação por palavra-chave). Agora chama `registerInboundMessage`
 * — o MESMO caminho usado pelo WhatsApp — pra herdar de graça roteamento por equipe, Kanban,
 * notificações e SSE. **Escopo cortado deliberadamente** (documentado no relatório final desta
 * entrega): a automação por palavra-chave do módulo antigo NÃO foi portada — nenhuma automação
 * dispara mais aqui (as tabelas antigas ficam paradas, sem receber dados novos). Se precisar de
 * automação de novo, o caminho natural agora é `conversation.aiEnabled` + o AI Responder do Inbox
 * (`maybeGenerateAiResponse`), não o motor antigo de regras por palavra-chave.
 *
 * Formato do payload é fixo pela Meta (Messenger Platform, reaproveitado pela Instagram Messaging
 * API): `{object, entry: [{id: <ig-business-account-id>, messaging: [{sender, recipient,
 * timestamp, message: {mid, text, is_echo?}}]}]}`. `is_echo: true` marca a própria mensagem que
 * ESTA aplicação enviou sendo ecoada de volta — pular sempre, tratar como inbound criaria loop.
 *
 * Uma conta cujo `entry.id` não tem rota conhecida (`instagram-dm-account-route-repository`) é
 * ignorada silenciosamente, nunca lança — o webhook é único por App Meta inteiro; eventos de
 * contas de OUTRO app/integração não deveriam nem chegar aqui, mas o handshake de assinatura é por
 * App, não por conta, então isto é a defesa de última linha.
 *
 * **Achado de design, documentado (não resolvido nesta rodada)**: `registerInboundMessage` pivota
 * contato por TELEFONE (`resolveInboundPivotPhone`) — Instagram não tem telefone, então o
 * participantId numérico cai no fallback `normalizePhoneNumber(chatId)`, virando um "telefone"
 * sintético (nunca colide na prática — IDs do Instagram têm 15-17 dígitos, mais longos que
 * qualquer E.164 real — mas é semanticamente impreciso, mesmo "pivô degradado" já documentado em
 * outros pontos do módulo pra LID sem evidência forte). Redesenhar identidade de contato pra ser
 * multi-canal-nativa é um projeto à parte, fora do pedido desta rodada.
 */

type MetaMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

type MetaWebhookEntry = { id?: string; time?: number; messaging?: MetaMessagingEvent[] };

type MetaInstagramWebhookPayload = { object?: string; entry?: MetaWebhookEntry[] };

export type ReceiveInstagramDmWebhookDeps = InboxUseCaseDeps & {
  accountRouteRepository: InstagramDmAccountRouteRepositoryPort;
};

export type ReceiveInstagramDmWebhookResult = {
  processed: number;
  skipped: number;
  /** Pra quem chamar publicar no SSE (`publishConversationUpdated`) — nunca feito aqui dentro
   * (use-case nunca publica realtime diretamente, mesmo padrão do resto do Inbox). */
  updatedConversations: { tenantId: string; workspaceId: string; conversationId: string }[];
};

export async function receiveInstagramDmWebhook(deps: ReceiveInstagramDmWebhookDeps, payload: unknown): Promise<ReceiveInstagramDmWebhookResult> {
  const entries = isMetaPayload(payload) ? payload.entry ?? [] : [];
  let processed = 0;
  let skipped = 0;
  const updatedConversations: { tenantId: string; workspaceId: string; conversationId: string }[] = [];

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

    const connection = await ensureInstagramMessagingConnection(deps, { tenantId: route.tenantId, workspaceId: route.workspaceId, instagramBusinessAccountId });

    for (const messaging of entry.messaging ?? []) {
      if (messaging.message?.is_echo) {
        skipped++;
        continue;
      }
      const participantId = messaging.sender?.id;
      const text = messaging.message?.text;
      const externalMessageId = messaging.message?.mid;
      if (!participantId || !text || !externalMessageId) {
        skipped++;
        continue;
      }

      const occurredAt = messaging.timestamp ? new Date(messaging.timestamp).toISOString() : new Date().toISOString();
      const { conversation } = await registerInboundMessage(deps, {
        tenantId: route.tenantId,
        workspaceId: route.workspaceId,
        connectionId: connection.id,
        chatId: participantId,
        isGroup: false,
        fromMe: false,
        senderId: participantId,
        externalMessageId,
        type: "text",
        body: text,
        occurredAt,
      });
      processed++;
      updatedConversations.push({ tenantId: route.tenantId, workspaceId: route.workspaceId, conversationId: conversation.id });
    }
  }

  return { processed, skipped, updatedConversations };
}

function isMetaPayload(payload: unknown): payload is MetaInstagramWebhookPayload {
  return !!payload && typeof payload === "object";
}
