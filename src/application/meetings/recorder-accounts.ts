import type { Permission } from "../../domain/identity/identity.model.js";
import {
  computeRecordingCapacity,
  looksLikePersonalGoogleAccount,
  normalizeGoogleEmail,
  type MeetingsLimits,
  type RecorderBotAccount,
  type RecordingCapacity,
} from "../../domain/meetings/meeting.model.js";
import { hasPermission, type TenantRole } from "../../domain/identity/identity.model.js";
import type { MeetingRepositoryPort, RecorderAccountWithContext, RecorderProvisioningSession } from "../ports/meeting-repository.port.js";

/**
 * Contas Google de GRAVAÇÃO do cliente (customer_managed), em self-service: o cliente conecta,
 * testa, reconecta, desativa e remove as próprias contas em Meetings → Configurações. Nenhum
 * terminal, script, upload de JSON ou suporte.
 *
 * O login é feito pelo PRÓPRIO cliente num navegador temporário e isolado que roda no host do
 * recorder e é transmitido para a tela. O Vorix nunca vê, guarda nem automatiza senha, código MFA
 * ou recovery code — só guarda (cifrada) a sessão resultante.
 */

export type RecorderAccountDeps = {
  repository: MeetingRepositoryPort;
  limitsFor: (tenantId: string) => Promise<MeetingsLimits>;
  idGenerator: (prefix: string) => string;
  now: () => Date;
  /** Token aleatório de visualização (vai só para o navegador de quem iniciou) e o hash que fica no banco. */
  newViewerToken: () => { token: string; hash: string };
};

export type RecorderAccountActor = { tenantId: string; userId: string; role: TenantRole; /** Permissões efetivas (preset + exceções); ausente = preset do papel. */ permissions?: readonly Permission[] };

/** Duração máxima do navegador temporário de login. */
export const RECORDER_PROVISIONING_TTL_MS = 10 * 60_000;

