import type { Pool } from "pg";
import type { InboxServiceSettingsRepositoryPort } from "../../../application/ports/inbox-service-settings-repository.port.js";
import type { InboxServiceSettings, ServiceWeeklySchedule, TriageOption } from "../../../domain/inbox/service-settings.js";

type Row = {
  workspace_id: string;
  tenant_id: string;
  timezone: string;
  business_hours: ServiceWeeklySchedule;
  away_enabled: boolean;
  away_message: string;
  closing_reasons: string[];
  require_closing_reason: boolean;
  csat_enabled: boolean;
  csat_message: string;
  csat_thanks_message: string;
  triage_enabled: boolean;
  triage_greeting: string;
  triage_options: TriageOption[];
  triage_fallback_message: string;
  updated_at: Date;
};

export class PostgresInboxServiceSettingsRepository implements InboxServiceSettingsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async get(workspaceId: string): Promise<InboxServiceSettings | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_service_settings where workspace_id = $1", [workspaceId]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async upsert(settings: InboxServiceSettings): Promise<InboxServiceSettings> {
    const result = await this.pool.query<Row>(
      `insert into inbox_service_settings (workspace_id, tenant_id, timezone, business_hours, away_enabled, away_message, closing_reasons, require_closing_reason, csat_enabled, csat_message, csat_thanks_message, triage_enabled, triage_greeting, triage_options, triage_fallback_message, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, now())
       on conflict (workspace_id) do update set
         timezone = excluded.timezone, business_hours = excluded.business_hours, away_enabled = excluded.away_enabled,
         away_message = excluded.away_message, closing_reasons = excluded.closing_reasons, require_closing_reason = excluded.require_closing_reason,
         csat_enabled = excluded.csat_enabled, csat_message = excluded.csat_message, csat_thanks_message = excluded.csat_thanks_message,
         triage_enabled = excluded.triage_enabled, triage_greeting = excluded.triage_greeting, triage_options = excluded.triage_options,
         triage_fallback_message = excluded.triage_fallback_message, updated_at = now()
       returning *`,
      [
        settings.workspaceId, settings.tenantId, settings.timezone, JSON.stringify(settings.businessHours), settings.awayEnabled, settings.awayMessage,
        JSON.stringify(settings.closingReasons), settings.requireClosingReason, settings.csatEnabled, settings.csatMessage, settings.csatThanksMessage,
        settings.triageEnabled, settings.triageGreeting, JSON.stringify(settings.triageOptions), settings.triageFallbackMessage,
      ],
    );
    return this.toDomain(result.rows[0]!);
  }

  private toDomain(row: Row): InboxServiceSettings {
    return {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      timezone: row.timezone,
      businessHours: row.business_hours,
      awayEnabled: row.away_enabled,
      awayMessage: row.away_message,
      closingReasons: row.closing_reasons ?? [],
      requireClosingReason: row.require_closing_reason,
      csatEnabled: row.csat_enabled,
      csatMessage: row.csat_message,
      csatThanksMessage: row.csat_thanks_message,
      triageEnabled: row.triage_enabled,
      triageGreeting: row.triage_greeting,
      triageOptions: row.triage_options ?? [],
      triageFallbackMessage: row.triage_fallback_message,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
