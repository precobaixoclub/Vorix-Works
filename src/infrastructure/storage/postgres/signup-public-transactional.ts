import type pg from "pg";
import { startTrial } from "../../../application/billing/trial-use-cases.js";
import { ensureDefaultPipeline } from "../../../application/crm/pipeline-use-cases.js";
import type { LoginUseCaseOutput } from "../../../application/identity/login.usecase.js";
import { signupPublic, type SignupPublicUseCaseInput } from "../../../application/identity/signup-public.usecase.js";
import type { JwtPort } from "../../../application/ports/jwt.port.js";
import type { PasswordHasherPort } from "../../../application/ports/password-hasher.port.js";
import { recordProductEvent, type ProductAnalyticsUseCaseDeps } from "../../../application/product-analytics/product-analytics-use-cases.js";
import type { PlatformPlanCode } from "../../../domain/platform-billing/platform-plan-catalog.js";
import { PostgresAuditLogRepository } from "./postgres-audit-log-repository.js";
import { PostgresBillingEventRepository } from "./postgres-billing-ops-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "./postgres-pipeline-repository.js";
import { PostgresPlanVersionRepository } from "./postgres-plan-version-repository.js";
import { PostgresPlatformBillingRepository } from "./postgres-platform-billing-repository.js";
import { PostgresRefreshTokenRepository } from "./postgres-refresh-token-repository.js";
import { PostgresSessionRepository } from "./postgres-session-repository.js";
import { PostgresSubscriptionRepository } from "./postgres-subscription-repository.js";
import { PostgresTenantMembershipRepository } from "./postgres-tenant-membership-repository.js";
import { PostgresUserRepository } from "./postgres-user-repository.js";
import { PostgresWorkspaceRepository } from "./postgres-workspace-repository.js";

/** Códigos aceitos em `input.planCode` — nunca FREE (não é oferecido publicamente, seção 1 do
 * pedido "aquisição self-service") nem ENTERPRISE ("fale conosco", nunca self-service). */
const TRIAL_ELIGIBLE_PLAN_CODES: readonly PlatformPlanCode[] = ["START", "PRO", "BUSINESS"];

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
  /** Kill switch (`TRIAL_ENABLED`) — mesmo já checado dentro de `startTrial`, mas checado aqui
   * TAMBÉM antes de tentar, pra nunca gastar um `idGenerator`/round-trip à toa quando o ambiente
   * não tem trial habilitado (signup continua funcionando normalmente, só sem Subscription real —
   * mesmo estado de hoje, `tenant_billing` FREE/trial legado). */
  trialEnabled: boolean;
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
  input: SignupPublicUseCaseInput & { planCode?: PlatformPlanCode },
): Promise<LoginUseCaseOutput & { trialStarted: boolean }> {
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

    // Aquisição self-service (seção 25 do pedido) — plano escolhido ANTES do signup (preservado via
    // querystring até aqui, seção 23) vira uma Subscription real de trial na MESMA transação do
    // resto do provisionamento: nunca um tenant "meio criado" (usuário existe mas trial não, ou
    // vice-versa). Sem cartão (`startTrial` nunca chama `BillingProviderPort`). Falha aqui NUNCA
    // derruba o signup inteiro — uma conta sempre nasce, mesmo que o trial real não possa ser
    // iniciado agora (plano indisponível, trial desligado no ambiente); o tenant permanece no
    // estado legado `tenant_billing` FREE/trial (o mesmo de antes desta mudança) até conseguir
    // ativar um plano depois pela tela de Billing.
    let trialStarted = false;
    if (input.planCode && deps.trialEnabled && TRIAL_ELIGIBLE_PLAN_CODES.includes(input.planCode)) {
      try {
        await startTrial(
          {
            subscriptionRepository: new PostgresSubscriptionRepository(txPool),
            planVersionRepository: new PostgresPlanVersionRepository(txPool),
            platformBillingRepository: new PostgresPlatformBillingRepository(txPool),
            billingEventRepository: new PostgresBillingEventRepository(txPool),
            trialEnabled: deps.trialEnabled,
            now: deps.now,
            // Sem `productAnalytics` aqui de propósito — `startTrial` gravaria o evento
            // imediatamente contra o pool REAL (fora desta transação), mentindo se o signup como
            // um todo ainda viesse a dar rollback. O evento `trial_started` é gravado abaixo,
            // DEPOIS do commit, junto dos outros eventos de signup.
          },
          { tenantId: result.tenantId, planCode: input.planCode },
        );
        trialStarted = true;
      } catch {
        // Best-effort — ver comentário acima. Nunca propaga pro catch externo (que faria rollback
        // do signup inteiro por uma falha puramente de billing).
      }
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
      if (trialStarted) {
        await recordProductEvent(deps.productAnalytics, { eventName: "trial_started", source: "server", tenantId: result.tenantId, properties: { planCode: input.planCode } });
      }
    }

    return { ...result, trialStarted };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
