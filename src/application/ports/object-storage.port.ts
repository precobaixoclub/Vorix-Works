/**
 * Porta de armazenamento de objetos — escopo deliberadamente estreito: só o necessário para
 * hospedar mídia enviada pelo cliente numa URL pública HTTPS que o TikTok/Meta consigam buscar
 * (`PULL_FROM_URL`/Graph API). NÃO é a Asset Library (biblioteca de marca do Workspace, só
 * metadados até aqui) nem o Media Catalog (mídia de campanha já resolvida pelo motor de
 * conteúdo) — reconciliar os três é uma decisão explicitamente adiada em outras sprints; esta
 * porta não reabre essa decisão, só resolve "preciso de uma URL pública para um post".
 */
export type ObjectStoragePutInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

export type ObjectStoragePort = {
  health(): Promise<{ ok: boolean; safeMessage?: string }>;
  put(input: ObjectStoragePutInput): Promise<{ url: string }>;
  delete(key: string): Promise<void>;
  /** Deriva a URL pública de um objeto já enviado a partir só da `key` — necessário porque
   * `AssetStorageRef` (Asset Library) nunca persiste a URL em si (decisão obrigatória, ver
   * `asset-library.model.ts`), só `objectKey`. Sempre a mesma fórmula que `put()` usaria. */
  resolvePublicUrl(key: string): string;
};
