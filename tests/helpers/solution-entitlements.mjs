/**
 * Concede o acesso INTERNO ao Vorix Marketing a um tenant de teste — o mesmo registro que o
 * administrador da plataforma cria por `PUT /v1/admin/tenants/:tenantId/solutions/marketing`.
 *
 * As rotas do Marketing (criação, briefing, planning, runtime, execução, publicação...) só
 * respondem a tenants com esse entitlement; sem ele a API devolve 403 `SOLUTION_ACCESS_DENIED`
 * (coberto em `tests/solutions.test.mjs`). Testes que exercitam o Marketing em si usam este helper.
 */
export async function grantInternalMarketing(pool, tenantId) {
  await pool.query(
    `insert into solution_entitlements (tenant_id, solution_key, enabled, source, reason)
     values ($1, 'marketing', true, 'internal', 'teste automatizado')
     on conflict (tenant_id, solution_key) do update set enabled = true, source = 'internal'`,
    [tenantId],
  );
}
