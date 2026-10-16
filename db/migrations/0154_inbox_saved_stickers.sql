-- Conversas: figurinhas salvas da equipe (como no WhatsApp). A figurinha recebida é COPIADA para o
-- armazenamento de mídia de conversas (chave própria), então continua disponível mesmo se a
-- conversa de origem for apagada. Mesma figurinha (mesmo conteúdo) não duplica no workspace.

create table if not exists inbox_saved_stickers (
  id            text primary key,
  tenant_id     text not null,
  workspace_id  text not null references workspaces (id) on delete cascade,
  object_key    text not null,
  mime_type     text not null,
  content_hash  text not null,
  size_bytes    integer not null,
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, content_hash)
);

create index if not exists inbox_saved_stickers_workspace_idx on inbox_saved_stickers (workspace_id, created_at desc);
