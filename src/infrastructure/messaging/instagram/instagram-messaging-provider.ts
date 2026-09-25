import type { MessagingConnectionRepositoryPort } from "../../../application/ports/messaging-connection-repository.port.js";
import type { MessagingProvider, MessagingProviderCapabilities, MessagingSendResult, NormalizedConnectionStatus } from "../../../application/ports/messaging-provider.port.js";
import { MessagingProviderError } from "../../../application/ports/messaging-provider.port.js";
import type { PublicationRepositoryPort } from "../../../application/ports/publication-repository.port.js";
import type { PublicationSecretStoragePort } from "../../../application/publication/publication-secret-store.js";
import { MetaGraphError, metaGraphRequest } from "../../meta/meta-graph-client.js";

const CAPABILITIES: MessagingProviderCapabilities = {
  // Sem sessão pareada — token OAuth já existente (reaproveita a MESMA credencial de publicação de
  // conteúdo do Instagram, nunca um App/credencial separado). Ver comentário no port sobre
  // "canal stateless" (esta classe é exatamente o caso que o comentário antecipava).
  supportsQrConnect: false,
  supportsTemplates: false,
  // v1 — só texto (mesmo escopo do módulo Instagram DM original, `sendInstagramDm`). Mídia fica
  // pra uma rodada futura (escopo cortado deliberadamente, ver relatório final desta entrega).
  supportedMediaKinds: ["text"],
  supportsReadReceipts: false,
  supportsTypingIndicator: false,
};

function graphErrorToProviderError(error: unknown, fallbackMessage: string): MessagingProviderError {
  if (error instanceof MetaGraphError) {
    if (error.isTokenError) return new MessagingProviderError("auth", error.message);
    if (error.isRateLimit) return new MessagingProviderError("rate_limit", error.message);
    if (error.isTransient) return new MessagingProviderError("transient", error.message);
    return new MessagingProviderError("permanent", error.message);
  }
  return new MessagingProviderError("transient", error instanceof Error ? error.message : fallbackMessage);
}

/**
 * Instagram DM como canal de primeira classe do Inbox (pedido explícito do usuário: "junte só a
 * tela, contabilizando no kanban também essas conversas" — decisão tomada foi a opção completa,
 * reaproveitando toda a pipeline já existente do WhatsApp). `externalSessionId` de uma
 * `MessagingConnection` deste canal é sempre o `instagramBusinessAccountId` — nunca um token, nunca
 * um id de sessão pareada (não existe pareamento aqui).
 *
 * Só `sendText` é implementado de verdade — os demais métodos obrigatórios do port
 * (`sendImage`/`sendAudio`/`sendVideo`/`sendDocument`) lançam `MessagingProviderError("permanent",
 * ...)` (mídia outbound do Instagram fica fora de escopo desta rodada); `connect`/`disconnect`/
 * `logout`/`getQrCode` também lançam — a conexão nasce/morre via o fluxo OAuth de publicação já
 * existente (`meta-instagram-oauth-service.ts`) + `ensureInstagramMessagingConnection`
 * (`instagram-connection-use-cases.ts`), nunca por pareamento.
 */
export class InstagramMessagingProvider implements MessagingProvider {
  readonly providerId = "instagram";
  readonly capabilities = CAPABILITIES;

