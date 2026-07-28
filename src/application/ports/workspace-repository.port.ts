import type { Workspace, WorkspaceSettings } from "../../domain/workspace/workspace.model.js";

export type CreateWorkspaceInput = {
  tenantId: string;
  name: string;
  kind?: string;
};

export type UpdateWorkspaceInput = Partial<{
  name: string;
  kind: string;
  settings: WorkspaceSettings;
}>;

/**
 * Contrato de persistência do Workspace — Sprint 02 (Fase 3). Sem implementação real ainda (a
 * migração para banco real é escopo da Sprint 03); o único adapter hoje é
 * `InMemoryWorkspaceRepository` (`src/infrastructure/storage/`), só para manter o contrato
 * testável. Assinatura deliberadamente enxuta — sem regra de negócio (limites de plano, validação
 * cruzada com Valentina etc.), que fica para quando o Workspace precisar de fato impor alguma.
 */
export type WorkspaceRepositoryPort = {
  create(input: CreateWorkspaceInput): Promise<Workspace>;
  getById(id: string): Promise<Workspace | undefined>;
  listByTenant(tenantId: string): Promise<Workspace[]>;
  update(id: string, patch: UpdateWorkspaceInput): Promise<Workspace>;
  archive(id: string): Promise<Workspace>;
};
