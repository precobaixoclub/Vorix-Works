import {contactLabel,type ContactPresentationInput} from "../../../domain/crm/contact-presentation.js";
import type { Pool } from "pg";
import type { CreateNotificationInput, NotificationRepositoryPort } from "../../../application/ports/notification-repository.port.js";
import type { Notification } from "../../../domain/notification/notification.model.js";

const idGenerator = () => `notif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  canonical_contact?:ContactPresentationInput|null;
  order_customer_name?:string|null;
  id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  body: string | null;
  source_type: string;
  source_id: string | null;
  source_url: string | null;
  read_at: Date | null;
  dismissed_at: Date | null;
  created_at: Date;
};

export class PostgresNotificationRepository implements NotificationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const result = await this.pool.query<Row>(
      `insert into notifications (id, tenant_id, workspace_id, user_id, title, body, source_type, source_id, source_url)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [idGenerator(), input.tenantId, input.workspaceId, input.userId, input.title, input.body ?? null, input.sourceType, input.sourceId ?? null, input.sourceUrl ?? null],
    );
    return this.toDomain(result.rows[0]);
  }

  async listActive(input: { tenantId: string; workspaceId: string; userId: string; limit: number }): Promise<Notification[]> {
    const result = await this.pool.query<Row>(
      `select notifications.*, (select jsonb_build_object('name',ct.name,'phone',ct.custom_fields->>'phone') from contacts ct where ct.tenant_id=notifications.tenant_id and ct.workspace_id=notifications.workspace_id and ct.id=coalesce(
 (select coalesce(p.contact_id,d.contact_id) from proposals p left join deals d on d.id=p.deal_id and d.tenant_id=p.tenant_id and d.workspace_id=p.workspace_id where p.id=notifications.source_id and p.tenant_id=notifications.tenant_id and p.workspace_id=notifications.workspace_id and notifications.source_type like 'proposal_%'),
 (select o.contact_id from commerce_orders o where o.id=notifications.source_id and o.tenant_id=notifications.tenant_id and o.workspace_id=notifications.workspace_id and notifications.source_type='commerce_order_paid')
 )) as canonical_contact, (select o.customer->>'name' from commerce_orders o where o.id=notifications.source_id and o.tenant_id=notifications.tenant_id and o.workspace_id=notifications.workspace_id and notifications.source_type='commerce_order_paid') as order_customer_name from notifications
       where tenant_id = $1 and workspace_id = $2 and user_id = $3 and dismissed_at is null
       order by created_at desc
       limit $4`,
      [input.tenantId, input.workspaceId, input.userId, input.limit],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async listHistory(input: { tenantId: string; workspaceId: string; userId: string; limit: number }): Promise<Notification[]> {
    const result = await this.pool.query<Row>(
      `select notifications.*, (select jsonb_build_object('name',ct.name,'phone',ct.custom_fields->>'phone') from contacts ct where ct.tenant_id=notifications.tenant_id and ct.workspace_id=notifications.workspace_id and ct.id=coalesce(
 (select coalesce(p.contact_id,d.contact_id) from proposals p left join deals d on d.id=p.deal_id and d.tenant_id=p.tenant_id and d.workspace_id=p.workspace_id where p.id=notifications.source_id and p.tenant_id=notifications.tenant_id and p.workspace_id=notifications.workspace_id and notifications.source_type like 'proposal_%'),
 (select o.contact_id from commerce_orders o where o.id=notifications.source_id and o.tenant_id=notifications.tenant_id and o.workspace_id=notifications.workspace_id and notifications.source_type='commerce_order_paid')
 )) as canonical_contact, (select o.customer->>'name' from commerce_orders o where o.id=notifications.source_id and o.tenant_id=notifications.tenant_id and o.workspace_id=notifications.workspace_id and notifications.source_type='commerce_order_paid') as order_customer_name from notifications
       where tenant_id = $1 and workspace_id = $2 and user_id = $3
       order by created_at desc
       limit $4`,
      [input.tenantId, input.workspaceId, input.userId, input.limit],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async dismiss(input: { tenantId: string; workspaceId: string; userId: string; id: string }): Promise<Notification | undefined> {
    const result = await this.pool.query<Row>(
      `update notifications set read_at = coalesce(read_at, now()), dismissed_at = now()
       where id = $1 and tenant_id = $2 and workspace_id = $3 and user_id = $4
       returning *`,
      [input.id, input.tenantId, input.workspaceId, input.userId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async dismissAll(input: { tenantId: string; workspaceId: string; userId: string }): Promise<number> {
    const result = await this.pool.query(
      `update notifications set read_at = coalesce(read_at, now()), dismissed_at = now()
       where tenant_id = $1 and workspace_id = $2 and user_id = $3 and dismissed_at is null`,
      [input.tenantId, input.workspaceId, input.userId],
    );
    return result.rowCount ?? 0;
  }

  private toDomain(row: Row): Notification {
    const person=contactLabel(row.canonical_contact);
    const titles:Record<string,string>={proposal_first_view:person+" abriu sua proposta",proposal_hot_view:person+" voltou a abrir a proposta",proposal_accepted:person+" aceitou a proposta",proposal_declined:person+" recusou a proposta"};
    const safe=(value:string)=>value.replace(/\blead(?:[_-][\w-]+|\s*\d+)?\b/gi,person).replace(/\b(?:contact|intent|conversation|visitor)-[\w-]+/gi,person);
    const body=row.canonical_contact && row.order_customer_name && row.body?.startsWith(row.order_customer_name) ? person+row.body.slice(row.order_customer_name.length) : row.body;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      title: row.canonical_contact ? titles[row.source_type] ?? safe(row.title) : safe(row.title),
      body: row.source_type === "proposal_accepted" ? "Proposta aceita. Aguardando faturamento." : body ? safe(body) : undefined,
      sourceType: row.source_type,
      sourceId: row.source_id ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      readAt: row.read_at?.toISOString(),
      dismissedAt: row.dismissed_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  }
}
