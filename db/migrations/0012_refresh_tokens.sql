-- Credencial opaca de longa duração, sempre armazenada como HASH (nunca o valor bruto — mesmo
-- raciocínio de senha). Rotacionada a cada uso: o token antigo ganha replaced_by_token_id e é
-- revogado; reaparecer com um token já revogado é tratado como replay (ver refresh.usecase.ts).
create table refresh_tokens (
  id                     text primary key,
  session_id             text not null references user_sessions (id) on delete cascade,
  user_id                text not null references users (id) on delete cascade,
  token_hash             text not null,
  created_at             timestamptz not null,
  expires_at             timestamptz not null,
  revoked_at             timestamptz,
  replaced_by_token_id   text references refresh_tokens (id)
);

-- Consulta principal do fluxo de refresh: encontrar o token pelo hash do valor recebido.
create unique index refresh_tokens_token_hash_uq on refresh_tokens (token_hash);

-- Revogar todos os tokens de uma sessão de uma vez (logout, replay detectado).
create index refresh_tokens_session_id_idx on refresh_tokens (session_id);
