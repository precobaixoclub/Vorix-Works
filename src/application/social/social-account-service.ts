import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { SocialRepositoryPort } from "../ports/social-repository.port.js";
import type { SocialAuditActor, SocialAuditLog } from "./social-audit.js";
import { SOCIAL_SYSTEM_ACTOR } from "./social-audit.js";
import type { SocialNotifier } from "./social-notifier.js";
import { reauthAlert, SOCIAL_PATHS } from "./social-notifier.js";
import type { SocialProviderResolver } from "./social-provider-resolver.js";
import type { SocialConnectedAccount, SocialProviderAccountContext, SocialProviderFailure, SocialProviderSession } from "./social-publishing-provider.port.js";
import type { SocialSessionVault } from "./social-session-vault.js";
import {
  accountNeedsReconnect,
  connectionStatusForError,
  isAccountBlockingError,
  NETWORK_LABEL,
  SOCIAL_NETWORKS,
  type SocialAccount,
  type SocialConnectionStatus,
  type SocialNetwork,
  type SocialPostDestination,
  type SocialProviderType,
} from "../../domain/social/social-publishing.model.js";

export type SocialAccountServiceDeps = {
  repository: SocialRepositoryPort;
  publicationRepository: Pick<PublicationRepositoryPort, "rescheduleTargetOutbox" | "cancelTarget" | "getDetail">;
  resolver: SocialProviderResolver;
  vault: SocialSessionVault;
  notifier: SocialNotifier;
  audit: SocialAuditLog;
  idGenerator: () => string;
  now?: () => Date;
};

/** Conta autorizada no provider, como o cliente vê para escolher (sem credencial nem ids técnicos internos). */
export type SocialAuthorizedAccountView = { externalAccountId: string; username?: string; displayName?: string; avatarUrl?: string; alreadyConnected: boolean };

/** Visão do cliente comum: sem token, cookie, sessão, endpoint ou nome técnico de provider. */
export type SocialAccountView = {
  id: string;
  network: SocialNetwork;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  status: SocialConnectionStatus;
  statusLabel: string;
  needsReconnect: boolean;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSuccessfulPublishAt?: string;
  nextPublicationAt?: string;
  waitingPublications: number;
  problem?: string;
};

export const CONNECTION_STATUS_LABEL: Record<SocialConnectionStatus, string> = {
  CONNECTED: "Conectada",
  HEALTHY: "Conectada",
  REAUTH_REQUIRED: "Reconexão necessária",
  CHECKPOINT_REQUIRED: "Confirmação de segurança pendente",
  DISCONNECTED: "Desconectada",
  TEMPORARY_ERROR: "Instável",
  DISABLED: "Desativada",
};

/** Destino aguardando reconexão nunca é apagado: guarda o horário original até a conta voltar. */
const FAR_FUTURE = "9999-12-31T00:00:00.000Z";

export class SocialAccountService {
  constructor(private readonly deps: SocialAccountServiceDeps) {}

  async listAccountViews(input: { tenantId: string; workspaceId: string }): Promise<SocialAccountView[]> {
    const accounts = await this.deps.repository.listAccounts(input);
    const now = this.now().toISOString();
    const destinations = await this.deps.repository.listDestinations({ tenantId: input.tenantId, workspaceId: input.workspaceId, from: now, limit: 500 });
    const blocked = await this.deps.repository.listBlockedDestinations({ tenantId: input.tenantId });
    return accounts.map((account) => {
      const upcoming = destinations
        .filter((destination) => destination.socialAccountId === account.id && destination.scheduledAt && !destination.skippedAt)
        .map((destination) => destination.scheduledAt!)
        .sort()[0];
      const waiting = blocked.filter((destination) => destination.socialAccountId === account.id && (destination.blockReason === "WAITING_REAUTH" || destination.blockReason === "AWAITING_CONFIRMATION")).length;
      return {
        id: account.id,
        network: account.network,
        username: account.username,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        status: account.status,
        statusLabel: CONNECTION_STATUS_LABEL[account.status],
        needsReconnect: accountNeedsReconnect(account.status),
        connectedAt: account.connectedAt,
        lastSyncAt: account.lastHealthCheckAt,
        lastSuccessfulPublishAt: account.lastSuccessfulPublishAt,
        nextPublicationAt: upcoming,
        waitingPublications: waiting,
        ...(account.status === "CHECKPOINT_REQUIRED" ? { problem: `O ${NETWORK_LABEL[account.network]} pediu uma confirmação de segurança. Confirme no app e reconecte.` } : {}),
        ...(account.status === "REAUTH_REQUIRED" ? { problem: `Sua conta do ${NETWORK_LABEL[account.network]} precisa ser reconectada.` } : {}),
        ...(account.status === "DISABLED" ? { problem: `Esta conta está pausada. Verifique a conta no app do ${NETWORK_LABEL[account.network]}.` } : {}),
      };
    });
  }

