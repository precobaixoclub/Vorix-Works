import type { InboxClosureSubtype, InboxClosureType } from "../../domain/inbox/attendance.model.js";

/** Tipos e subtipos de finalização, por workspace (migration 0172). Excluir é lógico. */
export type InboxClosureCatalogRepositoryPort = {
  /** Tipos não excluídos, ordenados, cada um com os subtipos não excluídos. */
  listByWorkspace(workspaceId: string): Promise<InboxClosureType[]>;
  /** Cria o catálogo sugerido só se o workspace nunca teve nenhum tipo (nem excluído). */
  seedIfEmpty(input: { tenantId: string; workspaceId: string; catalog: readonly { name: string; subtypes: readonly string[] }[] }): Promise<void>;
  getType(id: string): Promise<InboxClosureType | undefined>;
  getSubtype(id: string): Promise<InboxClosureSubtype | undefined>;
  createType(input: { tenantId: string; workspaceId: string; name: string }): Promise<InboxClosureType>;
  updateType(id: string, input: { name?: string; isActive?: boolean }): Promise<InboxClosureType>;
  deleteType(id: string): Promise<void>;
  reorderTypes(workspaceId: string, orderedIds: readonly string[]): Promise<void>;
  createSubtype(input: { tenantId: string; workspaceId: string; closureTypeId: string; name: string }): Promise<InboxClosureSubtype>;
  updateSubtype(id: string, input: { name?: string; isActive?: boolean }): Promise<InboxClosureSubtype>;
  deleteSubtype(id: string): Promise<void>;
  reorderSubtypes(closureTypeId: string, orderedIds: readonly string[]): Promise<void>;
};
