import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { SocialRepositoryPort } from "../ports/social-repository.port.js";
import { ensurePublicationOutboxIntents } from "../publication/publication-outbox-intent.js";
import { assertIanaTimezone, isValidIanaTimezone, zonedTimeToUtc } from "../scheduling/timezone.js";
import type { SocialAccountService } from "./social-account-service.js";
import type { SocialAuditActor, SocialAuditLog } from "./social-audit.js";
import { type SocialMediaProbePort, validateAgainstCapability } from "./social-media-validation.js";
import type { SocialProviderResolver } from "./social-provider-resolver.js";
import { composeCaption } from "./social-publication-router.js";
import type { SocialValidationIssue } from "./social-publishing-provider.port.js";
import type { SocialSessionVault } from "./social-session-vault.js";
import type { PublicationDetail, PublicationSourceArtifact } from "../../domain/publication/publication.model.js";
import {
  deriveDestinationState,
  derivePostState,
  effectiveFormatCapabilities,
  FORMAT_LABEL,
  isAccountPublishable,
  NETWORK_LABEL,
  userMessageForError,
  type SocialAccount,
  type SocialAudioMode,
  type SocialDestinationState,
  type SocialFeature,
  type SocialMediaItem,
  type SocialMusicSelection,
  type SocialMusicTrack,
  type SocialNetwork,
  type SocialPostDestination,
  type SocialPostFormat,
  type SocialPostState,
} from "../../domain/social/social-publishing.model.js";

export type SocialPostServiceDeps = {
  repository: SocialRepositoryPort;
  publicationRepository: PublicationRepositoryPort;
  accounts: SocialAccountService;
  resolver: SocialProviderResolver;
  vault: SocialSessionVault;
  audit: SocialAuditLog;
  mediaProbe?: SocialMediaProbePort;
  idGenerator: () => string;
  now?: () => Date;
  defaultTimezone?: string;
  /** Fuso do workspace (configuração do cliente); prevalece sobre o padrão da plataforma. */
  timezoneFor?: (input: { tenantId: string; workspaceId: string }) => Promise<string | undefined>;
};

/** Conteúdo base + personalização opcional por rede (legenda, hashtags, música, formato, mídia). */
export type SocialComposeInput = {
  tenantId: string;
  workspaceId: string;
  actor: SocialAuditActor;
  idempotencyKey: string;
  base: { caption: string; hashtags?: readonly string[]; media: readonly SocialMediaItem[] };
  destinations: readonly {
    accountId: string;
    format: SocialPostFormat;
    caption?: string;
    hashtags?: readonly string[];
    media?: readonly SocialMediaItem[];
    music?: SocialMusicSelection;
    audioMode?: SocialAudioMode;
  }[];
  when: { mode: "now" } | { mode: "schedule"; localDateTime: string; timezone?: string };
  /** Conteúdo de IA pode exigir aprovação antes de ir para a rede. */
  requireApproval?: boolean;
  source?: { executionRunId?: string; artifacts?: readonly PublicationSourceArtifact[] };
};

export type SocialDestinationCheck = {
  accountId: string;
  network: SocialNetwork;
  format: SocialPostFormat;
  issues: SocialValidationIssue[];
  /** Avisos que não impedem salvar (ex.: conta precisa reconectar → ficará aguardando). */
  warnings: string[];
};

export type SocialComposerAccountOption = {
  accountId: string;
  network: SocialNetwork;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  publishable: boolean;
  warning?: string;
  formats: { format: SocialPostFormat; label: string; features: readonly SocialFeature[]; maxItems: number; kinds: readonly ("image" | "video")[]; maxCaptionLength: number }[];
  musicSearch: boolean;
};

export type SocialDestinationView = {
  id: string;
  accountId: string;
  network: SocialNetwork;
  username?: string;
  format: SocialPostFormat;
  formatLabel: string;
  caption: string;
  hashtags: readonly string[];
  media: readonly SocialMediaItem[];
  music?: SocialMusicSelection;
  audioMode: SocialAudioMode;
  scheduledAt?: string;
  timezone?: string;
  state: SocialDestinationState;
  attemptCount: number;
  lastAttemptAt?: string;
  publishedAt?: string;
  externalPostId?: string;
  externalUrl?: string;
  problem?: string;
  actions: ("retry" | "cancel" | "confirm_late" | "skip_late" | "reconnect" | "resolve_unknown")[];
};

/** Linha do tempo amigável — sem logs técnicos. */
export type SocialPostHistoryEntry = {
  at: string;
  kind: "created" | "scheduled" | "attempt" | "retry" | "published" | "failed" | "reconnect_needed" | "confirmation_pending" | "reconciled" | "cancelled";
  label: string;
  network?: SocialNetwork;
  /** Para "agendada": o horário escolhido (a tela formata no fuso do usuário). */
  scheduledFor?: string;
};

export type SocialPostView = {
  id: string;
  state: SocialPostState;
  scheduledAt?: string;
  timezone?: string;
  createdAt: string;
  requiresApproval: boolean;
  destinations: SocialDestinationView[];
  history: SocialPostHistoryEntry[];
};

