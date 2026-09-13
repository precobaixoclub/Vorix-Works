/**
 * Porta de armazenamento de MÍDIA DE CONVERSAS — deliberadamente separada do `ObjectStoragePort`
 * (esse é para mídia PÚBLICA, servida direto por URL para TikTok/Meta puxarem — ver seu próprio
 * comentário). Mídia de conversa é conteúdo privado de cliente: nunca deve ter uma
 * `resolvePublicUrl()`, só pode ser lida de volta através do proxy autenticado do Vorix
 * (`GET /v1/inbox/media/:messageId`, ver `inbox.route.ts`), nunca por URL direta/assinada exposta
 * ao navegador.
 */
export type InboxMediaStoragePutInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

export type InboxMediaStorageGetResult = {
  body: Buffer;
  contentType: string;
};

export type InboxMediaStoragePort = {
  health(): Promise<{ ok: boolean; safeMessage?: string }>;
  put(input: InboxMediaStoragePutInput): Promise<void>;
  get(key: string): Promise<InboxMediaStorageGetResult | undefined>;
  delete(key: string): Promise<void>;
};
