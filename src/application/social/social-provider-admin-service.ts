import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { SocialRepositoryPort } from "../ports/social-repository.port.js";
import type { SocialAuditActor, SocialAuditLog } from "./social-audit.js";
import { SOCIAL_PATHS, type SocialNotifier } from "./social-notifier.js";
import type { SocialProviderResolver } from "./social-provider-resolver.js";
import {
  DEFAULT_LATE_POLICY,
  DEFAULT_RATE_LIMITS,
  isValidProviderType,
  NETWORK_LABEL,
  SOCIAL_NETWORKS,
  type SocialAccount,
  type SocialLatePolicy,
  type SocialNetwork,
  type SocialProviderAvailability,
  type SocialProviderPolicy,
  type SocialProviderSwitch,
  type SocialProviderType,
  type SocialRateLimits,
} from "../../domain/social/social-publishing.model.js";

export type SocialProviderAdminDeps = {
  repository: SocialRepositoryPort;
  publicationRepository: Pick<PublicationRepositoryPort, "rescheduleTargetOutbox">;
  resolver: SocialProviderResolver;
  notifier: SocialNotifier;
  audit: SocialAuditLog;
  now?: () => Date;
};

export type SocialTenantProviderOverview = {
  tenantId: string;
  networks: {
    network: SocialNetwork;
    policy: SocialProviderPolicy;
    providers: SocialProviderAvailability[];
    accounts: { id: string; username?: string; status: string; providerType: SocialProviderType; connectedProviders: SocialProviderType[] }[];
  }[];
};

export type SocialPublishingMetrics = {
  since: string;
  unofficial: { network: SocialNetwork; providerType: SocialProviderType; unofficialConnectedAccounts: number; unofficialHealthyAccounts: number; unofficialReauthRequired: number; unofficialPublishSuccess: number; unofficialPublishFailure: number; unofficialReconciliationRequired: number }[];
  byProvider: { network: SocialNetwork; providerType: SocialProviderType; attempts: number; published: number; failed: number; unknown: number; inProgress: number; workerDurationMs: number; mediaBytes: number }[];
  blocked: { network: SocialNetwork; reason: string; count: number }[];
};

/** Limites que o tenant pode ajustar: só para MAIS conservador que o teto da plataforma. */
const RATE_LIMIT_BOUNDS = { minimumIntervalSeconds: [60, 86_400], maxPublicationsPerHour: [1, 10], maxPublicationsPerDay: [1, 50], maxConsecutiveFailures: [1, 10] } as const;

export class SocialProviderAdminService {
  constructor(private readonly deps: SocialProviderAdminDeps) {}

  async listSwitches(): Promise<(SocialProviderSwitch & { implemented: boolean; configured: boolean; realPublishingValidated: boolean; networks: readonly SocialNetwork[] })[]> {
    const switches = await this.deps.resolver.listSwitches();
    return switches.map((item) => {
      const provider = this.deps.resolver.providers.get(item.providerType);
      return { ...item, implemented: !!provider?.descriptor.implemented, configured: provider?.connection?.isConfigured() ?? false, realPublishingValidated: !!provider?.descriptor.realPublishingValidated, networks: this.deps.resolver.providers.networksOf(item.providerType) };
    });
  }

  async tenantOverview(tenantId: string): Promise<SocialTenantProviderOverview> {
    const accounts = await this.deps.repository.listTenantAccounts({ tenantId });
    const networks = [];
    for (const network of SOCIAL_NETWORKS) {
      const policy = await this.deps.resolver.policyFor(tenantId, network);
      const providers = await Promise.all(this.deps.resolver.providers.providersFor(network).map((providerType) => this.deps.resolver.availability({ tenantId, network, providerType })));
      networks.push({
        network,
        policy,
        providers,
        accounts: accounts.filter((account) => account.network === network).map((account) => ({ id: account.id, username: account.username, status: account.status, providerType: account.providerType, connectedProviders: account.connections.filter((connection) => connection.status === "active").map((connection) => connection.providerType) })),
      });
    }
    return { tenantId, networks };
  }