  async requireAccount(input: { tenantId: string; workspaceId: string; accountId: string }): Promise<SocialAccount> {
    const account = await this.deps.repository.getAccount({ tenantId: input.tenantId, workspaceId: input.workspaceId, id: input.accountId });
    if (!account) throw new Error("SOCIAL_ACCOUNT_NOT_FOUND: conta social não encontrada.");
    return account;
  }

  /**
   * Início da conexão pelo provider liberado ao tenant (OAuth oficial hoje). O cliente só vê
   * "Conectar Instagram": a URL de autorização vem do provider; nada técnico chega à tela.
   */
  async beginConnection(input: { tenantId: string; workspaceId: string; network: SocialNetwork; userId: string; returnPath?: string }): Promise<{ redirectUrl: string }> {
    const label = NETWORK_LABEL[input.network];
    const resolution = await this.deps.resolver.connectionProviderFor(input.tenantId, input.network);
    if (!resolution.ok) {
      throw new Error(resolution.reason === "PUBLISHING_NOT_ENABLED" || resolution.reason === "TENANT_PROVIDER_NOT_ENABLED"
        ? `SOCIAL_PUBLISHING_NOT_ENABLED: a publicação no ${label} ainda não está liberada para a sua conta.`
        : `SOCIAL_CONNECTION_UNAVAILABLE: a conexão com o ${label} está indisponível no momento.`);
    }
    if (!resolution.provider.connection) throw new Error(`SOCIAL_CONNECTION_UNAVAILABLE: a conexão com o ${label} está indisponível no momento.`);
    return resolution.provider.connection.begin(input);
  }

  /**
   * Retorno da autorização: o provider troca o código pela credencial (cofre central) e devolve o
   * contexto guardado no servidor (workspace, rede, retorno). Com uma única conta autorizada nova,
   * ela já é conectada; com várias, o cliente escolhe quais usar.
   */
  async completeConnection(input: { tenantId: string; userId: string; network: SocialNetwork; state: string; code: string; actor: SocialAuditActor }): Promise<{ workspaceId: string; network: SocialNetwork; returnPath?: string; autoConnected: boolean; accounts: SocialAuthorizedAccountView[] }> {
    const label = NETWORK_LABEL[input.network];
    const resolution = await this.deps.resolver.connectionProviderFor(input.tenantId, input.network);
    if (!resolution.ok || !resolution.provider.connection) throw new Error(`SOCIAL_CONNECTION_UNAVAILABLE: a conexão com o ${label} está indisponível no momento.`);
    const flow = await resolution.provider.connection.complete({ state: input.state, code: input.code, tenantId: input.tenantId, userId: input.userId, role: input.actor.role });
    const network = flow.network ?? input.network;
    let accounts = await this.authorizedAccounts({ tenantId: input.tenantId, workspaceId: flow.workspaceId, network });
    const pending = accounts.filter((account) => !account.alreadyConnected);
    let autoConnected = false;
    if (pending.length === 1) {
      await this.syncConnections({ tenantId: input.tenantId, workspaceId: flow.workspaceId, actor: input.actor, network, externalAccountIds: [pending[0]!.externalAccountId] });
      accounts = await this.authorizedAccounts({ tenantId: input.tenantId, workspaceId: flow.workspaceId, network });
      autoConnected = true;
    } else if (pending.length === 0) {
      // Reconexão de contas já conhecidas: atualiza status/credencial e libera a fila.
      await this.syncConnections({ tenantId: input.tenantId, workspaceId: flow.workspaceId, actor: input.actor, network });
      autoConnected = accounts.length > 0;
    }
    return { workspaceId: flow.workspaceId, network, ...(flow.returnPath ? { returnPath: flow.returnPath } : {}), autoConnected, accounts };
  }

