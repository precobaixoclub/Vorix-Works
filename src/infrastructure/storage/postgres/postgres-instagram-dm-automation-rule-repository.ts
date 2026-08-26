import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  InstagramDmAutomationMatchType,
  InstagramDmAutomationReplyMode,
  InstagramDmAutomationRule,
  InstagramDmAutomationRuleRepositoryPort,
  UpsertInstagramDmAutomationRuleInput,
} from "../../../application/ports/instagram-dm-automation-rule-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  instagram_business_account_id: string;
  name: string;
  enabled: boolean;
  match_type: string;
  keywords: unknown;
  reply_mode: string;
  reply_text: string | null;
  ai_instructions: string | null;
  priority: number;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: Row): InstagramDmAutomationRule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    instagramBusinessAccountId: row.instagram_business_account_id,
    name: row.name,
    enabled: row.enabled,
    matchType: row.match_type as InstagramDmAutomationMatchType,
    keywords: (row.keywords as string[] | null) ?? [],
    replyMode: row.reply_mode as InstagramDmAutomationReplyMode,
    replyText: row.reply_text ?? undefined,
    aiInstructions: row.ai_instructions ?? undefined,
    priority: row.priority,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresInstagramDmAutomationRuleRepository implements InstagramDmAutomationRuleRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertRule(input: UpsertInstagramDmAutomationRuleInput): Promise<InstagramDmAutomationRule> {
    const id = input.id ?? randomUUID();
    const result = await this.pool.query<Row>(
      `insert into instagram_dm_automation_rules (id, tenant_id, workspace_id, instagram_business_account_id, name, enabled, match_type, keywords, reply_mode, reply_text, ai_instructions, priority)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do update
       set name = excluded.name, enabled = excluded.enabled, match_type = excluded.match_type, keywords = excluded.keywords,
           reply_mode = excluded.reply_mode, reply_text = excluded.reply_text, ai_instructions = excluded.ai_instructions,
           priority = excluded.priority, updated_at = now()
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.instagramBusinessAccountId, input.name, input.enabled, input.matchType,
        JSON.stringify(input.keywords), input.replyMode, input.replyText ?? null, input.aiInstructions ?? null, input.priority,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async listByAccount(input: { tenantId: string; workspaceId: string; instagramBusinessAccountId: string; onlyEnabled?: boolean }): Promise<InstagramDmAutomationRule[]> {
    const result = await this.pool.query<Row>(
      `select * from instagram_dm_automation_rules
       where tenant_id = $1 and workspace_id = $2 and instagram_business_account_id = $3 and ($4::boolean is false or enabled)
       order by priority asc`,
      [input.tenantId, input.workspaceId, input.instagramBusinessAccountId, input.onlyEnabled ?? false],
    );
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<InstagramDmAutomationRule | undefined> {
    const result = await this.pool.query<Row>("select * from instagram_dm_automation_rules where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from instagram_dm_automation_rules where id = $1", [id]);
  }
}
