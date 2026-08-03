-- 0052 — Configuração global do AI Gateway gerenciável pelo painel admin.
-- Uma única linha "singleton" — não faz sentido duas configs globais coexistindo.
-- A API key da Anthropic é gravada CRIPTOGRAFADA (AES-256-GCM com chave derivada de JWT_SECRET) —
-- o painel nunca exibe a chave em claro, só os últimos 4 caracteres.

create table if not exists platform_ai_settings (
  id text primary key default 'singleton' check (id = 'singleton'),
  gateway_enabled boolean not null default false,
  briefing_extraction_enabled boolean not null default false,
  anthropic_api_key_encrypted text,
  anthropic_api_key_last4 text,
  anthropic_briefing_extraction_model text not null default 'claude-haiku-4-5-20251001',
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into platform_ai_settings (id) values ('singleton') on conflict (id) do nothing;