  /** Contas autorizadas no provider para a rede — só o necessário para o cliente escolher. */
  async authorizedAccounts(input: { tenantId: string; workspaceId: string; network: SocialNetwork }): Promise<SocialAuthorizedAccountView[]> {
    const resolution = await this.deps.resolver.connectionProviderFor(input.tenantId, input.network);
    if (!resolution.ok || !resolution.provider.connection) return [];
    const remote = await resolution.provider.connection.listAccounts(input).catch((): SocialConnectedAccount[] => []);
    const local = await this.deps.repository.listAccounts({ tenantId: input.tenantId, workspaceId: input.workspaceId, network: input.network });
    return remote
      .filter((account) => account.status === "active")
      .map((account) => {
        const existing = local.find((item) => item.externalAccountId === account.externalAccountId);
        return {
          externalAccountId: account.externalAccountId,
          ...(account.username ? { username: account.username } : {}),
          ...(account.displayName ? { displayName: account.displayName } : {}),
          ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
          alreadyConnected: !!existing?.connections.some((connection) => connection.providerType === resolution.providerType && connection.status === "active" && connection.credentialReferenceId === account.credentialReferenceId),
        };
      });
  }

  /**
   * Sincroniza as contas autorizadas no provider com as contas sociais do Vorix. A MESMA conta
   * (rede + id externo) recebe a conexão do provider — trocar de provider nunca duplica a conta.
   * Credencial revogada/expirada → REAUTH_REQUIRED (agendamentos preservados).
   */
  async syncConnections(input: { tenantId: string; workspaceId: string; actor: SocialAuditActor; network?: SocialNetwork; /** Contas novas a importar (as já conectadas sempre atualizam). */ externalAccountIds?: readonly string[] }): Promise<{ connected: number; reconnected: number; revoked: number }> {
    let connected = 0;
    let reconnected = 0;
    let revoked = 0;
    for (const provider of this.deps.resolver.providers.list()) {
      if (!provider.connection) continue;
      for (const network of SOCIAL_NETWORKS.filter((item) => provider.descriptor.networks.includes(item) && (!input.network || item === input.network))) {
        const authorized = await provider.connection.listAccounts({ tenantId: input.tenantId, workspaceId: input.workspaceId, network }).catch((): SocialConnectedAccount[] => []);
        for (const remote of authorized) {
          const outcome = await this.applyConnectedAccount(input, provider.descriptor.type, remote);
          if (outcome === "connected") connected += 1;
          if (outcome === "reconnected") reconnected += 1;
          if (outcome === "revoked") revoked += 1;
        }
      }
    }
    return { connected, reconnected, revoked };
  }