export class SocialPostService {
  constructor(private readonly deps: SocialPostServiceDeps) {}

  /** O que o composer pode oferecer: só formatos/recursos que o provider E a conta suportam. */
  async composerOptions(input: { tenantId: string; workspaceId: string }): Promise<SocialComposerAccountOption[]> {
    const accounts = await this.deps.repository.listAccounts(input);
    const options: SocialComposerAccountOption[] = [];
    for (const account of accounts.filter((item) => item.status !== "DISCONNECTED")) {
      const resolution = await this.deps.resolver.resolveForAccount(account);
      const provider = resolution.ok ? resolution.provider : this.deps.resolver.providers.get(account.providerType);
      if (!provider) continue;
      const formats = effectiveFormatCapabilities(provider.getCapabilities(account.network), account.accountCapabilities);
      options.push({
        accountId: account.id,
        network: account.network,
        username: account.username,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        publishable: isAccountPublishable(account.status) && resolution.ok,
        ...(isAccountPublishable(account.status) ? (resolution.ok ? {} : { warning: `Publicações no ${NETWORK_LABEL[account.network]} estão pausadas no momento. Você pode agendar; elas sairão quando a integração voltar.` }) : { warning: userMessageForError(account.network, account.status === "CHECKPOINT_REQUIRED" ? "CHECKPOINT_REQUIRED" : "AUTH_REQUIRED") }),
        formats: formats.map((format) => ({ format: format.format, label: FORMAT_LABEL[format.format], features: format.features, maxItems: format.constraints.maxItems, kinds: format.constraints.kinds, maxCaptionLength: format.maxCaptionLength })),
        musicSearch: !!provider.searchMusic && provider.getCapabilities(account.network).supportsMusicSearch && formats.some((format) => format.features.includes("nativeMusic")),
      });
    }
    return options;
  }

  /** Validação por destino ANTES de agendar (mídia lida no servidor, não confiada ao navegador). */
  async validate(input: Omit<SocialComposeInput, "idempotencyKey" | "when" | "actor">): Promise<SocialDestinationCheck[]> {
    const checks: SocialDestinationCheck[] = [];
    for (const destination of input.destinations) {
      const account = await this.deps.repository.getAccount({ tenantId: input.tenantId, workspaceId: input.workspaceId, id: destination.accountId });
      if (!account) {
        // Conta de outro tenant/workspace é tratada como inexistente (isolamento no backend).
        checks.push({ accountId: destination.accountId, network: "instagram", format: destination.format, issues: [{ field: "format", code: "SOCIAL_ACCOUNT_NOT_FOUND", message: "Conta social não encontrada." }], warnings: [] });
        continue;
      }
      const merged = this.merge(input.base, destination);
      const media = await this.probe(merged.media);
      const resolution = await this.deps.resolver.resolveForAccount(account);
      const provider = resolution.ok ? resolution.provider : this.deps.resolver.providers.get(account.providerType);
      const capability = provider ? effectiveFormatCapabilities(provider.getCapabilities(account.network), account.accountCapabilities).find((item) => item.format === destination.format) : undefined;
      const caption = composeCaption({ caption: merged.caption, hashtags: merged.hashtags });
      const issues = [
        ...validateAgainstCapability({ network: account.network, capability, caption, media, music: destination.music, embeddedAudio: destination.audioMode === "EMBEDDED_AUDIO" }),
        ...(provider && capability ? provider.validatePost({ network: account.network, format: destination.format, caption, media, music: destination.music }) : []),
      ];
      const warnings: string[] = [];
      if (!isAccountPublishable(account.status)) warnings.push(`${userMessageForError(account.network, account.status === "CHECKPOINT_REQUIRED" ? "CHECKPOINT_REQUIRED" : "AUTH_REQUIRED")} A publicação ficará aguardando a reconexão.`);
      else if (!resolution.ok) warnings.push(`Publicações no ${NETWORK_LABEL[account.network]} estão pausadas no momento; o agendamento será preservado.`);
      checks.push({ accountId: account.id, network: account.network, format: destination.format, issues, warnings });
    }
    return checks;
  }