export class RecorderAccountError extends Error {
  constructor(
    readonly code:
      | "RECORDER_ACCOUNT_FORBIDDEN"
      | "RECORDER_ACCOUNT_NOT_FOUND"
      | "RECORDER_ACCOUNT_INVALID_INPUT"
      | "RECORDER_ACCOUNT_DUPLICATE"
      | "RECORDER_ACCOUNT_BUSY"
      | "RECORDER_ACCOUNT_SESSION_REQUIRED"
      | "RECORDER_PROVISIONING_NOT_FOUND",
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

/** O que a tela vê de uma conta — nunca a sessão, nem referência a segredo. */
export type RecorderAccountView = {
  id: string;
  label: string;
  googleEmail: string;
  status: RecorderBotAccount["status"];
  /** Rótulo de saúde para a tela. */
  health: "healthy" | "needs_reconnect" | "pending_test" | "never_connected" | "disabled" | "error";
  connected: boolean;
  lastHealthCheckAt?: string;
  lastUsedAt?: string;
  currentMeetingId?: string;
  currentMeetingTitle?: string;
  lastError?: string;
  /** Parece uma conta pessoal — só aviso; contas dedicadas são recomendadas. */
  personalAccountWarning: boolean;
  /** É uma conta Google que a própria pessoa usa (Agenda conectada) — aviso forte. */
  isKnownHumanAccount: boolean;
  createdAt: string;
};

function assertManage(actor: RecorderAccountActor): void {
  if (!hasPermission(actor, "meeting:manage_recorder_accounts")) {
    throw new RecorderAccountError("RECORDER_ACCOUNT_FORBIDDEN", "Somente administradores da empresa podem gerenciar contas de gravação.");
  }
}

function healthOf(account: RecorderBotAccount): RecorderAccountView["health"] {
  const pending = (account.health as { status?: string }).status === "pending";
  if (!account.hasEncryptedSessionState && !account.credentialSecretRef) return "never_connected";
  if (account.status === "active" || account.status === "busy") return "healthy";
  if (account.status === "reauth_required" || account.status === "invalid_session") return "needs_reconnect";
  if (account.status === "error") return "error";
  return pending ? "pending_test" : "disabled";
}

export function toRecorderAccountView(account: RecorderAccountWithContext, knownHumanEmails: ReadonlySet<string> = new Set()): RecorderAccountView {
  const email = normalizeGoogleEmail(account.googleEmail) ?? account.googleEmail;
  return {
    id: account.id,
    label: account.label,
    googleEmail: email,
    status: account.status,
    health: healthOf(account),
    connected: account.hasEncryptedSessionState || Boolean(account.credentialSecretRef),
    ...(account.lastHealthCheckAt ? { lastHealthCheckAt: account.lastHealthCheckAt } : {}),
    ...(account.lastUsedAt ? { lastUsedAt: account.lastUsedAt } : {}),
    ...(account.currentMeetingId ? { currentMeetingId: account.currentMeetingId } : {}),
    ...(account.currentMeetingTitle ? { currentMeetingTitle: account.currentMeetingTitle } : {}),
    ...(account.lastError ? { lastError: account.lastError.slice(0, 300) } : {}),
    personalAccountWarning: looksLikePersonalGoogleAccount(email),
    isKnownHumanAccount: knownHumanEmails.has(email),
    createdAt: account.createdAt,
  };
}

async function capacityFor(deps: RecorderAccountDeps, tenantId: string, accounts: readonly RecorderBotAccount[]): Promise<RecordingCapacity> {
  const limits = await deps.limitsFor(tenantId);
  const activeRecordings = await deps.repository.countActiveRecordings(tenantId);
  return computeRecordingCapacity({ planLimit: limits.maxConcurrentRecordings, accounts, activeRecordings });
}

/** Resumo de capacidade (sem e-mails) — visível para quem grava, para explicar avisos e bloqueios. */
export async function getRecordingCapacity(deps: RecorderAccountDeps, actor: RecorderAccountActor): Promise<RecordingCapacity & { canManage: boolean; knownHumanEmails: string[] }> {
  const accounts = await deps.repository.listRecorderAccounts({ tenantId: actor.tenantId });
  const known = await deps.repository.knownHumanGoogleEmails({ tenantId: actor.tenantId, userId: actor.userId });
  return {
    ...(await capacityFor(deps, actor.tenantId, accounts)),
    canManage: hasPermission(actor, "meeting:manage_recorder_accounts"),
    // Sugestões para "Qual conta Google você utilizará para participar?" — só as da própria pessoa.
    knownHumanEmails: [...new Set([...known.connected, ...known.recentExplicit])].sort(),
  };
}

export async function listTenantRecorderAccounts(deps: RecorderAccountDeps, actor: RecorderAccountActor): Promise<{ accounts: RecorderAccountView[]; capacity: RecordingCapacity }> {
  assertManage(actor);
  const accounts = await deps.repository.listRecorderAccounts({ tenantId: actor.tenantId });
  const known = await deps.repository.knownHumanGoogleEmails({ tenantId: actor.tenantId, userId: actor.userId });
  const knownSet = new Set([...known.connected, ...known.recentExplicit]);
  return { accounts: accounts.map((account) => toRecorderAccountView(account, knownSet)), capacity: await capacityFor(deps, actor.tenantId, accounts) };
}

async function requireAccount(deps: RecorderAccountDeps, actor: RecorderAccountActor, accountId: string): Promise<RecorderBotAccount> {
  const account = await deps.repository.getRecorderAccount({ accountId, tenantId: actor.tenantId });
  if (!account) throw new RecorderAccountError("RECORDER_ACCOUNT_NOT_FOUND", "Conta de gravação não encontrada.");
  return account;
}

export type ProvisioningStart = {
  account: RecorderAccountView;
  session: RecorderProvisioningSessionView;
  /** Token de visualização do navegador temporário — exibido UMA vez, só para quem iniciou. */
  viewerToken: string;
  warnings: string[];
};

export type RecorderProvisioningSessionView = Pick<RecorderProvisioningSession, "id" | "recorderAccountId" | "status" | "errorCode" | "errorMessage" | "expiresAt" | "completedAt">;

function toSessionView(session: RecorderProvisioningSession): RecorderProvisioningSessionView {
  return {
    id: session.id,
    recorderAccountId: session.recorderAccountId,
    status: session.status,
    ...(session.errorCode ? { errorCode: session.errorCode } : {}),
    ...(session.errorMessage ? { errorMessage: session.errorMessage } : {}),
    expiresAt: session.expiresAt,
    ...(session.completedAt ? { completedAt: session.completedAt } : {}),
  };
}

async function openProvisioning(deps: RecorderAccountDeps, actor: RecorderAccountActor, account: RecorderBotAccount, workspaceId: string, warnings: string[]): Promise<ProvisioningStart> {
  const viewer = deps.newViewerToken();
  const session = await deps.repository.createProvisioningSession({
    id: deps.idGenerator("rprov"),
    tenantId: actor.tenantId,
    workspaceId,
    recorderAccountId: account.id,
    createdByUserId: actor.userId,
    viewerTokenHash: viewer.hash,
    expiresAt: new Date(deps.now().getTime() + RECORDER_PROVISIONING_TTL_MS),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "RECORDER_ACCOUNT_UNAVAILABLE") throw new RecorderAccountError("RECORDER_ACCOUNT_BUSY", "A conta está em uso ou não está disponível neste workspace.");
    throw error;
  });
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId, actorUserId: actor.userId, action: "recorder_account.provisioning_started", details: { accountId: account.id, sessionId: session.id } });
  const current = await deps.repository.getRecorderAccount({ accountId: account.id, tenantId: actor.tenantId });
  return { account: toRecorderAccountView(current ?? account), session: toSessionView(session), viewerToken: viewer.token, warnings };
}

