import type { Pool } from "pg";
import type { ProposalTemplateRepositoryPort, ProposalTemplateValues } from "../../../application/ports/proposal-template-repository.port.js";
import type { ProposalItem, ProposalTemplate } from "../../../domain/crm/crm.model.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  name: string;
  default_title: string;
  default_items: ProposalItem[];
  default_conditions: string | null;
  default_valid_days: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

const id = () => `proposal-template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function toDomain(row: Row): ProposalTemplate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    name: row.name,
    defaultTitle: row.default_title,
    defaultItems: row.default_items ?? [],
    defaultConditions: row.default_conditions ?? undefined,
    defaultValidDays: row.default_valid_days,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresProposalTemplateRepository implements ProposalTemplateRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: ProposalTemplateValues & { tenantId: string; workspaceId: string }): Promise<ProposalTemplate> {
    const result = await this.pool.query<Row>(
      `insert into proposal_templates
         (id, tenant_id, workspace_id, name, default_title, default_items, default_conditions, default_valid_days, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [id(), input.tenantId, input.workspaceId, input.name, input.defaultTitle, JSON.stringify(input.defaultItems), input.defaultConditions ?? null, input.defaultValidDays, input.active ?? true],
    );
    return toDomain(result.rows[0]);
  }

  async getById(templateId: string): Promise<ProposalTemplate | undefined> {
    const result = await this.pool.query<Row>("select * from proposal_templates where id = $1", [templateId]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; activeOnly?: boolean }): Promise<ProposalTemplate[]> {
    const result = await this.pool.query<Row>(
      `select * from proposal_templates where tenant_id = $1 and workspace_id = $2
       ${input.activeOnly ? "and active = true" : ""} order by active desc, name asc`,
      [input.tenantId, input.workspaceId],
    );
    return result.rows.map(toDomain);
  }

  async update(templateId: string, patch: Partial<ProposalTemplateValues>): Promise<ProposalTemplate> {
    const existing = await this.getById(templateId);
    if (!existing) throw new Error(`PROPOSAL_TEMPLATE_NOT_FOUND: modelo "${templateId}" não existe.`);
    const result = await this.pool.query<Row>(
      `update proposal_templates set name=$2, default_title=$3, default_items=$4,
       default_conditions=$5, default_valid_days=$6, active=$7, updated_at=now()
       where id=$1 returning *`,
      [templateId, patch.name ?? existing.name, patch.defaultTitle ?? existing.defaultTitle, JSON.stringify(patch.defaultItems ?? existing.defaultItems), patch.defaultConditions !== undefined ? patch.defaultConditions : existing.defaultConditions ?? null, patch.defaultValidDays ?? existing.defaultValidDays, patch.active ?? existing.active],
    );
    return toDomain(result.rows[0]);
  }

  async delete(templateId: string): Promise<void> {
    await this.pool.query("delete from proposal_templates where id = $1", [templateId]);
  }
}
