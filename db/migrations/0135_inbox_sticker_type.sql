-- Bloco "figurinhas" (pedido explícito do usuário em produção, com print: "quando é figurinha
-- esta ficando como mídia recebida... preciso conseguir ver, salvar e ainda enviar quando
-- necessário") — `inbox_messages.type` tinha um CHECK fixo (migration 0083) sem 'sticker', então
-- toda figurinha recebida caía classificada como 'other' no banco, virando a bolha genérica
-- "Mídia recebida" no frontend (nenhum campo de mídia era extraído/baixado). Aditiva: só adiciona
-- 'sticker' ao allowlist existente, nunca remove/renomeia nenhum valor já em uso.

alter table inbox_messages drop constraint if exists inbox_messages_type_check;
alter table inbox_messages add constraint inbox_messages_type_check
  check (type in ('text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'sticker', 'other'));
