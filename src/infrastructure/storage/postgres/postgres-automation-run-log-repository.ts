import type { Pool } from "pg";
import type { AutomationRunLogRepositoryPort, RecordAutomationRunLogInput } from "../../../application/ports/automation-run-log-repository.port.js";
import type { AutomationRunLog } from "../../../domain/crm/crm.model.js";

const logId = () => `automation-log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  rule_id: string;
  contact_id: string | null;
  deal_id: string | null;
  matched: boolean;
  action_taken: boolean;
  error: string | null;
  occurred_at: Date;
};

function toDomain(row: Row): AutomationRunLog {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    ruleId: row.rule_id,
    contactId: row.contact_id ?? undefined,
    dealId: row.deal_id ?? undefined,
    matched: row.matched,
    actionTaken: row.action_taken,
    error: row.error ?? undefined,
    occurredAt: row.occurred_at.toISOString(),
  };
}

export class PostgresAutomationRunLogRepository implements AutomationRunLogRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordAutomationRunLogInput): Promise<AutomationRunLog> {
    const result = await this.pool.query<Row>(
      `insert into automation_run_logs (id, tenant_id, workspace_id, rule_id, contact_id, deal_id, matched, action_taken, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [logId(), input.tenantId, input.workspaceId, input.ruleId, input.contactId ?? null, input.dealId ?? null, input.matched, input.actionTaken, input.error ?? null],
    );
    return toDomain(result.rows[0]);
  }

  async listByRule(ruleId: string, limit = 50): Promise<AutomationRunLog[]> {
    const result = await this.pool.query<Row>(
      "select * from automation_run_logs where rule_id = $1 order by occurred_at desc limit $2",
      [ruleId, limit],
    );
    return result.rows.map(toDomain);
  }
}