  /**
   * Um post conceitual → um PublicationPlan com um target (destino) por conta/rede. Cada destino
   * tem estado, tentativa e retry próprios: falha no TikTok não desfaz o Instagram já publicado.
   */
  async create(input: SocialComposeInput): Promise<SocialPostView> {
    if (input.destinations.length === 0) throw new Error("SOCIAL_DESTINATIONS_REQUIRED: escolha ao menos uma rede.");
    const existing = await this.deps.publicationRepository.getPlanByIdempotency({ tenantId: input.tenantId, workspaceId: input.workspaceId, idempotencyKey: `social:${input.idempotencyKey}` });
    if (existing) return this.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, postId: existing.id });

    const seen = new Set<string>();
    for (const destination of input.destinations) {
      const key = `${destination.accountId}:${destination.format}`;
      if (seen.has(key)) throw new Error("SOCIAL_DESTINATION_DUPLICATED: a mesma conta e formato foram escolhidos duas vezes.");
      seen.add(key);
    }
    const checks = await this.validate(input);
    const invalid = checks.filter((check) => check.issues.length > 0);
    if (invalid.length > 0) {
      const first = invalid[0]!;
      const error = new Error(`SOCIAL_VALIDATION_FAILED: ${NETWORK_LABEL[first.network]} — ${first.issues[0]!.message}`) as Error & { details?: unknown };
      error.details = checks;
      throw error;
    }

    const timezone = (input.when.mode === "schedule" ? input.when.timezone : undefined) ?? await this.workspaceTimezone(input);
    let scheduledAt: string | undefined;
    if (input.when.mode === "schedule") {
      assertIanaTimezone(timezone);
      scheduledAt = zonedTimeToUtc(input.when.localDateTime, timezone);
      if (Date.parse(scheduledAt) < this.now().getTime() - 60_000) throw new Error("SOCIAL_SCHEDULE_IN_PAST: escolha um horário no futuro.");
    }

    const accounts = new Map<string, SocialAccount>();
    for (const destination of input.destinations) {
      const account = await this.deps.repository.getAccount({ tenantId: input.tenantId, workspaceId: input.workspaceId, id: destination.accountId });
      if (!account) throw new Error("SOCIAL_ACCOUNT_NOT_FOUND: conta social não encontrada.");
      accounts.set(account.id, account);
    }

    const planId = this.deps.idGenerator();
    const now = this.now().toISOString();
    const requireApproval = input.requireApproval ?? false;
    const prepared = await Promise.all(input.destinations.map(async (destination) => {
      const merged = this.merge(input.base, destination);
      return { destination, merged: { ...merged, media: await this.probe(merged.media) }, account: accounts.get(destination.accountId)!, candidateId: this.deps.idGenerator(), targetId: this.deps.idGenerator(), destinationId: this.deps.idGenerator() };
    }));
    const sourceArtifacts: PublicationSourceArtifact[] = input.source?.artifacts?.length
      ? [...input.source.artifacts]
      : [{ artifactId: `social-post:${planId}`, artifactType: "document", schemaId: "social.post", schemaVersion: 1, checksum: planId, payload: { caption: input.base.caption.slice(0, 500) } }];

    await this.deps.publicationRepository.createPlan({
      plan: {
        id: planId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        state: requireApproval ? "waiting_for_approval" : "approved",
        mode: "real",
        idempotencyKey: `social:${input.idempotencyKey}`,
        sourceExecutionRunId: input.source?.executionRunId,
        sourceArtifacts,
        policy: { allowPublish: true, requireApproval, allowedChannels: [...new Set(prepared.map((item) => item.account.network))], allowedProviders: ["social"], publishMode: "real", approvalPolicy: requireApproval ? "required" : "optional", maxRetries: 3, rollbackSupported: false },
        correlationId: planId,
        traceId: this.deps.idGenerator(),
        scheduledAt,
        timezone,
        ...(requireApproval ? {} : { approvedAt: now }),
      },
      candidates: prepared.map((item) => ({
        id: item.candidateId,
        publicationId: planId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        // Só referência ao destino: o conteúdo social mora em social_post_destinations.
        content: { socialDestinationId: item.destinationId, network: item.account.network, format: item.destination.format },
        assets: [],
        metadata: { socialAccountId: item.account.id },
      })),
      targets: prepared.map((item) => ({
        id: item.targetId,
        publicationId: planId,
        candidateId: item.candidateId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channel: item.account.network,
        provider: "social" as const,
        mode: "real" as const,
        status: "pending" as const,
        idempotencyKey: `${planId}:${item.account.id}:${item.destination.format}:${input.idempotencyKey}`,
      })),
    });
    await this.deps.repository.createDestinations(prepared.map((item) => ({
      id: item.destinationId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      publicationId: planId,
      targetId: item.targetId,
      socialAccountId: item.account.id,
      network: item.account.network,
      format: item.destination.format,
      caption: item.merged.caption,
      hashtags: item.merged.hashtags,
      ...(item.destination.music ? { music: item.destination.music } : {}),
      audioMode: item.destination.music ? "NATIVE_PLATFORM_MUSIC" : (item.destination.audioMode ?? (item.merged.media.some((media) => media.kind === "video" && media.hasAudio) ? "EMBEDDED_AUDIO" : "NONE")),
      media: item.merged.media,
      scheduledAt,
      timezone,
      ...(isAccountPublishable(item.account.status) ? {} : { blockReason: "WAITING_REAUTH" as const, blockedAt: now }),
      createdBy: input.actor.userId,
    })));
    if (!requireApproval) {
      await this.deps.publicationRepository.appendApproval({ id: this.deps.idGenerator(), publicationId: planId, tenantId: input.tenantId, workspaceId: input.workspaceId, approvedByUserId: input.actor.userId, reason: "Aprovado ao agendar no composer social." });
    }
    await this.deps.publicationRepository.appendEvent({ id: this.deps.idGenerator(), publicationId: planId, eventType: "publication_created", correlationId: planId, payload: { source: "social_composer", destinations: prepared.length } });

    if (scheduledAt) {
      await this.deps.publicationRepository.createSchedule({ id: this.deps.idGenerator(), publicationId: planId, tenantId: input.tenantId, workspaceId: input.workspaceId, scheduledAt, timezone, status: "scheduled" });
      await this.deps.publicationRepository.appendEvent({ id: this.deps.idGenerator(), publicationId: planId, eventType: "publication_scheduled", correlationId: planId, payload: { scheduledAt, timezone } });
    } else if (!requireApproval) {
      await this.startNow(input.tenantId, input.workspaceId, planId);
    }

    for (const item of prepared) {
      await this.deps.audit.record({ tenantId: input.tenantId, workspaceId: input.workspaceId, event: "POST_SCHEDULED", actor: input.actor, resource: { type: "social_post", id: planId }, metadata: { destinationId: item.destinationId, network: item.account.network, format: item.destination.format, scheduledAt: scheduledAt ?? "now", requireApproval } });
      if (item.destination.music) await this.deps.audit.record({ tenantId: input.tenantId, workspaceId: input.workspaceId, event: "MUSIC_SELECTED", actor: input.actor, resource: { type: "social_post", id: planId }, metadata: { destinationId: item.destinationId, network: item.account.network, musicId: item.destination.music.musicId, title: item.destination.music.title } });
    }
    return this.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, postId: planId });
  }

  async approve(input: { tenantId: string; workspaceId: string; postId: string; actor: SocialAuditActor }): Promise<SocialPostView> {
    const detail = await this.requireDetail(input);
    if (detail.plan.state !== "waiting_for_approval") throw new Error("SOCIAL_POST_NOT_AWAITING_APPROVAL: esta publicação não está aguardando aprovação.");
    await this.deps.publicationRepository.appendApproval({ id: this.deps.idGenerator(), publicationId: detail.plan.id, tenantId: input.tenantId, workspaceId: input.workspaceId, approvedByUserId: input.actor.userId, reason: "Aprovado no Marketing." });
    await this.deps.publicationRepository.updatePlanState({ id: detail.plan.id, state: "approved", expectedVersion: detail.plan.version, approvedAt: this.now().toISOString() });
    if (!detail.schedules.some((schedule) => schedule.status === "scheduled")) await this.startNow(input.tenantId, input.workspaceId, detail.plan.id);
    return this.get(input);
  }

  async publishNow(input: { tenantId: string; workspaceId: string; postId: string; actor: SocialAuditActor }): Promise<SocialPostView> {
    const detail = await this.requireDetail(input);
    if (detail.plan.state === "waiting_for_approval") throw new Error("SOCIAL_POST_AWAITING_APPROVAL: aprove a publicação antes de publicar.");
    for (const schedule of detail.schedules.filter((item) => item.status === "scheduled")) await this.deps.publicationRepository.updateScheduleStatus({ id: schedule.id, status: "cancelled" });
    await this.startNow(input.tenantId, input.workspaceId, detail.plan.id);
    return this.get(input);
  }

  async reschedule(input: { tenantId: string; workspaceId: string; postId: string; localDateTime: string; timezone?: string; actor: SocialAuditActor }): Promise<SocialPostView> {
    const detail = await this.requireDetail(input);
    if (detail.targets.some((target) => target.status === "published" || target.status === "publishing") || detail.outbox.some((message) => message.status === "claimed")) {
      throw new Error("SOCIAL_POST_ALREADY_STARTED: parte desta publicação já saiu; não é possível reagendar.");
    }
    const timezone = input.timezone ?? detail.plan.timezone ?? await this.workspaceTimezone(input);
    assertIanaTimezone(timezone);
    const scheduledAt = zonedTimeToUtc(input.localDateTime, timezone);
    if (Date.parse(scheduledAt) < this.now().getTime() - 60_000) throw new Error("SOCIAL_SCHEDULE_IN_PAST: escolha um horário no futuro.");
    for (const schedule of detail.schedules.filter((item) => item.status === "scheduled")) await this.deps.publicationRepository.updateScheduleStatus({ id: schedule.id, status: "cancelled" });
    await this.deps.publicationRepository.createSchedule({ id: this.deps.idGenerator(), publicationId: detail.plan.id, tenantId: input.tenantId, workspaceId: input.workspaceId, scheduledAt, timezone, status: "scheduled" });
    // Mensagens já criadas (ex.: publicar agora pendente) passam a respeitar o novo horário.
    for (const target of detail.targets) await this.deps.publicationRepository.rescheduleTargetOutbox({ targetId: target.id, availableAt: scheduledAt });
    for (const destination of await this.deps.repository.listDestinationsByPublication({ tenantId: input.tenantId, workspaceId: input.workspaceId, publicationId: detail.plan.id })) {
      await this.deps.repository.updateDestination({ tenantId: input.tenantId, id: destination.id, patch: { scheduledAt, timezone } });
    }
    await this.deps.audit.record({ tenantId: input.tenantId, workspaceId: input.workspaceId, event: "POST_RESCHEDULED", actor: input.actor, resource: { type: "social_post", id: detail.plan.id }, metadata: { scheduledAt, timezone } });
    return this.get(input);
  }

  /** Cancela o post inteiro (o que já publicou continua publicado). */
  async cancel(input: { tenantId: string; workspaceId: string; postId: string; actor: SocialAuditActor }): Promise<SocialPostView> {
    const detail = await this.requireDetail(input);
    const now = this.now().toISOString();
    for (const target of detail.targets.filter((item) => item.status === "pending" || item.status === "failed")) {
      await this.deps.publicationRepository.cancelTarget({ targetId: target.id, now });
    }
    for (const schedule of detail.schedules.filter((item) => item.status === "scheduled")) await this.deps.publicationRepository.updateScheduleStatus({ id: schedule.id, status: "cancelled" });
    const refreshed = await this.requireDetail(input);
    if (!refreshed.targets.some((target) => target.status === "published")) {
      await this.deps.publicationRepository.updatePlanState({ id: detail.plan.id, state: "cancelled", cancelledAt: now });
    }
    await this.deps.audit.record({ tenantId: input.tenantId, workspaceId: input.workspaceId, event: "POST_CANCELLED", actor: input.actor, resource: { type: "social_post", id: detail.plan.id } });
    return this.get(input);
  }

  async cancelDestination(input: { tenantId: string; workspaceId: string; destinationId: string; actor: SocialAuditActor }): Promise<SocialPostView> {
    const destination = await this.requireDestination(input);
    const cancelled = await this.deps.publicationRepository.cancelTarget({ targetId: destination.targetId, now: this.now().toISOString() });
    if (!cancelled) throw new Error("SOCIAL_DESTINATION_NOT_CANCELLABLE: esta rede já publicou ou está publicando agora.");
    await this.deps.repository.updateDestination({ tenantId: input.tenantId, id: destination.id, patch: { clearBlock: true } });
    await this.deps.audit.record({ tenantId: input.tenantId, workspaceId: input.workspaceId, event: "POST_CANCELLED", actor: input.actor, resource: { type: "social_post", id: destination.publicationId }, metadata: { destinationId: destination.id, network: destination.network } });
    return this.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, postId: destination.publicationId });
  }

  /** Retry só do destino que falhou — redes já publicadas nunca repetem. */
  async retryDestination(input: { tenantId: string; workspaceId: string; destinationId: string; actor: SocialAuditActor }): Promise<SocialPostView> {
    const destination = await this.requireDestination(input);
    const detail = await this.requireDetail({ tenantId: input.tenantId, workspaceId: input.workspaceId, postId: destination.publicationId });
    const target = detail.targets.find((item) => item.id === destination.targetId);
    if (!target || target.status !== "failed") throw new Error("SOCIAL_DESTINATION_NOT_RETRYABLE: só é possível tentar de novo uma rede que falhou.");
    await this.deps.repository.updateDestination({ tenantId: input.tenantId, id: destination.id, patch: { lastErrorCode: undefined, lastErrorMessage: undefined, clearBlock: true } });
    await this.deps.publicationRepository.retireTargetOutbox({ targetId: target.id, now: this.now().toISOString() });
    await this.deps.publicationRepository.updateTargetStatus({ id: target.id, status: "pending" });
    await ensurePublicationOutboxIntents({ repository: this.deps.publicationRepository, idGenerator: this.deps.idGenerator, now: this.deps.now }, { tenantId: input.tenantId, workspaceId: input.workspaceId, publicationId: detail.plan.id, targetIds: [target.id] });
    return this.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, postId: destination.publicationId });
  }

  /**
   * Resultado desconhecido que a API do provider não permitiu verificar: o cliente confere na rede e
   * confirma. "Publicado" registra o recibo (não republica); "não publicado" libera o retry manual.
   */
  async resolveUnknown(input: { tenantId: string; workspaceId: string; destinationId: string; outcome: "published" | "not_published"; externalUrl?: string; actor: SocialAuditActor }): Promise<SocialPostView> {
    const destination = await this.requireDestination(input);
    const detail = await this.requireDetail({ tenantId: input.tenantId, workspaceId: input.workspaceId, postId: destination.publicationId });
    const target = detail.targets.find((item) => item.id === destination.targetId);
    if (!target || target.status !== "unknown_outcome") throw new Error("SOCIAL_DESTINATION_NOT_UNKNOWN: esta publicação não está aguardando verificação.");
    const reconciliation = (await this.deps.publicationRepository.listReconciliations({ tenantId: input.tenantId, workspaceId: input.workspaceId }))
      .find((item) => item.targetId === target.id && (item.status === "pending" || item.status === "inconclusive"));
    if (!reconciliation) throw new Error("SOCIAL_DESTINATION_NOT_UNKNOWN: esta publicação não está aguardando verificação.");
    if (reconciliation.status === "inconclusive") await this.deps.publicationRepository.updateReconciliationStatus({ id: reconciliation.id, status: "pending" });
    const now = this.now().toISOString();
    if (input.outcome === "published") {
      await this.deps.publicationRepository.confirmReconciliationPublished({
        reconciliationId: reconciliation.id,
        receiptId: this.deps.idGenerator(),
        now,
        receipt: {
          publicationId: detail.plan.id,
          targetId: target.id,
          attemptId: reconciliation.attemptId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          provider: target.provider,
          providerPublicationId: `confirmed-by-user:${destination.id}`,
          channel: target.channel,
          publishedAt: now,
          status: "published",
          url: input.externalUrl ?? "",
          checksum: detail.payloadReferences.find((payload) => payload.targetId === target.id)?.contentChecksum ?? "confirmed-by-user",
          correlationId: detail.plan.correlationId,
          traceId: detail.plan.traceId,
          idempotencyKey: reconciliation.idempotencyKey,
        },
      });
    } else {
      await this.deps.publicationRepository.confirmReconciliationNotPublished({ reconciliationId: reconciliation.id, now, failure: { code: "USER_CONFIRMED_NOT_PUBLISHED", message: "Confirmado pelo cliente que a publicação não saiu.", category: "provider_unavailable", retryable: false } });
    }
    await this.deps.audit.record({ tenantId: input.tenantId, workspaceId: input.workspaceId, event: input.outcome === "published" ? "POST_PUBLISHED" : "POST_FAILED", actor: input.actor, resource: { type: "social_post", id: detail.plan.id }, metadata: { destinationId: destination.id, network: destination.network, resolvedBy: "user_confirmation" } });
    return this.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, postId: detail.plan.id });
  }

  async get(input: { tenantId: string; workspaceId: string; postId: string }): Promise<SocialPostView> {
    const detail = await this.requireDetail(input);
    const destinations = await this.deps.repository.listDestinationsByPublication({ tenantId: input.tenantId, workspaceId: input.workspaceId, publicationId: detail.plan.id });
    const accounts = new Map((await this.deps.repository.listAccounts({ tenantId: input.tenantId, workspaceId: input.workspaceId })).map((account) => [account.id, account]));
    return this.toView(detail, destinations, accounts);
  }

  /** Calendário: posts sociais no intervalo, com estado por rede. */
  async calendar(input: { tenantId: string; workspaceId: string; from?: string; to?: string; limit?: number }): Promise<SocialPostView[]> {
    const destinations = await this.deps.repository.listDestinations({ tenantId: input.tenantId, workspaceId: input.workspaceId, from: input.from, to: input.to, limit: input.limit ?? 500 });
    const byPost = new Map<string, SocialPostDestination[]>();
    for (const destination of destinations) byPost.set(destination.publicationId, [...(byPost.get(destination.publicationId) ?? []), destination]);
    const accounts = new Map((await this.deps.repository.listAccounts({ tenantId: input.tenantId, workspaceId: input.workspaceId })).map((account) => [account.id, account]));
    const views: SocialPostView[] = [];
    for (const [postId, items] of byPost) {
      const detail = await this.deps.publicationRepository.getDetail(postId);
      if (!detail || detail.plan.tenantId !== input.tenantId || detail.plan.workspaceId !== input.workspaceId) continue;
      views.push(this.toView(detail, items, accounts));
    }
    return views.sort((left, right) => (left.scheduledAt ?? left.createdAt).localeCompare(right.scheduledAt ?? right.createdAt));
  }

  /** "Músicas disponíveis" para ESTA conta e formato, agora — nunca um catálogo prometido. */
  async searchMusic(input: { tenantId: string; workspaceId: string; accountId: string; query: string; format: SocialPostFormat; limit?: number }): Promise<{ available: boolean; tracks: SocialMusicTrack[]; message?: string }> {
    const account = await this.deps.accounts.requireAccount({ tenantId: input.tenantId, workspaceId: input.workspaceId, accountId: input.accountId });
    const resolution = await this.deps.resolver.resolveForAccount(account);
    if (!resolution.ok || !resolution.provider.searchMusic) return { available: false, tracks: [], message: `Música do ${NETWORK_LABEL[account.network]} não está disponível para esta conta.` };
    const capability = effectiveFormatCapabilities(resolution.provider.getCapabilities(account.network), account.accountCapabilities).find((item) => item.format === input.format);
    if (!capability?.features.includes("nativeMusic")) return { available: false, tracks: [], message: `Música do ${NETWORK_LABEL[account.network]} não está disponível neste formato.` };
    if (!isAccountPublishable(account.status)) return { available: false, tracks: [], message: userMessageForError(account.network, "AUTH_REQUIRED") };
    const session = await this.deps.vault.load(account, resolution.providerType);
    if (!session) return { available: false, tracks: [], message: userMessageForError(account.network, "AUTH_REQUIRED") };
    const query = input.query.trim().slice(0, 100);
    if (!query) return { available: true, tracks: [] };
    const result = await resolution.provider.searchMusic({ account: this.deps.accounts.context(account, session), query, format: input.format, limit: Math.min(input.limit ?? 20, 30) });
    if (!result.ok) {
      if (result.failure.errorClass === "AUTH_REQUIRED" || result.failure.errorClass === "SESSION_INVALID" || result.failure.errorClass === "CHECKPOINT_REQUIRED") await this.deps.accounts.applyFailure(account, result.failure);
      return { available: false, tracks: [], message: userMessageForError(account.network, result.failure.errorClass === "UNKNOWN" ? "TEMPORARY_PLATFORM_ERROR" : result.failure.errorClass) };
    }
    return { available: true, tracks: result.tracks.filter((track) => track.available) };
  }

  private toView(detail: PublicationDetail, destinations: readonly SocialPostDestination[], accounts: Map<string, SocialAccount>): SocialPostView {
    const hasSchedule = detail.schedules.some((schedule) => schedule.status === "scheduled" || schedule.status === "running");
    const views = destinations.map((destination): SocialDestinationView => {
      const target = detail.targets.find((item) => item.id === destination.targetId);
      // Mensagem vigente do destino: as aposentadas (retry/cancelamento) nunca representam o estado,
      // mesmo com horário de criação empatado.
      const outbox = detail.outbox
        .filter((message) => message.targetId === destination.targetId)
        .sort((left, right) => Number(left.status === "dead_lettered") - Number(right.status === "dead_lettered") || right.createdAt.localeCompare(left.createdAt))[0];
      const attempts = detail.attempts.filter((attempt) => attempt.targetId === destination.targetId);
      const receipt = detail.receipts.find((item) => item.targetId === destination.targetId);
      const account = accounts.get(destination.socialAccountId);
      const state = deriveDestinationState({ planState: detail.plan.state, targetStatus: target?.status ?? "pending", hasSchedule: hasSchedule || !!destination.scheduledAt, outboxStatus: outbox?.status, blockReason: destination.blockReason, skipped: !!destination.skippedAt });
      const actions: SocialDestinationView["actions"] = [];
      if (state === "FAILED") actions.push("retry");
      if (state === "SCHEDULED" || state === "WAITING_REAUTH" || state === "AWAITING_CONFIRMATION" || state === "PAUSED" || state === "AWAITING_APPROVAL") actions.push("cancel");
      if (state === "AWAITING_CONFIRMATION") actions.push("confirm_late", "skip_late");
      if (state === "WAITING_REAUTH") actions.push("reconnect");
      if (state === "RECONCILIATION_REQUIRED") actions.push("resolve_unknown");
      return {
        id: destination.id,
        accountId: destination.socialAccountId,
        network: destination.network,
        username: account?.username,
        format: destination.format,
        formatLabel: FORMAT_LABEL[destination.format],
        caption: destination.caption,
        hashtags: destination.hashtags,
        media: destination.media,
        ...(destination.music ? { music: destination.music } : {}),
        audioMode: destination.audioMode,
        scheduledAt: destination.scheduledAt,
        timezone: destination.timezone,
        state,
        attemptCount: Math.max(attempts.length ? outbox?.attemptCount ?? 0 : 0, attempts.length),
        lastAttemptAt: attempts.map((attempt) => attempt.startedAt).sort().at(-1),
        ...(receipt ? { publishedAt: receipt.publishedAt, externalPostId: receipt.providerPublicationId, externalUrl: receipt.url } : {}),
        ...(state === "PUBLISHED" || !destination.lastErrorMessage ? {} : { problem: destination.lastErrorMessage }),
        ...(state === "PAUSED" ? { problem: `Publicações no ${NETWORK_LABEL[destination.network]} estão pausadas no momento. O agendamento foi preservado.` } : {}),
        actions,
      };
    });
    return {
      id: detail.plan.id,
      state: derivePostState(views.map((view) => view.state)),
      scheduledAt: detail.plan.scheduledAt ?? destinations[0]?.scheduledAt,
      timezone: detail.plan.timezone,
      createdAt: detail.plan.createdAt,
      requiresApproval: detail.plan.state === "waiting_for_approval",
      destinations: views,
      history: buildHistory(detail, destinations),
    };
  }

  /** Fuso efetivo: do workspace do cliente; senão o padrão da plataforma. */
  async workspaceTimezone(input: { tenantId: string; workspaceId: string }): Promise<string> {
    const configured = await this.deps.timezoneFor?.(input).catch(() => undefined);
    return configured && isValidIanaTimezone(configured) ? configured : this.deps.defaultTimezone ?? "America/Sao_Paulo";
  }

  private async startNow(tenantId: string, workspaceId: string, publicationId: string): Promise<void> {
    await ensurePublicationOutboxIntents({ repository: this.deps.publicationRepository, idGenerator: this.deps.idGenerator, now: this.deps.now }, { tenantId, workspaceId, publicationId });
  }

  private merge(base: SocialComposeInput["base"], destination: SocialComposeInput["destinations"][number]): { caption: string; hashtags: string[]; media: SocialMediaItem[] } {
    return {
      caption: (destination.caption ?? base.caption).slice(0, 5_000),
      hashtags: [...(destination.hashtags ?? base.hashtags ?? [])].map((tag) => tag.trim()).filter(Boolean).slice(0, 30),
      media: [...(destination.media ?? base.media)],
    };
  }

  private async probe(media: readonly SocialMediaItem[]): Promise<SocialMediaItem[]> {
    if (!this.deps.mediaProbe) return [...media];
    return Promise.all(media.map((item) => this.deps.mediaProbe!.probe(item).catch(() => item)));
  }

  private async requireDetail(input: { tenantId: string; workspaceId: string; postId: string }): Promise<PublicationDetail> {
    const detail = await this.deps.publicationRepository.getDetail(input.postId);
    if (!detail || detail.plan.tenantId !== input.tenantId || detail.plan.workspaceId !== input.workspaceId) throw new Error("SOCIAL_POST_NOT_FOUND: publicação não encontrada.");
    return detail;
  }

  private async requireDestination(input: { tenantId: string; workspaceId: string; destinationId: string }): Promise<SocialPostDestination> {
    const destination = await this.deps.repository.getDestination({ tenantId: input.tenantId, workspaceId: input.workspaceId, id: input.destinationId });
    if (!destination) throw new Error("SOCIAL_DESTINATION_NOT_FOUND: publicação não encontrada.");
    return destination;
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }
}

