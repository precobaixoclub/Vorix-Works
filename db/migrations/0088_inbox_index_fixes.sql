-- 0088 — Módulo Conversas, Fase 7 (Hardening). Dois gaps estruturais de índice encontrados na
-- auditoria da fase (evidência estrutural — não "por precaução"):
--
-- 1) `listByWorkspace` (Inbox) ordena por `coalesce(last_message_at, created_at) desc`, mas o
--    índice existente (0082) é só sobre `last_message_at` puro — Postgres não usa um índice de
--    coluna simples para satisfazer ORDER BY sobre uma expressão `coalesce(...)` em cima dela.
--    Índice funcional casando EXATAMENTE a expressão usada na query.
-- 2) O drenador de IA (`listUnansweredInboundByConversation`, Fase 5/6) busca mensagens com
--    `ai_claim_status is null OR (ai_claim_status = 'processing' AND ai_claimed_at < staleBefore)`
--    — o índice parcial de 0085 só cobre a metade `is null`; a metade "claim expirado" (adicionada
--    na Fase 6 para recuperação de lease) nunca tinha índice nenhum. Segundo índice parcial
--    cobrindo especificamente essa metade.
create index if not exists inbox_conversations_workspace_activity_expr_idx
  on inbox_conversations (tenant_id, workspace_id, (coalesce(last_message_at, created_at)) desc);

create index if not exists inbox_messages_stale_processing_claim_idx
  on inbox_messages (conversation_id, ai_claimed_at)
  where direction = 'inbound' and ai_claim_status = 'processing';
