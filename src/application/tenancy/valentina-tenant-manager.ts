import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../events/zuno-event.contract.js";
import { getValentinaPlanDefinition, getValentinaPlanLimits } from "./valentina-plan-catalog.js";
import type { ValentinaTenantPort } from "./valentina-tenant.port.js";
import type { ValentinaLoggerPort, ValentinaLogAction } from "./valentina-log.contract.js";
import type { ValentinaTenantRepositoryPort } from "./valentina-repository.port.js";
import type {
  ChangeTenantPlanInput,
  CreateTenantInput,
  TenantActionInput,
  TenantActor,
  TenantAuditMetadata,
  TenantClientContext,
  TenantConsumptionInput,
  TenantCreditsInput,
  TenantHistoryEntry,
  TenantIntegrationInput,
  TenantLimitCheckRequest,
  TenantLimitCheckResult,
  TenantMonthlyConsumption,
  TenantPlanCode,
  TenantPlanDefinition,
  TenantQuery,
  TenantRecord,
  TenantSocialNetwork,
  TenantVersion,
  UpdateTenantInput,
  ValentinaIdGenerator,
} from "./valentina.types.js";

export type ValentinaTenantManagerDependencies = {
  repository: ValentinaTenantRepositoryPort;
  logger?: ValentinaLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: ValentinaIdGenerator;
  now?: () => Date;
};

class SequentialValentinaIdGenerator implements ValentinaIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopValentinaLogger implements ValentinaLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

export class ValentinaTenantManager implements ValentinaTenantPort {
  private readonly repository: ValentinaTenantRepositoryPort;
  private readonly logger: ValentinaLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: ValentinaIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: ValentinaTenantManagerDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger ?? new NoopValentinaLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialValentinaIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async createTenant(input: CreateTenantInput): Promise<TenantRecord> {
    validateCreateInput(input);
    const plan = input.plan ?? "FREE";
    const timestamp = this.timestamp();
    const planLimits = getValentinaPlanLimits(plan);
    const tenantId = this.idGenerator.create("tenant");
    const clientId = input.clientId ?? this.idGenerator.create("client");
    const existing = await this.repository.findByClientId(clientId);
    if (existing) throw new Error(`Cliente ${clientId} já está cadastrado na Valentina.`);

    const base = {
      id: tenantId,
      clientId,
      displayName: input.displayName,
      status: "created" as const,
      subscriptionStatus: input.subscriptionStatus ?? "trial" as const,
      plan,
      planLimits,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: input.expiresAt,
      niche: input.niche,
      mainObjectives: input.mainObjectives ?? [],
      connectedSocialNetworks: [],
      integrations: {},
      credits: {
        addedAiTokens: 0,
        consumedExtraAiTokens: 0,
        availableExtraAiTokens: 0,
      },
      usage: {
        monthly: [createMonthlyConsumption(periodFromDate(timestamp))],
      },
      enabledSpecialists: planLimits.specialists,
      enabledFeatures: planLimits.features,
      permissions: defaultPermissions(plan),
      settings: {
        timezone: input.timezone,
        language: input.language,
        country: input.country,
        environment: input.environment,
        preferences: input.preferences ?? {},
        general: input.generalSettings,
      },
      currentVersion: 1,
    };
    const version = this.createVersion(1, base, input.audit, "Cliente cadastrado.");
    const record: TenantRecord = {
      ...base,
      versions: [version],
      history: [
        this.createHistory("created", input.audit, 1, undefined, {
          clientId,
          displayName: input.displayName,
          plan,
        }),
      ],
    };

    await this.repository.save(record);
    await this.log("TenantCreated", "Cliente cadastrado pela Valentina.", input.audit.actor, record);
    await this.emit("TenantCreated", record, input.audit.actor, { version: 1 });
    return clone(record);
  }

  async updateTenant(input: UpdateTenantInput): Promise<TenantRecord> {
    validateAudit(input.audit);
    const existing = await this.requireTenant(input.tenantId);
    const oldValues = pickChangedValues(existing, input.patch);
    const nextSettings = input.patch.settings || input.patch.preferences
      ? {
        ...existing.settings,
        ...(input.patch.settings ?? {}),
        preferences: {
          ...existing.settings.preferences,
          ...(input.patch.preferences ?? input.patch.settings?.preferences ?? {}),
        },
      }
      : existing.settings;
    const updated = this.withMutation(existing, input.audit, "updated", "Cliente atualizado.", oldValues, {
      ...input.patch,
      settings: nextSettings,
    }, {
      ...existing,
      ...input.patch,
      settings: nextSettings,
      updatedAt: this.timestamp(),
    });

    await this.repository.save(updated);
    await this.log("TenantUpdated", "Cliente atualizado pela Valentina.", input.audit.actor, updated, { oldValues });
    await this.emit("TenantUpdated", updated, input.audit.actor, { oldValues, newValues: input.patch });
    return clone(updated);
  }