  private async applyConnectedAccount(input: { tenantId: string; workspaceId: string; actor: SocialAuditActor; externalAccountIds?: readonly string[] }, providerType: SocialProviderType, remote: SocialConnectedAccount): Promise<"connected" | "reconnected" | "revoked" | "unchanged"> {
    const now = this.now().toISOString();
    let account = await this.deps.repository.findAccountByExternalId({ tenantId: input.tenantId, workspaceId: input.workspaceId, network: remote.network, externalAccountId: remote.externalAccountId });
    const previous = account?.connections.find((connection) => connection.providerType === providerType);
    if (!account) {
      if (remote.status !== "active") return "unchanged";
      // Conta nova só entra se o cliente escolheu (quando houve escolha).
      if (input.externalAccountIds && !input.externalAccountIds.includes(remote.externalAccountId)) return "unchanged";
      account = await this.deps.repository.createAccount({
        id: this.deps.idGenerator(),
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        network: remote.network,
        providerType,
        externalAccountId: remote.externalAccountId,
        username: remote.username,
        displayName: remote.displayName,
        avatarUrl: remote.avatarUrl,
        status: "CONNECTED",
        accountCapabilities: {},
        metadata: {},
        consecutiveFailures: 0,
        connectedAt: now,
        createdBy: input.actor.userId,
      });
    }
    if (previous && previous.status === remote.status && previous.credentialReferenceId === remote.credentialReferenceId) return "unchanged";
    await this.deps.repository.upsertConnection({ tenantId: input.tenantId, accountId: account.id, connection: { providerType, credentialReferenceId: remote.credentialReferenceId, status: remote.status } });
    if (remote.status !== "active") {
      const refreshed = (await this.deps.repository.getAccount({ tenantId: input.tenantId, workspaceId: input.workspaceId, id: account.id }))!;
      await this.applyFailure(refreshed, { errorClass: "AUTH_REQUIRED", code: remote.status === "revoked" ? "CONNECTION_REVOKED" : "CONNECTION_EXPIRED" });
      return "revoked";
    }
    const isReconnect = !!previous || accountNeedsReconnect(account.status);
    await this.deps.repository.updateAccount({
      tenantId: input.tenantId,
      id: account.id,
      patch: { status: "CONNECTED", username: remote.username ?? account.username, displayName: remote.displayName ?? account.displayName, avatarUrl: remote.avatarUrl ?? account.avatarUrl, connectedAt: now, reauthRequiredAt: undefined, consecutiveFailures: 0 },
    });
    const fresh = (await this.deps.repository.getAccount({ tenantId: input.tenantId, workspaceId: input.workspaceId, id: account.id }))!;
    const health = await this.checkHealth(fresh);
    await this.deps.audit.record({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      event: isReconnect ? "SOCIAL_ACCOUNT_RECONNECTED" : "SOCIAL_ACCOUNT_CONNECTED",
      actor: input.actor,
      resource: { type: "social_account", id: account.id },
      result: health.account.status === "HEALTHY" ? { status: "success" } : { status: "failure", code: health.account.lastErrorCode },
      metadata: { network: remote.network, username: health.account.username, providerType, status: health.account.status },
    });
    if (health.account.status === "HEALTHY" && isReconnect) await this.resumeAfterReconnect(health.account, input.actor);
    return isReconnect ? "reconnected" : "connected";
  }

  /** Desconecta sem apagar nada: agendamentos ficam aguardando reconexão. */
  async disconnect(input: { tenantId: string; workspaceId: string; accountId: string; actor: SocialAuditActor }): Promise<SocialAccount> {
    const account = await this.requireAccount(input);
    for (const connection of account.connections) {
      const provider = this.deps.resolver.providers.get(connection.providerType);
      await provider?.connection?.disconnect({ tenantId: account.tenantId, workspaceId: account.workspaceId, credentialReferenceId: connection.credentialReferenceId }).catch(() => undefined);
      await this.deps.repository.removeConnection({ tenantId: account.tenantId, accountId: account.id, providerType: connection.providerType });
    }
    const updated = (await this.deps.repository.updateAccount({ tenantId: account.tenantId, id: account.id, patch: { status: "DISCONNECTED", reauthRequiredAt: this.now().toISOString() } }))!;
    const blocked = await this.blockPendingDestinations(updated);
    await this.deps.audit.record({ tenantId: account.tenantId, workspaceId: account.workspaceId, event: "SOCIAL_ACCOUNT_DISCONNECTED", actor: input.actor, resource: { type: "social_account", id: account.id }, metadata: { network: account.network, preservedPublications: blocked } });
    return updated;
  }

  async testConnection(input: { tenantId: string; workspaceId: string; accountId: string }): Promise<{ account: SocialAccount; healthy: boolean; message: string }> {
    const account = await this.requireAccount(input);
    const result = await this.checkHealth(account);
    const label = NETWORK_LABEL[account.network];
    return { account: result.account, healthy: result.account.status === "HEALTHY", message: result.account.status === "HEALTHY" ? `Conta do ${label} conectada e funcionando.` : CONNECTION_STATUS_LABEL[result.account.status] };
  }

