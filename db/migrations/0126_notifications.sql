-- 0126 — Notificações in-app ("sino"), réplica adaptada do CMDesk (pedido explícito do usuário,
-- relatório "Agenda e Central de Notificações no CMDesk"). Alerta pontual pro usuário logado —
-- não confundir com a OUTRA "Central de Notificações" do mesmo relatório (disparo em massa de
-- WhatsApp, fora de escopo desta rodada: documento-fonte truncado no meio do algoritmo).

create table if not exists notifications (
  id             text primary key,
  tenant_id      text not null,
  workspace_id   text not null references workspaces (id) on delete cascade,
  user_id        text not null,
  title          text not null,
  body           text,
  source_type    text not null,
  source_id      text,
  source_url     text,
  -- Setados sempre JUNTOS (nunca "lida sem dispensar" nesta rodada, mesmo achado do CMDesk).
  read_at        timestamptz,
  dismissed_at   timestamptz,
  created_at     timestamptz not null default now()
);

-- Índice parcial — só as ativas (não dispensadas) importam pra consulta do sino ("Novas"), que é
-- de longe a consulta mais frequente; o histórico completo é raro (aba "Anteriores").
create index if not exists notifications_active_idx on notifications (tenant_id, workspace_id, user_id, created_at desc) where dismissed_at is null;
create index if not exists notifications_history_idx on notifications (tenant_id, workspace_id, user_id, created_at desc);
