import type { Workspace, WorkspaceSettings, WorkspaceStatus } from "../../domain/workspace/workspace.model.js";

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

export type ListWorkspacesFilter = {
  status?: WorkspaceStatus;
};

/**
 * Contrato de persistência do Workspace — Sprint 02 (Fase 3), evoluído na Sprint 03 (Fase 4/6:
 * persistência real + transições de status). Dois adapters reais agora:
 * `InMemoryWorkspaceRepository` (`src/infrastructure/storage/`) e
 * `PostgresWorkspaceRepository` (`src/infrastructure/storage/postgres/`).
 *
 * `activate`/`deactivate`/`archive` são mutações INCONDICIONAIS — não validam se a transição é
 * legal a partir do status atual. Essa regra vive no domínio
 * (`assertValidWorkspaceTransition`, `workspace.model.ts`) e é aplicada pelos casos de uso
 * (`src/application/workspace/`), nunca pelo repositório nem pelo handler HTTP.
 */
export type WorkspaceRepositoryPort = {
  create(input: CreateWorkspaceInput): Promise<Workspace>;
  getById(id: string): Promise<Workspace | undefined>;
  listByTenant(tenantId: string, filter?: ListWorkspacesFilter): Promise<Workspace[]>;
  update(id: string, patch: UpdateWorkspaceInput): Promise<Workspace>;
  activate(id: string): Promise<Workspace>;
  deactivate(id: string): Promise<Workspace>;
  archive(id: string): Promise<Workspace>;
};
