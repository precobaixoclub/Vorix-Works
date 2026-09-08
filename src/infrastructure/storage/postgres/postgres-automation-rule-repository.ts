import type { Pool } from "pg";
import type {
  AutomationRuleRepositoryPort,
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
} from "../../../application/ports/automation-rule-repository.port.js";
import type { AutomationActionType, AutomationCondition, AutomationRule, AutomationTrigger } from "../../../domain/crm/crm.model.js";

const ruleId = () => `automation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  name: string;
  trigger: string;
  conditions: AutomationCondition[];
  action: string;
  action_config: Record<string, unknown>;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: Row): AutomationRule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    name: row.name,
    trigger: row.trigger as AutomationTrigger,
    conditions: row.conditions ?? [],
    action: row.action as AutomationActionType,
    actionConfig: row.action_config ?? {},
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresAutomationRuleRepository implements AutomationRuleRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateAutomationRuleInput): Promise<AutomationRule> {
    const result = await this.pool.query<Row>(
      `insert into automation_rules (id, tenant_id, workspace_id, name, trigger, conditions, action, action_config)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [ruleId(), input.tenantId, input.workspaceId, input.name, input.trigger, JSON.stringify(input.conditions), input.action, JSON.stringify(input.actionConfig)],
    );
    return toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<AutomationRule | undefined> {
    const result = await this.pool.query<Row>("select * from automation_rules where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(tenantId: string, workspaceId: string): Promise<AutomationRule[]> {
    const result = await this.pool.query<Row>(
      "select * from automation_rules where tenant_id = $1 and workspace_id = $2 order by created_at desc",
      [tenantId, workspaceId],
    );
    return result.rows.map(toDomain);
  }

  async listActiveByTrigger(tenantId: string, workspaceId: string, trigger: AutomationTrigger): Promise<AutomationRule[]> {
    const result = await this.pool.query<Row>(
      "select * from automation_rules where tenant_id = $1 and workspace_id = $2 and trigger = $3 and active order by created_at asc",
      [tenantId, workspaceId, trigger],
    );
    return result.rows.map(toDomain);
  }

  async update(id: string, input: UpdateAutomationRuleInput): Promise<AutomationRule> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`AUTOMATION_RULE_NOT_FOUND: regra "${id}" não existe.`);
    const result = await this.pool.query<Row>(
      `update automation_rules set
         name = $2, trigger = $3, conditions = $4, action = $5, action_config = $6, active = $7, updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        input.name ?? existing.name,
        input.trigger ?? existing.trigger,
        JSON.stringify(input.conditions ?? existing.conditions),
        input.action ?? existing.action,
        JSON.stringify(input.actionConfig ?? existing.actionConfig),
        input.active ?? existing.active,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from automation_rules where id = $1", [id]);
  }
}