  /** Health check leve (sem publicar nada): detecta credencial inválida ANTES do horário de publicar. */
  async checkHealth(account: SocialAccount): Promise<{ account: SocialAccount }> {
    const now = this.now().toISOString();
    const resolution = await this.deps.resolver.resolveForAccount(account);
    if (!resolution.ok) {
      if (resolution.reason === "CONNECTION_MISSING") return { account: await this.applyFailure(account, { errorClass: "SESSION_INVALID", code: "CONNECTION_MISSING" }) };
      // Provider pausado pela plataforma: não é problema da conta do cliente.
      return { account: (await this.deps.repository.updateAccount({ tenantId: account.tenantId, id: account.id, patch: { lastHealthCheckAt: now } }))! };
    }
    const session = await this.deps.vault.load(account, resolution.providerType);
    if (!session) return { account: await this.applyFailure(account, { errorClass: "SESSION_INVALID", code: "CREDENTIAL_MISSING" }) };
    const result = await resolution.provider.healthCheck(this.context(account, session)).catch((error): Awaited<ReturnType<typeof resolution.provider.healthCheck>> => ({ healthy: false, failure: { errorClass: "TEMPORARY_PLATFORM_ERROR", code: "HEALTH_EXCEPTION", detail: error instanceof Error ? error.message.slice(0, 200) : undefined } }));
    if (!result.healthy) return { account: await this.applyFailure(account, result.failure) };
    if (result.externalAccountId !== account.externalAccountId) {
      // Credencial de OUTRO perfil nunca publica nesta conta.
      return { account: await this.applyFailure(account, { errorClass: "SESSION_INVALID", code: "SESSION_ACCOUNT_MISMATCH" }) };
    }
    const previous = account.status;
    const updated = (await this.deps.repository.updateAccount({
      tenantId: account.tenantId,
      id: account.id,
      patch: {
        status: "HEALTHY",
        lastHealthCheckAt: now,
        consecutiveFailures: 0,
        reauthRequiredAt: undefined,
        lastErrorCode: undefined,
        username: result.username ?? account.username,
        displayName: result.displayName ?? account.displayName,
        avatarUrl: result.avatarUrl ?? account.avatarUrl,
        accountCapabilities: { disabledFormats: result.disabledFormats ?? [], disabledFeatures: (result.disabledFeatures ?? []) as never, detectedAt: now },
        ...(result.metadata ? { metadata: { ...account.metadata, ...result.metadata } } : {}),
      },
    }))!;
    const current = await this.recordProviderInUse(updated, resolution.providerType, SOCIAL_SYSTEM_ACTOR);
    if (previous !== "HEALTHY" && previous !== "CONNECTED") {
      await this.deps.audit.record({ tenantId: account.tenantId, workspaceId: account.workspaceId, event: "SOCIAL_ACCOUNT_STATUS_CHANGED", actor: SOCIAL_SYSTEM_ACTOR, resource: { type: "social_account", id: account.id }, metadata: { from: previous, to: "HEALTHY" } });
      if (accountNeedsReconnect(previous) || previous === "TEMPORARY_ERROR") await this.resumeAfterReconnect(current, SOCIAL_SYSTEM_ACTOR);
    }
    return { account: current };
  }

  /**
   * Ponto ÚNICO onde o provider em uso da conta muda — sempre auditado (PROVIDER_CHANGED), venha a
   * troca da política, do health check ou da publicação.
   */
  async recordProviderInUse(account: SocialAccount, providerType: SocialProviderType, actor: SocialAuditActor): Promise<SocialAccount> {
    if (account.providerType === providerType) return account;
    const updated = (await this.deps.repository.updateAccount({ tenantId: account.tenantId, id: account.id, patch: { providerType } }))!;
    await this.deps.audit.record({ tenantId: account.tenantId, workspaceId: account.workspaceId, event: "PROVIDER_CHANGED", actor, resource: { type: "social_account", id: account.id }, metadata: { network: account.network, from: account.providerType, to: providerType } });
    return updated;
  }

  async runHealthChecks(input: { olderThanMs: number; limit: number }): Promise<{ checked: number; unhealthy: number }> {
    const olderThan = new Date(this.now().getTime() - input.olderThanMs).toISOString();
    const accounts = await this.deps.repository.listAccountsDueForHealthCheck({ olderThan, limit: input.limit });
    let unhealthy = 0;
    for (const account of accounts) {
      const { account: checked } = await this.checkHealth(account).catch(() => ({ account }));
      if (checked.status !== "HEALTHY") unhealthy += 1;
    }
    return { checked: accounts.length, unhealthy };
  }

