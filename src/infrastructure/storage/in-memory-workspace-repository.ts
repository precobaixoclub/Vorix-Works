import type { CreateWorkspaceInput, UpdateWorkspaceInput, WorkspaceRepositoryPort } from "../../application/ports/workspace-repository.port.js";
import type { Workspace } from "../../domain/workspace/workspace.model.js";

export type WorkspaceIdGenerator = () => string;

const defaultIdGenerator: WorkspaceIdGenerator = () => `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Único adapter real de `WorkspaceRepositoryPort` nesta sprint — mesmo papel que
 * `InMemoryCampaignRepository` cumpre para Campaign Manager. A migração para persistência real
 * (Postgres) é escopo da Sprint 03; até lá, isto mantém o contrato exercitável em teste sem
 * depender de nenhuma infraestrutura.
 */
export class InMemoryWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly idGenerator: WorkspaceIdGenerator;
  private readonly now: () => Date;

  constructor(options: { idGenerator?: WorkspaceIdGenerator; now?: () => Date } = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const timestamp = this.now().toISOString();
    const workspace: Workspace = {
      id: this.idGenerator(),
      tenantId: input.tenantId,
      name: input.name,
      kind: input.kind,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      campaignIds: [],
      integrations: [],
      members: [],
      settings: {},
    };
    this.workspaces.set(workspace.id, clone(workspace));
    return clone(workspace);
  }

  async getById(id: string): Promise<Workspace | undefined> {
    return clone(this.workspaces.get(id));
  }

  async listByTenant(tenantId: string): Promise<Workspace[]> {
    return Array.from(this.workspaces.values())
      .filter((workspace) => workspace.tenantId === tenantId)
      .map(clone);
  }

  async update(id: string, patch: UpdateWorkspaceInput): Promise<Workspace> {
    const existing = this.workspaces.get(id);
    if (!existing) {
      throw new Error(`WORKSPACE_NOT_FOUND: workspace "${id}" não existe.`);
    }
    const updated: Workspace = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.settings !== undefined ? { settings: { ...existing.settings, ...patch.settings } } : {}),
      updatedAt: this.now().toISOString(),
    };
    this.workspaces.set(id, clone(updated));
    return clone(updated);
  }

  async archive(id: string): Promise<Workspace> {
    const existing = this.workspaces.get(id);
    if (!existing) {
      throw new Error(`WORKSPACE_NOT_FOUND: workspace "${id}" não existe.`);
    }
    const timestamp = this.now().toISOString();
    const archived: Workspace = { ...existing, status: "archived", archivedAt: timestamp, updatedAt: timestamp };
    this.workspaces.set(id, clone(archived));
    return clone(archived);
  }

  clear(): void {
    this.workspaces.clear();
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}
