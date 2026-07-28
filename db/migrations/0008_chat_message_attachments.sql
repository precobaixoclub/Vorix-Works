-- Anexo de uma mensagem de chat. Mesma regra de storage_ref das demais tabelas: nunca segredo,
-- só referência durável.
create table chat_message_attachments (
  id           text primary key,
  message_id   text not null references chat_messages (id) on delete cascade,
  kind         text not null,
  name         text not null,
  storage_ref  jsonb,

  constraint chat_message_attachments_kind_check check (kind in ('image', 'video', 'document', 'audio'))
);

-- Consulta principal: carregar os anexos de uma mensagem (reconstrução do agregado ChatSession).
create index chat_message_attachments_message_id_idx on chat_message_attachments (message_id);
