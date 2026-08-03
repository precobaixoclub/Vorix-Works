-- 0053 — Backend real do Secret Manager operacional em produção.
-- Substitui o stub fail-closed: os valores são gravados CRIPTOGRAFADOS (AES-256-GCM com chave
-- derivada de JWT_SECRET, mesmo esquema de platform_ai_settings) — nunca em texto puro.

create table if not exists operational_secrets (
  reference text primary key,
  ciphertext text not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