/** Conectar conta: cria a conta (fora da seleção até o teste passar) e abre o navegador temporário. */
export async function connectRecorderAccount(deps: RecorderAccountDeps, actor: RecorderAccountActor, input: { workspaceId: string; label: string; googleEmail: string }): Promise<ProvisioningStart> {
  assertManage(actor);
  const email = normalizeGoogleEmail(input.googleEmail);
  if (!email) throw new RecorderAccountError("RECORDER_ACCOUNT_INVALID_INPUT", "Informe um e-mail Google válido.");
  const label = input.label.trim().slice(0, 80);
  if (!label) throw new RecorderAccountError("RECORDER_ACCOUNT_INVALID_INPUT", "Dê um nome para esta conta (ex.: Gravador Comercial 01).");
  const known = await deps.repository.knownHumanGoogleEmails({ tenantId: actor.tenantId, userId: actor.userId });
  const warnings: string[] = [];
  if ([...known.connected, ...known.recentExplicit].includes(email)) {
    warnings.push("Esta parece ser a conta Google que você usa para participar das reuniões. Ela nunca gravará reuniões em que você entra com ela — prefira uma conta dedicada à gravação.");
  } else if (looksLikePersonalGoogleAccount(email)) {
    warnings.push("Recomendamos usar uma conta Google dedicada à gravação (ex.: gravador01@suaempresa.com), separada das contas de quem participa das reuniões.");
  }
  const created = await deps.repository.createRecorderAccount({
    id: deps.idGenerator("rec-acc"),
    tenantId: actor.tenantId,
    createdByUserId: actor.userId,
    label,
    googleEmail: email,
    displayName: label,
  });
  if (!created.ok) throw new RecorderAccountError("RECORDER_ACCOUNT_DUPLICATE", "Esta conta Google já está conectada como conta de gravação. Use Reconectar nela.");
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, actorUserId: actor.userId, action: "recorder_account.created", details: { accountId: created.account.id, ownershipType: "customer_managed" } });
  return openProvisioning(deps, actor, created.account, input.workspaceId, warnings);
}

/** Reconectar: novo login para uma conta existente (sessão expirou ou foi revogada). */
export async function reconnectRecorderAccount(deps: RecorderAccountDeps, actor: RecorderAccountActor, input: { workspaceId: string; accountId: string }): Promise<ProvisioningStart> {
  assertManage(actor);
  const account = await requireAccount(deps, actor, input.accountId);
  if (account.status === "busy") throw new RecorderAccountError("RECORDER_ACCOUNT_BUSY", "Esta conta está gravando uma reunião agora. Reconecte depois que a gravação terminar.");
  if (account.workspaceId && account.workspaceId !== input.workspaceId) throw new RecorderAccountError("RECORDER_ACCOUNT_NOT_FOUND", "Conta de gravação não encontrada neste workspace.");
  return openProvisioning(deps, actor, account, input.workspaceId, []);
}

export async function getProvisioningSessionStatus(deps: RecorderAccountDeps, actor: RecorderAccountActor, input: { sessionId: string }): Promise<{ session: RecorderProvisioningSessionView; account?: RecorderAccountView }> {
  assertManage(actor);
  const session = await deps.repository.getProvisioningSession({ sessionId: input.sessionId, tenantId: actor.tenantId });
  if (!session || session.createdByUserId !== actor.userId) throw new RecorderAccountError("RECORDER_PROVISIONING_NOT_FOUND", "Sessão de conexão não encontrada.");
  const account = await deps.repository.getRecorderAccount({ accountId: session.recorderAccountId, tenantId: actor.tenantId });
  return { session: toSessionView(session), ...(account ? { account: toRecorderAccountView(account) } : {}) };
}

