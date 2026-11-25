import type pg from "pg";
import type {
  ApprovalMember,
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRule,
  ApprovalSettings,
  WhatsappApprovalRepositoryPort,
} from "../../../application/approvals/whatsapp-approval-service.js";
import type { ApprovalDecision } from "../../../application/approvals/whatsapp-approval.js";
import type { TenantRole } from "../../../domain/identity/identity.model.js";

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : undefined);

type RequestRow = {
  id: string; tenant_id: string; workspace_id: string; publication_id: string; code: string; connection_id: string; approver_phone: string; approver_user_id: string | null;
  status: ApprovalRequestStatus; decision: ApprovalDecision | null; reason: string | null; detail: string | null; created_at: Date; sent_at: Date | null; decided_at: Date | null; applied_at: Date | null;
};

const toRequest = (row: RequestRow): ApprovalRequest => ({
  id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, publicationId: row.publication_id, code: row.code, connectionId: row.connection_id,
  approverPhone: row.approver_phone, ...(row.approver_user_id ? { approverUserId: row.approver_user_id } : {}), status: row.status,
  ...(row.decision ? { decision: row.decision } : {}), ...(row.reason ? { reason: row.reason } : {}), ...(row.detail ? { detail: row.detail } : {}),
  createdAt: iso(row.created_at)!, ...(row.sent_at ? { sentAt: iso(row.sent_at) } : {}), ...(row.decided_at ? { decidedAt: iso(row.decided_at) } : {}), ...(row.applied_at ? { appliedAt: iso(row.applied_at) } : {}),
});

type RuleRow = { tenant_id: string; workspace_id: string; enabled: boolean; approver_user_id: string | null; approver_phone: string | null; on_timeout: "skip" | "publish"; enabled_at: Date | null; updated_at: Date };
const toRule = (row: RuleRow): ApprovalRule => ({
  tenantId: row.tenant_id, workspaceId: row.workspace_id, enabled: row.enabled, ...(row.approver_user_id ? { approverUserId: row.approver_user_id } : {}),
  ...(row.approver_phone ? { approverPhone: row.approver_phone } : {}), onTimeout: row.on_timeout, ...(row.enabled_at ? { enabledAt: iso(row.enabled_at) } : {}), updatedAt: iso(row.updated_at),
});

