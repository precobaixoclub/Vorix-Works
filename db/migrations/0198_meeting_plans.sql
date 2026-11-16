-- 0198 — Planos de gravação de reuniões (franquia de horas por ciclo). Só aditiva: nenhuma tabela
-- existente é alterada. Regras em `src/domain/meetings/meeting-plans.model.ts`.

-- Estado ATUAL do plano de gravação de cada tenant (uma linha por tenant). `trial_started_at` é a
-- marca permanente de "teste já usado" (um teste por organização) — nunca é zerada.
create table if not exists meeting_plan_subscriptions (
  tenant_id             text primary key,
  plan_code             text not null check (plan_code in ('trial', 'individual', 'professional', 'teams')),
  status                text not null check (status in ('trial', 'active', 'past_due', 'canceled', 'expired')),
  current_period_start  timestamptz not null,
  current_period_end    timestamptz not null,
  cancel_at_period_end  boolean not null default false,
  pending_plan_code     text check (pending_plan_code in ('individual', 'professional', 'teams')),
  trial_started_at      timestamptz,
  canceled_at           timestamptz,
  ended_at              timestamptz,
  export_until          timestamptz,
  payment_failed_at     timestamptz,
  -- Quando a janela de exportação foi fechada (arquivos removidos + acesso encerrado).
  export_closed_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint meeting_plan_period_check check (current_period_end > current_period_start)
);

create index if not exists meeting_plan_subscriptions_live_idx
  on meeting_plan_subscriptions (current_period_end)
  where status in ('trial', 'active', 'past_due');

create index if not exists meeting_plan_subscriptions_export_idx
  on meeting_plan_subscriptions (export_until)
  where status in ('canceled', 'expired') and export_closed_at is null;

-- Trilha de auditoria de toda mudança de plano (quem, quando, de onde para onde).
create table if not exists meeting_plan_events (
  id             text primary key,
  tenant_id      text not null,
  kind           text not null,
  plan_code      text not null,
  status         text not null,
  details        jsonb not null default '{}'::jsonb,
  actor_user_id  text,
  occurred_at    timestamptz not null default now()
);

create index if not exists meeting_plan_events_tenant_idx on meeting_plan_events (tenant_id, occurred_at desc);

-- Avisos de exclusão já enviados (15 e 3 dias antes) — nunca repetem.
create table if not exists meeting_retention_notices (
  recording_id  text not null,
  days_before   integer not null check (days_before > 0),
  tenant_id     text not null,
  notified_at   timestamptz not null default now(),
  primary key (recording_id, days_before)
);
