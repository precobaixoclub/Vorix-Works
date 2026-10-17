import type { Pool } from "pg";
import type { ReportTemplate, ReportTemplateRepositoryPort } from "../../../application/ports/report-template-repository.port.js";
import { isReportSectionKey, type ReportSectionKey } from "../../../domain/reports/report-catalog.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  sections: unknown;
  source: ReportTemplate["source"];
  ai_request: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

const sectionsOf = (value: unknown): ReportSectionKey[] => (Array.isArray(value) ? value.filter((item): item is ReportSectionKey => typeof item === "string" && isReportSectionKey(item)) : []);

function toDomain(row: Row): ReportTemplate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description ?? undefined,
    sections: sectionsOf(row.sections),
    source: row.source,
    aiRequest: row.ai_request ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresReportTemplateRepository implements ReportTemplateRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async list(input: { tenantId: string; workspaceId: string }): Promise<ReportTemplate[]> {
    const result = await this.pool.query<Row>("select * from report_templates where tenant_id = $1 and workspace_id = $2 order by created_at desc", [input.tenantId, input.workspaceId]);
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<ReportTemplate | undefined> {
    const result = await this.pool.query<Row>("select * from report_templates where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async create(input: Omit<ReportTemplate, "id" | "createdAt" | "updatedAt">): Promise<ReportTemplate> {
    const id = `rpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await this.pool.query<Row>(
      `insert into report_templates (id, tenant_id, workspace_id, name, description, sections, source, ai_request, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [id, input.tenantId, input.workspaceId, input.name, input.description ?? null, JSON.stringify(input.sections), input.source, input.aiRequest ?? null, input.createdBy ?? null],
    );
    return toDomain(result.rows[0]);
  }

  async update(id: string, patch: { name?: string; description?: string | null; sections?: ReportSectionKey[] }): Promise<ReportTemplate> {
    const result = await this.pool.query<Row>(
      `update report_templates set
         name = coalesce($2, name),
         description = case when $3::boolean then $4 else description end,
         sections = coalesce($5::jsonb, sections),
         updated_at = now()
       where id = $1 returning *`,
      [id, patch.name ?? null, patch.description !== undefined, patch.description ?? null, patch.sections ? JSON.stringify(patch.sections) : null],
    );
    if (!result.rows[0]) throw new Error(`REPORT_TEMPLATE_NOT_FOUND: modelo "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from report_templates where id = $1", [id]);
  }
}
