import type { PublicationProviderAdapterPort, PublicationProviderAdapterPublishRequest, PublicationProviderStatusResult, PublicationReceiptVerificationResult } from "../publication/publication-provider-adapter.port.js";
import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { SocialRepositoryPort } from "../ports/social-repository.port.js";
import type { SocialAccountService } from "./social-account-service.js";
import { SOCIAL_FAR_FUTURE } from "./social-account-service.js";
import type { SocialAuditLog } from "./social-audit.js";
import { SOCIAL_SYSTEM_ACTOR } from "./social-audit.js";
import { validateAgainstCapability } from "./social-media-validation.js";
import { reauthAlert, type SocialNotifier } from "./social-notifier.js";
import type { SocialProviderResolver } from "./social-provider-resolver.js";
import type { SocialProviderFailure, SocialPublishResult } from "./social-publishing-provider.port.js";
import type { SocialSessionVault } from "./social-session-vault.js";
import type { PublicationProviderCallResult, PublicationProviderDescriptor, PublicationReceipt } from "../../domain/publication/publication.model.js";
import {
  effectiveFormatCapabilities,
  isAccountBlockingError,
  isAccountPublishable,
  isRetryableSocialError,
  NETWORK_LABEL,
  isValidProviderType,
  userMessageForError,
  type SocialAccount,
  type SocialPostDestination,
  type SocialProviderType,
} from "../../domain/social/social-publishing.model.js";

export type SocialPublicationRouterDeps = {
  repository: SocialRepositoryPort;
  publicationRepository: Pick<PublicationRepositoryPort, "acquireLock" | "releaseLock" | "getDetail">;
  accounts: SocialAccountService;
  resolver: SocialProviderResolver;
  vault: SocialSessionVault;
  notifier: SocialNotifier;
  audit: SocialAuditLog;
  idGenerator: () => string;
  now?: () => Date;
  /** Duração máxima de uma publicação na conta (trava por conta). */
  accountLockMs?: number;
  /** Quando reavaliar um provider pausado pela plataforma. */
  providerPausedRecheckMs?: number;
};

const PROVIDER_REQUEST_PREFIX = "social-target:";

/**
 * Provider `social` do motor de Publication. Para cada destino:
 * conta → política/kill switch → trava por conta → limites → sessão → validação → provider real.
 *
 * Bloqueios (conta aguardando reconexão, limite, conta ocupada, provider pausado) devolvem
 * `deferred`: o job volta para a fila SEM consumir tentativa e SEM perder o horário original.
 */
export class SocialPublicationRouter implements PublicationProviderAdapterPort {
  readonly descriptor: PublicationProviderDescriptor = {
    providerId: "social",
    providerVersion: "1.0.0",
    displayName: "Vorix Social Publishing",
    enabled: true,
    status: "enabled",
    oauthType: "manual",
    supportedChannels: ["instagram", "facebook", "tiktok"],
    supportedContentTypes: ["text", "image", "carousel", "video", "document"],
    capabilities: { publish: true, image: true, video: true, carousel: true, scheduling: false, update: false, delete: false, status: true, analytics: false, webhooks: false },
    supportsIdempotencyKey: true,
    supportsStatusLookup: true,
    supportsDelete: false,
    supportsUpdate: false,
    supportsScheduling: false,
    supportsReceiptVerification: false,
    maxPayloadBytes: 512_000,
    maxAssets: 20,
    managesOwnCredentials: true,
    isolatesFailures: true,
  };

  constructor(private readonly deps: SocialPublicationRouterDeps) {}

  capabilities(): PublicationProviderDescriptor {
    return this.descriptor;
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    return { ok: true };
  }

