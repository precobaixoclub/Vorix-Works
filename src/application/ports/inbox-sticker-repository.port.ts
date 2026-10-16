/** Figurinhas salvas da equipe. Ver `db/migrations/0154_inbox_saved_stickers.sql`. */

export type InboxSavedSticker = {
  id: string;
  tenantId: string;
  workspaceId: string;
  objectKey: string;
  mimeType: string;
  contentHash: string;
  sizeBytes: number;
  createdBy?: string;
  createdAt: string;
};

export type InboxStickerRepositoryPort = {
  /** Idempotente por conteúdo: a mesma figurinha salva de novo devolve a já existente. */
  save(input: Omit<InboxSavedSticker, "createdAt">): Promise<{ sticker: InboxSavedSticker; created: boolean }>;
  getById(id: string): Promise<InboxSavedSticker | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; limit: number }): Promise<InboxSavedSticker[]>;
  delete(id: string): Promise<void>;
};
