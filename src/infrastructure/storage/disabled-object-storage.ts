import type { ObjectStoragePort } from "../../application/ports/object-storage.port.js";

/** Usado quando `OBJECT_STORAGE_ENABLED` não está ligado — falha fechado com mensagem clara em vez de tentar subir para um bucket inexistente. */
export class DisabledObjectStorage implements ObjectStoragePort {
  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    return { ok: false, safeMessage: "Upload de mídia não configurado (OBJECT_STORAGE_ENABLED=false)." };
  }

  async put(): Promise<{ url: string }> {
    throw new Error("OBJECT_STORAGE_NOT_CONFIGURED: upload de mídia não está habilitado neste servidor.");
  }

  async delete(): Promise<void> {
    throw new Error("OBJECT_STORAGE_NOT_CONFIGURED: upload de mídia não está habilitado neste servidor.");
  }
}
