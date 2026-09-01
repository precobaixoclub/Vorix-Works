-- 0087 — Módulo Conversas, Fase 7 (Hardening/Segurança). Idempotência FINANCEIRA forte para
-- cobrança de IA (não só o claim CAS operacional da Fase 5/6, que protege contra duas GERAÇÕES
-- concorrentes mas não contra o cenário "crédito debitado → processo morre antes de resolver o
-- claim → claim expira pelo lease (Fase 6) → mensagem é reprocessada → cobraria de novo").
--
-- `idempotency_key` é opcional (nullable) — MediaGenerationService (imagem/vídeo) continua
-- inserindo sem chave, comportamento IDÊNTICO ao de antes (múltiplos NULLs nunca colidem num
-- índice único). Só a Inbox (Fase 7) passa uma chave determinística
-- (`inbox_auto_reply:<inboundMessageId(s)>`) — nesse caso, uma segunda tentativa de cobrar a MESMA
-- chave é silenciosamente ignorada pelo `ON CONFLICT ... DO NOTHING`, e a camada de aplicação
-- (`CreditAccountingService.recordSuccess`) sabe não aplicar `addAiUsage`/`applyCreditDelta` de
-- novo quando isso acontece — nunca um ledger paralelo, a MESMA tabela `ai_generation_ledger`.
alter table ai_generation_ledger add column if not exists idempotency_key text;

create unique index if not exists ai_generation_ledger_idempotency_key_uidx
  on ai_generation_ledger (idempotency_key)
  where idempotency_key is not null;