export class PostgresWhatsappApprovalRepository implements WhatsappApprovalRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async getSettings(tenantId: string): Promise<ApprovalSettings | undefined> {
    const { rows } = await this.pool.query("select tenant_id, enabled, connection_id, updated_at from whatsapp_approval_settings where tenant_id=$1", [tenantId]);
    const row = rows[0];
    return row ? { tenantId: row.tenant_id, enabled: row.enabled, ...(row.connection_id ? { connectionId: row.connection_id } : {}), updatedAt: iso(row.updated_at) } : undefined;
  }

  async saveSettings(input: { tenantId: string; enabled: boolean; connectionId?: string; updatedBy: string }): Promise<ApprovalSettings> {
    await this.pool.query(`insert into whatsapp_approval_settings (tenant_id, enabled, connection_id, updated_by, updated_at) values ($1,$2,$3,$4,now())
      on conflict (tenant_id) do update set enabled=excluded.enabled, connection_id=excluded.connection_id, updated_by=excluded.updated_by, updated_at=now()`,
    [input.tenantId, input.enabled, input.connectionId ?? null, input.updatedBy]);
    return (await this.getSettings(input.tenantId))!;
  }

  async listRules(tenantId: string): Promise<ApprovalRule[]> {
    const { rows } = await this.pool.query<RuleRow>("select * from whatsapp_approval_rules where tenant_id=$1", [tenantId]);
    return rows.map(toRule);
  }

  async getRule(tenantId: string, workspaceId: string): Promise<ApprovalRule | undefined> {
    const { rows } = await this.pool.query<RuleRow>("select * from whatsapp_approval_rules where tenant_id=$1 and workspace_id=$2", [tenantId, workspaceId]);
    return rows[0] ? toRule(rows[0]) : undefined;
  }

  async saveRule(input: Omit<ApprovalRule, "enabledAt" | "updatedAt"> & { updatedBy: string }): Promise<ApprovalRule> {
    // enabled_at marca quando a regra foi ligada: só publicações criadas depois disso pedem aprovação.
    await this.pool.query(`insert into whatsapp_approval_rules (tenant_id, workspace_id, enabled, approver_user_id, approver_phone, on_timeout, enabled_at, updated_by, updated_at)
      values ($1,$2,$3,$4,$5,$6, case when $3 then now() end, $7, now())
      on conflict (tenant_id, workspace_id) do update set enabled=excluded.enabled, approver_user_id=excluded.approver_user_id, approver_phone=excluded.approver_phone,
        on_timeout=excluded.on_timeout, updated_by=excluded.updated_by, updated_at=now(),
        enabled_at = case when excluded.enabled and not whatsapp_approval_rules.enabled then now() when excluded.enabled then whatsapp_approval_rules.enabled_at else null end`,
    [input.tenantId, input.workspaceId, input.enabled, input.approverUserId ?? null, input.approverPhone ?? null, input.onTimeout, input.updatedBy]);
    return (await this.getRule(input.tenantId, input.workspaceId))!;
  }

  async listMembers(tenantId: string): Promise<ApprovalMember[]> {
    const { rows } = await this.pool.query(`select u.id, u.name, u.email, m.role from tenant_members m join users u on u.id=m.user_id
      where m.tenant_id=$1 and u.status='active' order by u.name`, [tenantId]);
    return rows.map((row) => ({ userId: row.id, name: row.name ?? row.email, email: row.email ?? undefined, role: row.role as TenantRole }));
  }

  async listPublicationsToRequest(limit: number) {
    const { rows } = await this.pool.query(`select p.id, p.tenant_id, p.workspace_id from publication_plans p
      join whatsapp_approval_rules r on r.tenant_id=p.tenant_id and r.workspace_id=p.workspace_id and r.enabled and r.approver_phone is not null and r.approver_user_id is not null
      join whatsapp_approval_settings s on s.tenant_id=p.tenant_id and s.enabled and s.connection_id is not null
      where p.state='waiting_for_approval' and p.idempotency_key like 'social:%' and r.enabled_at is not null and p.created_at >= r.enabled_at
        and not exists (select 1 from publication_approval_requests a where a.publication_id=p.id)
      order by p.created_at limit $1`, [limit]);
    return rows.map((row) => ({ tenantId: row.tenant_id, workspaceId: row.workspace_id, publicationId: row.id }));
  }

  async createRequest(input: Omit<ApprovalRequest, "status" | "createdAt"> & { status?: ApprovalRequestStatus }): Promise<ApprovalRequest | undefined> {
    const { rows } = await this.pool.query<RequestRow>(`insert into publication_approval_requests (id, tenant_id, workspace_id, publication_id, code, connection_id, approver_phone, approver_user_id, status)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (publication_id) do nothing returning *`,
    [input.id, input.tenantId, input.workspaceId, input.publicationId, input.code, input.connectionId, input.approverPhone, input.approverUserId ?? null, input.status ?? "pending"]);
    return rows[0] ? toRequest(rows[0]) : undefined;
  }

  async updateRequest(id: string, patch: Partial<Pick<ApprovalRequest, "status" | "decision" | "reason" | "detail" | "sentAt" | "decidedAt" | "appliedAt">>): Promise<void> {
    const columns: Record<string, unknown> = { status: patch.status, decision: patch.decision, reason: patch.reason, detail: patch.detail, sent_at: patch.sentAt, decided_at: patch.decidedAt, applied_at: patch.appliedAt };
    const entries = Object.entries(columns).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    await this.pool.query(`update publication_approval_requests set ${entries.map(([column], index) => `${column}=$${index + 2}`).join(", ")} where id=$1`, [id, ...entries.map(([, value]) => value)]);
  }

  async decideRequest(id: string, decision: ApprovalDecision, reason: string | undefined, at: string): Promise<boolean> {
    const result = await this.pool.query("update publication_approval_requests set status='decided', decision=$2, reason=$3, decided_at=$4 where id=$1 and status='sent'", [id, decision, reason ?? null, at]);
    return (result.rowCount ?? 0) > 0;
  }

  async listOpenByPhone(connectionId: string, approverPhone: string): Promise<ApprovalRequest[]> {
    const { rows } = await this.pool.query<RequestRow>("select * from publication_approval_requests where connection_id=$1 and approver_phone=$2 and status='sent' order by created_at", [connectionId, approverPhone]);
    return rows.map(toRequest);
  }

  async listByStatus(status: ApprovalRequestStatus, limit: number): Promise<ApprovalRequest[]> {
    const { rows } = await this.pool.query<RequestRow>("select * from publication_approval_requests where status=$1 order by created_at limit $2", [status, limit]);
    return rows.map(toRequest);
  }

  async listRecent(tenantId: string, limit: number): Promise<ApprovalRequest[]> {
    const { rows } = await this.pool.query<RequestRow>("select * from publication_approval_requests where tenant_id=$1 order by created_at desc limit $2", [tenantId, limit]);
    return rows.map(toRequest);
  }
}