  constructor(
    private readonly deps: {
      connectionRepository: MessagingConnectionRepositoryPort;
      publicationRepository: PublicationRepositoryPort;
      publicationSecretStore: PublicationSecretStoragePort;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async connect(): Promise<{ phoneNumber?: string }> {
    throw new MessagingProviderError("permanent", "Conexão Instagram é criada via OAuth de publicação (Conexões → Instagram), não suporta pareamento.");
  }

  async disconnect(): Promise<void> {
    // No-op deliberado — desconectar de verdade é revogar a credencial OAuth de publicação
    // (fluxo já existente, `meta-instagram-oauth-service.ts`), nunca uma ação própria deste canal.
  }

  async logout(): Promise<void> {
    throw new MessagingProviderError("permanent", "Canal Instagram não tem sessão pareada para revogar — desconecte pela tela de Conexões.");
  }

  async getQrCode(): Promise<{ qrCode: string; expiresAt: string }> {
    throw new MessagingProviderError("permanent", "Canal Instagram não suporta pareamento por QR code.");
  }

  async getConnectionStatus(input: { externalSessionId: string }): Promise<NormalizedConnectionStatus> {
    const credential = await this.resolveActiveCredential(input.externalSessionId).catch(() => undefined);
    return { status: credential ? "connected" : "logged_out" };
  }

  async sendText(input: { externalSessionId: string; to: string; body: string }): Promise<MessagingSendResult> {
    const { accessToken, instagramBusinessAccountId } = await this.resolveActiveCredential(input.externalSessionId);
    try {
      const response = await metaGraphRequest<{ message_id?: string }>(`/${instagramBusinessAccountId}/messages`, {
        method: "POST",
        accessToken,
        fetchImpl: this.deps.fetchImpl,
        params: { recipient: { id: input.to }, message: { text: input.body } },
      });
      if (!response.message_id) throw new MessagingProviderError("transient", "Graph API não devolveu message_id.");
      return { externalMessageId: response.message_id };
    } catch (error) {
      throw graphErrorToProviderError(error, "Falha ao enviar mensagem no Instagram.");
    }
  }

  async sendImage(): Promise<MessagingSendResult> {
    throw new MessagingProviderError("permanent", "Envio de imagem ainda não suportado no canal Instagram.");
  }

  async sendAudio(): Promise<MessagingSendResult> {
    throw new MessagingProviderError("permanent", "Envio de áudio ainda não suportado no canal Instagram.");
  }

  async sendVideo(): Promise<MessagingSendResult> {
    throw new MessagingProviderError("permanent", "Envio de vídeo ainda não suportado no canal Instagram.");
  }

  async sendDocument(): Promise<MessagingSendResult> {
    throw new MessagingProviderError("permanent", "Envio de documento ainda não suportado no canal Instagram.");
  }

  async sendContact(): Promise<MessagingSendResult> {
    throw new MessagingProviderError("permanent", "Envio de contato ainda não suportado no canal Instagram.");
  }

  async sendSticker(): Promise<MessagingSendResult> {
    throw new MessagingProviderError("permanent", "Envio de figurinha ainda não suportado no canal Instagram.");
  }

  // downloadMedia / getGroupInfo / getProfilePicture / sendReaction / revokeMessage deliberadamente
  // OMITIDOS (métodos opcionais do port) — Instagram DM não tem grupo, mídia inbound e reação/
  // revogação via API ficam fora de escopo desta rodada; os chamadores já tratam a ausência como
  // "recurso indisponível neste canal", nunca como erro fatal (mesmo comportamento hoje pro
  // `FakeMessagingProvider`).

  /** Reaproveita EXATAMENTE o mecanismo de credencial já usado por `sendInstagramDm` (módulo
   * Instagram DM original) — a mensageria usa a MESMA credencial `instagram` da publicação de
   * conteúdo, nunca uma separada. `externalSessionId` (= instagramBusinessAccountId) resolve
   * `tenantId`/`workspaceId` via a própria `MessagingConnection` (o port de mensageria não passa
   * esses campos explicitamente — única forma de os obter aqui). */
  private async resolveActiveCredential(externalSessionId: string): Promise<{ accessToken: string; instagramBusinessAccountId: string }> {
    const connection = await this.deps.connectionRepository.getByProviderAndExternalSessionId("instagram", externalSessionId);
    if (!connection) throw new MessagingProviderError("permanent", `Conexão Instagram "${externalSessionId}" não encontrada.`);

    const references = await this.deps.publicationRepository.listCredentialReferences({ tenantId: connection.tenantId, workspaceId: connection.workspaceId, providerId: "instagram" });
    const reference = references.find((candidate) => candidate.providerSubjectId === externalSessionId && candidate.status === "active");
    if (!reference) throw new MessagingProviderError("auth", "Credencial do Instagram não está ativa — reconecte em Conexões.");

    const secret = await this.deps.publicationSecretStore.get({ tenantId: connection.tenantId, workspaceId: connection.workspaceId, providerId: "instagram", credentialReferenceId: reference.credentialReferenceId });
    const accessToken = secret?.value.accessToken;
    if (!accessToken) throw new MessagingProviderError("auth", "Token de acesso do Instagram ausente — reconecte em Conexões.");

    return { accessToken, instagramBusinessAccountId: externalSessionId };
  }
}
