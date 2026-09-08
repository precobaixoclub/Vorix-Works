import type { Pool } from "pg";
import type {
  CommercialSuggestionRepositoryPort,
  CreateCommercialSuggestionInput,
  ListCommercialSuggestionsFilter,
} from "../../../application/ports/commercial-suggestion-repository.port.js";
import type { CommercialSuggestion, CommercialSuggestionAction, CommercialSuggestionStatus } from "../../../domain/crm/crm.model.js";

const suggestionId = () => `suggestion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  contact_id: string;
  deal_id: string | null;
  title: string;
  rationale: string;
  evidence: string;
  confidence: number;
  suggested_action: string;
  status: string;
  created_at: Date;
  resolved_at: Date | null;
};

function toDomain(row: Row): CommercialSuggestion {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    contactId: row.contact_id,
    dealId: row.deal_id ?? undefined,
    title: row.title,
    rationale: row.rationale,
    evidence: row.evidence,
    confidence: row.confidence,
    suggestedAction: row.suggested_action as CommercialSuggestionAction,
    status: row.status as CommercialSuggestionStatus,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString(),
  };
}

export class PostgresCommercialSuggestionRepository implements CommercialSuggestionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateCommercialSuggestionInput): Promise<CommercialSuggestion> {
    const result = await this.pool.query<Row>(
      `insert into commercial_suggestions (id, tenant_id, workspace_id, contact_id, deal_id, title, rationale, evidence, confidence, suggested_action)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning *`,
      [
        suggestionId(), input.tenantId, input.workspaceId, input.contactId, input.dealId ?? null,
        input.title, input.rationale, input.evidence, input.confidence, input.suggestedAction,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<CommercialSuggestion | undefined> {
    const result = await this.pool.query<Row>("select * from commercial_suggestions where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(filter: ListCommercialSuggestionsFilter): Promise<CommercialSuggestion[]> {
    const conditions: string[] = ["tenant_id = $1", "workspace_id = $2"];
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    if (filter.contactId) {
      params.push(filter.contactId);
      conditions.push(`contact_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const result = await this.pool.query<Row>(
      `select * from commercial_suggestions where ${conditions.join(" and ")} order by created_at desc`,
      params,
    );
    return result.rows.map(toDomain);
  }

  async setStatus(id: string, status: CommercialSuggestionStatus, resolvedAt: string | null): Promise<CommercialSuggestion> {
    const result = await this.pool.query<Row>(
      "update commercial_suggestions set status = $2, resolved_at = $3 where id = $1 returning *",
      [id, status, resolvedAt],
    );
    if (!result.rows[0]) throw new Error(`COMMERCIAL_SUGGESTION_NOT_FOUND: sugestão "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }
}
