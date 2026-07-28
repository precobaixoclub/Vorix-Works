import type { Pool } from "pg";
import type {
  CreateWorkspaceInput,
  ListWorkspacesFilter,
  UpdateWorkspaceInput,
  WorkspaceRepositoryPort,
} from "../../../application/ports/workspace-repository.port.js";
import type { Workspace, WorkspaceIntegrationRef, WorkspaceMember } from "../../../domain/workspace/workspace.model.js";

export type WorkspaceIdGenerator = () => string;

const defaultIdGenerator: WorkspaceIdGenerator = () => `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type WorkspaceRow = {
  id: string;
  tenant_id: string;
  name: string;
  kind: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  knowledge_client_id: string | null;
  settings: Record<string, unknown> | null;
};

type MemberRow = { workspace_id: string; user_id: string; role: string; added_at: Date };

type IntegrationRow = {
  id: string;
  workspace_id: string;
  channel: string;
  external_account_id: string | null;
  display_name: string | null;
  status: string;
  connected_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * Adapter Postgres de `WorkspaceRepositoryPort` — Sprint 03 (Fase 4). Segunda implementação real
 * do contrato, ao lado de `InMemoryWorkspaceRepository` (Sprint 02) — mesmo Port, sem alteração de
 * assinatura além do que a própria Sprint 03 pediu (activate/deactivate/listByTenant com filtro).
 *
 * Reconstrução de agregado sem N+1: `listByTenant` busca todos os workspaces em 1 query e os
 * membros/integrações de TODOS eles em mais 2 queries (`= any($1::text[])`), nunca uma consulta
 * por workspace. `activate`/`deactivate`/`archive` são mutações incondicionais — a validação de
 * transição vive no domínio/casos de uso, nunca aqui (ver `assertValidWorkspaceTransition`).
 *
 * Timestamps são gerados pelo PRÓPRIO Postgres (`now()`), nunca pelo processo Node — a única
 * conversão feita aqui é `Date -> string ISO` na saída, para o domínio nunca saber que existe um
 * banco por trás.
 */
export class PostgresWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: WorkspaceIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: WorkspaceIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const id = this.idGenerator();
    const result = await this.pool.query<WorkspaceRow>(
      `insert into workspaces (id, tenant_id, name, kind, status, created_at, updated_at, settings)
       values ($1, $2, $3, $4, 'active', now(), now(), '{}'::jsonb)
       returning *`,
      [id, input.tenantId, input.name, input.kind ?? null],
    );
    return this.toDomain(result.rows[0], [], []);
  }

  async getById(id: string): Promise<Workspace | undefined> {
    const result = await this.pool.query<WorkspaceRow>("select * from workspaces where id = $1", [id]);
    const row = result.rows[0];
    if (!row) return undefined;
    return this.hydrate(row);
  }

  async listByTenant(tenantId: string, filter?: ListWorkspacesFilter): Promise<Workspace[]> {
    const conditions = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter?.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }

    const result = await this.pool.query<WorkspaceRow>(
      `select * from workspaces where ${conditions.join(" and ")} order by created_at asc`,
      params,
    );
    const ids = result.rows.map((row) => row.id);
    if (ids.length === 0) return [];

    const [membersByWorkspace, integrationsByWorkspace] = await Promise.all([this.fetchMembers(ids), this.fetchIntegrations(ids)]);
    return result.rows.map((row) => this.toDomain(row, membersByWorkspace.get(row.id) ?? [], integrationsByWorkspace.get(row.id) ?? []));
  }

  async update(id: string, patch: UpdateWorkspaceInput): Promise<Workspace> {
    const existing = await this.mustGetRow(id);
    const name = patch.name ?? existing.name;
    const kind = patch.kind !== undefined ? patch.kind : existing.kind;
    const settings = patch.settings !== undefined ? { ...(existing.settings ?? {}), ...patch.settings } : (existing.settings ?? {});

    const result = await this.pool.query<WorkspaceRow>(
      `update workspaces set name = $2, kind = $3, settings = $4, updated_at = now() where id = $1 returning *`,
      [id, name, kind, JSON.stringify(settings)],
    );
    return this.hydrate(result.rows[0]);
  }

  async activate(id: string): Promise<Workspace> {
    return this.setStatus(id, "active");
  }

  async deactivate(id: string): Promise<Workspace> {
    return this.setStatus(id, "inactive");
  }

  async archive(id: string): Promise<Workspace> {
    await this.mustGetRow(id);
    const result = await this.pool.query<WorkspaceRow>(
      `update workspaces set status = 'archived', archived_at = now(), updated_at = now() where id = $1 returning *`,
      [id],
    );
    return this.hydrate(result.rows[0]);
  }

  private async setStatus(id: string, status: "active" | "inactive"): Promise<Workspace> {
    await this.mustGetRow(id);
    const result = await this.pool.query<WorkspaceRow>(`update workspaces set status = $2, updated_at = now() where id = $1 returning *`, [
      id,
      status,
    ]);
    return this.hydrate(result.rows[0]);
  }

  private async mustGetRow(id: string): Promise<WorkspaceRow> {
    const result = await this.pool.query<WorkspaceRow>("select * from workspaces where id = $1", [id]);
    const row = result.rows[0];
    if (!row) throw new Error(`WORKSPACE_NOT_FOUND: workspace "${id}" não existe.`);
    return row;
  }

  private async hydrate(row: WorkspaceRow): Promise<Workspace> {
    const [members, integrations] = await Promise.all([this.fetchMembers([row.id]), this.fetchIntegrations([row.id])]);
    return this.toDomain(row, members.get(row.id) ?? [], integrations.get(row.id) ?? []);
  }

  private async fetchMembers(workspaceIds: string[]): Promise<Map<string, WorkspaceMember[]>> {
    const result = await this.pool.query<MemberRow>("select * from workspace_members where workspace_id = any($1::text[])", [workspaceIds]);
    const byWorkspace = new Map<string, WorkspaceMember[]>();
    for (const row of result.rows) {
      const list = byWorkspace.get(row.workspace_id) ?? [];
      list.push({ userId: row.user_id, role: row.role as WorkspaceMember["role"], addedAt: row.added_at.toISOString() });
      byWorkspace.set(row.workspace_id, list);
    }
    return byWorkspace;
  }

  private async fetchIntegrations(workspaceIds: string[]): Promise<Map<string, WorkspaceIntegrationRef[]>> {
    const result = await this.pool.query<IntegrationRow>("select * from workspace_integrations where workspace_id = any($1::text[])", [
      workspaceIds,
    ]);
    const byWorkspace = new Map<string, WorkspaceIntegrationRef[]>();
    for (const row of result.rows) {
      const list = byWorkspace.get(row.workspace_id) ?? [];
      list.push({
        id: row.id,
        channel: row.channel,
        externalAccountId: row.external_account_id ?? undefined,
        displayName: row.display_name ?? undefined,
        status: row.status as WorkspaceIntegrationRef["status"],
        connectedAt: row.connected_at ? row.connected_at.toISOString() : undefined,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      });
      byWorkspace.set(row.workspace_id, list);
    }
    return byWorkspace;
  }

  private toDomain(row: WorkspaceRow, members: WorkspaceMember[], integrations: WorkspaceIntegrationRef[]): Workspace {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      kind: row.kind ?? undefined,
      status: row.status as Workspace["status"],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      archivedAt: row.archived_at ? row.archived_at.toISOString() : undefined,
      knowledge: row.knowledge_client_id ? { clientId: row.knowledge_client_id } : undefined,
      campaignIds: [],
      integrations,
      members,
      settings: (row.settings ?? {}) as Workspace["settings"],
    };
  }
}
