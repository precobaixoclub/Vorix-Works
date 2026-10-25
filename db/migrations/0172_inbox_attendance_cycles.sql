-- 0172 — Ciclo de atendimento (Conversas). Separa CONVERSA (histórico permanente com o contato) de
-- ATENDIMENTO (ciclo que abre e fecha dentro dela) e de CICLO DE RESPONSABILIDADE (cada pessoa que
-- recebe o atendimento tem o próprio relógio de primeira resposta). Timestamps são a fonte primária;
-- `*_seconds` são só cache para relatórios. Ver src/domain/inbox/attendance.model.ts.

-- Catálogo configurável de finalização (tipo > subtipo), por workspace. Excluir é lógico
-- (`deleted_at`): atendimentos antigos continuam apontando para o registro e guardam o nome.
create table if not exists inbox_closure_types (
  id            text primary key,
  tenant_id     text not null,
  workspace_id  text not null references workspaces (id) on delete cascade,
  name          text not null,
  position      integer not null default 0,
  is_active     boolean not null default true,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists inbox_closure_types_workspace_idx on inbox_closure_types (workspace_id, position);

create table if not exists inbox_closure_subtypes (
  id               text primary key,
  tenant_id        text not null,
  workspace_id     text not null references workspaces (id) on delete cascade,
  closure_type_id  text not null references inbox_closure_types (id) on delete cascade,
  name             text not null,
  position         integer not null default 0,
  is_active        boolean not null default true,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists inbox_closure_subtypes_type_idx on inbox_closure_subtypes (closure_type_id, position);

-- Atendimento: no máximo UM aberto por conversa (índice parcial único abaixo). `number` é o
-- "#125" exibido, sequencial por workspace.
create table if not exists inbox_attendances (
  id                       text primary key,
  tenant_id                text not null,
  workspace_id             text not null references workspaces (id) on delete cascade,
  conversation_id          text not null references inbox_conversations (id) on delete cascade,
  contact_id               text,
  connection_id            text not null,
  team_id                  text,
  number                   integer not null,
  status                   text not null default 'open' check (status in ('open', 'closed')),
  opened_at                timestamptz not null,
  opened_by                text not null,
  open_reason              text not null,
  distribution_rule        text,
  initial_assignee_user_id text,
  first_response_at        timestamptz,
  first_response_by        text,
  closed_at                timestamptz,
  closed_by                text,
  closure_type_id          text references inbox_closure_types (id) on delete set null,
  closure_subtype_id       text references inbox_closure_subtypes (id) on delete set null,
  closure_type_name        text,
  closure_subtype_name     text,
  closure_note             text,
  resolution_seconds       integer,
  csat_status              text check (csat_status is null or csat_status in ('sent', 'disabled_by_channel', 'waived', 'not_applicable', 'failed')),
  csat_waived_by           text,
  csat_sent_at             timestamptz,
  csat_score               smallint check (csat_score is null or csat_score between 1 and 5),
  csat_answered_at         timestamptz,
  reopened_count           integer not null default 0,
  last_reopened_at         timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists inbox_attendances_one_open_per_conversation on inbox_attendances (conversation_id) where status = 'open';
create unique index if not exists inbox_attendances_workspace_number on inbox_attendances (workspace_id, number);
create index if not exists inbox_attendances_conversation_idx on inbox_attendances (conversation_id, opened_at);
create index if not exists inbox_attendances_workspace_closed_idx on inbox_attendances (workspace_id, closed_at) where closed_at is not null;
create index if not exists inbox_attendances_workspace_opened_idx on inbox_attendances (workspace_id, opened_at);

-- Ciclo de responsabilidade: um por atribuição/transferência. No máximo UM ativo por atendimento.
create table if not exists inbox_attendance_assignments (
  id                          text primary key,
  tenant_id                   text not null,
  workspace_id                text not null references workspaces (id) on delete cascade,
  attendance_id               text not null references inbox_attendances (id) on delete cascade,
  conversation_id             text not null references inbox_conversations (id) on delete cascade,
  user_id                     text not null,
  team_id                     text,
  source                      text not null,
  assigned_by                 text not null,
  started_at                  timestamptz not null,
  first_response_at           timestamptz,
  first_response_message_id   text,
  first_response_seconds      integer,
  ended_at                    timestamptz,
  end_reason                  text,
  transferred_to_user_id      text,
  holding_seconds             integer,
  created_at                  timestamptz not null default now()
);
create unique index if not exists inbox_attendance_assignments_one_active on inbox_attendance_assignments (attendance_id) where ended_at is null;
create index if not exists inbox_attendance_assignments_attendance_idx on inbox_attendance_assignments (attendance_id, started_at);
create index if not exists inbox_attendance_assignments_user_idx on inbox_attendance_assignments (workspace_id, user_id, started_at);

-- Eventos da timeline ganham colunas estruturadas (fonte para métricas/auditoria; o texto do
-- marco é sempre gerado a partir delas, nunca o contrário).
alter table inbox_conversation_events add column if not exists attendance_id text;
alter table inbox_conversation_events add column if not exists contact_id text;
alter table inbox_conversation_events add column if not exists from_phase_id text;
alter table inbox_conversation_events add column if not exists to_phase_id text;
alter table inbox_conversation_events add column if not exists closure_type_id text;
alter table inbox_conversation_events add column if not exists closure_subtype_id text;
alter table inbox_conversation_events add column if not exists reason text;
create index if not exists inbox_conversation_events_attendance_idx on inbox_conversation_events (attendance_id, created_at) where attendance_id is not null;
create index if not exists inbox_conversation_events_workspace_type_idx on inbox_conversation_events (workspace_id, type, created_at);

alter table inbox_conversation_events drop constraint if exists inbox_conversation_events_type_check;
alter table inbox_conversation_events add constraint inbox_conversation_events_type_check
  check (type in (
    'assigned', 'unassigned', 'took_over', 'transferred', 'status_changed', 'ai_paused', 'ai_resumed',
    'ai_response_sent', 'ai_response_failed', 'ai_response_cancelled', 'ai_response_skipped_insufficient_credits',
    'kanban_phase_changed', 'note_added', 'csat_answered', 'away_message_sent', 'triage_completed', 'triage_skipped',
    'attendance_opened', 'attendance_closed', 'attendance_reopened', 'csat_sent', 'csat_not_sent'
  ));

-- Configuração POR CANAL: pesquisa ao finalizar e quem recebe um atendimento novo depois de um
-- finalizado. Backfill da pesquisa a partir da regra antiga (por workspace) preserva o comportamento.
alter table messaging_connections add column if not exists csat_on_close boolean not null default false;
alter table messaging_connections add column if not exists new_attendance_assignment text not null default 'last_assignee';
alter table messaging_connections drop constraint if exists messaging_connections_new_attendance_assignment_check;
alter table messaging_connections add constraint messaging_connections_new_attendance_assignment_check
  check (new_attendance_assignment in ('last_assignee', 'redistribute'));
update messaging_connections c set csat_on_close = true
  from inbox_service_settings s
  where s.workspace_id = c.workspace_id and s.csat_enabled = true and c.csat_on_close = false;

-- Backfill: toda conversa em atendimento hoje ganha um atendimento aberto (e o ciclo do
-- responsável atual), mantendo a invariante "conversa aberta ⇔ exatamente um atendimento aberto".
insert into inbox_attendances (id, tenant_id, workspace_id, conversation_id, contact_id, connection_id, team_id, number, status, opened_at, opened_by, open_reason, distribution_rule, initial_assignee_user_id)
select 'attn-mig-' || c.id, c.tenant_id, c.workspace_id, c.id, c.contact_id, c.connection_id, c.current_team_id,
       row_number() over (partition by c.workspace_id order by c.created_at, c.id),
       'open', now(), 'system', 'migration', case when c.assigned_user_id is not null then 'last_assignee' else 'queue' end, c.assigned_user_id
from inbox_conversations c
where c.status in ('open', 'pending') and c.merge_status is null
  and not exists (select 1 from inbox_attendances a where a.conversation_id = c.id and a.status = 'open');

insert into inbox_attendance_assignments (id, tenant_id, workspace_id, attendance_id, conversation_id, user_id, team_id, source, assigned_by, started_at)
select 'attnasg-mig-' || a.id, a.tenant_id, a.workspace_id, a.id, a.conversation_id, a.initial_assignee_user_id, a.team_id, 'migration', 'system', a.opened_at
from inbox_attendances a
where a.open_reason = 'migration' and a.initial_assignee_user_id is not null
  and not exists (select 1 from inbox_attendance_assignments x where x.attendance_id = a.id);
