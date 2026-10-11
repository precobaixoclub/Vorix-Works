import type { Pool } from "pg";
import {
  CREATIVE_ENGINE_CAPABILITY,
  type CreativeEngineEntitlementAuditEntry,
  type CreativeEngineEntitlementRepositoryPort,
  type CreativeEngineGlobalSettings,
  type CreativeEngineWorkspaceEntitlement,
  type SetCreativeEngineWorkspaceEntitlementInput,
} from "../../../application/ports/creative-engine-entitlement-repository.port.js";

const auditId = () => `cee-audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type EntitlementRow = {
  tenant_id: string;
  workspace_id: string;
  capability: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
  reason: string | null;
};

type AuditRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  capability: string;
  old_value: boolean | null;
  new_value: boolean;
  actor_user_id: string | null;
  reason: string | null;
  occurred_at: Date;
};

type GlobalSettingsRow = {
  enabled: boolean;
  updated_at: Date;
  updated_by: string | null;
};

export class PostgresCreativeEngineEntitlementRepository implements CreativeEngineEntitlementRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getGlobalSettings(): Promise<CreativeEngineGlobalSettings> {
    const result = await this.pool.query<GlobalSettingsRow>(
      "select enabled, updated_at, updated_by from creative_engine_global_settings where id = 'singleton'",
    );
    const row = result.rows[0];
    if (!row) return { enabled: false, updatedAt: new Date(0).toISOString() };
    return toGlobalSettings(row);
  }

  async setGlobalEnabled(input: { enabled: boolean; actorUserId?: string; reason?: string }): Promise<CreativeEngineGlobalSettings> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<GlobalSettingsRow>(
        "select enabled, updated_at, updated_by from creative_engine_global_settings where id = 'singleton' for update",
      );
      const oldValue = current.rows[0]?.enabled;
      const result = await client.query<GlobalSettingsRow>(
        `insert into creative_engine_global_settings (id, enabled, updated_by, updated_at)
         values ('singleton', $1, $2, now())
         on conflict (id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()
         returning enabled, updated_at, updated_by`,
        [input.enabled, input.actorUserId ?? null],
      );
      await client.query(
        `insert into creative_engine_entitlement_audit_log
          (id, tenant_id, workspace_id, capability, old_value, new_value, actor_user_id, reason)
         values ($1, '__global__', '__global__', $2, $3, $4, $5, $6)`,
        [auditId(), CREATIVE_ENGINE_CAPABILITY, oldValue ?? null, input.enabled, input.actorUserId ?? null, input.reason ?? null],
      );
      await client.query("commit");
      return toGlobalSettings(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getWorkspaceEntitlement(input: { tenantId: string; workspaceId: string }): Promise<CreativeEngineWorkspaceEntitlement | undefined> {
    const result = await this.pool.query<EntitlementRow>(
      `select * from creative_engine_workspace_entitlements
       where tenant_id = $1 and workspace_id = $2 and capability = $3`,
      [input.tenantId, input.workspaceId, CREATIVE_ENGINE_CAPABILITY],
    );
    return result.rows[0] ? toEntitlement(result.rows[0]) : undefined;
  }

  async setWorkspaceEntitlement(input: SetCreativeEngineWorkspaceEntitlementInput): Promise<CreativeEngineWorkspaceEntitlement> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<EntitlementRow>(
        `select * from creative_engine_workspace_entitlements
         where tenant_id = $1 and workspace_id = $2 and capability = $3
         for update`,
        [input.tenantId, input.workspaceId, CREATIVE_ENGINE_CAPABILITY],
      );
      const oldValue = current.rows[0]?.enabled;
      const result = await client.query<EntitlementRow>(
        `insert into creative_engine_workspace_entitlements
          (tenant_id, workspace_id, capability, enabled, updated_by, reason)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (tenant_id, workspace_id, capability) do update set
          enabled = excluded.enabled,
          updated_by = excluded.updated_by,
          reason = excluded.reason,
          updated_at = now()
         returning *`,
        [input.tenantId, input.workspaceId, CREATIVE_ENGINE_CAPABILITY, input.enabled, input.actorUserId ?? null, input.reason ?? null],
      );
      await client.query(
        `insert into creative_engine_entitlement_audit_log
          (id, tenant_id, workspace_id, capability, old_value, new_value, actor_user_id, reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          auditId(),
          input.tenantId,
          input.workspaceId,
          CREATIVE_ENGINE_CAPABILITY,
          oldValue ?? null,
          input.enabled,
          input.actorUserId ?? null,
          input.reason ?? null,
        ],
      );
      await client.query("commit");
      return toEntitlement(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listEnabledWorkspaces(input: { tenantId?: string; limit?: number; offset?: number } = {}): Promise<CreativeEngineWorkspaceEntitlement[]> {
    const params: unknown[] = [CREATIVE_ENGINE_CAPABILITY];
    const conditions = ["capability = $1", "enabled = true"];
    if (input.tenantId) {
      params.push(input.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    params.push(input.limit ?? 100, input.offset ?? 0);
    const result = await this.pool.query<EntitlementRow>(
      `select * from creative_engine_workspace_entitlements
       where ${conditions.join(" and ")}
       order by updated_at desc
       limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return result.rows.map(toEntitlement);
  }

  async listAudit(input: { tenantId?: string; workspaceId?: string; limit?: number }): Promise<CreativeEngineEntitlementAuditEntry[]> {
    const params: unknown[] = [CREATIVE_ENGINE_CAPABILITY];
    const conditions = ["capability = $1"];
    if (input.tenantId) {
      params.push(input.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (input.workspaceId) {
      params.push(input.workspaceId);
      conditions.push(`workspace_id = $${params.length}`);
    }
    params.push(input.limit ?? 50);
    const result = await this.pool.query<AuditRow>(
      `select * from creative_engine_entitlement_audit_log
       where ${conditions.join(" and ")}
       order by occurred_at desc
       limit $${params.length}`,
      params,
    );
    return result.rows.map(toAudit);
  }
}

function toGlobalSettings(row: GlobalSettingsRow): CreativeEngineGlobalSettings {
  return { enabled: row.enabled, updatedAt: row.updated_at.toISOString(), updatedBy: row.updated_by ?? undefined };
}

function toEntitlement(row: EntitlementRow): CreativeEngineWorkspaceEntitlement {
  return {
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    capability: CREATIVE_ENGINE_CAPABILITY,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by ?? undefined,
    reason: row.reason ?? undefined,
  };
}

function toAudit(row: AuditRow): CreativeEngineEntitlementAuditEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    capability: CREATIVE_ENGINE_CAPABILITY,
    oldValue: row.old_value ?? undefined,
    newValue: row.new_value,
    actorUserId: row.actor_user_id ?? undefined,
    reason: row.reason ?? undefined,
    occurredAt: row.occurred_at.toISOString(),
  };
}
