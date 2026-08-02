import type { Pool } from "pg";
import type { BriefingRepositoryPort, CreateBriefingInput } from "../../../application/ports/briefing-repository.port.js";
import type { Briefing, BriefingStatus } from "../../../domain/briefing/briefing.model.js";

export type BriefingIdGenerator = () => string;
const defaultIdGenerator: BriefingIdGenerator = () => `briefing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type BriefingRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  schema_type: string;
  status: string;
  schema_version: number;
  revision: number;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
};

export class PostgresBriefingRepository implements BriefingRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: BriefingIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: BriefingIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async create(input: CreateBriefingInput): Promise<Briefing> {
    const id = this.idGenerator();
    const result = await this.pool.query<BriefingRow>(
      `insert into briefings (id, tenant_id, workspace_id, conversation_id, schema_type, status, schema_version, revision, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'collecting', $6, 1, now(), now())
       returning *`,
      [id, input.tenantId, input.workspaceId, input.conversationId, input.type, input.schemaVersion],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Briefing | undefined> {
    const result = await this.pool.query<BriefingRow>("select * from briefings where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async getActiveByConversation(conversationId: string): Promise<Briefing | undefined> {
    const result = await this.pool.query<BriefingRow>(
      `select * from briefings
       where conversation_id = $1 and status not in ('completed', 'cancelled', 'expired')
       order by created_at desc
       limit 1`,
      [conversationId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async updateStatus(id: string, status: BriefingStatus): Promise<Briefing> {
    const result = await this.pool.query<BriefingRow>(
      `update briefings
       set status = $2,
           updated_at = now(),
           completed_at = case when $2 = 'completed' then now() else completed_at end,
           cancelled_at = case when $2 = 'cancelled' then now() else cancelled_at end
       where id = $1
       returning *`,
      [id, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`BRIEFING_NOT_FOUND: briefing "${id}" não existe.`);
    return this.toDomain(row);
  }

  async incrementRevision(id: string): Promise<Briefing> {
    const result = await this.pool.query<BriefingRow>(
      "update briefings set revision = revision + 1, updated_at = now() where id = $1 returning *",
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`BRIEFING_NOT_FOUND: briefing "${id}" não existe.`);
    return this.toDomain(row);
  }

  private toDomain(row: BriefingRow): Briefing {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      type: row.schema_type as Briefing["type"],
      status: row.status as BriefingStatus,
      schemaVersion: row.schema_version,
      revision: row.revision,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      completedAt: row.completed_at?.toISOString(),
      cancelledAt: row.cancelled_at?.toISOString(),
    };
  }
}
