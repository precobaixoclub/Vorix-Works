import type { MessagingConnection } from "../../domain/inbox/inbox.model.js";
import type { MessagingConnectionRepositoryPort } from "../ports/messaging-connection-repository.port.js";

/**
 * Instagram DM como canal de primeira classe do Inbox (pedido explícito do usuário) — uma conexão
 * Instagram nasce/é reencontrada de forma IDEMPOTENTE a partir do `instagramBusinessAccountId` que
 * chega em todo evento de webhook, nunca via o fluxo de pareamento por QR do WhatsApp
 * (`createConnection`). `externalSessionId` é sempre o `instagramBusinessAccountId` — é essa
 * mesma string que `InstagramMessagingProvider` usa depois pra resolver a credencial OAuth de
 * publicação (`sendText`).
 */
export async function ensureInstagramMessagingConnection(
  deps: { connectionRepository: MessagingConnectionRepositoryPort },
  input: { tenantId: string; workspaceId: string; instagramBusinessAccountId: string; displayName?: string },
): Promise<MessagingConnection> {
  const existing = await deps.connectionRepository.getByProviderAndExternalSessionId("instagram", input.instagramBusinessAccountId);
  if (existing) return existing;

  const created = await deps.connectionRepository.create({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    provider: "instagram",
    displayName: input.displayName ?? "Instagram",
  });
  // Sem `connect()`/QR — a sessão "existe" desde já (é a credencial OAuth de publicação, resolvida
  // sob demanda em cada envio, nunca um estado pareado que precise ser "iniciado" aqui).
  return deps.connectionRepository.updateStatus(created.id, { status: "connected", externalSessionId: input.instagramBusinessAccountId });
}
