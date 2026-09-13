import type { InboxMediaStorageGetResult, InboxMediaStoragePort } from "../../application/ports/inbox-media-storage.port.js";

/** Usado quando nenhum storage de mídia de conversas está configurado — a Inbox continua
 * funcionando normalmente (mensagens de mídia chegam com `type` correto), só sem baixar/persistir
 * o arquivo em si; `MessageMediaPreview` no frontend cai no fallback de ícone+rótulo. */
export class DisabledInboxMediaStorage implements InboxMediaStoragePort {
  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    return { ok: false, safeMessage: "Storage de mídia de conversas não configurado." };
  }

  async put(): Promise<void> {
    throw new Error("INBOX_MEDIA_STORAGE_NOT_CONFIGURED: storage de mídia de conversas não está habilitado neste servidor.");
  }

  async get(): Promise<InboxMediaStorageGetResult | undefined> {
    return undefined;
  }

  async delete(): Promise<void> {
    // Sem storage configurado, nunca há nada para apagar.
  }
}
