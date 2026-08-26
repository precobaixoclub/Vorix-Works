import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { PublicationSecretStoragePort } from "../publication/publication-secret-store.js";
import type { InstagramDmConversation, InstagramDmConversationRepositoryPort, InstagramDmSender } from "../ports/instagram-dm-conversation-repository.port.js";
import type { InstagramDmMessage, InstagramDmMessageRepositoryPort } from "../ports/instagram-dm-message-repository.port.js";
import { metaGraphRequest } from "../../infrastructure/meta/meta-graph-client.js";

/**
 * Envio de mensagem direta do Instagram — módulo Instagram DM Automation, Fase 5.
 *
 * DELIBERADAMENTE reaproveita a credencial de publicação `instagram` já existente
 * (`PublicationRepositoryPort`/`PublicationSecretStoragePort`) em vez de um credential store
 * próprio como o módulo de Ads — mensageria é o MESMO canal/token de publicação de conteúdo do
 * Instagram (Page Access Token com escopo adicional `instagram_manage_messages`), nunca um
 * conceito isolado como conta de anúncio. Ver `instagram.route.ts` sobre o roteamento inbound do
 * webhook, que por sua vez precisou de um port isolado (`instagram-dm-account-route-repository`)
 * justamente porque `PublicationRepositoryPort` não expõe busca global por conta.
 */

const MESSAGE_TEXT_MAX_LENGTH = 1000;

export type SendInstagramDmInput = {
  tenantId: string;
  workspaceId: string;
  conversation: InstagramDmConversation;
  text: string;
  sender: Extract<InstagramDmSender, "page" | "automation">;
};

export type SendInstagramDmDeps = {
  messageRepository: InstagramDmMessageRepositoryPort;
  conversationRepository: InstagramDmConversationRepositoryPort;
  publicationRepository: PublicationRepositoryPort;
  publicationSecretStore: PublicationSecretStoragePort;
  fetchImpl?: typeof fetch;
};

export async function sendInstagramDm(deps: SendInstagramDmDeps, input: SendInstagramDmInput): Promise<InstagramDmMessage> {
  const text = input.text.trim();
  if (!text) throw new Error("INSTAGRAM_DM_TEXT_EMPTY: a mensagem não pode ser vazia.");
  if (text.length > MESSAGE_TEXT_MAX_LENGTH) throw new Error(`INSTAGRAM_DM_TEXT_TOO_LONG: mensagens do Instagram têm limite de ${MESSAGE_TEXT_MAX_LENGTH} caracteres.`);

  const references = await deps.publicationRepository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "instagram" });
  const reference = references.find((candidate) => candidate.providerSubjectId === input.conversation.instagramBusinessAccountId && candidate.status === "active");
  if (!reference) throw new Error("INSTAGRAM_DM_CREDENTIAL_NOT_ACTIVE: nenhuma conexão ativa do Instagram encontrada para esta conta — reconecte em Conexões.");

  const secret = await deps.publicationSecretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "instagram", credentialReferenceId: reference.credentialReferenceId });
  const accessToken = secret?.value.accessToken;
  if (!accessToken) throw new Error("INSTAGRAM_DM_TOKEN_MISSING: token não encontrado para esta conexão — reconecte em Conexões.");

  const response = await metaGraphRequest<{ message_id?: string }>(`/${input.conversation.instagramBusinessAccountId}/messages`, {
    method: "POST",
    accessToken,
    fetchImpl: deps.fetchImpl,
    params: { recipient: { id: input.conversation.participantId }, message: { text } },
  });

  const now = new Date().toISOString();
  const message = await deps.messageRepository.recordMessage({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: input.conversation.id,
    direction: "outbound",
    sender: input.sender,
    messageId: response.message_id,
    messageText: text,
    sentAt: now,
  });

  await deps.conversationRepository.upsertConversation({
    ...input.conversation,
    lastMessageAt: now,
    lastMessagePreview: text.slice(0, 200),
    lastMessageFrom: input.sender,
    unread: false,
  });

  return message;
}
