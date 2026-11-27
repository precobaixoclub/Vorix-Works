-- Registro de cada geração de movimento por IA (motor híbrido de vídeos): custo estimado antes de gerar,
-- limite mensal por workspace, clipe armazenado, verificação de fidelidade e decisão (aprovado/reprovado).
create table if not exists video_motion_generations (
  id                 text primary key,
  tenant_id          text not null,
  workspace_id       text not null,
  provider           text not null,
  model              text not null,
  source_object_key  text not null,
  source_sha256      text not null,
  prompt             text not null,
  seconds            numeric not null,
  estimated_usd      numeric not null,
  status             text not null check (status in ('blocked_budget', 'blocked_disabled', 'submitted', 'failed', 'generated', 'approved', 'rejected')),
  provider_job_id    text,
  clip_object_key    text,
  clip_sha256        text,
  fidelity           jsonb,
  review             jsonb,
  error              text,
  origin             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists video_motion_generations_budget_idx on video_motion_generations (workspace_id, created_at) where status not in ('blocked_budget', 'blocked_disabled');