  /**
   * Erro de conta: segurança/autenticação pausa a fila e notifica (sem retry agressivo); erro
   * transitório só conta falhas consecutivas.
   */
  async applyFailure(account: SocialAccount, failure: SocialProviderFailure, maxConsecutiveFailures = 3): Promise<SocialAccount> {
    const now = this.now().toISOString();
    const nextStatus = connectionStatusForError(failure.errorClass);
    const consecutiveFailures = account.consecutiveFailures + 1;
    if (isAccountBlockingError(failure.errorClass)) {
      const status = nextStatus ?? "REAUTH_REQUIRED";
      const updated = (await this.deps.repository.updateAccount({ tenantId: account.tenantId, id: account.id, patch: { status, lastErrorCode: failure.code, lastErrorAt: now, lastHealthCheckAt: now, reauthRequiredAt: account.reauthRequiredAt ?? now, consecutiveFailures } }))!;
      const pending = await this.blockPendingDestinations(updated);
      if (account.status !== status) {
        await this.deps.audit.record({ tenantId: account.tenantId, workspaceId: account.workspaceId, event: "SOCIAL_ACCOUNT_STATUS_CHANGED", actor: SOCIAL_SYSTEM_ACTOR, resource: { type: "social_account", id: account.id }, result: { status: "failure", code: failure.code }, metadata: { from: account.status, to: status, errorClass: failure.errorClass } });
      }
      await this.deps.notifier.notify(reauthAlert({ tenantId: account.tenantId, workspaceId: account.workspaceId, accountId: account.id, network: account.network, pendingCount: pending, checkpoint: status === "CHECKPOINT_REQUIRED" }));
      return updated;
    }
    const status: SocialConnectionStatus = nextStatus === "TEMPORARY_ERROR" && consecutiveFailures >= maxConsecutiveFailures ? "TEMPORARY_ERROR" : account.status;
    const updated = (await this.deps.repository.updateAccount({ tenantId: account.tenantId, id: account.id, patch: { status, lastErrorCode: failure.code, lastErrorAt: now, lastHealthCheckAt: now, consecutiveFailures } }))!;
    if (status === "TEMPORARY_ERROR" && account.status !== "TEMPORARY_ERROR") {
      await this.deps.notifier.notify({ tenantId: account.tenantId, workspaceId: account.workspaceId, kind: "account_problem", network: account.network, subjectId: account.id, title: `Conta do ${NETWORK_LABEL[account.network]} com problema`, body: `O ${NETWORK_LABEL[account.network]} está instável para esta conta. Vamos continuar tentando com cuidado.`, sourceUrl: SOCIAL_PATHS.integrations(account.workspaceId) });
    }
    return updated;
  }

  async recordPublishSuccess(account: SocialAccount): Promise<void> {
    await this.deps.repository.updateAccount({ tenantId: account.tenantId, id: account.id, patch: { lastSuccessfulPublishAt: this.now().toISOString(), consecutiveFailures: 0, ...(account.status === "TEMPORARY_ERROR" || account.status === "CONNECTED" ? { status: "HEALTHY" as const } : {}) } });
  }

