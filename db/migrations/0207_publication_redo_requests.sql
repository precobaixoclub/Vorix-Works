-- Reprovação com motivo pelo WhatsApp: a marca escolhe entre refazer a arte com base no motivo (e reenviar
-- para aprovação) ou devolver a ideia ao Bolsão.
alter table whatsapp_approval_rules add column if not exists on_reject text not null default 'redo';
alter table whatsapp_approval_rules drop constraint if exists whatsapp_approval_rules_on_reject_check;
alter table whatsapp_approval_rules add constraint whatsapp_approval_rules_on_reject_check check (on_reject in ('redo', 'return'));

-- Pedido de refação: o piloto (host) reivindica, refaz com o Codex e grava a publicação nova.
create table if not exists publication_redo_requests (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  publication_id text not null unique,
  idea_id text not null,
  reason text not null,
  attempt integer not null,
  slot text,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  result_publication_id text,
  detail text,
  -- Refação que falhou: o aprovador é avisado pelo WhatsApp uma única vez.
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publication_redo_requests_status_idx on publication_redo_requests (workspace_id, status, created_at);
create index if not exists publication_redo_requests_idea_idx on publication_redo_requests (idea_id, created_at);
create index if not exists publication_redo_requests_result_idx on publication_redo_requests (result_publication_id);