  /**
   * Política por tenant (platform admin): liberação explícita da publicação social e de quais
   * providers atendem cada rede. Um provider só pode ser liberado ao tenant depois de HOMOLOGADO
   * na plataforma — e nada disso vira padrão automaticamente.
   */
  async setTenantPolicy(input: { tenantId: string; network: SocialNetwork; publishingEnabled?: boolean; preferredProvider?: SocialProviderType; enabledProviders?: readonly SocialProviderType[]; actor: SocialAuditActor }): Promise<SocialProviderPolicy> {
    const current = await this.deps.resolver.policyFor(input.tenantId, input.network);
    const enabledProviders = [...new Set(input.enabledProviders ?? current.enabledProviders)];
    const preferredProvider = input.preferredProvider ?? (enabledProviders.includes(current.preferredProvider) ? current.preferredProvider : enabledProviders[0] ?? current.preferredProvider);
    for (const providerType of [...enabledProviders, preferredProvider]) {
      if (!isValidProviderType(providerType) || !this.deps.resolver.providers.networksOf(providerType).includes(input.network)) throw new Error(`SOCIAL_POLICY_INVALID: o provider ${providerType} não atende ${NETWORK_LABEL[input.network]}.`);
    }
    for (const providerType of enabledProviders.filter((type) => !current.enabledProviders.includes(type))) {
      if (!this.deps.resolver.providers.get(providerType)?.descriptor.implemented) throw new Error(`SOCIAL_PROVIDER_NOT_IMPLEMENTED: provider ${providerType} indisponível.`);
      const globalSwitch = await this.deps.resolver.switchFor(providerType);
      if (!globalSwitch.approved) throw new Error(`SOCIAL_PROVIDER_NOT_APPROVED: o provider ${providerType} ainda não foi homologado.`);
    }
    const next: SocialProviderPolicy = {
      ...current,
      publishingEnabled: input.publishingEnabled ?? current.publishingEnabled,
      preferredProvider,
      enabledProviders,
      updatedBy: input.actor.userId,
      updatedAt: this.now().toISOString(),
    };
    if (next.publishingEnabled && next.enabledProviders.length === 0) throw new Error("SOCIAL_POLICY_INVALID: liberar a publicação exige ao menos um provider habilitado.");
    if (next.enabledProviders.length > 0 && !next.enabledProviders.includes(next.preferredProvider)) throw new Error("SOCIAL_POLICY_INVALID: o provider preferido precisa estar habilitado.");
    const saved = await this.deps.repository.upsertPolicy(next);
    await this.deps.audit.record({ tenantId: input.tenantId, event: "PROVIDER_POLICY_CHANGED", actor: input.actor, resource: { type: "social_provider", id: `${input.tenantId}:${input.network}` }, metadata: { network: input.network, publishingEnabled: saved.publishingEnabled, preferredProvider: saved.preferredProvider, enabledProviders: [...saved.enabledProviders], previousPreferredProvider: current.preferredProvider, previousPublishingEnabled: current.publishingEnabled } });
    for (const providerType of new Set([...saved.enabledProviders, ...current.enabledProviders])) {
      const was = current.enabledProviders.includes(providerType);
      const is = saved.enabledProviders.includes(providerType);
      if (was !== is) await this.deps.audit.record({ tenantId: input.tenantId, event: is ? "PROVIDER_ENABLED_FOR_TENANT" : "PROVIDER_DISABLED_FOR_TENANT", actor: input.actor, resource: { type: "social_provider", id: `${input.tenantId}:${providerType}` }, metadata: { network: input.network, providerType } });
    }
    await this.migrateAccounts(input.tenantId, input.network, input.actor);
    return saved;
  }