  /**
   * Retomada após reconexão: aplica a política de atraso a cada destino que esperava a conta.
   * Nada é disparado em rajada: a fila por conta (intervalo mínimo + trava) escalona a saída.
   */
  async resumeAfterReconnect(account: SocialAccount, actor: SocialAuditActor): Promise<{ released: number; awaitingConfirmation: number; skipped: number }> {
    const policy = await this.deps.resolver.policyFor(account.tenantId, account.network);
    const waiting = await this.deps.repository.listBlockedDestinations({ tenantId: account.tenantId, socialAccountId: account.id, blockReason: "WAITING_REAUTH" });
    const now = this.now();
    let released = 0;
    let awaitingConfirmation = 0;
    let skipped = 0;
    for (const destination of waiting) {
      const lateMinutes = destination.scheduledAt ? (now.getTime() - Date.parse(destination.scheduledAt)) / 60_000 : 0;
      if (lateMinutes <= policy.latePolicy.toleranceMinutes || policy.latePolicy.whenLate === "PUBLISH_ON_RECONNECT") {
        await this.releaseDestination(destination, destination.scheduledAt && Date.parse(destination.scheduledAt) > now.getTime() ? destination.scheduledAt : now.toISOString());
        released += 1;
      } else if (policy.latePolicy.whenLate === "SKIP") {
        await this.skipDestination(destination, actor, "late_policy");
        skipped += 1;
      } else {
        await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { blockReason: "AWAITING_CONFIRMATION", blockedAt: now.toISOString() } });
        awaitingConfirmation += 1;
      }
    }
    if (awaitingConfirmation > 0) {
      await this.deps.notifier.notify({
        tenantId: account.tenantId,
        workspaceId: account.workspaceId,
        kind: "publication_late",
        network: account.network,
        subjectId: account.id,
        title: "Publicações atrasadas aguardando confirmação",
        body: `${awaitingConfirmation === 1 ? "1 publicação passou" : `${awaitingConfirmation} publicações passaram`} do horário enquanto a conta do ${NETWORK_LABEL[account.network]} estava desconectada. Confirme se ainda devem sair.`,
        sourceUrl: SOCIAL_PATHS.calendar(account.workspaceId),
      });
    }
    return { released, awaitingConfirmation, skipped };
  }

  /** Decisão do cliente para publicação atrasada: publicar agora ou pular. */
  async decideLate(input: { tenantId: string; workspaceId: string; destinationId: string; decision: "publish" | "skip"; actor: SocialAuditActor }): Promise<SocialPostDestination> {
    const destination = await this.deps.repository.getDestination({ tenantId: input.tenantId, workspaceId: input.workspaceId, id: input.destinationId });
    if (!destination) throw new Error("SOCIAL_DESTINATION_NOT_FOUND: publicação não encontrada.");
    if (destination.blockReason !== "AWAITING_CONFIRMATION") throw new Error("SOCIAL_DESTINATION_NOT_AWAITING: esta publicação não está aguardando confirmação.");
    if (input.decision === "skip") {
      await this.skipDestination(destination, input.actor, "user_decision");
    } else {
      await this.releaseDestination(destination, this.now().toISOString());
      await this.deps.audit.record({ tenantId: input.tenantId, workspaceId: input.workspaceId, event: "POST_LATE_CONFIRMED", actor: input.actor, resource: { type: "social_post", id: destination.publicationId }, metadata: { destinationId: destination.id, network: destination.network } });
    }
    return (await this.deps.repository.getDestination({ tenantId: input.tenantId, workspaceId: input.workspaceId, id: input.destinationId }))!;
  }

  /** Bloqueia (sem apagar) os destinos pendentes da conta. Retorna quantos estão aguardando. */
  async blockPendingDestinations(account: SocialAccount): Promise<number> {
    const now = this.now().toISOString();
    const destinations = await this.deps.repository.listDestinations({ tenantId: account.tenantId, workspaceId: account.workspaceId, socialAccountId: account.id, limit: 1000 });
    let count = 0;
    for (const destination of destinations) {
      if (destination.skippedAt) continue;
      if (destination.blockReason === "WAITING_REAUTH" || destination.blockReason === "AWAITING_CONFIRMATION") {
        count += 1;
        continue;
      }
      const detail = await this.deps.publicationRepository.getDetail(destination.publicationId);
      const target = detail?.targets.find((item) => item.id === destination.targetId);
      if (!detail || !target || target.status === "published" || target.status === "cancelled" || detail.plan.state === "cancelled") continue;
      await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { blockReason: "WAITING_REAUTH", blockedAt: now } });
      await this.deps.publicationRepository.rescheduleTargetOutbox({ targetId: destination.targetId, availableAt: FAR_FUTURE });
      count += 1;
    }
    return count;
  }

  private async releaseDestination(destination: SocialPostDestination, availableAt: string): Promise<void> {
    await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { clearBlock: true } });
    await this.deps.publicationRepository.rescheduleTargetOutbox({ targetId: destination.targetId, availableAt });
  }

  private async skipDestination(destination: SocialPostDestination, actor: SocialAuditActor, reason: string): Promise<void> {
    const now = this.now().toISOString();
    await this.deps.publicationRepository.cancelTarget({ targetId: destination.targetId, now });
    await this.deps.repository.updateDestination({ tenantId: destination.tenantId, id: destination.id, patch: { clearBlock: true, skippedAt: now } });
    await this.deps.audit.record({ tenantId: destination.tenantId, workspaceId: destination.workspaceId, event: "POST_LATE_SKIPPED", actor, resource: { type: "social_post", id: destination.publicationId }, metadata: { destinationId: destination.id, network: destination.network, reason } });
  }

  context(account: SocialAccount, session: SocialProviderSession): SocialProviderAccountContext {
    return { tenantId: account.tenantId, workspaceId: account.workspaceId, socialAccountId: account.id, network: account.network, externalAccountId: account.externalAccountId, username: account.username, metadata: account.metadata, session };
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }
}

export { FAR_FUTURE as SOCIAL_FAR_FUTURE };
