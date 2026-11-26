-- Marketing › Criar vídeo com IA (motor de vídeo, arquitetura B: IA + FFmpeg).
-- Projeto = materiais + configurações; versão = um pedido (criação ou alteração por conversa) com
-- seu plano, render e Quality Gate. A FILA são as próprias versões (status 'queued'), reservadas
-- pelo worker de vídeo com FOR UPDATE SKIP LOCKED e lease renovado por heartbeat (mesmo padrão de
-- meeting_jobs). Nada aqui roda na API.

create table if not exists video_projects (
  id            text primary key,
  tenant_id     text not null,
  workspace_id  text not null,
  title         text not null,
  mode          text not null check (mode in ('edit_footage', 'images_ad')),
  aspect        text not null check (aspect in ('9:16', '1:1', '16:9')),
  -- duração desejada, estilo de edição, intensidade das transições, legendas, trilha
  settings      jsonb not null default '{}'::jsonb,
  -- [{ id, objectKey, kind, role, label, contentType }] — sempre chaves do próprio workspace
  materials     jsonb not null default '[]'::jsonb,
  -- cache da transcrição por material (evita transcrever de novo a cada alteração)
  transcripts   jsonb not null default '{}'::jsonb,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists video_projects_workspace_idx on video_projects (tenant_id, workspace_id, created_at desc);

create table if not exists video_versions (
  id                 text primary key,
  project_id         text not null references video_projects (id) on delete cascade,
  tenant_id          text not null,
  workspace_id       text not null,
  number             integer not null,
  parent_version_id  text,
  request            text not null,
  status             text not null default 'queued' check (status in ('queued', 'planning', 'rendering', 'verifying', 'ready_for_review', 'needs_revision', 'approved', 'failed', 'cancelled')),
  stage              text,
  progress           integer not null default 0 check (progress between 0 and 100),
  message            text,
  draft              jsonb,
  plan               jsonb,
  gate               jsonb,
  warnings           jsonb not null default '[]'::jsonb,
  usage              jsonb,
  error              text,
  output_key         text,
  poster_key         text,
  output_size_bytes  bigint,
  render_ms          integer,
  attempts           integer not null default 0,
  max_attempts       integer not null default 2,
  locked_by          text,
  locked_until       timestamptz,
  cancel_requested   boolean not null default false,
  created_by         text,
  approved_by        text,
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, number)
);
create index if not exists video_versions_queue_idx on video_versions (created_at) where status = 'queued';
create index if not exists video_versions_active_idx on video_versions (locked_until) where status in ('planning', 'rendering', 'verifying');
create index if not exists video_versions_project_idx on video_versions (project_id, number desc);
create index if not exists video_versions_workspace_day_idx on video_versions (tenant_id, workspace_id, created_at desc);