  async activateTenant(input: TenantActionInput): Promise<TenantRecord> {
    const existing = await this.requireTenant(input.tenantId);
    const updated = this.withMutation(existing, input.audit, "activated", "Cliente ativado.", {
      status: existing.status,
      subscriptionStatus: existing.subscriptionStatus,
    }, {
      status: "active",
      subscriptionStatus: "active",
    }, {
      ...existing,
      status: "active",
      subscriptionStatus: "active",
      activatedAt: existing.activatedAt ?? this.timestamp(),
      updatedAt: this.timestamp(),
    });

    await this.repository.save(updated);
    await this.log("TenantActivated", "Cliente ativado pela Valentina.", input.audit.actor, updated);
    await this.emit("TenantActivated", updated, input.audit.actor);
    return clone(updated);
  }

  async suspendTenant(input: TenantActionInput): Promise<TenantRecord> {
    const existing = await this.requireTenant(input.tenantId);
    const updated = this.withMutation(existing, input.audit, "suspended", "Cliente suspenso.", {
      status: existing.status,
    }, {
      status: "suspended",
    }, {
      ...existing,
      status: "suspended",
      suspendedAt: this.timestamp(),
      updatedAt: this.timestamp(),
    });

    await this.repository.save(updated);
    await this.log("TenantSuspended", "Cliente suspenso pela Valentina.", input.audit.actor, updated);
    await this.emit("TenantSuspended", updated, input.audit.actor);
    return clone(updated);
  }

  async deleteTenant(input: TenantActionInput): Promise<TenantRecord> {
    const existing = await this.requireTenant(input.tenantId);
    const updated = this.withMutation(existing, input.audit, "deleted", "Cliente removido logicamente.", {
      status: existing.status,
    }, {
      status: "deleted",
    }, {
      ...existing,
      status: "deleted",
      deletedAt: this.timestamp(),
      updatedAt: this.timestamp(),
    });

    await this.repository.save(updated);
    await this.log("TenantDeleted", "Cliente removido logicamente pela Valentina.", input.audit.actor, updated);
    await this.emit("TenantDeleted", updated, input.audit.actor);
    return clone(updated);
  }

  async changePlan(input: ChangeTenantPlanInput): Promise<TenantRecord> {
    validateAudit(input.audit);
    const existing = await this.requireTenant(input.tenantId);
    const planLimits = getValentinaPlanLimits(input.plan);
    const updated = this.withMutation(existing, input.audit, "plan_changed", "Plano do cliente alterado.", {
      plan: existing.plan,
      planLimits: existing.planLimits,
      expiresAt: existing.expiresAt,
    }, {
      plan: input.plan,
      planLimits,
      expiresAt: input.expiresAt,
    }, {
      ...existing,
      plan: input.plan,
      planLimits,
      expiresAt: input.expiresAt ?? existing.expiresAt,
      enabledSpecialists: planLimits.specialists,
      enabledFeatures: planLimits.features,
      permissions: defaultPermissions(input.plan),
      updatedAt: this.timestamp(),
    });

    await this.repository.save(updated);
    await this.log("PlanChanged", "Plano alterado pela Valentina.", input.audit.actor, updated, { from: existing.plan, to: input.plan });
    await this.emit("PlanChanged", updated, input.audit.actor, { from: existing.plan, to: input.plan });
    return clone(updated);
  }

  async addCredits(input: TenantCreditsInput): Promise<TenantRecord> {
    validateAudit(input.audit);
    if (input.aiTokens <= 0) throw new Error("aiTokens precisa ser maior que zero para adicionar créditos.");
    const existing = await this.requireTenant(input.tenantId);
    const credits = {
      addedAiTokens: existing.credits.addedAiTokens + input.aiTokens,
      consumedExtraAiTokens: existing.credits.consumedExtraAiTokens,
      availableExtraAiTokens: existing.credits.availableExtraAiTokens + input.aiTokens,
    };
    const updated = this.withMutation(existing, input.audit, "credits_added", "Créditos adicionados.", {
      credits: existing.credits,
    }, {
      credits,
    }, {
      ...existing,
      credits,
      updatedAt: this.timestamp(),
    });

    await this.repository.save(updated);
    await this.log("CreditsAdded", "Créditos adicionados pela Valentina.", input.audit.actor, updated, { aiTokens: input.aiTokens });
    await this.emit("CreditsAdded", updated, input.audit.actor, { aiTokens: input.aiTokens });
    return clone(updated);
  }

