-- 0163 — Decisão comercial: contatos, armazenamento e automações são ilimitados em todos os planos
-- (sem cobrança extra — o uso de IA já é cobrado em créditos). O que o plano limita/cobra passa a
-- ser só usuários, números de WhatsApp, workspaces e a cota mensal de créditos de IA (mais a
-- recarga avulsa que o cliente escolher). `null` em `limits` = ilimitado.

update plan_versions
   set limits = limits || '{"contacts": null, "storage_mb": null, "automations": null}'::jsonb;

-- Adicionais pagos desses recursos (e o pacote mensal de créditos, substituído pela recarga avulsa
-- de quantidade livre) saem da venda. Itens já contratados não são apagados.
update addon_definitions
   set active = false
 where resource in ('contacts', 'storage_mb', 'automations')
    or code = 'extra_ai_credits_1000';
