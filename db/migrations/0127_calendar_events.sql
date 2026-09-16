-- 0127 — Agenda (Calendário/Eventos/Sync com Google Calendar), réplica adaptada do CMDesk (pedido
-- explícito do usuário, relatório "Agenda e Central de Notificações no CMDesk", Parte A).
--
-- Escopo trimado deliberadamente (ver comentário no topo de src/domain/calendar/calendar.model.ts):
-- sem recorrência (RRULE), sem Google Meet automático, sem lembretes, sem webhook/watch channel
-- (só cron periódico ~2min). Fora disso, o modelo espelha o original: source SYSTEM/GOOGLE, status
-- CONFIRMED/CANCELLED/DONE (sem hard delete), conexão Google 1:1 por usuário (nunca uma conta
-- corporativa central).

create table if not exists calendar_connections (
  id                   text primary key,
  tenant_id            text not null,
  workspace_id         text not null references workspaces (id) on delete cascade,
  user_id              text not null,
  google_email         text,
  calendar_id          text not null default 'primary',
  -- Tokens NUNCA ficam nesta tabela — sempre no secret manager genérico (operational_secrets,
  -- AES-256-GCM), referenciados por `calendar:<tenant_id>:<workspace_id>:<user_id>` (mesmo padrão
  -- já usado por YouTube/TikTok/Meta, ver secret-manager.port.ts).
  sync_token           text,
  last_synced_at       timestamptz,
  auto_sync_enabled    boolean not null default true,
  status               text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  last_error_message   text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (tenant_id, workspace_id, user_id)
);

create index if not exists calendar_connections_due_sync_idx on calendar_connections (status, auto_sync_enabled) where status = 'connected';

create table if not exists calendar_events (
  id                     text primary key,
  tenant_id              text not null,
  workspace_id           text not null references workspaces (id) on delete cascade,
  owner_user_id          text not null,
  title                  text not null,
  description            text,
  location               text,
  start_at               timestamptz not null,
  end_at                 timestamptz not null,
  timezone               text not null default 'UTC',
  all_day                boolean not null default false,
  attendees              jsonb not null default '[]',
  status                 text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'done')),
  source                 text not null default 'system' check (source in ('system', 'google')),
  related_entity_type    text,
  related_entity_id      text,
  google_account_id      text,
  google_calendar_id     text,
  google_event_id        text,
  google_etag            text,
  google_updated_at      timestamptz,
  html_link              text,
  sync_state             text check (sync_state in ('ok', 'failed')),
  last_sync_error        text,
  last_google_sync_at    timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Dedupe do pull (seção 1.1 do relatório). Sem recorrência nesta rodada, então nunca há colisão
  -- de "várias instâncias com o mesmo id de sistema" (o bug documentado na seção 1.2).
  unique (google_account_id, google_event_id)
);

create index if not exists calendar_events_owner_range_idx on calendar_events (tenant_id, workspace_id, owner_user_id, start_at);
create index if not exists calendar_events_status_idx on calendar_events (tenant_id, workspace_id, status);
create index if not exists calendar_events_related_idx on calendar_events (tenant_id, workspace_id, related_entity_type, related_entity_id, start_at);
-- Varredura de pendências de push (source=SYSTEM, nunca sincronizado ou última tentativa FAILED).
create index if not exists calendar_events_pending_push_idx on calendar_events (tenant_id, workspace_id, owner_user_id, source, sync_state);