  async consumeCredits(input: TenantConsumptionInput): Promise<TenantRecord> {
    validateAudit(input.audit);
    const existing = await this.requireTenant(input.tenantId);
    const limitCheck = this.evaluateLimits(existing, input);
    if (!limitCheck.allowed) throw new Error(`Consumo bloqueado pela Valentina: ${limitCheck.reasons.join("; ")}`);

    const occurredAt = input.occurredAt ?? this.timestamp();
    const period = periodFromDate(occurredAt);
    const day = dayFromDate(occurredAt);
    const usage = clone(existing.usage);
    const monthly = ensureMonthlyConsumption(usage.monthly, period);
    const aiTokens = input.aiTokens ?? 0;
    const extraTokensUsed = calculateExtraTokensNeeded(existing, monthly, aiTokens);
    monthly.aiTokens += aiTokens;
    monthly.estimatedCost += input.estimatedCost ?? 0;
    monthly.realCost += input.realCost ?? 0;
    monthly.publications += input.publications ?? 0;
    monthly.campaigns += input.campaigns ?? 0;
    monthly.images += input.images ?? 0;
    monthly.videos += input.videos ?? 0;
    monthly.dailyAiTokens[day] = (monthly.dailyAiTokens[day] ?? 0) + aiTokens;

    const credits = {
      addedAiTokens: existing.credits.addedAiTokens,
      consumedExtraAiTokens: existing.credits.consumedExtraAiTokens + extraTokensUsed,
      availableExtraAiTokens: existing.credits.availableExtraAiTokens - extraTokensUsed,
    };
    const updated = this.withMutation(existing, input.audit, "credits_consumed", "Consumo registrado.", {
      usage: existing.usage,
      credits: existing.credits,
    }, {
      usage,
      credits,
      consumed: input,
    }, {
      ...existing,
      usage,
      credits,
      updatedAt: this.timestamp(),
    });

    await this.repository.save(updated);
    await this.log("CreditsConsumed", "Consumo registrado pela Valentina.", input.audit.actor, updated, { consumed: input });
    await this.emit("CreditsConsumed", updated, input.audit.actor, { consumed: input });
    return clone(updated);
  }

  async connectIntegration(input: TenantIntegrationInput): Promise<TenantRecord> {
    validateAudit(input.audit);
    const existing = await this.requireTenant(input.tenantId);
    const limitCheck = this.evaluateLimits(existing, { integration: input.network });
    if (!limitCheck.allowed) throw new Error(`Integração bloqueada pela Valentina: ${limitCheck.reasons.join("; ")}`);

    const integration = {
      network: input.network,
      status: "connected" as const,
      connectedAt: this.timestamp(),
      tokenReference: input.tokenReference,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
      metadata: input.metadata,
    };
    const integrations = {
      ...existing.integrations,
      [input.network]: integration,
    };
    const connectedSocialNetworks = Array.from(new Set([...existing.connectedSocialNetworks, input.network]));
    const updated = this.withMutation(existing, input.audit, "integration_connected", "Integração conectada.", {
      integrations: existing.integrations[input.network],
      connectedSocialNetworks: existing.connectedSocialNetworks,
    }, {
      integration,
      connectedSocialNetworks,
    }, {
      ...existing,
      integrations,
      connectedSocialNetworks,
      updatedAt: this.timestamp(),
    });

    await this.repository.save(updated);
    await this.log("IntegrationConnected", "Integração conectada pela Valentina.", input.audit.actor, updated, { network: input.network }, input.network);
    await this.emit("IntegrationConnected", updated, input.audit.actor, { network: input.network });
    return clone(updated);
  }

