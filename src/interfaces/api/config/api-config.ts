import type { PersistenceDriver } from "../../../infrastructure/storage/build-platform-repositories.js";
import type { AuthPrincipal } from "../../../domain/identity/identity.model.js";
import { isModelRegisteredAndActive } from "../../../application/ai-gateway/model-registry.js";
import type { ExecutionEnvironment } from "../../../application/execution/execution-operational-policy.js";

const DEFAULT_ANTHROPIC_BRIEFING_EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

/**
 * Configuração da camada HTTP — lê variáveis de ambiente uma única vez, com padrões seguros.
 * A partir da Sprint 05, `authMode` passou a existir: `"jwt"` (padrão, autenticação real) exige
 * `JWT_SECRET` e `DATABASE_URL` — Identidade sempre vive em Postgres de verdade, mesmo que
 * `PERSISTENCE_DRIVER=memory` para Workspace/Asset Library/Chat continue disponível para testes
 * rápidos desses domínios. `"noop"` é a válvula de escape explícita para dev/teste (mesmo
 * `NoopAuthAdapter` da Sprint 02/03), nunca o padrão silencioso.
 */
export type ApiConfig = {
  port: number;
  host: string;
  persistenceDriver: PersistenceDriver;
  /** Só obrigatório quando `persistenceDriver === "postgres"` OU `authMode === "jwt"` (Identidade sempre precisa de Postgres). */
  databaseUrl?: string;
  logLevel: string;
  corsOrigin: string | string[];

  /** "jwt" (padrão, produção) | "noop" (dev/teste explícito, ver `NoopAuthAdapter`). */
  authMode: "jwt" | "noop";
  /** Obrigatório quando `authMode === "jwt"`. Nunca tem valor padrão — um segredo previsível anularia a assinatura. */
  jwtSecret?: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  /** Cookies HttpOnly (refresh token) só com `Secure` fora de desenvolvimento local (HTTPS obrigatório em produção). */
  cookieSecure: boolean;
  /**
   * `Domain` do cookie de refresh/CSRF. Sem valor (padrão) = host-only, restrito ao host exato que
   * respondeu ao login. Precisa ser configurado quando API e frontend vivem em subdomínios
   * irmãos (ex.: `api.exemplo.com` emitindo login, `exemplo.com` sendo onde o `proxy.ts` do
   * frontend precisa VER o cookie) — sem isso o cookie nunca chega ao domínio do frontend e o
   * portal de navegação redireciona de volta para /login mesmo após login bem-sucedido.
   */
  cookieDomain?: string;

  /** Usado só quando `authMode === "noop"` — mesmo princípio do `devPrincipal` da Sprint 03, agora com `role`/`sessionId` (RBAC). */
  devPrincipal?: AuthPrincipal;

  /**
   * AI Gateway — Sprint 08 (Fase 19). `enabled=false` (padrão) reproduz o comportamento idêntico
   * à Sprint 07 (Fase 37) — o Briefing nunca sequer monta um `AiRequest`. `briefingExtractionEnabled`
   * só tem efeito quando `enabled` também é `true`. Falta de `anthropicApiKey` com `enabled=true`
   * NUNCA impede o startup (Fase 5: "falhar... na primeira chamada" — a escolhida aqui) — o
   * Gateway simplesmente não tem nenhum provider configurado e toda chamada degrada para o
   * fallback determinístico. Já `anthropicBriefingExtractionModel` inválido (fora do Model
   * Registry) É um erro de configuração — falha no startup (decisão obrigatória 24), nunca em
   * runtime.
   */
  aiGateway: {
    enabled: boolean;
    briefingExtractionEnabled: boolean;
    anthropicApiKey?: string;
    anthropicBriefingExtractionModel: string;
  };
  execution: {
    realExecutionEnabled: boolean;
    realExecutionResearchEnabled: boolean;
    realPlanningEnabled: boolean;
    realCopyEnabled: boolean;
    realVisualEnabled: boolean;
    realDistributionEnabled: boolean;
    environment: ExecutionEnvironment;
  };
  publication: {
    providerEnvironment: "sandbox" | "production";
    productionEnabled: boolean;
    metaPagesSandboxEnabled: boolean;
    metaAppId?: string;
    metaAppSecret?: string;
    metaRedirectUri?: string;
    metaGraphBaseUrl?: string;
    canaryEnabled: boolean;
    canaryTenantIds: readonly string[];
    canaryWorkspaceIds: readonly string[];
    webhookSecrets: Partial<Record<"meta_pages_sandbox" | "linkedin_sandbox" | "x_sandbox", string>>;
  };
  scheduling: {
    occurrenceWindowDays: number;
    maxOccurrencesPerRun: number;
    leaseMs: number;
    maxBatch: number;
    missedGraceMs: number;
    lateThresholdMs: number;
    conflictWindowMinutes: number;
  };
  analytics: {
    maxQueryDays: number;
    defaultTimezone: string;
    exportRetentionDays: number;
  };
  operations: {
    secretManagerProvider: "local" | "production";
    rateLimitDefaultLimit: number;
    rateLimitWindowMs: number;
    circuitBreakerFailureThreshold: number;
    circuitBreakerCooldownMs: number;
    publicationQueueMax: number;
    publicationOutboxPendingMax: number;
    publicationDeadLetterMax: number;
    schedulingLateMsMax: number;
    analyticsDeadLetterMax: number;
  };
};

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
const PERSISTENCE_DRIVERS: readonly PersistenceDriver[] = ["memory", "postgres"];
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = parsePort(env.API_PORT) ?? DEFAULT_PORT;
  const host = env.API_HOST?.trim() || DEFAULT_HOST;
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const logLevel = env.ZUNO_LOG_LEVEL?.trim() || "info";
  const persistenceDriver = parsePersistenceDriver(env.PERSISTENCE_DRIVER);
  const corsOrigin = parseCorsOrigin(env.API_CORS_ORIGIN);

  const authMode = env.AUTH_MODE?.trim() === "noop" ? "noop" : "jwt";
  const jwtSecret = env.JWT_SECRET?.trim() || undefined;
  const accessTokenTtlSeconds = parsePositiveInt(env.ACCESS_TOKEN_TTL_SECONDS) ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const refreshTokenTtlSeconds = parsePositiveInt(env.REFRESH_TOKEN_TTL_SECONDS) ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
  const cookieSecure = env.COOKIE_SECURE?.trim() === "true";
  const cookieDomain = env.COOKIE_DOMAIN?.trim() || undefined;

  if (authMode === "jwt") {
    if (!jwtSecret) {
      throw new Error(
        'AUTH_MODE="jwt" (padrão) exige JWT_SECRET configurado (ver .env.example). Use AUTH_MODE=noop só para desenvolvimento/teste local sem autenticação real.',
      );
    }
    if (!databaseUrl) {
      throw new Error(
        'AUTH_MODE="jwt" exige DATABASE_URL configurado — Identidade (usuários/sessões/refresh tokens) sempre vive em Postgres real, independente de PERSISTENCE_DRIVER.',
      );
    }
  }

  const devPrincipal = authMode === "noop" ? parseDevPrincipal(env) : undefined;

  const aiGatewayEnabled = env.AI_GATEWAY_ENABLED?.trim() === "true";
  const aiBriefingExtractionEnabled = aiGatewayEnabled && env.AI_BRIEFING_EXTRACTION_ENABLED?.trim() === "true";
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const anthropicBriefingExtractionModel = env.ANTHROPIC_BRIEFING_EXTRACTION_MODEL?.trim() || DEFAULT_ANTHROPIC_BRIEFING_EXTRACTION_MODEL;
  const realExecutionEnabled = env.REAL_EXECUTION_ENABLED?.trim() === "true";
  const realExecutionResearchEnabled = realExecutionEnabled && env.REAL_EXECUTION_RESEARCH_ENABLED?.trim() === "true";
  const realPlanningEnabled = realExecutionEnabled && env.REAL_PLANNING_ENABLED?.trim() === "true";
  const realCopyEnabled = realExecutionEnabled && env.REAL_COPY_ENABLED?.trim() === "true";
  const realVisualEnabled = realExecutionEnabled && env.REAL_VISUAL_ENABLED?.trim() === "true";
  const realDistributionEnabled = realExecutionEnabled && env.REAL_DISTRIBUTION_ENABLED?.trim() === "true";
  const executionEnvironment = parseExecutionEnvironment(env.EXECUTION_ENVIRONMENT ?? env.NODE_ENV);
  const publicationProviderEnvironment = env.PUBLICATION_PROVIDER_ENVIRONMENT?.trim() === "production" ? "production" : "sandbox";
  const publicationProductionEnabled = env.PUBLICATION_PRODUCTION_ENABLED?.trim() === "true";
  const metaPagesSandboxEnabled = env.META_PAGES_SANDBOX_ENABLED?.trim() === "true";
  const metaAppId = env.META_APP_ID?.trim() || undefined;
  const metaAppSecret = env.META_APP_SECRET?.trim() || undefined;
  const metaRedirectUri = env.META_OAUTH_REDIRECT_URI?.trim() || undefined;
  const metaGraphBaseUrl = env.META_GRAPH_BASE_URL?.trim() || undefined;
  const publicationCanaryEnabled = env.PUBLICATION_CANARY_ENABLED?.trim() === "true";
  const publicationCanaryTenantIds = parseCsv(env.PUBLICATION_CANARY_TENANT_IDS);
  const publicationCanaryWorkspaceIds = parseCsv(env.PUBLICATION_CANARY_WORKSPACE_IDS);
  const schedulingOccurrenceWindowDays = parsePositiveInt(env.SCHEDULING_OCCURRENCE_WINDOW_DAYS) ?? 30;
  const schedulingMaxOccurrencesPerRun = parsePositiveInt(env.SCHEDULING_MAX_OCCURRENCES_PER_RUN) ?? 200;
  const schedulingLeaseMs = parsePositiveInt(env.SCHEDULING_LEASE_MS) ?? 60_000;
  const schedulingMaxBatch = parsePositiveInt(env.SCHEDULING_MAX_BATCH) ?? 10;
  const schedulingMissedGraceMs = parsePositiveInt(env.SCHEDULING_MISSED_GRACE_MS) ?? 15 * 60_000;
  const schedulingLateThresholdMs = parsePositiveInt(env.SCHEDULING_LATE_THRESHOLD_MS) ?? 15 * 60_000;
  const schedulingConflictWindowMinutes = parsePositiveInt(env.SCHEDULING_CONFLICT_WINDOW_MINUTES) ?? 30;
  const analyticsMaxQueryDays = parsePositiveInt(env.ANALYTICS_MAX_QUERY_DAYS) ?? 370;
  const analyticsDefaultTimezone = env.ANALYTICS_DEFAULT_TIMEZONE?.trim() || "America/Sao_Paulo";
  const analyticsExportRetentionDays = parsePositiveInt(env.ANALYTICS_EXPORT_RETENTION_DAYS) ?? 7;
  const secretManagerProvider = env.SECRET_MANAGER_PROVIDER?.trim() === "production" ? "production" : "local";
  const rateLimitDefaultLimit = parsePositiveInt(env.OPERATIONAL_RATE_LIMIT_DEFAULT) ?? 120;
  const rateLimitWindowMs = parsePositiveInt(env.OPERATIONAL_RATE_LIMIT_WINDOW_MS) ?? 60_000;
  const circuitBreakerFailureThreshold = parsePositiveInt(env.OPERATIONAL_CIRCUIT_FAILURE_THRESHOLD) ?? 2;
  const circuitBreakerCooldownMs = parsePositiveInt(env.OPERATIONAL_CIRCUIT_COOLDOWN_MS) ?? 60_000;
  const publicationQueueMax = parsePositiveInt(env.OPERATIONAL_PUBLICATION_QUEUE_MAX) ?? 500;
  const publicationOutboxPendingMax = parsePositiveInt(env.OPERATIONAL_PUBLICATION_OUTBOX_PENDING_MAX) ?? 500;
  const publicationDeadLetterMax = parsePositiveInt(env.OPERATIONAL_PUBLICATION_DEAD_LETTER_MAX) ?? 25;
  const schedulingLateMsMax = parsePositiveInt(env.OPERATIONAL_SCHEDULING_LATE_MS_MAX) ?? 15 * 60_000;
  const analyticsDeadLetterMax = parsePositiveInt(env.OPERATIONAL_ANALYTICS_DEAD_LETTER_MAX) ?? 25;

  if (aiGatewayEnabled && !isModelRegisteredAndActive("anthropic", anthropicBriefingExtractionModel)) {
    throw new Error(
      `AI_GATEWAY_ENABLED="true" mas ANTHROPIC_BRIEFING_EXTRACTION_MODEL="${anthropicBriefingExtractionModel}" não está registrado (ou não está ativo) no Model Registry ` +
        "(src/application/ai-gateway/model-registry.ts). Nunca use um alias implícito como \"latest\" — informe um modelId explícito já registrado.",
    );
  }

  return {
    port,
    host,
    persistenceDriver,
    databaseUrl,
    logLevel,
    corsOrigin,
    authMode,
    jwtSecret,
    accessTokenTtlSeconds,
    refreshTokenTtlSeconds,
    cookieSecure,
    cookieDomain,
    devPrincipal,
    aiGateway: {
      enabled: aiGatewayEnabled,
      briefingExtractionEnabled: aiBriefingExtractionEnabled,
      anthropicApiKey,
      anthropicBriefingExtractionModel,
    },
    execution: {
      realExecutionEnabled,
      realExecutionResearchEnabled,
      realPlanningEnabled,
      realCopyEnabled,
      realVisualEnabled,
      realDistributionEnabled,
      environment: executionEnvironment,
    },
    publication: {
      providerEnvironment: publicationProviderEnvironment,
      productionEnabled: publicationProductionEnabled,
      metaPagesSandboxEnabled,
      metaAppId,
      metaAppSecret,
      metaRedirectUri,
      metaGraphBaseUrl,
      canaryEnabled: publicationCanaryEnabled,
      canaryTenantIds: publicationCanaryTenantIds,
      canaryWorkspaceIds: publicationCanaryWorkspaceIds,
      webhookSecrets: {
        meta_pages_sandbox: env.META_PAGES_WEBHOOK_SECRET?.trim() || undefined,
        linkedin_sandbox: env.LINKEDIN_SANDBOX_WEBHOOK_SECRET?.trim() || undefined,
        x_sandbox: env.X_SANDBOX_WEBHOOK_SECRET?.trim() || undefined,
      },
    },
    scheduling: {
      occurrenceWindowDays: schedulingOccurrenceWindowDays,
      maxOccurrencesPerRun: schedulingMaxOccurrencesPerRun,
      leaseMs: schedulingLeaseMs,
      maxBatch: schedulingMaxBatch,
      missedGraceMs: schedulingMissedGraceMs,
      lateThresholdMs: schedulingLateThresholdMs,
      conflictWindowMinutes: schedulingConflictWindowMinutes,
    },
    analytics: {
      maxQueryDays: analyticsMaxQueryDays,
      defaultTimezone: analyticsDefaultTimezone,
      exportRetentionDays: analyticsExportRetentionDays,
    },
    operations: {
      secretManagerProvider,
      rateLimitDefaultLimit,
      rateLimitWindowMs,
      circuitBreakerFailureThreshold,
      circuitBreakerCooldownMs,
      publicationQueueMax,
      publicationOutboxPendingMax,
      publicationDeadLetterMax,
      schedulingLateMsMax,
      analyticsDeadLetterMax,
    },
  };
}