const HISTORY_LABEL: Record<SocialPostHistoryEntry["kind"], string> = {
  created: "Publicação criada",
  scheduled: "Agendada",
  attempt: "Envio iniciado",
  retry: "Nova tentativa",
  published: "Publicada",
  failed: "Não publicada",
  reconnect_needed: "Aguardando reconexão",
  confirmation_pending: "Confirmação de publicação pendente",
  reconciled: "Publicação confirmada",
  cancelled: "Cancelada",
};

/** Histórico derivado do motor de publicação (tentativas, recibos, reconciliação) — nunca payload técnico. */
function buildHistory(detail: PublicationDetail, destinations: readonly SocialPostDestination[]): SocialPostHistoryEntry[] {
  const networkOf = (targetId: string | undefined) => destinations.find((destination) => destination.targetId === targetId)?.network;
  const entries: SocialPostHistoryEntry[] = [{ at: detail.plan.createdAt, kind: "created", label: HISTORY_LABEL.created }];
  for (const schedule of detail.schedules) entries.push({ at: schedule.createdAt, kind: "scheduled", label: schedule.status === "cancelled" ? "Agendamento substituído" : HISTORY_LABEL.scheduled, scheduledFor: schedule.scheduledAt });
  for (const attempt of detail.attempts) {
    const network = networkOf(attempt.targetId);
    entries.push({ at: attempt.startedAt, kind: attempt.attemptNumber > 1 ? "retry" : "attempt", label: attempt.attemptNumber > 1 ? HISTORY_LABEL.retry : HISTORY_LABEL.attempt, ...(network ? { network } : {}) });
    if (attempt.state === "failed" && attempt.finishedAt) entries.push({ at: attempt.finishedAt, kind: "failed", label: HISTORY_LABEL.failed, ...(network ? { network } : {}) });
    if (attempt.state === "unknown_outcome" && attempt.finishedAt) entries.push({ at: attempt.finishedAt, kind: "confirmation_pending", label: HISTORY_LABEL.confirmation_pending, ...(network ? { network } : {}) });
  }
  for (const receipt of detail.receipts) {
    const network = networkOf(receipt.targetId);
    entries.push({ at: receipt.publishedAt, kind: "published", label: HISTORY_LABEL.published, ...(network ? { network } : {}) });
  }
  for (const reconciliation of detail.reconciliations.filter((item) => item.status === "confirmed_published" || item.status === "confirmed_not_published")) {
    const network = networkOf(reconciliation.targetId);
    entries.push({ at: reconciliation.updatedAt, kind: "reconciled", label: reconciliation.status === "confirmed_published" ? HISTORY_LABEL.reconciled : "Confirmado que não foi publicada", ...(network ? { network } : {}) });
  }
  for (const destination of destinations) {
    if (destination.blockReason === "WAITING_REAUTH" && destination.blockedAt) entries.push({ at: destination.blockedAt, kind: "reconnect_needed", label: HISTORY_LABEL.reconnect_needed, network: destination.network });
    if (destination.skippedAt) entries.push({ at: destination.skippedAt, kind: "cancelled", label: "Não publicada (atrasada)", network: destination.network });
  }
  if (detail.plan.cancelledAt) entries.push({ at: detail.plan.cancelledAt, kind: "cancelled", label: HISTORY_LABEL.cancelled });
  return entries.sort((left, right) => left.at.localeCompare(right.at));
}
