-- 0156 — Sales Engine (Vorix Conversas), fases 5–7: proposta como entidade central da negociação.
-- Versionamento (PROP-AAAA-NNN vN, nova versão SUBSTITUI a anterior ao ser enviada), status de
-- aprovação interna, rastreio separado (entrega/leitura do WhatsApp ≠ visualização da proposta),
-- aceite auditado (hash do conteúdo aceito, IP só como hash, user-agent truncado), eventos
-- append-only, destinatários com token próprio (preparação para múltiplos decisores) e controle
-- idempotente dos follow-ups automáticos. Tudo aditivo; nenhum dado existente é reescrito.

alter table proposals drop constraint if exists proposals_status_check;
do $$ begin
  alter table proposals add constraint proposals_status_check check (status in (
    'draft', 'pending_approval', 'approved', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'cancelled', 'superseded'
  ));
exception when duplicate_object then null; end $$;

alter table proposals
  add column if not exists number text,
  add column if not exists version integer not null default 1,
  add column if not exists root_proposal_id text,
  add column if not exists supersedes_proposal_id text,
  add column if not exists superseded_by_proposal_id text,
  add column if not exists superseded_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists introduction text,
  add column if not exists notes text,
  add column if not exists terms text,
  add column if not exists list_total_cents bigint,
  add column if not exists created_by_user_id text,
  add column if not exists sent_by_user_id text,
  add column if not exists sent_channel text,
  add column if not exists sent_conversation_id text,
  add column if not exists sent_message_id text,
  add column if not exists total_view_seconds integer not null default 0,
  add column if not exists accepted_content_hash text,
  add column if not exists accepted_ip_hash text,
  add column if not exists accepted_user_agent text,
  add column if not exists accepted_version integer,
  add column if not exists follow_up_unviewed_at timestamptz,
  add column if not exists follow_up_unanswered_at timestamptz,
  add column if not exists follow_up_expiry_at timestamptz;

-- Propostas existentes viram a v1 de si mesmas (raiz = ela própria), com número retroativo estável.
update proposals set root_proposal_id = id where root_proposal_id is null;
update proposals p set number = sub.number
  from (
    select id, 'PROP-' || to_char(created_at, 'YYYY') || '-' || lpad(row_number() over (partition by workspace_id, to_char(created_at, 'YYYY') order by created_at, id)::text, 3, '0') as number
    from proposals where number is null
  ) sub
  where p.id = sub.id;

create unique index if not exists proposals_number_version_idx on proposals (workspace_id, number, version) where number is not null;
create index if not exists proposals_root_idx on proposals (root_proposal_id, version desc);
create index if not exists proposals_follow_up_idx on proposals (status, sent_at) where status in ('sent', 'viewed');

alter table proposal_templates
  add column if not exists default_introduction text,
  add column if not exists default_terms text;

-- Eventos append-only da proposta (timeline histórica; o status atual nunca é a única fonte).
create table if not exists proposal_events (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  proposal_id  text not null references proposals (id) on delete cascade,
  event_type   text not null check (event_type in (
    'created', 'approval_requested', 'approved', 'rejected_internally', 'sent', 'delivered', 'whatsapp_read', 'whatsapp_failed',
    'viewed', 'downloaded', 'accepted', 'declined', 'expired', 'superseded', 'cancelled', 'reminder_sent', 'follow_up_task_created'
  )),
  recipient_id text,
  occurred_at  timestamptz not null default now(),
  payload      jsonb not null default '{}'
);
create index if not exists proposal_events_proposal_idx on proposal_events (proposal_id, occurred_at);
-- Eventos que só podem acontecer uma vez por proposta (dedupe idempotente).
create unique index if not exists proposal_events_once_idx on proposal_events (proposal_id, event_type)
  where event_type in ('created', 'delivered', 'whatsapp_read', 'accepted', 'declined', 'expired', 'superseded', 'cancelled');

-- Destinatários com token próprio (múltiplos decisores). O token principal continua em proposals.
create table if not exists proposal_recipients (
  id              text primary key,
  tenant_id       text not null,
  workspace_id    text not null references workspaces (id) on delete cascade,
  proposal_id     text not null references proposals (id) on delete cascade,
  contact_id      text references contacts (id) on delete set null,
  name            text not null,
  token_hash      text not null unique,
  view_count      integer not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at  timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists proposal_recipients_proposal_idx on proposal_recipients (proposal_id);

alter table proposal_views add column if not exists recipient_id text;

-- Gatilhos novos de automação (mesmo motor; nenhum segundo motor de automação).
alter table automation_rules drop constraint if exists automation_rules_trigger_check;
do $$ begin
  alter table automation_rules add constraint automation_rules_trigger_check check (trigger in (
    'deal_stage_changed', 'contact_created', 'proposal_accepted', 'proposal_rejected',
    'deal_created', 'deal_won', 'deal_lost', 'proposal_sent', 'proposal_viewed', 'approval_requested', 'approval_decided', 'goal_reached'
  ));
exception when duplicate_object then null; end $$;