  async publish(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    const destination = await this.deps.repository.getDestinationByTarget({ targetId: request.targetId });
    if (!destination || destination.tenantId !== request.tenantId || destination.workspaceId !== request.workspaceId) {
      return { kind: "permanent_failure", errorCode: "SOCIAL_DESTINATION_NOT_FOUND", safeMessage: "Destino da publicação não encontrado." };
    }
    if (destination.skippedAt) return { kind: "rejected", errorCode: "SOCIAL_DESTINATION_SKIPPED", safeMessage: "Publicação pulada." };
    if (destination.blockReason === "AWAITING_CONFIRMATION") return this.defer("SOCIAL_AWAITING_CONFIRMATION", "Aguardando confirmação para publicação atrasada.", SOCIAL_FAR_FUTURE);

    const account = await this.deps.repository.getAccount({ tenantId: destination.tenantId, workspaceId: destination.workspaceId, id: destination.socialAccountId });
    if (!account) return this.failDestination(destination, { kind: "permanent_failure", errorCode: "SOCIAL_ACCOUNT_NOT_FOUND", safeMessage: "A conta desta publicação foi removida." }, "A conta desta publicação foi removida.");

    if (!isAccountPublishable(account.status)) return this.waitReauth(destination, account);

    const resolution = await this.deps.resolver.resolveForAccount(account);
    if (!resolution.ok) {
      if (resolution.reason === "CONNECTION_MISSING") return this.waitReauth(destination, account);
      // Provider pausado pela plataforma (kill switch, homologação, política): preserva e reavalia depois.
      await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { blockReason: "PROVIDER_DISABLED", blockedAt: this.nowIso() } });
      await this.deps.notifier.notify({ tenantId: account.tenantId, workspaceId: account.workspaceId, kind: "provider_paused", network: account.network, subjectId: `${account.network}:${resolution.providerType}`, title: `Publicações no ${NETWORK_LABEL[account.network]} pausadas`, body: `As publicações no ${NETWORK_LABEL[account.network]} estão pausadas temporariamente. Os agendamentos foram preservados e sairão assim que a integração voltar.`, sourceUrl: `/workspaces/${account.workspaceId}/calendar` });
      return this.defer("SOCIAL_PROVIDER_PAUSED", "Integração pausada pela plataforma.", new Date(this.now().getTime() + (this.deps.providerPausedRecheckMs ?? 15 * 60_000)).toISOString());
    }
    const provider = resolution.provider;
    await this.deps.accounts.recordProviderInUse(account, resolution.providerType, SOCIAL_SYSTEM_ACTOR);

    // Limites operacionais conservadores (proteção, não "imitação de humano").
    const policy = await this.deps.resolver.policyFor(account.tenantId, account.network);
    const limits = policy.rateLimits;
    const now = this.now();
    const last = await this.deps.repository.lastPublishLog({ socialAccountId: account.id });
    if (last && last.outcome !== "deferred") {
      const nextAllowed = Date.parse(last.startedAt) + limits.minimumIntervalSeconds * 1000;
      if (nextAllowed > now.getTime()) return this.deferRate(destination, new Date(nextAllowed).toISOString());
    }
    const lastHour = await this.deps.repository.countPublishLog({ socialAccountId: account.id, since: new Date(now.getTime() - 3_600_000).toISOString(), outcomes: ["published", "failed", "unknown"] });
    if (lastHour >= limits.maxPublicationsPerHour) return this.deferRate(destination, new Date(now.getTime() + 15 * 60_000).toISOString());
    const lastDay = await this.deps.repository.countPublishLog({ socialAccountId: account.id, since: new Date(now.getTime() - 86_400_000).toISOString(), outcomes: ["published", "failed", "unknown"] });
    if (lastDay >= limits.maxPublicationsPerDay) return this.deferRate(destination, new Date(now.getTime() + 3 * 3_600_000).toISOString());

    // Fila sequencial por conta: nunca duas ações simultâneas na mesma conta.
    const lockKey = `social-account:${account.id}`;
    const lockOwner = `${request.attemptId}:${this.deps.idGenerator()}`;
    const acquired = await this.deps.publicationRepository.acquireLock({ publicationId: lockKey, ownerId: lockOwner, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + (this.deps.accountLockMs ?? 10 * 60_000)).toISOString() });
    if (!acquired) return this.defer("SOCIAL_ACCOUNT_BUSY", "Outra publicação desta conta está em andamento.", new Date(now.getTime() + 30_000).toISOString());

    const logId = this.deps.idGenerator();
    const startedAt = this.nowIso();
    try {
      const session = await this.deps.vault.load(account, resolution.providerType);
      if (!session) {
        const updated = await this.deps.accounts.applyFailure(account, { errorClass: "SESSION_INVALID", code: "CREDENTIAL_MISSING" });
        return this.waitReauth(destination, updated, false);
      }

      const capability = effectiveFormatCapabilities(provider.getCapabilities(account.network), account.accountCapabilities).find((item) => item.format === destination.format);
      const caption = composeCaption(destination);
      const issues = [
        ...validateAgainstCapability({ network: account.network, capability, caption, media: destination.media, music: destination.music, embeddedAudio: destination.audioMode === "EMBEDDED_AUDIO" }),
        ...provider.validatePost({ network: account.network, format: destination.format, caption, media: destination.media, music: destination.music }),
      ];
      if (issues.length > 0) {
        const message = issues[0]!.message;
        if (issues.some((issue) => issue.field === "music")) await this.notifyMusic(account, destination);
        return this.failDestination(destination, { kind: "rejected", errorCode: issues[0]!.code, safeMessage: message }, message, account);
      }

      if (destination.lastProviderType !== resolution.providerType) {
        await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { lastProviderType: resolution.providerType } });
      }
      if (destination.blockReason) await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { clearBlock: true } });
      await this.deps.repository.appendPublishLog({ id: logId, tenantId: account.tenantId, workspaceId: account.workspaceId, socialAccountId: account.id, publicationId: destination.publicationId, targetId: destination.targetId, providerType: resolution.providerType, network: account.network, format: destination.format, startedAt, mediaBytes: destination.media.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0) });
      await this.deps.audit.record({ tenantId: account.tenantId, workspaceId: account.workspaceId, event: "POST_PUBLISH_STARTED", actor: SOCIAL_SYSTEM_ACTOR, resource: { type: "social_post", id: destination.publicationId }, metadata: { destinationId: destination.id, network: account.network, format: destination.format, providerType: resolution.providerType } });

      const result: SocialPublishResult = await provider.publish({
        account: this.deps.accounts.context(account, session),
        format: destination.format,
        caption,
        media: destination.media,
        music: destination.music,
        idempotencyKey: request.idempotencyKey,
        attemptStartedAt: startedAt,
      }).catch((error): SocialPublishResult => {
        const text = error instanceof Error ? error.message : "erro";
        return /timeout|abort/i.test(text) ? { ok: "unknown", detail: "Timeout sem confirmação da rede." } : { ok: false, failure: { errorClass: "UNKNOWN", code: "PROVIDER_EXCEPTION", detail: text.slice(0, 200) } };
      });
      // Mesmo relógio da tentativa (injetável): duração entra em métricas e custo por tenant.
      const durationMs = Math.max(0, this.now().getTime() - Date.parse(startedAt));

      if (result.ok === true) {
        await this.deps.repository.finishPublishLog({ id: logId, finishedAt: this.nowIso(), outcome: "published", durationMs });
        await this.deps.accounts.recordPublishSuccess(account);
        await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { lastErrorCode: undefined, lastErrorMessage: undefined, clearBlock: true } });
        await this.deps.audit.record({ tenantId: account.tenantId, workspaceId: account.workspaceId, event: "POST_PUBLISHED", actor: SOCIAL_SYSTEM_ACTOR, resource: { type: "social_post", id: destination.publicationId }, metadata: { destinationId: destination.id, network: account.network, externalPostId: result.externalPostId } });
        await this.deps.notifier.notify({ tenantId: account.tenantId, workspaceId: account.workspaceId, kind: "publication_published", network: account.network, subjectId: destination.id, title: `Publicado no ${NETWORK_LABEL[account.network]}`, body: account.username ? `Publicação feita em @${account.username}.` : "Publicação feita.", sourceUrl: `/workspaces/${account.workspaceId}/calendar`, onlyUserId: destination.createdBy });
        return { kind: "published", providerPublicationId: result.externalPostId, publishedAt: result.publishedAt, ...(result.externalUrl ? { url: result.externalUrl } : {}) };
      }
      if (result.ok === "unknown") {
        await this.deps.repository.finishPublishLog({ id: logId, finishedAt: this.nowIso(), outcome: "unknown", durationMs });
        // Não repete às cegas: a reconciliação verifica na rede antes de qualquer nova tentativa.
        // Guarda QUEM tentou e a referência devolvida: a verificação usa o mesmo provider mesmo que a
        // política troque de provider no meio tempo.
        return { kind: "unknown_outcome", providerRequestId: encodeUnknownReference({ targetId: destination.targetId, startedAt, providerType: resolution.providerType, providerReference: result.providerReference }), safeMessage: result.detail, errorCode: "SOCIAL_UNKNOWN_OUTCOME" };
      }
      await this.deps.repository.finishPublishLog({ id: logId, finishedAt: this.nowIso(), outcome: "failed", errorCode: result.failure.code, durationMs });
      return this.handleFailure(destination, account, result.failure, limits.maxConsecutiveFailures);
    } finally {
      await this.deps.publicationRepository.releaseLock(lockKey, lockOwner).catch(() => undefined);
    }
  }

  /** Verificação após timeout: a rede publicou ou não? Só então o motor decide repetir. */
  async getStatus(input: { idempotencyKey: string; providerRequestId?: string; providerPublicationId?: string }): Promise<PublicationProviderStatusResult> {
    const reference = decodeUnknownReference(input.providerRequestId);
    if (!reference) return { kind: "inconclusive", safeMessage: "Sem referência do destino." };
    const destination = await this.deps.repository.getDestinationByTarget({ targetId: reference.targetId });
    if (!destination) return { kind: "inconclusive", safeMessage: "Destino não encontrado." };
    const account = await this.deps.repository.getAccount({ tenantId: destination.tenantId, workspaceId: destination.workspaceId, id: destination.socialAccountId });
    if (!account) return { kind: "inconclusive", safeMessage: "Conta não encontrada." };
    // Verifica no MESMO provider que fez a tentativa (não no atual da política).
    const provider = this.deps.resolver.providers.get(reference.providerType);
    if (!provider) return { kind: "inconclusive", safeMessage: "Provider da tentativa indisponível para verificar." };
    const session = await this.deps.vault.load(account, reference.providerType);
    if (!session) return { kind: "inconclusive", safeMessage: "Credencial indisponível para verificar." };
    const status = await provider.getPublicationStatus({ account: this.deps.accounts.context(account, session), caption: composeCaption(destination), attemptStartedAt: reference.startedAt, ...(reference.providerReference ? { providerReference: reference.providerReference } : {}) }).catch(() => ({ kind: "inconclusive" as const, detail: "Falha ao verificar." }));
    if (status.kind === "published") return { kind: "published", providerPublicationId: status.externalPostId, publishedAt: status.publishedAt, ...(status.externalUrl ? { url: status.externalUrl } : {}) };
    if (status.kind === "not_found") return { kind: "not_found", safeMessage: "A rede confirmou que não publicou." };
    return { kind: "inconclusive", safeMessage: status.detail };
  }

  async verifyReceipt(receipt: PublicationReceipt): Promise<PublicationReceiptVerificationResult> {
    return { verificationStatus: "not_supported", checksum: receipt.checksum };
  }

  private async handleFailure(destination: SocialPostDestination, account: SocialAccount, failure: SocialProviderFailure, maxConsecutiveFailures: number): Promise<PublicationProviderCallResult> {
    const userMessage = userMessageForError(account.network, failure.errorClass);
    if (isAccountBlockingError(failure.errorClass)) {
      // Autenticação/segurança: PARA a fila desta conta, notifica, aguarda reconexão. Sem fallback.
      const updated = await this.deps.accounts.applyFailure(account, failure, maxConsecutiveFailures);
      return this.waitReauth(destination, updated, false);
    }
    await this.deps.accounts.applyFailure(account, failure, maxConsecutiveFailures);
    await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { lastErrorCode: failure.code, lastErrorMessage: userMessage } });
    if (isRetryableSocialError(failure.errorClass)) {
      const retryAfter = failure.retryAfterSec ? new Date(this.now().getTime() + failure.retryAfterSec * 1000).toISOString() : undefined;
      return failure.errorClass === "RATE_LIMITED"
        ? { kind: "rate_limited", errorCode: failure.code, safeMessage: userMessage, ...(retryAfter ? { retryAfter } : {}) }
        : { kind: "transient_failure", errorCode: failure.code, safeMessage: userMessage, ...(retryAfter ? { retryAfter } : {}) };
    }
    if (failure.errorClass === "MUSIC_UNAVAILABLE") await this.notifyMusic(account, destination);
    return this.failDestination(destination, { kind: "rejected", errorCode: failure.code, safeMessage: userMessage }, userMessage, account);
  }

  private async waitReauth(destination: SocialPostDestination, account: SocialAccount, notify = true): Promise<PublicationProviderCallResult> {
    if (destination.blockReason !== "WAITING_REAUTH") {
      await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { blockReason: "WAITING_REAUTH", blockedAt: this.nowIso(), lastErrorMessage: userMessageForError(account.network, account.status === "CHECKPOINT_REQUIRED" ? "CHECKPOINT_REQUIRED" : "AUTH_REQUIRED") } });
    }
    if (notify && account.status !== "DISABLED") {
      const pending = (await this.deps.repository.listBlockedDestinations({ tenantId: account.tenantId, socialAccountId: account.id, blockReason: "WAITING_REAUTH" })).length;
      await this.deps.notifier.notify(reauthAlert({ tenantId: account.tenantId, workspaceId: account.workspaceId, accountId: account.id, network: account.network, pendingCount: pending, checkpoint: account.status === "CHECKPOINT_REQUIRED" }));
    }
    return this.defer("SOCIAL_WAITING_REAUTH", `Aguardando reconexão da conta do ${NETWORK_LABEL[account.network]}.`, SOCIAL_FAR_FUTURE);
  }

  private async deferRate(destination: SocialPostDestination, availableAt: string): Promise<PublicationProviderCallResult> {
    return this.defer("SOCIAL_RATE_LIMIT_LOCAL", "Intervalo de segurança entre publicações desta conta.", availableAt);
  }

  private defer(errorCode: string, safeMessage: string, availableAt: string): PublicationProviderCallResult {
    return { kind: "deferred", errorCode, safeMessage, availableAt };
  }

  private async failDestination(destination: SocialPostDestination, result: Extract<PublicationProviderCallResult, { kind: "rejected" | "permanent_failure" }>, userMessage: string, account?: SocialAccount): Promise<PublicationProviderCallResult> {
    await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { lastErrorCode: result.errorCode, lastErrorMessage: userMessage } });
    await this.deps.audit.record({ tenantId: destination.tenantId, workspaceId: destination.workspaceId, event: "POST_FAILED", actor: SOCIAL_SYSTEM_ACTOR, resource: { type: "social_post", id: destination.publicationId }, result: { status: "failure", code: result.errorCode }, metadata: { destinationId: destination.id, network: destination.network } });
    if (account) {
      await this.deps.notifier.notify({ tenantId: destination.tenantId, workspaceId: destination.workspaceId, kind: "publication_failed", network: destination.network, subjectId: destination.id, title: `Publicação no ${NETWORK_LABEL[destination.network]} falhou`, body: userMessage, sourceUrl: `/workspaces/${destination.workspaceId}/calendar`, onlyUserId: destination.createdBy });
    }
    return result;
  }

  private async notifyMusic(account: SocialAccount, destination: SocialPostDestination): Promise<void> {
    await this.deps.notifier.notify({ tenantId: account.tenantId, workspaceId: account.workspaceId, kind: "music_unavailable", network: account.network, subjectId: destination.id, title: "Música indisponível", body: userMessageForError(account.network, "MUSIC_UNAVAILABLE"), sourceUrl: `/workspaces/${account.workspaceId}/calendar`, onlyUserId: destination.createdBy });
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

/** Referência do resultado desconhecido: destino + início da tentativa + provider + referência dele. */
export function encodeUnknownReference(input: { targetId: string; startedAt: string; providerType: SocialProviderType; providerReference?: string }): string {
  return `${PROVIDER_REQUEST_PREFIX}${[input.targetId, input.startedAt, input.providerType, input.providerReference ?? ""].map(encodeURIComponent).join("|")}`;
}

export function decodeUnknownReference(value: string | undefined): { targetId: string; startedAt: string; providerType: SocialProviderType; providerReference?: string } | undefined {
  if (!value?.startsWith(PROVIDER_REQUEST_PREFIX)) return undefined;
  const [targetId, startedAt, providerType, providerReference] = value.slice(PROVIDER_REQUEST_PREFIX.length).split("|").map(decodeURIComponent);
  if (!targetId || !startedAt || !providerType || !isValidProviderType(providerType)) return undefined;
  return { targetId, startedAt, providerType: providerType as SocialProviderType, ...(providerReference ? { providerReference } : {}) };
}

/** Legenda final: texto + hashtags (sem duplicar as que já estão no texto). */
export function composeCaption(destination: Pick<SocialPostDestination, "caption" | "hashtags">): string {
  const text = destination.caption.trim();
  const present = new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.toLowerCase()));
  const extra = destination.hashtags
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .filter((tag) => /^#[\p{L}\p{N}_]+$/u.test(tag) && !present.has(tag.toLowerCase()));
  return extra.length ? `${text}${text ? "\n\n" : ""}${extra.join(" ")}` : text;
}
