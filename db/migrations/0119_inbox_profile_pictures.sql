-- 0119 — Módulo Conversas: foto de perfil (contato) e foto de grupo, pedidas explicitamente pelo
-- usuário em produção ("ajustar para carregar as fotos dos grupos e conversas"). Mesmo padrão de
-- `inbox_messages.media_storage_ref` (0083) — nunca a URL bruta do WhatsApp, sempre um ref pro
-- InboxMediaStoragePort, servido de volta só pelo proxy autenticado do Vorix.

alter table inbox_contacts
  add column if not exists profile_picture_storage_ref jsonb,
  add column if not exists profile_picture_synced_at timestamptz;

alter table inbox_conversations
  add column if not exists group_picture_storage_ref jsonb,
  add column if not exists group_picture_synced_at timestamptz;
