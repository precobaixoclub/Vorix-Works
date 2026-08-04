-- 0054 — Registro de Provedores de IA + sistema de créditos Vorix (substitui cota proporcional a
-- tokens por crédito fixo por funcionalidade, admin-configurável). Três responsabilidades novas:
--   1. Cadastro de provedores/modelos de IA (ai_providers, ai_provider_models) — módulo admin
--      "Provedores de IA". Anthropic entra como linha "externally_managed" (chave/roteamento
--      continuam em platform_ai_settings, sem mudança de comportamento); OpenAI (imagem) e Google
--      (Gemini/Veo, vídeo) entram desabilitados até o admin configurar a API key.
--   2. Catálogo de operações que consomem crédito (ai_operation_types) — "quanto custa em crédito
--      fazer X", 100% editável pelo admin.
--   3. Ledger de geração (ai_generation_ledger) — uma linha por geração de IA (texto/imagem/vídeo),
--      com provedor/modelo usado, créditos consumidos, custo real e receita estimada — auditoria
--      financeira completa.
--
-- Também migra tenant_billing/tenant_credit_ledger de "tokens" para "créditos Vorix" (unidade
-- abstrata e fixa por operação, nunca proporcional a token/segundo real gasto no provider).

-- 1) Cadastro de provedores.
create table ai_providers (
  code                text        primary key,
  display_name        text        not null,
  capabilities         jsonb       not null default '[]'::jsonb,
  status               text        not null default 'disabled',
  externally_managed   boolean     not null default false,
  secret_reference     text,
  base_url             text,
  default_params       jsonb       not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           text,

  constraint ai_providers_status_check check (status in ('active', 'disabled'))
);

insert into ai_providers (code, display_name, capabilities, status, externally_managed) values
  ('anthropic', 'Anthropic (Claude)', '["text_generation"]'::jsonb, 'active', true),
  ('openai', 'OpenAI (imagem)', '["image_generation"]'::jsonb, 'disabled', false),
  ('google', 'Google Gemini/Veo (vídeo)', '["video_generation"]'::jsonb, 'disabled', false);

-- 2) Modelos de cada provedor — preço real (USD) por unidade, nunca exibido ao cliente final.
create table ai_provider_models (
  id                   text        primary key,
  provider_code        text        not null references ai_providers(code) on delete cascade,
  model_id             text        not null,
  capability           text        not null,
  active               boolean     not null default true,
  pricing              jsonb       not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint ai_provider_models_capability_check
    check (capability in ('text_generation', 'image_generation', 'video_generation')),
  constraint ai_provider_models_unique unique (provider_code, model_id)
);

insert into ai_provider_models (id, provider_code, model_id, capability, active, pricing) values
  ('model-openai-gpt-image-1', 'openai', 'gpt-image-1', 'image_generation', true,
    '{"kind":"per_image","usdPerImage":0.04}'::jsonb),
  ('model-google-veo-3', 'google', 'veo-3', 'video_generation', true,
    '{"kind":"per_video_second","usdPerSecond":0.35}'::jsonb);

-- 3) Catálogo de operações que consomem crédito. `credits_cost` é o único número que o admin
-- precisa mexer para "quanto custa fazer X" — nunca espalhado em código.
create table ai_operation_types (
  code                  text        primary key,
  label                 text        not null,
  capability            text        not null,
  credits_cost          integer     not null default 1,
  default_provider_code text        references ai_providers(code),
  default_model_id      text,
  active                boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint ai_operation_types_capability_check
    check (capability in ('text_generation', 'image_generation', 'video_generation')),
  constraint ai_operation_types_credits_check check (credits_cost >= 0)
);

insert into ai_operation_types (code, label, capability, credits_cost, default_provider_code, default_model_id) values
  ('briefing_field_extraction', 'Extração de campos do briefing (chat)', 'text_generation', 1, 'anthropic', 'claude-haiku-4-5-20251001'),
  ('image_generation', 'Geração de imagem', 'image_generation', 2, 'openai', 'gpt-image-1'),
  ('video_generation', 'Geração de vídeo curto', 'video_generation', 20, 'google', 'veo-3');

-- 4) Ledger de geração — auditoria financeira granular, uma linha por chamada de IA.
create table ai_generation_ledger (
  id                     text        primary key,
  tenant_id              text        not null,
  workspace_id           text,
  operation_type_code    text        not null references ai_operation_types(code),
  provider_code          text        not null references ai_providers(code),
  model_id               text        not null,
  credits_consumed       integer     not null default 0,
  provider_cost_usd      numeric(14,6) not null default 0,
  estimated_revenue_usd  numeric(14,6) not null default 0,
  status                 text        not null default 'success',
  error_code             text,
  requested_by_user_id   text references users(id) on delete set null,
  occurred_at            timestamptz not null default now(),
  metadata               jsonb       not null default '{}'::jsonb,

  constraint ai_generation_ledger_status_check check (status in ('success', 'failed'))
);

create index ai_generation_ledger_tenant_period_idx
  on ai_generation_ledger (tenant_id, occurred_at desc);

create index ai_generation_ledger_provider_period_idx
  on ai_generation_ledger (provider_code, occurred_at desc);

-- 5) platform_ai_settings ganha o parâmetro de conversão crédito → USD (só para estimativa de
-- receita no painel financeiro — não é preço real cobrado, não existe gateway de pagamento ainda).
alter table platform_ai_settings add column credit_unit_value_usd numeric(10,6) not null default 0.05;

-- 6) tenant_ai_usage_monthly ganha o total de créditos consumidos no período (soma texto+imagem+
-- vídeo) — usado para exibir "quanto da cota mensal já foi usado" sem precisar agregar o ledger
-- inteiro toda hora.
alter table tenant_ai_usage_monthly add column credits_consumed bigint not null default 0;

-- 7) tenant_billing e tenant_credit_ledger: "tokens" → "créditos Vorix". As cotas antigas (em
-- tokens Anthropic, ex. 100000/1500000/...) não fazem sentido como número de créditos (que agora
-- custam 1/2/20 por operação) — recalibra para os novos valores do catálogo de planos.
alter table tenant_billing rename column monthly_token_quota to monthly_credits_quota;
alter table tenant_billing rename column credits_extra_tokens to credits_extra;
alter table tenant_credit_ledger rename column delta_tokens to delta_credits;

update tenant_billing set monthly_credits_quota = case plan_code
  when 'FREE' then 50
  when 'START' then 500
  when 'PRO' then 2500
  when 'BUSINESS' then 10000
  when 'ENTERPRISE' then 999999999
  else 50
end;