  /** Política operacional do próprio tenant (atraso e limites) — nunca afrouxa além do teto. */
  async setTenantOperationalPolicy(input: { tenantId: string; network: SocialNetwork; latePolicy?: Partial<SocialLatePolicy>; rateLimits?: Partial<SocialRateLimits>; actor: SocialAuditActor }): Promise<SocialProviderPolicy> {
    const current = await this.deps.resolver.policyFor(input.tenantId, input.network);
    const latePolicy: SocialLatePolicy = {
      toleranceMinutes: clamp(input.latePolicy?.toleranceMinutes ?? current.latePolicy.toleranceMinutes ?? DEFAULT_LATE_POLICY.toleranceMinutes, 0, 24 * 60),
      whenLate: input.latePolicy?.whenLate ?? current.latePolicy.whenLate ?? DEFAULT_LATE_POLICY.whenLate,
    };
    if (!["PUBLISH_ON_RECONNECT", "ASK_CONFIRMATION", "SKIP"].includes(latePolicy.whenLate)) throw new Error("SOCIAL_POLICY_INVALID: política de atraso inválida.");
    const rateLimits = { ...DEFAULT_RATE_LIMITS, ...current.rateLimits };
    for (const key of Object.keys(RATE_LIMIT_BOUNDS) as (keyof SocialRateLimits)[]) {
      const value = input.rateLimits?.[key];
      if (value === undefined) continue;
      const [min, max] = RATE_LIMIT_BOUNDS[key];
      rateLimits[key] = clamp(value, min, max);
    }
    const saved = await this.deps.repository.upsertPolicy({ ...current, latePolicy, rateLimits, updatedBy: input.actor.userId, updatedAt: this.now().toISOString() });
    await this.deps.audit.record({ tenantId: input.tenantId, event: "PROVIDER_POLICY_CHANGED", actor: input.actor, resource: { type: "social_provider", id: `${input.tenantId}:${input.network}` }, metadata: { network: input.network, toleranceMinutes: latePolicy.toleranceMinutes, whenLate: latePolicy.whenLate, ...rateLimits } });
    return saved;
  }

  /**
   * Kill switch / homologação global de um provider (emergência). Desligar NUNCA apaga conteúdo:
   * novos jobs ficam pausados, agendamentos preservados, clientes informados.
   */
  async setSwitch(input: { providerType: SocialProviderType; enabled: boolean; approved?: boolean; reason?: string; actor: SocialAuditActor }): Promise<SocialProviderSwitch> {
    if (!this.deps.resolver.providers.get(input.providerType)) throw new Error(`SOCIAL_PROVIDER_NOT_IMPLEMENTED: provider ${input.providerType} desconhecido.`);
    const current = await this.deps.resolver.switchFor(input.providerType);
    const saved = await this.deps.repository.upsertSwitch({ providerType: input.providerType, enabled: input.enabled, approved: input.approved ?? current.approved, reason: input.reason?.slice(0, 300), updatedBy: input.actor.userId, updatedAt: this.now().toISOString() });
    const affected = await this.deps.repository.listAccountsByProvider({ providerType: input.providerType });
    const tenants = new Set(affected.map((account) => account.tenantId));
    for (const tenantId of tenants.size ? tenants : new Set(["platform"])) {
      await this.deps.audit.record({ tenantId, event: "PROVIDER_SWITCH_CHANGED", actor: input.actor, resource: { type: "social_provider", id: input.providerType }, metadata: { providerType: input.providerType, enabled: saved.enabled, approved: saved.approved, reason: saved.reason, previousEnabled: current.enabled, previousApproved: current.approved } });
    }
    if (current.enabled && !saved.enabled) {
      const notified = new Set<string>();
      for (const account of affected) {
        const key = `${account.tenantId}:${account.workspaceId}:${account.network}`;
        if (notified.has(key)) continue;
        notified.add(key);
        await this.deps.notifier.notify({ tenantId: account.tenantId, workspaceId: account.workspaceId, kind: "provider_paused", network: account.network, subjectId: `${account.network}:${input.providerType}`, title: `Publicações no ${NETWORK_LABEL[account.network]} pausadas`, body: `As publicações no ${NETWORK_LABEL[account.network]} foram pausadas temporariamente. Nada foi apagado: os agendamentos sairão assim que a integração voltar.`, sourceUrl: SOCIAL_PATHS.calendar(account.workspaceId) });
      }
    }
    if (!current.enabled && saved.enabled) await this.releaseProviderPaused(affected);
    return saved;
  }