  async disconnectIntegration(input: TenantIntegrationInput): Promise<TenantRecord> {
    validateAudit(input.audit);
    const existing = await this.requireTenant(input.tenantId);
    const previous = existing.integrations[input.network];
    const integration = {
      ...(previous ?? { network: input.network }),
      network: input.network,
      status: "disconnected" as const,
      disconnectedAt: this.timestamp(),
    };
    const integrations = {
      ...existing.integrations,
      [input.network]: integration,
    };
    const connectedSocialNetworks = existing.connectedSocialNetworks.filter((network) => network !== input.network);
    const updated = this.withMutation(existing, input.audit, "integration_disconnected", "Integração desconectada.", {
      integrations: previous,
      connectedSocialNetworks: existing.connectedSocialNetworks,
    }, {
      integration,
      connectedSocialNetworks,
    }, {
      ...existing,
      integrations,
      connectedSocialNetworks,
      updatedAt: this.timestamp(),
    });

    await this.repository.save(updated);
    await this.log("IntegrationDisconnected", "Integração desconectada pela Valentina.", input.audit.actor, updated, { network: input.network }, input.network);
    await this.emit("IntegrationDisconnected", updated, input.audit.actor, { network: input.network });
    return clone(updated);
  }

  async getTenant(query: TenantQuery): Promise<TenantRecord | undefined> {
    const tenant = query.tenantId
      ? await this.repository.findById(query.tenantId)
      : query.clientId
        ? await this.repository.findByClientId(query.clientId)
        : (await this.listTenants({ ...query, limit: 1 }))[0];
    if (tenant) {
      await this.log("TenantRequested", "Cliente consultado na Valentina.", undefined, tenant);
      await this.log("TenantDelivered", "Cliente entregue pela Valentina.", undefined, tenant);
    }
    return clone(tenant);
  }

  async listTenants(query: TenantQuery = {}): Promise<TenantRecord[]> {
    return (await this.repository.list(query)).map(clone);
  }

  async getClientContext(tenantId: string): Promise<TenantClientContext> {
    const tenant = await this.requireTenant(tenantId);
    await this.log("TenantRequested", "Contexto de cliente solicitado à Valentina.", undefined, tenant);
    const context: TenantClientContext = {
      tenantId: tenant.id,
      clientId: tenant.clientId,
      plan: tenant.plan,
      status: tenant.status,
      subscriptionStatus: tenant.subscriptionStatus,
      timezone: tenant.settings.timezone,
      language: tenant.settings.language,
      country: tenant.settings.country,
      environment: tenant.settings.environment,
      aiPriority: tenant.settings.preferences.aiPriority,
      enabledSpecialists: tenant.enabledSpecialists,
      enabledFeatures: tenant.enabledFeatures,
      planLimits: tenant.planLimits,
    };
    await this.log("TenantDelivered", "Contexto de cliente entregue pela Valentina.", undefined, tenant);
    return clone(context);
  }

  async canUseSpecialist(tenantId: string, capability: SkillCapability): Promise<boolean> {
    const tenant = await this.requireTenant(tenantId);
    const allowed = tenant.enabledSpecialists === "all" || tenant.enabledSpecialists.includes(capability);
    await this.log("LimitChecked", "Permissão de Especialista consultada na Valentina.", undefined, tenant, { capability, allowed });
    return allowed;
  }

  async checkLimits(request: TenantLimitCheckRequest): Promise<TenantLimitCheckResult> {
    const tenant = await this.requireTenant(request.tenantId);
    const result = this.evaluateLimits(tenant, {
      capability: request.capability,
      feature: request.feature,
      integration: request.integration,
      ...(request.expectedConsumption ?? {}),
    });
    await this.log("LimitChecked", "Limites consultados na Valentina.", undefined, tenant, {
      request,
      allowed: result.allowed,
      reasons: result.reasons,
    });
    return clone(result);
  }

  async getPlan(code: TenantPlanCode): Promise<TenantPlanDefinition> {
    return getValentinaPlanDefinition(code);
  }

