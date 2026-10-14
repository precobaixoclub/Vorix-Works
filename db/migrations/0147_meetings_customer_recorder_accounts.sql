-- 0147 — Vorix Meetings: contas de gravação DO CLIENTE (customer_managed), identidade humana por
-- reunião (nunca a mesma conta Google como pessoa e como gravador na mesma reunião), estratégia de
-- captura e sessões de provisionamento self-service (login Google feito pelo próprio cliente).
--
-- Aditiva e idempotente. Contas já existentes (pool global de homologação) viram `vorix_managed`;
-- nenhuma linha é apagada. A unicidade global de e-mail vira unicidade POR TENANT (cada cliente
-- conecta as próprias contas; um tenant nunca bloqueia nem descobre a conta de outro).

alter table recorder_bot_accounts add column if not exists ownership_type text not null default 'vorix_managed';
alter table recorder_bot_accounts drop constraint if exists recorder_bot_accounts_ownership_type_check;
alter table recorder_bot_accounts add constraint recorder_bot_accounts_ownership_type_check check (ownership_type in ('customer_managed', 'vorix_managed')) not valid;
alter table recorder_bot_accounts validate constraint recorder_bot_accounts_ownership_type_check;
alter table recorder_bot_accounts add column if not exists tenant_id text;
alter table recorder_bot_accounts add column if not exists workspace_id text;
alter table recorder_bot_accounts add column if not exists created_by_user_id text;
alter table recorder_bot_accounts add column if not exists removed_at timestamptz;
-- Conta do cliente SEM tenant não existe.
alter table recorder_bot_accounts drop constraint if exists recorder_bot_accounts_customer_tenant_check;
alter table recorder_bot_accounts add constraint recorder_bot_accounts_customer_tenant_check check (ownership_type <> 'customer_managed' or tenant_id is not null) not valid;
alter table recorder_bot_accounts validate constraint recorder_bot_accounts_customer_tenant_check;

alter table recorder_bot_accounts drop constraint if exists recorder_bot_accounts_google_email_key;
create unique index if not exists recorder_bot_accounts_tenant_email_uidx
  on recorder_bot_accounts ((coalesce(tenant_id, '__vorix_managed__')), (lower(google_email))) where removed_at is null;
create index if not exists recorder_bot_accounts_tenant_status_idx
  on recorder_bot_accounts (tenant_id, status) where removed_at is null;

-- Identidade Google que a PESSOA usará para entrar na reunião (não é usuário do Vorix nem conta de
-- gravação). `excluded_recorder_emails` permite excluir mais de uma identidade humana conhecida.
alter table meetings add column if not exists human_join_account_email text;
alter table meetings add column if not exists human_join_identity_source text;
alter table meetings drop constraint if exists meetings_human_join_identity_source_check;
alter table meetings add constraint meetings_human_join_identity_source_check check (human_join_identity_source is null or human_join_identity_source in ('explicit', 'google_calendar_organizer', 'connected_google_account', 'calendar_owner', 'unknown')) not valid;
alter table meetings validate constraint meetings_human_join_identity_source_check;
alter table meetings add column if not exists excluded_recorder_emails text[] not null default '{}';
-- Como a reunião é capturada. Só `vorix_recorder` existe hoje; `google_native` fica preparado.
alter table meetings add column if not exists capture_strategy text not null default 'vorix_recorder';
alter table meetings drop constraint if exists meetings_capture_strategy_check;
alter table meetings add constraint meetings_capture_strategy_check check (capture_strategy in ('vorix_recorder', 'google_native')) not valid;
alter table meetings validate constraint meetings_capture_strategy_check;

-- Organizador do evento no Google (base da inferência de identidade humana).
alter table calendar_events add column if not exists organizer_email text;

-- Sessão temporária de login self-service: o navegador roda no host do recorder e é transmitido
-- ao cliente. Só o HASH do token de visualização é guardado; nada digitado é persistido.
create table if not exists recorder_provisioning_sessions (
  id                    text primary key,
  tenant_id             text not null,
  workspace_id          text not null,
  recorder_account_id   text not null references recorder_bot_accounts (id) on delete cascade,
  created_by_user_id    text not null,
  status                text not null default 'pending' check (status in ('pending', 'starting', 'live', 'completed', 'failed', 'expired', 'cancelled')),
  viewer_token_hash     text not null,
  worker_id             text,
  worker_endpoint       text,
  error_code            text,
  error_message         text,
  expires_at            timestamptz not null,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists recorder_provisioning_sessions_pending_idx on recorder_provisioning_sessions (created_at) where status = 'pending';
create index if not exists recorder_provisioning_sessions_tenant_idx on recorder_provisioning_sessions (tenant_id, created_at desc);