function parseDevPrincipal(env: NodeJS.ProcessEnv): AuthPrincipal | undefined {
  const tenantId = env.DEV_PRINCIPAL_TENANT_ID?.trim();
  if (!tenantId) return undefined;
  const role = env.DEV_PRINCIPAL_ROLE?.trim();
  return {
    userId: env.DEV_PRINCIPAL_USER_ID?.trim() || "dev-user",
    tenantId,
    role: (["owner", "admin", "editor", "viewer"] as const).includes(role as never) ? (role as AuthPrincipal["role"]) : "owner",
    sessionId: "dev-session",
  };
}

function parseCorsOrigin(raw: string | undefined): string | string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return "http://localhost:3001";
  const origins = trimmed.split(",").map((origin) => origin.trim()).filter(Boolean);
  return origins.length > 1 ? origins : origins[0];
}

function parsePersistenceDriver(raw: string | undefined): PersistenceDriver {
  const trimmed = raw?.trim();
  if (trimmed && (PERSISTENCE_DRIVERS as readonly string[]).includes(trimmed)) return trimmed as PersistenceDriver;
  return "memory";
}

function parsePort(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return undefined;
  return parsed;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseCsv(raw: string | undefined): readonly string[] {
  return raw?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function parseExecutionEnvironment(raw: string | undefined): ExecutionEnvironment {
  const value = raw?.trim();
  if (value === "test" || value === "staging" || value === "production") return value;
  return "development";
}
