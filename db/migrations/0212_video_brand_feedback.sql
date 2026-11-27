-- 0212 — Gosto da marca em vídeo: avaliações HUMANAS por versão (aprovação editorial e reprovações com
-- motivo). O Quality Gate técnico segue verificando integridade; o padrão comercial só é declarado por
-- pessoa. Os padrões reprovados/preferidos orientam o diretor criativo e a seleção de propostas.

create table if not exists video_brand_feedback (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null,
  project_id   text,
  version_id   text,
  verdict      text not null check (verdict in ('approved', 'rejected')),
  -- vocabulário de `VIDEO_TASTE_PATTERNS` (domain/video-editing/brand-video-taste.ts)
  patterns     jsonb not null default '[]'::jsonb,
  note         text,
  reviewer_id  text not null,
  created_at   timestamptz not null default now()
);
create index if not exists video_brand_feedback_workspace_idx on video_brand_feedback (tenant_id, workspace_id, created_at desc);
create index if not exists video_brand_feedback_version_idx on video_brand_feedback (version_id);
