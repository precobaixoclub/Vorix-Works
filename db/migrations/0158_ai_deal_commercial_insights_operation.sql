-- 0158 — Sales Engine (fase 10): registra a operação `deal_commercial_insights` no catálogo do AI
-- Gateway (mesmo padrão da 0100). Gerada só sob demanda (botão do vendedor), 1 crédito por análise.

insert into ai_operation_types (code, label, capability, credits_cost, default_provider_code, default_model_id)
values ('deal_commercial_insights', 'IA Comercial — resumo, riscos e próximas ações da oportunidade', 'text_generation', 1, 'anthropic', 'claude-haiku-4-5-20251001')
on conflict (code) do nothing;
