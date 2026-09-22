-- Tela de admin para credenciais do Mercado Pago — mesmo molde de `platform_ai_settings` (0052):
-- uma única linha "singleton" (não faz sentido duas configs globais coexistindo), segredos gravados
-- CRIPTOGRAFADOS (AES-256-GCM com chave derivada de JWT_SECRET), painel nunca exibe em claro, só os
-- últimos 4 caracteres. `mercadopago_notification_url` não é sensível, fica em texto plano.
--
-- Escopo desta tabela é só CREDENCIAIS do Mercado Pago — qual provider está ATIVO continua sendo
-- BILLING_PROVIDER_ENABLED/BILLING_PROVIDER (env + deploy), decisão explícita do usuário.

create table if not exists billing_provider_settings (
  id text primary key default 'singleton' check (id = 'singleton'),
  mercadopago_access_token_encrypted text,
  mercadopago_access_token_last4 text,
  mercadopago_webhook_secret_encrypted text,
  mercadopago_webhook_secret_last4 text,
  mercadopago_notification_url text,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into billing_provider_settings (id) values ('singleton') on conflict (id) do nothing;
