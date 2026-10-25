import { proposalScopeSql } from "./postgres-proposal-scope.js";
import type { Pool } from "pg";
import type { CreateProposalInput, ListProposalsFilter, ProposalRepositoryPort, UpdateProposalInput } from "../../../application/ports/proposal-repository.port.js";
import type { Proposal, ProposalDelivery, ProposalEvent, ProposalEventType, ProposalItem, ProposalRecipient, ProposalStatus } from "../../../domain/crm/crm.model.js";

const proposalId = () => `proposal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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
  last_viewed_at: Date | null;
  view_count: number;
  responded_at: Date | null;
  public_link_revoked_at: Date | null;
  rejection_reason: string | null;
  rejection_comment: string | null;
  created_at: Date;
  updated_at: Date;
  number: string | null;
  version: number;
  root_proposal_id: string | null;
  supersedes_proposal_id: string | null;
  superseded_by_proposal_id: string | null;
  superseded_at: Date | null;
  cancelled_at: Date | null;
  introduction: string | null;
  notes: string | null;
  terms: string | null;
  list_total_cents: string | null;
  created_by_user_id: string | null;
  sent_by_user_id: string | null;
  sent_channel: string | null;
  sent_conversation_id: string | null;
  sent_message_id: string | null;
  total_view_seconds: number;
  accepted_content_hash: string | null;
  accepted_version: number | null;
};

export type { ProposalRow };
export function mapProposalRow(row: ProposalRow): Proposal {
  return toDomain(row);
}

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
    lastViewedAt: row.last_viewed_at?.toISOString(),
    viewCount: Number(row.view_count ?? 0),
    respondedAt: row.responded_at?.toISOString(),
    publicLinkRevokedAt: row.public_link_revoked_at?.toISOString(),
    rejectionReason: row.rejection_reason ?? undefined,
    rejectionComment: row.rejection_comment ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    number: row.number ?? undefined,
    version: row.version ?? 1,
    rootProposalId: row.root_proposal_id ?? row.id,
    supersedesProposalId: row.supersedes_proposal_id ?? undefined,
    supersededByProposalId: row.superseded_by_proposal_id ?? undefined,
    supersededAt: row.superseded_at?.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString(),
    introduction: row.introduction ?? undefined,
    notes: row.notes ?? undefined,
    terms: row.terms ?? undefined,
    listTotalCents: row.list_total_cents === null ? undefined : Number(row.list_total_cents),
    createdByUserId: row.created_by_user_id ?? undefined,
    sentByUserId: row.sent_by_user_id ?? undefined,
    sentChannel: row.sent_channel ?? undefined,
    sentConversationId: row.sent_conversation_id ?? undefined,
    sentMessageId: row.sent_message_id ?? undefined,
    totalViewSeconds: Number(row.total_view_seconds ?? 0),
    acceptedContentHash: row.accepted_content_hash ?? undefined,
    acceptedVersion: row.accepted_version ?? undefined,
  };
}

type EventRow = { id: string; proposal_id: string; event_type: ProposalEventType; recipient_id: string | null; occurred_at: Date; payload: Record<string, unknown> | null };
const toEvent = (row: EventRow): ProposalEvent => ({ id: row.id, proposalId: row.proposal_id, eventType: row.event_type, recipientId: row.recipient_id ?? undefined, occurredAt: row.occurred_at.toISOString(), payload: row.payload ?? {} });

type RecipientRow = { id: string; proposal_id: string; contact_id: string | null; name: string; view_count: number; first_viewed_at: Date | null; last_viewed_at: Date | null; revoked_at: Date | null; created_at: Date };
const toRecipient = (row: RecipientRow): ProposalRecipient => ({
  id: row.id, proposalId: row.proposal_id, contactId: row.contact_id ?? undefined, name: row.name, viewCount: row.view_count,
  firstViewedAt: row.first_viewed_at?.toISOString(), lastViewedAt: row.last_viewed_at?.toISOString(), revokedAt: row.revoked_at?.toISOString(), createdAt: row.created_at.toISOString(),
});

type DeliveryRow = { id: string; proposal_id: string; conversation_id: string; inbox_message_id: string | null; status: ProposalDelivery["status"]; error_message: string | null; created_at: Date; queued_at: Date | null };
const toDelivery = (row: DeliveryRow): ProposalDelivery => ({
  id: row.id, proposalId: row.proposal_id, conversationId: row.conversation_id, inboxMessageId: row.inbox_message_id ?? undefined, status: row.status,
  errorMessage: row.error_message ?? undefined, createdAt: row.created_at.toISOString(), queuedAt: row.queued_at?.toISOString(),
});

export class PostgresProposalRepository implements ProposalRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateProposalInput): Promise<Proposal> {
    const id = proposalId();
    const result = await this.pool.query<ProposalRow>(
      `insert into proposals (id, tenant_id, workspace_id, deal_id, contact_id, title, items, discount_cents, total_cents, currency, valid_until, conditions, public_token_hash,
         number, version, root_proposal_id, supersedes_proposal_id, introduction, notes, terms, list_total_cents, created_by_user_id, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.dealId ?? null, input.contactId ?? null,
        input.title, JSON.stringify(input.items), input.discountCents ?? 0, input.totalCents, input.currency ?? "BRL",
        input.validUntil ?? null, input.conditions ?? null, input.publicTokenHash,
        input.number ?? null, input.version ?? 1, input.rootProposalId ?? id, input.supersedesProposalId ?? null, input.introduction ?? null,
        input.notes ?? null, input.terms ?? null, input.listTotalCents ?? null, input.createdByUserId ?? null, input.status ?? "draft",
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
    const scope = proposalScopeSql(filter, params);
    if (scope) conditions.push(scope);
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
         currency = $8, valid_until = $9, conditions = $10, introduction = $11, notes = $12, terms = $13, list_total_cents = $14, updated_at = now()
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
        input.introduction !== undefined ? input.introduction : existing.introduction ?? null,
        input.notes !== undefined ? input.notes : existing.notes ?? null,
        input.terms !== undefined ? input.terms : existing.terms ?? null,
        input.listTotalCents !== undefined ? input.listTotalCents : existing.listTotalCents ?? null,
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

  async rotatePublicToken(id: string, tokenHash: string): Promise<Proposal> {
    const result = await this.pool.query<ProposalRow>(
      "update proposals set public_token_hash = $2, public_link_revoked_at = null, updated_at = now() where id = $1 returning *",
      [id, tokenHash],
    );
    if (!result.rows[0]) throw new Error(`PROPOSAL_NOT_FOUND: proposta "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async revokePublicToken(id: string, revokedAt: string): Promise<Proposal> {
    const result = await this.pool.query<ProposalRow>(
      "update proposals set public_link_revoked_at = $2, updated_at = now() where id = $1 returning *",
      [id, revokedAt],
    );
    if (!result.rows[0]) throw new Error(`PROPOSAL_NOT_FOUND: proposta "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async recordView(id: string, viewedAt: string, recipientId?: string): Promise<Proposal> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into proposal_views (id, proposal_id, viewed_at, recipient_id) values ($1, $2, $3, $4)",
        [`proposal-view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, id, viewedAt, recipientId ?? null],
      );
      const result = await client.query<ProposalRow>(
        `update proposals set
           status = case when status = 'sent' then 'viewed' else status end,
           viewed_at = coalesce(viewed_at, $2), last_viewed_at = $2,
           view_count = view_count + 1, updated_at = now()
         where id = $1 returning *`,
        [id, viewedAt],
      );
      if (!result.rows[0]) throw new Error(`PROPOSAL_NOT_FOUND: proposta "${id}" não existe.`);
      await client.query("commit");
      return toDomain(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async setRejection(id: string, input: { reason?: string; comment?: string }): Promise<Proposal> {
    const result = await this.pool.query<ProposalRow>(
      "update proposals set rejection_reason = $2, rejection_comment = $3, updated_at = now() where id = $1 returning *",
      [id, input.reason ?? null, input.comment ?? null],
    );
    if (!result.rows[0]) throw new Error(`PROPOSAL_NOT_FOUND: proposta "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async reserveDelivery(input: { id: string; tenantId: string; workspaceId: string; proposalId: string; conversationId: string; idempotencyKey: string }): Promise<"reserved" | "pending" | "queued"> {
    const inserted = await this.pool.query<{ status: "pending" }>(
      `insert into proposal_deliveries (id, tenant_id, workspace_id, proposal_id, conversation_id, idempotency_key, status)
       values ($1,$2,$3,$4,$5,$6,'pending') on conflict (tenant_id, workspace_id, idempotency_key) do nothing returning status`,
      [input.id, input.tenantId, input.workspaceId, input.proposalId, input.conversationId, input.idempotencyKey],
    );
    if (inserted.rows[0]) return "reserved";
    const existing = await this.pool.query<{ proposal_id: string; conversation_id: string; status: "pending" | "queued" | "failed" }>(
      "select proposal_id, conversation_id, status from proposal_deliveries where tenant_id=$1 and workspace_id=$2 and idempotency_key=$3",
      [input.tenantId, input.workspaceId, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.proposal_id !== input.proposalId || row.conversation_id !== input.conversationId) throw new Error("PROPOSAL_SEND_IDEMPOTENCY_CONFLICT: chave já utilizada em outro envio.");
    if (row.status === "failed") {
      const retried = await this.pool.query(
        "update proposal_deliveries set status='pending', error_message=null where tenant_id=$1 and workspace_id=$2 and idempotency_key=$3 and status='failed' returning id",
        [input.tenantId, input.workspaceId, input.idempotencyKey],
      );
      if (retried.rowCount) return "reserved";
    }
    return row.status === "queued" ? "queued" : "pending";
  }

  async completeDelivery(input: { tenantId: string; workspaceId: string; idempotencyKey: string; inboxMessageId: string; queuedAt: string }): Promise<void> {
    await this.pool.query(
      "update proposal_deliveries set status='queued', inbox_message_id=$4, queued_at=$5, error_message=null where tenant_id=$1 and workspace_id=$2 and idempotency_key=$3",
      [input.tenantId, input.workspaceId, input.idempotencyKey, input.inboxMessageId, input.queuedAt],
    );
  }

  async failDelivery(input: { tenantId: string; workspaceId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    await this.pool.query(
      "update proposal_deliveries set status='failed', error_message=$4 where tenant_id=$1 and workspace_id=$2 and idempotency_key=$3",
      [input.tenantId, input.workspaceId, input.idempotencyKey, input.errorMessage.slice(0, 1000)],
    );
  }

  async nextNumber(workspaceId: string, year: number): Promise<string> {
    const prefix = `PROP-${year}-`;
    const result = await this.pool.query<{ max: number | null }>(
      "select max(nullif(regexp_replace(number, '^PROP-[0-9]{4}-', ''), '')::int) as max from proposals where workspace_id = $1 and number like $2",
      [workspaceId, `${prefix}%`],
    );
    return `${prefix}${String((result.rows[0]?.max ?? 0) + 1).padStart(3, "0")}`;
  }

  async listVersions(rootProposalId: string): Promise<Proposal[]> {
    const result = await this.pool.query<ProposalRow>("select * from proposals where root_proposal_id = $1 order by version desc", [rootProposalId]);
    return result.rows.map(toDomain);
  }

  async markSent(id: string, input: { sentAt: string; sentByUserId?: string; channel?: string; conversationId?: string; messageId?: string }): Promise<Proposal> {
    const result = await this.pool.query<ProposalRow>(
      `update proposals set status = case when status in ('draft', 'approved', 'pending_approval') then 'sent' else status end,
         sent_at = coalesce(sent_at, $2), sent_by_user_id = coalesce($3, sent_by_user_id), sent_channel = coalesce($4, sent_channel),
         sent_conversation_id = coalesce($5, sent_conversation_id), sent_message_id = coalesce($6, sent_message_id), updated_at = now()
       where id = $1 returning *`,
      [id, input.sentAt, input.sentByUserId ?? null, input.channel ?? null, input.conversationId ?? null, input.messageId ?? null],
    );
    if (!result.rows[0]) throw new Error(`PROPOSAL_NOT_FOUND: proposta "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async markSuperseded(id: string, input: { supersededByProposalId: string; at: string }): Promise<Proposal | undefined> {
    const result = await this.pool.query<ProposalRow>(
      `update proposals set status = 'superseded', superseded_by_proposal_id = $2, superseded_at = $3, updated_at = now()
       where id = $1 and status not in ('accepted', 'cancelled', 'superseded') returning *`,
      [id, input.supersededByProposalId, input.at],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async markCancelled(id: string, at: string): Promise<Proposal | undefined> {
    const result = await this.pool.query<ProposalRow>(
      "update proposals set status = 'cancelled', cancelled_at = $2, updated_at = now() where id = $1 and status not in ('accepted', 'cancelled', 'superseded') returning *",
      [id, at],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async setAcceptance(id: string, input: { contentHash: string; ipHash?: string; userAgent?: string; version: number }): Promise<Proposal> {
    const result = await this.pool.query<ProposalRow>(
      "update proposals set accepted_content_hash = $2, accepted_ip_hash = $3, accepted_user_agent = $4, accepted_version = $5, updated_at = now() where id = $1 returning *",
      [id, input.contentHash, input.ipHash ?? null, input.userAgent?.slice(0, 300) ?? null, input.version],
    );
    if (!result.rows[0]) throw new Error(`PROPOSAL_NOT_FOUND: proposta "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async addViewSeconds(id: string, seconds: number): Promise<void> {
    await this.pool.query("update proposals set total_view_seconds = least(total_view_seconds + $2, 2000000000) where id = $1", [id, Math.max(0, Math.min(60, Math.round(seconds)))]);
  }

  async claimFollowUp(id: string, kind: "unviewed" | "unanswered" | "expiry", at: string): Promise<boolean> {
    const column = kind === "unviewed" ? "follow_up_unviewed_at" : kind === "unanswered" ? "follow_up_unanswered_at" : "follow_up_expiry_at";
    const result = await this.pool.query(`update proposals set ${column} = $2 where id = $1 and ${column} is null`, [id, at]);
    return (result.rowCount ?? 0) > 0;
  }

  async listFollowUpCandidates(input: { sentBefore: string; viewedBefore: string; expiringUntil: string; limit: number }): Promise<Proposal[]> {
    const result = await this.pool.query<ProposalRow>(
      `select * from proposals
       where status in ('sent', 'viewed') and public_link_revoked_at is null
         and (
           (status = 'sent' and sent_at <= $1 and follow_up_unviewed_at is null)
           or (status = 'viewed' and viewed_at <= $2 and follow_up_unanswered_at is null)
           or (valid_until is not null and valid_until <= $3::date and valid_until >= current_date and follow_up_expiry_at is null)
         )
       order by sent_at asc limit $4`,
      [input.sentBefore, input.viewedBefore, input.expiringUntil, input.limit],
    );
    return result.rows.map(toDomain);
  }

  async appendEvent(input: { tenantId: string; workspaceId: string; proposalId: string; eventType: ProposalEventType; recipientId?: string; occurredAt?: string; payload?: Record<string, unknown> }): Promise<ProposalEvent | undefined> {
    const result = await this.pool.query<EventRow>(
      `insert into proposal_events (id, tenant_id, workspace_id, proposal_id, event_type, recipient_id, occurred_at, payload)
       values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8)
       on conflict do nothing returning *`,
      [newId("pevent"), input.tenantId, input.workspaceId, input.proposalId, input.eventType, input.recipientId ?? null, input.occurredAt ?? null, JSON.stringify(input.payload ?? {})],
    );
    return result.rows[0] ? toEvent(result.rows[0]) : undefined;
  }

  async listEvents(proposalId: string): Promise<ProposalEvent[]> {
    const result = await this.pool.query<EventRow>("select * from proposal_events where proposal_id = $1 order by occurred_at, id", [proposalId]);
    return result.rows.map(toEvent);
  }

  async createRecipient(input: { tenantId: string; workspaceId: string; proposalId: string; contactId?: string; name: string; tokenHash: string }): Promise<ProposalRecipient> {
    const result = await this.pool.query<RecipientRow>(
      "insert into proposal_recipients (id, tenant_id, workspace_id, proposal_id, contact_id, name, token_hash) values ($1, $2, $3, $4, $5, $6, $7) returning *",
      [newId("precipient"), input.tenantId, input.workspaceId, input.proposalId, input.contactId ?? null, input.name, input.tokenHash],
    );
    return toRecipient(result.rows[0]);
  }

  async listRecipients(proposalId: string): Promise<ProposalRecipient[]> {
    const result = await this.pool.query<RecipientRow>("select * from proposal_recipients where proposal_id = $1 order by created_at", [proposalId]);
    return result.rows.map(toRecipient);
  }

  async getRecipientByTokenHash(tokenHash: string): Promise<(ProposalRecipient & { proposalId: string }) | undefined> {
    const result = await this.pool.query<RecipientRow>("select * from proposal_recipients where token_hash = $1 and revoked_at is null", [tokenHash]);
    return result.rows[0] ? toRecipient(result.rows[0]) : undefined;
  }

  async recordRecipientView(recipientId: string, viewedAt: string): Promise<void> {
    await this.pool.query(
      "update proposal_recipients set view_count = view_count + 1, first_viewed_at = coalesce(first_viewed_at, $2), last_viewed_at = $2 where id = $1",
      [recipientId, viewedAt],
    );
  }

  async listDeliveries(proposalId: string): Promise<ProposalDelivery[]> {
    const result = await this.pool.query<DeliveryRow>("select * from proposal_deliveries where proposal_id = $1 order by created_at desc", [proposalId]);
    return result.rows.map(toDelivery);
  }

  async listDeliveriesByConversation(input: { tenantId: string; workspaceId: string; conversationId: string }): Promise<(ProposalDelivery & { proposal: Proposal })[]> {
    const result = await this.pool.query<DeliveryRow & { proposal: ProposalRow }>(
      `select d.*, row_to_json(p.*) as proposal from proposal_deliveries d join proposals p on p.id = d.proposal_id
       where d.tenant_id = $1 and d.workspace_id = $2 and d.conversation_id = $3 and d.inbox_message_id is not null
       order by d.created_at desc limit 100`,
      [input.tenantId, input.workspaceId, input.conversationId],
    );
    return result.rows.map((row) => {
      const proposalRow = row.proposal;
      // row_to_json devolve timestamps como string — normaliza para Date antes do mapeamento comum.
      const dates = ["valid_until", "sent_at", "viewed_at", "last_viewed_at", "responded_at", "public_link_revoked_at", "created_at", "updated_at", "superseded_at", "cancelled_at"] as const;
      const normalized = { ...proposalRow } as Record<string, unknown>;
      for (const key of dates) normalized[key] = proposalRow[key] ? new Date(proposalRow[key] as unknown as string) : null;
      return { ...toDelivery(row), proposal: toDomain(normalized as unknown as ProposalRow) };
    });
  }
}