  /**
   * Reaplica a resolução de provider nas contas do tenant/rede. A conta, os agendamentos, o
   * histórico e a mídia permanecem; só muda o mecanismo de transporte.
   */
  async migrateAccounts(tenantId: string, network: SocialNetwork, actor: SocialAuditActor): Promise<number> {
    const accounts = await this.deps.repository.listTenantAccounts({ tenantId, network });
    let changed = 0;
    for (const account of accounts) {
      const resolution = await this.deps.resolver.resolveForAccount(account);
      if (!resolution.ok || resolution.providerType === account.providerType) continue;
      await this.deps.repository.updateAccount({ tenantId, id: account.id, patch: { providerType: resolution.providerType } });
      changed += 1;
      await this.deps.audit.record({ tenantId, workspaceId: account.workspaceId, event: "PROVIDER_CHANGED", actor, resource: { type: "social_account", id: account.id }, metadata: { network, from: account.providerType, to: resolution.providerType } });
    }
    await this.releaseProviderPaused(accounts);
    return changed;
  }

  /**
   * Observabilidade e custo operacional: tentativas por rede/provider e destinos bloqueados.
   * Sem conteúdo privado (legenda, mídia, sessão) — só contagens e duração.
   */
  async metrics(input: { tenantId?: string; sinceHours: number }): Promise<SocialPublishingMetrics> {
    const since = new Date(this.now().getTime() - input.sinceHours * 3_600_000).toISOString();
    const logs = await this.deps.repository.listPublishLog({ tenantId: input.tenantId, since, limit: 50_000 });
    const rows = new Map<string, SocialPublishingMetrics["byProvider"][number]>();
    for (const log of logs) {
      const key = `${log.network}:${log.providerType}`;
      const row = rows.get(key) ?? { network: log.network, providerType: log.providerType, attempts: 0, published: 0, failed: 0, unknown: 0, inProgress: 0, workerDurationMs: 0, mediaBytes: 0 };
      row.attempts += 1;
      if (log.outcome === "published") row.published += 1;
      else if (log.outcome === "failed") row.failed += 1;
      else if (log.outcome === "unknown") row.unknown += 1;
      else row.inProgress += 1;
      row.workerDurationMs += log.durationMs ?? 0;
      row.mediaBytes += log.mediaBytes ?? 0;
      rows.set(key, row);
    }
    const tenants = input.tenantId ? [input.tenantId] : [...new Set(logs.map((log) => log.tenantId))];
    const blocked: Record<string, number> = {};
    for (const tenantId of tenants) {
      for (const destination of await this.deps.repository.listBlockedDestinations({ tenantId })) {
        const key = `${destination.network}:${destination.blockReason}`;
        blocked[key] = (blocked[key] ?? 0) + 1;
      }
    }
    const unofficial = [];
    for (const network of SOCIAL_NETWORKS) {
      const providerType = `${network}_unofficial`;
      const accounts = (await this.deps.repository.listAccountsByProvider({ providerType, tenantId: input.tenantId })).filter(account => account.network === network);
      const totals = rows.get(`${network}:${providerType}`);
      unofficial.push({ network, providerType, unofficialConnectedAccounts: accounts.filter(account => ["CONNECTED", "HEALTHY", "TEMPORARY_ERROR"].includes(account.status)).length, unofficialHealthyAccounts: accounts.filter(account => account.status === "HEALTHY").length, unofficialReauthRequired: accounts.filter(account => ["REAUTH_REQUIRED", "CHECKPOINT_REQUIRED"].includes(account.status)).length, unofficialPublishSuccess: totals?.published ?? 0, unofficialPublishFailure: totals?.failed ?? 0, unofficialReconciliationRequired: totals?.unknown ?? 0 });
    }
    return { since, unofficial, byProvider: [...rows.values()], blocked: Object.entries(blocked).map(([key, count]) => ({ network: key.split(":")[0] as SocialNetwork, reason: key.split(":")[1]!, count })) };
  }

  private async releaseProviderPaused(accounts: readonly SocialAccount[]): Promise<void> {
    const now = this.now().toISOString();
    for (const account of accounts) {
      const paused = await this.deps.repository.listBlockedDestinations({ tenantId: account.tenantId, socialAccountId: account.id, blockReason: "PROVIDER_DISABLED" });
      for (const destination of paused) {
        await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { clearBlock: true } });
        await this.deps.publicationRepository.rescheduleTargetOutbox({ targetId: destination.targetId, availableAt: destination.scheduledAt && destination.scheduledAt > now ? destination.scheduledAt : now });
      }
    }
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
