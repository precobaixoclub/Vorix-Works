import type pg from "pg";
import { ensureDefaultPipeline } from "../../../application/crm/pipeline-use-cases.js";
import type { LoginUseCaseOutput } from "../../../application/identity/login.usecase.js";
import { signupPublic, type SignupPublicUseCaseInput } from "../../../application/identity/signup-public.usecase.js";
import type { JwtPort } from "../../../application/ports/jwt.port.js";
import type { PasswordHasherPort } from "../../../application/ports/password-hasher.port.js";
import { recordProductEvent, type ProductAnalyticsUseCaseDeps } from "../../../application/product-analytics/product-analytics-use-cases.js";
import { PostgresAuditLogRepository } from "./postgres-audit-log-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "./postgres-pipeline-repository.js";
import { PostgresPlatformBillingRepository } from "./postgres-platform-billing-repository.js";
import { PostgresRefreshTokenRepository } from "./postgres-refresh-token-repository.js";
import { PostgresSessionRepository } from "./postgres-session-repository.js";
import { PostgresTenantMembershipRepository } from "./postgres-tenant-membership-repository.js";
import { PostgresUserRepository } from "./postgres-user-repository.js";
import { PostgresWorkspaceRepository } from "./postgres-workspace-repository.js";

export type SignupPublicTransactionDeps = {
  passwordHasher: PasswordHasherPort;
  jwt: JwtPort;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  idGenerator: (prefix: string) => string;
  now?: () => Date;
  /** Trial + Product Analytics — integração MÍNIMA (só o registro do evento, nenhuma regra de
   * signup muda). `undefined` = Product Analytics não configurado, nunca bloqueia o signup. */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
};

/**
 * Envolve `signupPublic` numa transação real (`BEGIN`/`COMMIT`/`ROLLBACK`). `signupPublic` em si
 * continua agnóstico de Postgres/transação (só enxerga ports) — aqui construímos instâncias
 * TEMPORÁRIAS dos mesmos repositórios já existentes, todas ligadas a um único `PoolClient`
 * reservado (que expõe `.query()` com assinatura compatível com `Pool`, e nenhum dos métodos
 * chamados por `signupPublic`/`login` usa algo além de `.query()`), para que as 4 gravações
 * (User/Membership/Workspace/tenant_billing) + a sessão de login imediato sejam tudo-ou-nada.
 * Sem isto, uma falha no meio do fluxo (ex.: `tenant_billing` falhando após o Workspace já
 * existir) deixava um tenant órfão — risco que fica mais sério a partir do Checkout (Fase 2),
 * onde este mesmo caminho de provisionamento passa a ser acionado por webhooks de pagamento.
 *
 * Fase 5 (Onboarding) — logo após o Workspace nascer, provisiona o Pipeline padrão + etapas
 * (`ensureDefaultPipeline`, já existente desde o CRM/Comercial Fase 2 mas nunca antes acionado em
 * lugar nenhum) na MESMA transação: um tenant novo já abre o CRM com um funil de vendas pronto,
 * em vez de uma tela vazia. Reusa a entidade existente — não inventa um conceito novo de "template
 * de onboarding" para isto.
 */
export async function signupPublicTransactional(
  pool: pg.Pool,
  deps: SignupPublicTransactionDeps,
  input: SignupPublicUseCaseInput,
): Promise<LoginUseCaseOutput> {
  const client = await pool.connect();
  const txPool = client as unknown as pg.Pool;
  try {
    await client.query("begin");
    const result = await signupPublic(
      {
        userRepository: new PostgresUserRepository(txPool),
        membershipRepository: new PostgresTenantMembershipRepository(txPool),
        sessionRepository: new PostgresSessionRepository(txPool),
        refreshTokenRepository: new PostgresRefreshTokenRepository(txPool),
        auditLog: new PostgresAuditLogRepository(txPool),
        workspaceRepository: new PostgresWorkspaceRepository(txPool),
        platformBillingRepository: new PostgresPlatformBillingRepository(txPool),
        passwordHasher: deps.passwordHasher,
        jwt: deps.jwt,
        accessTokenTtlSeconds: deps.accessTokenTtlSeconds,
        refreshTokenTtlSeconds: deps.refreshTokenTtlSeconds,
        idGenerator: deps.idGenerator,
        now: deps.now ?? (() => new Date()),
      },
      input,
    );

    const [workspace] = await new PostgresWorkspaceRepository(txPool).listByTenant(result.tenantId);
    if (workspace) {
      await ensureDefaultPipeline(
        { pipelineRepository: new PostgresPipelineRepository(txPool), pipelineStageRepository: new PostgresPipelineStageRepository(txPool) },
        result.tenantId,
        workspace.id,
      );
    }

    await client.query("commit");

    // Sempre DEPOIS do commit — um evento pra um signup que acabou sendo revertido seria mentira.
    // `productEventRepository` aqui usa o pool REAL (nunca `txPool`, que já foi liberado/não
    // participa de nada fora desta transação).
    if (deps.productAnalytics) {
      await recordProductEvent(deps.productAnalytics, { eventName: "signup_completed", source: "server", tenantId: result.tenantId, userId: result.user.id });
      if (workspace) {
        await recordProductEvent(deps.productAnalytics, { eventName: "workspace_created", source: "server", tenantId: result.tenantId, workspaceId: workspace.id });
      }
    }

    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
