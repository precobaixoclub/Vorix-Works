-- 0120 — Módulo Conversas: retry de download de mídia (pedido explícito do usuário: "mensagens...
-- só informação de mídia recebida e que não carregou dentro do sistema"). Antes desta migration, o
-- ref bruto (url/directPath/mediaKey/etc.) usado pra baixar a mídia só existia na memória do worker
-- durante a UNICA tentativa (`downloadInboundMediaAndAttach`) — se falhasse (rede instável, WuzAPI
-- reiniciando no meio), o ref era perdido pra sempre e a mensagem ficava com media_storage_ref nulo
-- pra sempre, sem nenhuma chance de reprocessar depois.

alter table inbox_messages
  add column if not exists media_source_ref jsonb;