  private evaluateLimits(
    tenant: TenantRecord,
    input: Partial<TenantConsumptionInput> & { capability?: SkillCapability; feature?: string; integration?: TenantSocialNetwork },
  ): TenantLimitCheckResult {
    const reasons: string[] = [];
    const period = periodFromDate(input.occurredAt ?? this.timestamp());
    const day = dayFromDate(input.occurredAt ?? this.timestamp());
    const monthly = tenant.usage.monthly.find((usage) => usage.period === period) ?? createMonthlyConsumption(period);

    if (tenant.status !== "active" && tenant.status !== "created") reasons.push(`Cliente está com status ${tenant.status}.`);
    if (tenant.subscriptionStatus === "expired" || tenant.subscriptionStatus === "cancelled") {
      reasons.push(`Assinatura está ${tenant.subscriptionStatus}.`);
    }

    if (input.capability && tenant.enabledSpecialists !== "all" && !tenant.enabledSpecialists.includes(input.capability)) {
      reasons.push(`Especialista ${input.capability} não liberado no plano ${tenant.plan}.`);
    }
    if (input.feature && tenant.enabledFeatures !== "all" && !tenant.enabledFeatures.includes(input.feature)) {
      reasons.push(`Recurso ${input.feature} não liberado no plano ${tenant.plan}.`);
    }
    if (input.integration && tenant.planLimits.integrations !== "all" && !tenant.planLimits.integrations.includes(input.integration)) {
      reasons.push(`Integração ${input.integration} não liberada no plano ${tenant.plan}.`);
    }

    const aiTokens = input.aiTokens ?? 0;
    if (aiTokens > 0) {
      const dailyTotal = (monthly.dailyAiTokens[day] ?? 0) + aiTokens;
      if (exceedsLimit(dailyTotal, tenant.planLimits.dailyAiTokens)) {
        reasons.push(`Limite diário de IA excedido para o plano ${tenant.plan}.`);
      }

      const extraNeeded = calculateExtraTokensNeeded(tenant, monthly, aiTokens);
      if (extraNeeded > tenant.credits.availableExtraAiTokens) {
        reasons.push(`Limite mensal de IA excedido e créditos extras insuficientes.`);
      }
    }

    if (exceedsLimit(monthly.publications + (input.publications ?? 0), tenant.planLimits.monthlyPublications)) {
      reasons.push(`Limite mensal de publicações excedido.`);
    }
    if (exceedsLimit(monthly.campaigns + (input.campaigns ?? 0), tenant.planLimits.monthlyCampaigns)) {
      reasons.push(`Limite mensal de campanhas excedido.`);
    }
    if (exceedsLimit(monthly.images + (input.images ?? 0), tenant.planLimits.monthlyImages)) {
      reasons.push(`Limite mensal de imagens excedido.`);
    }
    if (exceedsLimit(monthly.videos + (input.videos ?? 0), tenant.planLimits.monthlyVideos)) {
      reasons.push(`Limite mensal de vídeos excedido.`);
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      tenant,
    };
  }

  private withMutation(
    existing: TenantRecord,
    audit: TenantAuditMetadata,
    action: TenantHistoryEntry["action"],
    changeSummary: string,
    oldValues: Record<string, unknown> | undefined,
    newValues: Record<string, unknown> | undefined,
    nextRecord: TenantRecord,
  ): TenantRecord {
    validateAudit(audit);
    const nextVersion = existing.currentVersion + 1;
    const base = {
      ...nextRecord,
      currentVersion: nextVersion,
      versions: undefined,
      history: undefined,
    };
    const version = this.createVersion(nextVersion, base, audit, changeSummary);
    const history = this.createHistory(action, audit, nextVersion, oldValues, newValues);
    return {
      ...nextRecord,
      currentVersion: nextVersion,
      versions: [...existing.versions, version],
      history: [...existing.history, history],
    };
  }

  private createVersion(
    version: number,
    snapshot: Omit<TenantRecord, "versions" | "history">,
    audit: TenantAuditMetadata,
    changeSummary: string,
  ): TenantVersion {
    validateAudit(audit);
    return {
      version,
      createdAt: this.timestamp(),
      createdBy: audit.actor,
      reason: audit.reason,
      snapshot: maskTokenReferencesDeep(clone(snapshot)),
      changeSummary,
    };
  }

  private createHistory(
    action: TenantHistoryEntry["action"],
    audit: TenantAuditMetadata,
    version: number,
    oldValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
  ): TenantHistoryEntry {
    validateAudit(audit);
    return {
      id: this.idGenerator.create("tenant-history"),
      occurredAt: this.timestamp(),
      action,
      actor: audit.actor,
      reason: audit.reason,
      version,
      oldValues: oldValues ? maskTokenReferencesDeep(clone(oldValues)) : undefined,
      newValues: newValues ? maskTokenReferencesDeep(clone(newValues)) : undefined,
    };
  }

  private async requireTenant(tenantId: string): Promise<TenantRecord> {
    const tenant = await this.repository.findById(tenantId);
    if (!tenant) throw new Error(`Cliente ${tenantId} não encontrado pela Valentina.`);
    return tenant;
  }

