import type { Pool } from "pg";
import type { CreateProposalInput, ListProposalsFilter, ProposalRepositoryPort, UpdateProposalInput } from "../../../application/ports/proposal-repository.port.js";
import type { Proposal, ProposalItem, ProposalStatus } from "../../../domain/crm/crm.model.js";

const proposalId = () => `proposal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type ProposalRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  deal_id: string | null;
  contact_id: string | null;
  title: string;
  items: ProposalItem[];
  discount_cents: string;
  total_cents: string;
  currency: string;
  valid_until: Date | null;
  conditions: string | null;
  status: string;
  public_token_hash: string;
  sent_at: Date | null;
  viewed_at: Date | null;
  responded_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: ProposalRow): Proposal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    dealId: row.deal_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    title: row.title,
    items: row.items ?? [],
    discountCents: Number(row.discount_cents),
    totalCents: Number(row.total_cents),
    currency: row.currency,
    validUntil: row.valid_until ? row.valid_until.toISOString().slice(0, 10) : undefined,
    conditions: row.conditions ?? undefined,
    status: row.status as ProposalStatus,
    publicTokenHash: row.public_token_hash,
    sentAt: row.sent_at?.toISOString(),
    viewedAt: row.viewed_at?.toISOString(),
    respondedAt: row.responded_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresProposalRepository implements ProposalRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateProposalInput): Promise<Proposal> {
    const result = await this.pool.query<ProposalRow>(
      `insert into proposals (id, tenant_id, workspace_id, deal_id, contact_id, title, items, discount_cents, total_cents, currency, valid_until, conditions, public_token_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning *`,
      [
        proposalId(), input.tenantId, input.workspaceId, input.dealId ?? null, input.contactId ?? null,
        input.title, JSON.stringify(input.items), input.discountCents ?? 0, input.totalCents, input.currency ?? "BRL",
        input.validUntil ?? null, input.conditions ?? null, input.publicTokenHash,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Proposal | undefined> {
    const result = await this.pool.query<ProposalRow>("select * from proposals where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async getByTokenHash(tokenHash: string): Promise<Proposal | undefined> {
    const result = await this.pool.query<ProposalRow>("select * from proposals where public_token_hash = $1", [tokenHash]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(filter: ListProposalsFilter): Promise<Proposal[]> {
    const limit = filter.limit ?? 200;
    const conditions: string[] = ["tenant_id = $1", "workspace_id = $2"];
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    if (filter.dealId) {
      params.push(filter.dealId);
      conditions.push(`deal_id = $${params.length}`);
    }
    if (filter.contactId) {
      params.push(filter.contactId);
      conditions.push(`contact_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.cursor) {
      params.push(filter.cursor);
      conditions.push(`created_at < (select created_at from proposals where id = $${params.length})`);
    }
    params.push(limit);
    const result = await this.pool.query<ProposalRow>(
      `select * from proposals where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map(toDomain);
  }

  async update(id: string, input: UpdateProposalInput): Promise<Proposal> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`PROPOSAL_NOT_FOUND: proposta "${id}" não existe.`);
    const result = await this.pool.query<ProposalRow>(
      `update proposals set
         deal_id = $2, contact_id = $3, title = $4, items = $5, discount_cents = $6, total_cents = $7,
         currency = $8, valid_until = $9, conditions = $10, updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        input.dealId !== undefined ? input.dealId : existing.dealId ?? null,
        input.contactId !== undefined ? input.contactId : existing.contactId ?? null,
        input.title ?? existing.title,
        JSON.stringify(input.items ?? existing.items),
        input.discountCents ?? existing.discountCents,
        input.totalCents ?? existing.totalCents,
        input.currency ?? existing.currency,
        input.validUntil !== undefined ? input.validUntil : existing.validUntil ?? null,
        input.conditions !== undefined ? input.conditions : existing.conditions ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async setStatus(id: string, input: { status: ProposalStatus; sentAt?: string | null; viewedAt?: string | null; respondedAt?: string | null }): Promise<Proposal> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`PROPOSAL_NOT_FOUND: proposta "${id}" não existe.`);
    const result = await this.pool.query<ProposalRow>(
      `update proposals set status = $2, sent_at = $3, viewed_at = $4, responded_at = $5, updated_at = now()
       where id = $1 returning *`,
      [
        id,
        input.status,
        input.sentAt !== undefined ? input.sentAt : existing.sentAt ?? null,
        input.viewedAt !== undefined ? input.viewedAt : existing.viewedAt ?? null,
        input.respondedAt !== undefined ? input.respondedAt : existing.respondedAt ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }
}
