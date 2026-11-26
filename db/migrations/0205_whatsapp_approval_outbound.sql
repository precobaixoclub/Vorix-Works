-- Aprovação de publicações pelo WhatsApp (25/11/2026): ids das mensagens que o SISTEMA mandou ao aprovador
-- (pedido, imagens, confirmações). O eco dessas mensagens (fromMe) não entra nas Conversas — assim como as
-- respostas do aprovador também não entram. Só acréscimo.
create table if not exists whatsapp_approval_outbound (
  external_message_id text primary key,
  connection_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_approval_outbound_created_idx on whatsapp_approval_outbound (created_at);
