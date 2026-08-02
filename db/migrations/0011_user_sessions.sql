-- Um "episódio" de login contínuo. Revogar aqui derruba todos os refresh_tokens da sessão
-- (ver 0012_refresh_tokens.sql) — é assim que "sair" e "sair de todos os lugares" funcionam.
create table user_sessions (
  id                 text primary key,
  user_id            text not null references users (id) on delete cascade,
  -- Tenant "ativo" desta sessão — sem FK (Tenant não vive em Postgres, ver tenant_members).
  -- Atualizado pelo Tenant Switcher (Fase 6); é o que o próximo refresh usa para reemitir o token.
  active_tenant_id   text not null,
  created_at         timestamptz not null,
  last_used_at       timestamptz not null,
  revoked_at         timestamptz,
  user_agent         text,
  ip_address         text
);

-- Consulta principal: sessões de um usuário (logout de todos os dispositivos, auditoria).
create index user_sessions_user_id_idx on user_sessions (user_id);
