-- Auditoria de identidade (Fase 7) — "apenas estrutura": grava o evento, sem consulta/dashboard.
-- Sem FK em user_id/tenant_id/session_id de propósito: uma trilha de auditoria precisa sobreviver
-- mesmo que o usuário/sessão referenciado seja apagado depois — nunca pode ser bloqueada ou
-- cascateada por uma exclusão futura.
create table auth_audit_log (
  id           text primary key,
  event_type   text not null,
  user_id      text,
  tenant_id    text,
  session_id   text,
  metadata     jsonb,
  created_at   timestamptz not null,

  constraint auth_audit_log_event_type_check check (event_type in (
    'login_success', 'login_failed', 'logout', 'refresh_success', 'refresh_replay_detected', 'tenant_switch'
  ))
);

-- Consulta mais provável numa investigação: histórico de um usuário em ordem cronológica.
create index auth_audit_log_user_id_created_at_idx on auth_audit_log (user_id, created_at);
