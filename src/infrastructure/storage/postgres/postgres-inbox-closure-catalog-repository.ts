import type { Pool } from "pg";
import type { InboxClosureCatalogRepositoryPort } from "../../../application/ports/inbox-closure-catalog-repository.port.js";
import type { InboxClosureSubtype, InboxClosureType } from "../../../domain/inbox/attendance.model.js";

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type TypeRow = { id: string; tenant_id: string; workspace_id: string; name: string; position: number; is_active: boolean; created_at: Date; updated_at: Date };
type SubtypeRow = TypeRow & { closure_type_id: string };

/** Tipos/subtipos de finalização (migration 0172). Excluir é lógico (`deleted_at`): atendimentos
 * antigos continuam apontando para o registro, e o catálogo sugerido nunca é recriado por cima. */
export class PostgresInboxClosureCatalogRepository implements InboxClosureCatalogRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listByWorkspace(workspaceId: string): Promise<InboxClosureType[]> {
    const [types, subtypes] = await Promise.all([
      this.pool.query<TypeRow>("select * from inbox_closure_types where workspace_id = $1 and deleted_at is null order by position, created_at", [workspaceId]),
      this.pool.query<SubtypeRow>("select * from inbox_closure_subtypes where workspace_id = $1 and deleted_at is null order by position, created_at", [workspaceId]),
    ]);
    return types.rows.map((row) => toType(row, subtypes.rows.filter((subtype) => subtype.closure_type_id === row.id).map(toSubtype)));
  }

  async seedIfEmpty(input: { tenantId: string; workspaceId: string; catalog: readonly { name: string; subtypes: readonly string[] }[] }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serializa por workspace: duas telas abrindo juntas nunca semeiam o catálogo duas vezes.
      await client.query("select id from workspaces where id = $1 for update", [input.workspaceId]);
      const existing = await client.query("select 1 from inbox_closure_types where workspace_id = $1 limit 1", [input.workspaceId]);
      if (!existing.rows.length) {
        for (const [typeIndex, type] of input.catalog.entries()) {
          const typeId = newId("closetype");
          await client.query("insert into inbox_closure_types (id, tenant_id, workspace_id, name, position) values ($1, $2, $3, $4, $5)", [typeId, input.tenantId, input.workspaceId, type.name, typeIndex]);
          for (const [subtypeIndex, subtype] of type.subtypes.entries()) {
            await client.query(
              "insert into inbox_closure_subtypes (id, tenant_id, workspace_id, closure_type_id, name, position) values ($1, $2, $3, $4, $5, $6)",
              [newId("closesub"), input.tenantId, input.workspaceId, typeId, subtype, subtypeIndex],
            );
          }
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getType(id: string): Promise<InboxClosureType | undefined> {
    const type = await this.pool.query<TypeRow>("select * from inbox_closure_types where id = $1 and deleted_at is null", [id]);
    if (!type.rows[0]) return undefined;
    const subtypes = await this.pool.query<SubtypeRow>("select * from inbox_closure_subtypes where closure_type_id = $1 and deleted_at is null order by position, created_at", [id]);
    return toType(type.rows[0], subtypes.rows.map(toSubtype));
  }

  async getSubtype(id: string): Promise<InboxClosureSubtype | undefined> {
    const result = await this.pool.query<SubtypeRow>("select * from inbox_closure_subtypes where id = $1 and deleted_at is null", [id]);
    return result.rows[0] ? toSubtype(result.rows[0]) : undefined;
  }

  async createType(input: { tenantId: string; workspaceId: string; name: string }): Promise<InboxClosureType> {
    const result = await this.pool.query<TypeRow>(
      `insert into inbox_closure_types (id, tenant_id, workspace_id, name, position)
       select $1, $2, $3, $4, coalesce(max(position), -1) + 1 from inbox_closure_types where workspace_id = $3 and deleted_at is null
       returning *`,
      [newId("closetype"), input.tenantId, input.workspaceId, input.name],
    );
    return toType(result.rows[0]!, []);
  }

  async updateType(id: string, input: { name?: string; isActive?: boolean }): Promise<InboxClosureType> {
    const result = await this.pool.query<TypeRow>(
      "update inbox_closure_types set name = coalesce($2, name), is_active = coalesce($3, is_active), updated_at = now() where id = $1 and deleted_at is null returning *",
      [id, input.name ?? null, input.isActive ?? null],
    );
    if (!result.rows[0]) throw new Error(`INBOX_CLOSURE_TYPE_NOT_FOUND: tipo de finalização "${id}" não existe.`);
    return (await this.getType(id))!;
  }

  async deleteType(id: string): Promise<void> {
    await this.pool.query("update inbox_closure_types set deleted_at = now(), is_active = false, updated_at = now() where id = $1 and deleted_at is null", [id]);
    await this.pool.query("update inbox_closure_subtypes set deleted_at = now(), is_active = false, updated_at = now() where closure_type_id = $1 and deleted_at is null", [id]);
  }

  async reorderTypes(workspaceId: string, orderedIds: readonly string[]): Promise<void> {
    await this.pool.query(
      `update inbox_closure_types t set position = ordered.position - 1, updated_at = now()
       from unnest($2::text[]) with ordinality as ordered(id, position)
       where t.id = ordered.id and t.workspace_id = $1`,
      [workspaceId, orderedIds],
    );
  }

  async createSubtype(input: { tenantId: string; workspaceId: string; closureTypeId: string; name: string }): Promise<InboxClosureSubtype> {
    const result = await this.pool.query<SubtypeRow>(
      `insert into inbox_closure_subtypes (id, tenant_id, workspace_id, closure_type_id, name, position)
       select $1, $2, $3, $4, $5, coalesce(max(position), -1) + 1 from inbox_closure_subtypes where closure_type_id = $4 and deleted_at is null
       returning *`,
      [newId("closesub"), input.tenantId, input.workspaceId, input.closureTypeId, input.name],
    );
    return toSubtype(result.rows[0]!);
  }

  async updateSubtype(id: string, input: { name?: string; isActive?: boolean }): Promise<InboxClosureSubtype> {
    const result = await this.pool.query<SubtypeRow>(
      "update inbox_closure_subtypes set name = coalesce($2, name), is_active = coalesce($3, is_active), updated_at = now() where id = $1 and deleted_at is null returning *",
      [id, input.name ?? null, input.isActive ?? null],
    );
    if (!result.rows[0]) throw new Error(`INBOX_CLOSURE_SUBTYPE_NOT_FOUND: subtipo de finalização "${id}" não existe.`);
    return toSubtype(result.rows[0]);
  }

  async deleteSubtype(id: string): Promise<void> {
    await this.pool.query("update inbox_closure_subtypes set deleted_at = now(), is_active = false, updated_at = now() where id = $1 and deleted_at is null", [id]);
  }

  async reorderSubtypes(closureTypeId: string, orderedIds: readonly string[]): Promise<void> {
    await this.pool.query(
      `update inbox_closure_subtypes s set position = ordered.position - 1, updated_at = now()
       from unnest($2::text[]) with ordinality as ordered(id, position)
       where s.id = ordered.id and s.closure_type_id = $1`,
      [closureTypeId, orderedIds],
    );
  }
}

function toType(row: TypeRow, subtypes: InboxClosureSubtype[]): InboxClosureType {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    name: row.name,
    position: Number(row.position),
    isActive: row.is_active,
    subtypes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSubtype(row: SubtypeRow): InboxClosureSubtype {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    closureTypeId: row.closure_type_id,
    name: row.name,
    position: Number(row.position),
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
