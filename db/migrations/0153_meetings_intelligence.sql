-- Vorix Meetings — inteligência e colaboração: modelo de resumo, nomes dos falantes, "pergunte à
-- reunião", follow-up, vínculo com o CRM, compartilhamento por link, trechos, comentários,
-- palavras monitoradas, preferências de gravação automática e aviso de gravação.
-- Ver src/domain/meetings/meeting-intelligence.ts e src/application/meetings/meeting-intelligence.ts.

create table if not exists meeting_insights (
  meeting_id            text primary key references meetings (id) on delete cascade,
  tenant_id             text not null,
  workspace_id          text not null,
  summary_template      text not null default 'general',
  crm_contact_id        text,
  crm_deal_id           text,
  follow_up             jsonb,
  follow_up_generated_at timestamptz,
  updated_at            timestamptz not null default now()
);

create table if not exists meeting_speaker_names (
  meeting_id    text not null references meetings (id) on delete cascade,
  tenant_id     text not null,
  speaker_key   text not null,
  display_name  text not null,
  updated_by    text,
  updated_at    timestamptz not null default now(),
  primary key (meeting_id, speaker_key)
);

create table if not exists meeting_questions (
  id               text primary key,
  tenant_id        text not null,
  workspace_id     text not null,
  meeting_id       text references meetings (id) on delete cascade,
  user_id          text not null,
  question         text not null,
  answer           jsonb not null,
  credits_charged  integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists meeting_questions_meeting_idx on meeting_questions (meeting_id, created_at desc);
create index if not exists meeting_questions_user_idx on meeting_questions (tenant_id, user_id, created_at desc);

create table if not exists meeting_shares (
  id                  text primary key,
  tenant_id           text not null,
  workspace_id        text not null,
  meeting_id          text not null references meetings (id) on delete cascade,
  token_hash          text not null unique,
  include_transcript  boolean not null default true,
  include_recording   boolean not null default false,
  expires_at          timestamptz,
  revoked_at          timestamptz,
  created_by          text not null,
  view_count          integer not null default 0,
  last_viewed_at      timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists meeting_shares_meeting_idx on meeting_shares (meeting_id, created_at desc);

create table if not exists meeting_clips (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null,
  meeting_id   text not null references meetings (id) on delete cascade,
  start_ms     integer not null check (start_ms >= 0),
  end_ms       integer not null check (end_ms > start_ms),
  title        text not null,
  note         text,
  created_by   text not null,
  created_at   timestamptz not null default now()
);
create index if not exists meeting_clips_meeting_idx on meeting_clips (meeting_id, start_ms);

create table if not exists meeting_comments (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null,
  meeting_id   text not null references meetings (id) on delete cascade,
  at_ms        integer check (at_ms is null or at_ms >= 0),
  text         text not null,
  user_id      text not null,
  created_at   timestamptz not null default now()
);
create index if not exists meeting_comments_meeting_idx on meeting_comments (meeting_id, created_at);

create table if not exists meeting_keyword_trackers (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  label        text not null,
  terms        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);
create unique index if not exists meeting_keyword_trackers_label_idx on meeting_keyword_trackers (workspace_id, lower(label));

create table if not exists meeting_user_preferences (
  tenant_id         text not null,
  user_id           text not null,
  auto_record_mode  text not null default 'off' check (auto_record_mode in ('off', 'all', 'external_only')),
  default_template  text not null default 'general',
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table if not exists meeting_tenant_settings (
  tenant_id               text primary key,
  consent_notice_enabled  boolean not null default true,
  consent_message         text not null default 'Olá! Esta reunião está sendo gravada e transcrita pelo Vorix para registro e geração de resumo. Se não concordar, avise o organizador.',
  updated_at              timestamptz not null default now()
);

alter table meeting_action_items add column if not exists crm_task_id text;

insert into ai_operation_types (code, label, capability, credits_cost, default_provider_code, default_model_id)
values
  ('meeting_question_answer', 'Vorix Meetings — pergunte à reunião', 'text_generation', 1, 'anthropic', 'claude-haiku-4-5-20251001'),
  ('meeting_follow_up', 'Vorix Meetings — follow-up por e-mail e WhatsApp', 'text_generation', 1, 'anthropic', 'claude-haiku-4-5-20251001')
on conflict (code) do nothing;

-- Importação da transcrição NATIVA do Google Meet (sem robô): controle de tentativas do agendador.
create table if not exists meeting_native_imports (
  meeting_id       text primary key references meetings (id) on delete cascade,
  tenant_id        text not null,
  attempts         integer not null default 0,
  status           text not null,
  last_error       text,
  last_attempt_at  timestamptz not null default now()
);

-- Gravações importadas de outras plataformas (Zoom): evita importar a mesma duas vezes.
create table if not exists meeting_external_imports (
  tenant_id    text not null,
  provider     text not null check (provider in ('zoom', 'google_meet')),
  external_id  text not null,
  -- Sem FK: a reserva é gravada ANTES de a reunião existir (evita importação duplicada).
  meeting_id   text not null,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, provider, external_id)
);
