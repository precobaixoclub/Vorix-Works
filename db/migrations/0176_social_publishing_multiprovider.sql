-- Social Publishing multiprovider (Vorix Marketing): conta social, conexões por provider, política de
-- provider por tenant, chaves globais por provider, destinos por rede e log operacional.
-- Aditiva: não altera tabelas existentes. A publicação em si continua no domínio Publication
-- (plans/targets/outbox/attempts/receipts/reconciliations); estas tabelas guardam só o que é social.

-- Conta social: identidade lógica do perfil. O provider é só o mecanismo de transporte.
create table if not exists social_accounts (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  network text not null check (network in ('instagram','facebook','tiktok')),
  -- Último provider que atendeu a conta (diagnóstico); a escolha vem da política do tenant.
  provider_type text not null,
  external_account_id text not null,
  username text,
  display_name text,
  avatar_url text,
  status text not null check (status in ('CONNECTED','HEALTHY','REAUTH_REQUIRED','CHECKPOINT_REQUIRED','DISCONNECTED','TEMPORARY_ERROR','DISABLED')),
  account_capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  consecutive_failures integer not null default 0,
  connected_at timestamptz,
  last_health_check_at timestamptz,
  last_successful_publish_at timestamptz,
  reauth_required_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, network, external_account_id)
);
create index if not exists social_accounts_scope on social_accounts (tenant_id, workspace_id, network);
create index if not exists social_accounts_health_due on social_accounts (last_health_check_at) where status in ('CONNECTED','HEALTHY','TEMPORARY_ERROR');

-- Conexão da conta com UM provider. O segredo (token) fica no cofre central cifrado; aqui só a
-- referência da credencial. Várias conexões por conta = troca de provider sem duplicar a conta.
create table if not exists social_account_connections (
  social_account_id text not null references social_accounts(id) on delete cascade,
  tenant_id text not null,
  provider_type text not null,
  credential_reference_id text not null,
  status text not null check (status in ('active','revoked','expired')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (social_account_id, provider_type)
);
create index if not exists social_account_connections_credential on social_account_connections (tenant_id, credential_reference_id);

-- Política por tenant e rede. Ausência de linha = padrão: publicação social DESLIGADA.
create table if not exists social_provider_policies (
  tenant_id text not null,
  network text not null check (network in ('instagram','facebook','tiktok')),
  publishing_enabled boolean not null default false,
  preferred_provider text not null,
  enabled_providers text[] not null default '{}',
  late_policy jsonb not null default '{}'::jsonb,
  rate_limits jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, network)
);

-- Kill switch e homologação por provider (plataforma). Ausência de linha = padrão do ambiente (OFF).
create table if not exists social_provider_switches (
  provider_type text primary key,
  enabled boolean not null,
  approved boolean not null,
  reason text,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Destino de publicação (um por rede/conta), ligado 1:1 a um publication_target.
create table if not exists social_post_destinations (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  publication_id text not null references publication_plans(id),
  target_id text not null unique references publication_targets(id),
  social_account_id text not null references social_accounts(id),
  network text not null check (network in ('instagram','facebook','tiktok')),
  format text not null check (format in ('feed_image','feed_video','carousel','story_image','story_video','reel','short_video','photo_post')),
  caption text not null default '',
  hashtags text[] not null default '{}',
  -- Música nativa da plataforma (quando algum provider oferecer); áudio embutido fica na mídia.
  music jsonb,
  audio_mode text not null default 'NONE' check (audio_mode in ('NONE','NATIVE_PLATFORM_MUSIC','EMBEDDED_AUDIO')),
  media jsonb not null default '[]'::jsonb,
  scheduled_at timestamptz,
  timezone text,
  block_reason text check (block_reason in ('WAITING_REAUTH','AWAITING_CONFIRMATION','PROVIDER_DISABLED','ACCOUNT_BUSY','RATE_LIMITED')),
  blocked_at timestamptz,
  skipped_at timestamptz,
  last_provider_type text,
  last_error_code text,
  last_error_message text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_post_destinations_publication on social_post_destinations (publication_id);
create index if not exists social_post_destinations_account_blocked on social_post_destinations (social_account_id, block_reason) where block_reason is not null;
create index if not exists social_post_destinations_calendar on social_post_destinations (tenant_id, workspace_id, scheduled_at);

-- Uma linha por tentativa real de publicação: limites operacionais, métricas e custo por tenant.
create table if not exists social_publish_log (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  social_account_id text not null,
  publication_id text not null,
  target_id text not null,
  provider_type text not null,
  network text not null,
  format text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  outcome text check (outcome in ('published','failed','unknown','deferred')),
  error_code text,
  duration_ms integer,
  media_bytes bigint
);
create index if not exists social_publish_log_account_started on social_publish_log (social_account_id, started_at desc);
create index if not exists social_publish_log_tenant_started on social_publish_log (tenant_id, started_at desc);

-- Deduplicação de alertas (não bombardear o usuário com o mesmo aviso).
create table if not exists social_notification_dedupe (
  tenant_id text not null,
  dedupe_key text not null,
  last_sent_at timestamptz not null,
  primary key (tenant_id, dedupe_key)
);