  private async log(
    action: ValentinaLogAction,
    message: string,
    actor?: TenantActor,
    tenant?: TenantRecord,
    metadata: Record<string, unknown> = {},
    network?: TenantSocialNetwork,
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("valentina-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      actor,
      tenantId: tenant?.id,
      clientId: tenant?.clientId,
      plan: tenant?.plan,
      network,
      version: tenant?.currentVersion,
      metadata,
    });
  }

  private async emit(name: ZunoEventName, tenant: TenantRecord, actor?: TenantActor, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      payload: {
        source: "valentina",
        actor,
        tenantId: tenant.id,
        clientId: tenant.clientId,
        plan: tenant.plan,
        version: tenant.currentVersion,
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateCreateInput(input: CreateTenantInput): void {
  if (!input.displayName?.trim()) throw new Error("displayName é obrigatório para cadastrar cliente.");
  if (!input.timezone?.trim()) throw new Error("timezone é obrigatório para cadastrar cliente.");
  if (!input.language?.trim()) throw new Error("language é obrigatório para cadastrar cliente.");
  if (!input.country?.trim()) throw new Error("country é obrigatório para cadastrar cliente.");
  if (!input.environment) throw new Error("environment é obrigatório para cadastrar cliente.");
  validateAudit(input.audit);
}

function validateAudit(audit: TenantAuditMetadata): void {
  if (!audit?.actor?.id?.trim()) throw new Error("audit.actor.id é obrigatório.");
  if (!audit.actor.type) throw new Error("audit.actor.type é obrigatório.");
}

function defaultPermissions(plan: TenantPlanCode) {
  const paid = plan !== "FREE";
  const proOrHigher = ["PRO", "BUSINESS", "ENTERPRISE"].includes(plan);
  return {
    canPublish: paid,
    canCreateCampaigns: proOrHigher,
    canUsePaidAds: proOrHigher,
    canUseImageGeneration: paid,
    canUseVideoGeneration: proOrHigher,
  };
}

function createMonthlyConsumption(period: string): TenantMonthlyConsumption {
  return {
    period,
    aiTokens: 0,
    estimatedCost: 0,
    realCost: 0,
    publications: 0,
    campaigns: 0,
    images: 0,
    videos: 0,
    dailyAiTokens: {},
  };
}

function ensureMonthlyConsumption(monthly: TenantMonthlyConsumption[], period: string): TenantMonthlyConsumption {
  let record = monthly.find((current) => current.period === period);
  if (!record) {
    record = createMonthlyConsumption(period);
    monthly.push(record);
  }
  return record;
}

function calculateExtraTokensNeeded(tenant: TenantRecord, monthly: TenantMonthlyConsumption, aiTokens: number): number {
  if (tenant.planLimits.monthlyAiTokens === "unlimited") return 0;
  const remainingPlanTokens = Math.max(0, tenant.planLimits.monthlyAiTokens - monthly.aiTokens);
  return Math.max(0, aiTokens - remainingPlanTokens);
}

function exceedsLimit(value: number, limit: number | "unlimited"): boolean {
  return limit !== "unlimited" && value > limit;
}

function periodFromDate(date: string): string {
  return date.slice(0, 7);
}

function dayFromDate(date: string): string {
  return date.slice(0, 10);
}

function pickChangedValues(record: TenantRecord, patch: UpdateTenantInput["patch"]): Record<string, unknown> {
  const oldValues: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    oldValues[key] = (record as unknown as Record<string, unknown>)[key];
  }
  return oldValues;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}

/**
 * Mascara qualquer campo `tokenReference` encontrado recursivamente num valor — usado apenas ao
 * gravar histórico/versões (auditoria), nunca no estado vivo do tenant (`integrations`), que
 * continua com o valor real para uso operacional. Reduz quantas cópias em texto puro de um
 * credential de integração social ficam persistidas em `tenants.json` ao longo do tempo.
 */
function maskTokenReferencesDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskTokenReferencesDeep(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = key === "tokenReference" ? maskToken(entry) : maskTokenReferencesDeep(entry);
    }
    return result as T;
  }
  return value;
}

function maskToken(token: unknown): unknown {
  if (typeof token !== "string" || token.length === 0) return token;
  return token.length <= 4 ? "••••" : `••••${token.slice(-4)}`;
}

export function createValentinaTenantManager(dependencies: ValentinaTenantManagerDependencies): ValentinaTenantManager {
  return new ValentinaTenantManager(dependencies);
}
