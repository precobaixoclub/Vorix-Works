-- 0080 — Módulo Conversas (Fase 1, Fundação): conexões de mensageria (WhatsApp via WuzAPI na
-- primeira versão). Token/credencial do gateway NUNCA fica aqui — só `external_session_id`
-- (identificador de sessão no gateway); segredos vivem exclusivamente no `.env.conversas` do
-- container do gateway, nunca no banco do Vorix nem no frontend.

create table if not exists messaging_connections (
  id                    text primary key,
  tenant_id             text not null,
  workspace_id          text not null references workspaces (id) on delete cascade,
  provider              text not null check (provider in ('wuzapi')),
  display_name          text not null,
  phone_number          text,
  external_session_id   text,
  status                text not null default 'connecting'
                        check (status in ('connecting', 'connected', 'reconnecting', 'disconnected', 'logged_out', 'requires_repair', 'error')),
  connection_health     text not null default 'unknown' check (connection_health in ('healthy', 'degraded', 'unknown')),
  reconnect_count       integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  last_connected_at     timestamptz,
  last_disconnected_at  timestamptz,
  last_event_at         timestamptz,
  last_heartbeat_at     timestamptz
);

-- Consulta principal: "conexões de um workspace, isoladas por tenant".
create index if not exists messaging_connections_tenant_workspace_idx on messaging_connections (tenant_id, workspace_id);
create index if not exists messaging_connections_status_idx on messaging_connections (status);
