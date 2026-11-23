import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PlatformEmailAlertsRepository, PlatformEmailEvent, PlatformEmailHistoryItem, PlatformEmailSettings, PlatformEmailStatus } from "../../../application/notification/platform-email-alerts.js";
import { decryptSecret, encryptSecret } from "../../crypto/secret-cipher.js";

type SettingsRow = { enabled: boolean; from_email: string | null; recipients: string[]; event_types: PlatformEmailEvent[]; api_key_encrypted: string | null };
type DeliveryRow = {
  id: string; event_type: PlatformEmailEvent | "test"; subject: string; recipient: string; status: PlatformEmailStatus;
  attempts: number; created_at: Date; finished_at: Date | null; last_error: string | null;
  from_email: string; body: string; link_path: string | null; lease_token: string;
};

function historyItem(row: DeliveryRow): PlatformEmailHistoryItem {
  return { id: String(row.id), event: row.event_type, subject: row.subject, recipient: row.recipient, status: row.status,
    attempts: row.attempts, createdAt: row.created_at.toISOString(), finishedAt: row.finished_at?.toISOString() ?? null, lastError: row.last_error };
}

export class PostgresPlatformEmailAlerts implements PlatformEmailAlertsRepository {
  constructor(private readonly pool: Pool, private readonly masterKey: string) {}

  async settings() {
    const result = await this.pool.query<SettingsRow>("select * from platform_email_alert_settings where id");
    const row = result.rows[0];
    if (!row) throw new Error("Configuração de e-mail da plataforma ausente");
    let apiKey: string | undefined;
    if (row.api_key_encrypted) {
      try { apiKey = decryptSecret(row.api_key_encrypted, this.masterKey); }
      catch { /* The key must be replaced after master key rotation. */ }
    }
    return { enabled: row.enabled, fromEmail: row.from_email, recipients: row.recipients, events: row.event_types, apiKey };
  }

  async save(input: PlatformEmailSettings & { apiKey?: string }) {
    const key = input.apiKey ? encryptSecret(input.apiKey, this.masterKey) : null;
    await this.pool.query(`with settings as (
      update platform_email_alert_settings set enabled=$1, from_email=$2, recipients=$3, event_types=$4,
        api_key_encrypted=coalesce($5, api_key_encrypted), updated_at=now() where id
      returning enabled, from_email, recipients, event_types
    ) update platform_email_deliveries d set status='cancelled', finished_at=now(), last_error='As preferências de envio foram alteradas.'
      from settings s where d.status='pending' and (d.from_email is distinct from s.from_email or not (d.recipient=any(s.recipients))
        or (d.event_type<>'test' and (not s.enabled or not (d.event_type=any(s.event_types)))))`,
    [input.enabled, input.fromEmail, input.recipients, input.events, key]);
  }

  async enqueueTest() {
    const result = await this.pool.query(`insert into platform_email_deliveries (event_type,event_key,recipient,from_email,subject,body,link_path)
      select 'test', date_trunc('minute', now())::text, recipient, s.from_email, 'Teste de notificação do Vorix',
        'Este e-mail confirma que o canal de notificações do Vorix pode enviar para este endereço.', '/admin/email-notifications'
      from platform_email_alert_settings s cross join lateral unnest(s.recipients) as recipient
      where s.id and s.api_key_encrypted is not null and s.from_email is not null
      on conflict (event_type,event_key,recipient) do nothing`);
    return result.rowCount ?? 0;
  }

  async history() {
    const result = await this.pool.query<DeliveryRow>("select * from platform_email_deliveries order by id desc limit 50");
    return result.rows.map(historyItem);
  }

  async claim() {
    const result = await this.pool.query<DeliveryRow>(`with expired as (
      update platform_email_deliveries set status='failed', finished_at=now(), lease_until=null, lease_token=null,
        last_error='A confirmação do envio expirou. Confira o histórico no Resend.'
      where (status='sending' and lease_until<=now() and attempts>=5)
        or (status in ('pending','sending') and (lease_until is null or lease_until<=now()) and created_at<now()-interval '23 hours')
    ), eligible as (
      select d.id from platform_email_deliveries d cross join platform_email_alert_settings s
      where s.id and s.from_email=d.from_email and d.recipient=any(s.recipients)
        and (d.event_type='test' or (s.enabled and d.event_type=any(s.event_types)))
        and (d.status='pending' or (d.status='sending' and d.lease_until<=now()))
        and d.available_at<=now() and d.attempts<5 and d.created_at>=now()-interval '23 hours'
      order by d.available_at,d.id for update of d skip locked limit 1
    ) update platform_email_deliveries d set status='sending', attempts=d.attempts+1, lease_token=$1,
      lease_until=now()+interval '90 seconds' from eligible e where d.id=e.id returning d.*`, [randomUUID()]);
    const row = result.rows[0];
    return row && { ...historyItem(row), fromEmail: row.from_email, body: row.body, path: row.link_path, leaseToken: row.lease_token };
  }

  async settle(input: Parameters<PlatformEmailAlertsRepository["settle"]>[0]) {
    await this.pool.query(`update platform_email_deliveries set status=$3, provider_id=$4, last_error=$5,
      finished_at=case when $3='pending' then null else now() end,
      available_at=now()+make_interval(secs=>$6), lease_until=null, lease_token=null
      where id=$1 and lease_token=$2 and status='sending'`,
    [input.job.id, input.job.leaseToken, input.status, input.providerId ?? null, input.error ?? null, input.retryAfterSeconds ?? 0]);
  }
}