export async function cancelProvisioningSession(deps: RecorderAccountDeps, actor: RecorderAccountActor, input: { sessionId: string }): Promise<void> {
  assertManage(actor);
  const session = await deps.repository.getProvisioningSession({ sessionId: input.sessionId, tenantId: actor.tenantId });
  if (!session || session.createdByUserId !== actor.userId) throw new RecorderAccountError("RECORDER_PROVISIONING_NOT_FOUND", "Sessão de conexão não encontrada.");
  await deps.repository.updateProvisioningSession({ sessionId: session.id, status: "cancelled" });
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: session.workspaceId, actorUserId: actor.userId, action: "recorder_account.provisioning_cancelled", details: { accountId: session.recorderAccountId, sessionId: session.id } });
}

/** Testar: o worker do recorder abre meet.google.com com a sessão guardada → ACTIVE ou INVALID_SESSION. */
export async function testRecorderAccount(deps: RecorderAccountDeps, actor: RecorderAccountActor, input: { accountId: string }): Promise<RecorderAccountView> {
  assertManage(actor);
  const account = await requireAccount(deps, actor, input.accountId);
  if (!account.hasEncryptedSessionState && !account.credentialSecretRef) throw new RecorderAccountError("RECORDER_ACCOUNT_SESSION_REQUIRED", "Esta conta ainda não foi conectada. Use Conectar/Reconectar.");
  if (account.status === "busy") throw new RecorderAccountError("RECORDER_ACCOUNT_BUSY", "Esta conta está gravando uma reunião agora.");
  const updated = await deps.repository.updateRecorderBotStatus({ botId: account.id, status: "disabled", health: { status: "pending", requestedAt: deps.now().toISOString() } });
  if (!updated) throw new RecorderAccountError("RECORDER_ACCOUNT_BUSY", "Esta conta está gravando uma reunião agora.");
  await deps.repository.audit({ tenantId: actor.tenantId, actorUserId: actor.userId, action: "recorder_account.test_requested", details: { accountId: account.id } });
  return toRecorderAccountView(updated);
}

export async function disableRecorderAccount(deps: RecorderAccountDeps, actor: RecorderAccountActor, input: { accountId: string }): Promise<RecorderAccountView> {
  assertManage(actor);
  const result = await deps.repository.setRecorderAccountEnabled({ tenantId: actor.tenantId, accountId: input.accountId, enabled: false });
  if (!result) throw new RecorderAccountError("RECORDER_ACCOUNT_NOT_FOUND", "Conta de gravação não encontrada.");
  if (result === "busy") throw new RecorderAccountError("RECORDER_ACCOUNT_BUSY", "Esta conta está gravando uma reunião agora. Desative depois que a gravação terminar.");
  await deps.repository.audit({ tenantId: actor.tenantId, ...(result.workspaceId ? { workspaceId: result.workspaceId } : {}), actorUserId: actor.userId, action: "RECORDER_DISABLED", details: { recorderAccountId: input.accountId } });
  return toRecorderAccountView(result);
}

export async function removeRecorderAccount(deps: RecorderAccountDeps, actor: RecorderAccountActor, input: { accountId: string }): Promise<void> {
  assertManage(actor);
  const account = await requireAccount(deps, actor, input.accountId);
  const result = await deps.repository.removeRecorderAccount({ tenantId: actor.tenantId, accountId: input.accountId, actorUserId: actor.userId });
  if (result === "not_found") throw new RecorderAccountError("RECORDER_ACCOUNT_NOT_FOUND", "Conta de gravação não encontrada.");
  if (result === "busy") throw new RecorderAccountError("RECORDER_ACCOUNT_BUSY", "Esta conta está gravando uma reunião agora. Remova depois que a gravação terminar.");
  await deps.repository.audit({ tenantId: actor.tenantId, ...(account.workspaceId ? { workspaceId: account.workspaceId } : {}), actorUserId: actor.userId, action: "RECORDER_REMOVED", details: { recorderAccountId: input.accountId } });
}

/** Visão de SUPORTE da plataforma (admin de plataforma): todas as contas, de todos os tenants. */
export async function listAllRecorderAccountsForSupport(deps: Pick<RecorderAccountDeps, "repository">): Promise<(RecorderAccountView & { ownershipType: RecorderBotAccount["ownershipType"]; tenantId?: string; workspaceId?: string; workspaceName?: string })[]> {
  const accounts = await deps.repository.listRecorderAccounts({});
  return accounts.map((account) => ({
    ...toRecorderAccountView(account),
    ownershipType: account.ownershipType,
    ...(account.tenantId ? { tenantId: account.tenantId } : {}),
    ...(account.workspaceId ? { workspaceId: account.workspaceId } : {}),
    ...(account.workspaceName ? { workspaceName: account.workspaceName } : {}),
  }));
}
