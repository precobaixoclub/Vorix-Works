-- 0143 — Entitlement por SOLUÇÃO (Vorix como plataforma: Core + Conversas + Marketing + futuras).
-- Só aditiva e idempotente: nenhuma tabela/coluna existente é alterada, nada é apagado. Todo o
-- Vorix Marketing (Creative Engine, biblioteca, brand profile, publicações...) continua intacto —
-- esta migration só registra QUEM tem acesso a cada solução.
--
-- Uma linha aqui é o ENTITLEMENT explícito de um tenant para uma solução. Sem linha, vale o
-- default da solução (definido em `domain/solutions/solution.model.ts`): Conversas habilitado,
-- Marketing desabilitado. Não é RBAC, não é feature flag e não é kill switch — cada um continua
-- no seu lugar.

create table if not exists solution_entitlements (
  tenant_id     text not null,
  -- Texto livre de propósito (sem CHECK de vocabulário): uma nova solução entra só com código +
  -- linhas novas, sem migration de constraint.
  solution_key  text not null,
  enabled       boolean not null default false,
  -- 'subscription' = veio de contratação · 'manual' = ajuste administrativo de solução pública
  -- 'internal' = desenvolvimento/homologação/testes (único tipo aceito para solução não comercial)
  source        text not null default 'manual' check (source in ('subscription', 'internal', 'manual')),
  reason        text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, solution_key)
);

create index if not exists solution_entitlements_enabled_idx
  on solution_entitlements (solution_key, tenant_id)
  where enabled;

create table if not exists solution_entitlement_audit_log (
  id             text primary key,
  tenant_id      text not null,
  solution_key   text not null,
  old_enabled    boolean,
  new_enabled    boolean not null,
  source         text not null,
  actor_user_id  text,
  reason         text,
  occurred_at    timestamptz not null default now()
);

create index if not exists solution_entitlement_audit_tenant_idx
  on solution_entitlement_audit_log (tenant_id, occurred_at desc);

-- Preserva o acesso INTERNO ao Marketing de quem já o usa hoje: todo tenant que tem ao menos um
-- workspace com o Creative Engine habilitado (0141 — concessão já feita caso a caso, fail-closed)
-- recebe a concessão interna do Vorix Marketing. Ninguém mais ganha Marketing por esta migration.
insert into solution_entitlements (tenant_id, solution_key, enabled, source, reason, updated_by)
select distinct cee.tenant_id, 'marketing', true, 'internal',
       'Acesso interno preservado na separação de soluções (workspace com Creative Engine habilitado)', 'migration-0143'
from creative_engine_workspace_entitlements cee
where cee.enabled
on conflict (tenant_id, solution_key) do nothing;
