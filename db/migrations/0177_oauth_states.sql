-- Estado OAuth persistente e compartilhado entre instâncias da API (antes: Map em memória por
-- processo, que quebrava com restart, deploy ou load balancer entre o início e o callback).
-- Guarda só o HASH do state; uso único (consumed_at), expiração curta e vínculo tenant/usuário/provider.
create table if not exists oauth_states (
  state_hash text primary key,
  provider text not null,
  tenant_id text not null,
  workspace_id text not null,
  user_id text,
  network text,
  return_path text,
  -- Verificador PKCE: necessário para trocar o code; apagado no consumo.
  code_verifier text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists oauth_states_expires on oauth_states (expires_at);
