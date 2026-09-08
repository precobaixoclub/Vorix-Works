-- 0100 — CRM/Comercial, Fase 5: registra a operação `commercial_copilot_suggestions` no catálogo
-- do AI Gateway (mesmo padrão de `inbox_auto_reply`, migration 0086). Custo baixo (1 crédito) —
-- gera no máximo 5 sugestões por chamada, texto curto.

insert into ai_operation_types (code, label, capability, credits_cost, default_provider_code, default_model_id)
values ('commercial_copilot_suggestions', 'Copiloto Comercial — sugestões de próxima ação (CRM)', 'text_generation', 1, 'anthropic', 'claude-haiku-4-5-20251001')
on conflict (code) do nothing;
