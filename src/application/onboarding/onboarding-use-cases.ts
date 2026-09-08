import { assertWithinLimit, type EntitlementUseCaseDeps } from "../billing/entitlement-use-cases.js";
import { createConnection, listConnections, type InboxUseCaseDeps } from "../inbox/inbox-use-cases.js";
import { inviteMember, listTenantInvites, type InviteUseCaseDeps } from "../identity/invite-use-cases.js";
import type { WorkspaceOnboardingRepositoryPort } from "../ports/workspace-onboarding-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import type { MessagingConnection } from "../../domain/inbox/inbox.model.js";
import { nextOnboardingStep, type OnboardingGoal, type OnboardingStep, type WorkspaceOnboarding } from "../../domain/onboarding/onboarding.model.js";
import type { TenantMemberInvite, TenantRole } from "../../domain/identity/identity.model.js";
import { recordFirstEvent, recordProductEvent, type ProductAnalyticsUseCaseDeps } from "../product-analytics/product-analytics-use-cases.js";

/**
 * Onboarding guiado — SaaS Commercialization. Camada de ORQUESTRAÇÃO, nunca de reimplementação:
 * toda ação real (convidar, conectar canal) delega para o caso de uso já existente do módulo dono
 * daquilo (`inviteMember`, `createConnection`) — esta camada só sabe "em que etapa o workspace
 * está" e aplica as checagens de idempotência/entitlement específicas do FLUXO de onboarding
 * (nunca duplica a regra de negócio em si, ver `docs/` desta fase).
 */
export type OnboardingUseCaseDeps = {
  workspaceOnboardingRepository: WorkspaceOnboardingRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
  entitlementDeps: EntitlementUseCaseDeps;
  inviteDeps: InviteUseCaseDeps;
  inboxDeps: InboxUseCaseDeps;
  /** Kill switch global do módulo Conversas (`CONVERSATIONS_MODULE_ENABLED`) — INDEPENDENTE do
   * entitlement de `messaging_connections`. Um é "o plano permite quantas conexões" (billing), o
   * outro é "o módulo está tecnicamente ligado neste ambiente" (operações); a etapa "Canal" só
   * pode agir quando OS DOIS permitirem, nunca um no lugar do outro. */
  inboxModuleEnabled: boolean;
  /** Trial + Product Analytics — integração MÍNIMA autorizada nesta camada (só registrar
   * `onboarding_started`/`onboarding_step_completed`/`onboarding_completed`; nenhuma regra de
   * onboarding muda). */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
};

async function assertWorkspaceBelongsToTenant(deps: OnboardingUseCaseDeps, tenantId: string, workspaceId: string): Promise<void> {
  const workspace = await deps.workspaceRepository.getById(workspaceId);
  if (!workspace || workspace.tenantId !== tenantId) {
    throw new Error(`ONBOARDING_WORKSPACE_NOT_FOUND: workspace "${workspaceId}" não existe.`);
  }
}

function addCompletedStep(current: OnboardingStep[], step: OnboardingStep): OnboardingStep[] {
  return current.includes(step) ? current : [...current, step];
}

export async function startOnboarding(deps: OnboardingUseCaseDeps, input: { tenantId: string; workspaceId: string }): Promise<WorkspaceOnboarding> {
  await assertWorkspaceBelongsToTenant(deps, input.tenantId, input.workspaceId);
  const progress = await deps.workspaceOnboardingRepository.ensureStarted({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  if (deps.productAnalytics) {
    // `recordFirstEvent` (não a nomenclatura "first_*") só pelo mecanismo de idempotência por
    // (workspaceId, eventName) — evita registrar de novo a cada reload/reabertura do wizard.
    await recordFirstEvent(deps.productAnalytics, { eventName: "onboarding_started", source: "server", tenantId: input.tenantId, workspaceId: input.workspaceId });
  }
  return progress;
}

/** Dispara `onboarding_step_completed` só quando o array de etapas concluídas realmente muda —
 * nunca em reload/idempotência (mesma checagem que `saveCompanyStep`/`advanceOnboardingStep` já
 * fazem pra decidir se avançam `currentStep`). */
async function recordStepCompletedIfNew(deps: OnboardingUseCaseDeps, tenantId: string, workspaceId: string, previous: OnboardingStep[], updated: OnboardingStep[], step: OnboardingStep): Promise<void> {
  if (!deps.productAnalytics) return;
  if (updated.length === previous.length) return;
  await recordProductEvent(deps.productAnalytics, { eventName: "onboarding_step_completed", source: "server", tenantId, workspaceId, properties: { step } });
}

/** `undefined` = onboarding nunca foi iniciado para este workspace (nunca inventa um progresso
 * vazio — mesma convenção de `GET /brand-profile`). */
export async function getOnboarding(deps: OnboardingUseCaseDeps, input: { tenantId: string; workspaceId: string }): Promise<WorkspaceOnboarding | undefined> {
  await assertWorkspaceBelongsToTenant(deps, input.tenantId, input.workspaceId);
  return deps.workspaceOnboardingRepository.getByWorkspace(input.workspaceId);
}

export type SaveCompanyStepInput = { tenantId: string; workspaceId: string; segment?: string; size?: string; goal?: OnboardingGoal };

/** Etapa 1 ("Sua Empresa"). O NOME da empresa é o próprio nome do Workspace — editado via
 * `PATCH /v1/workspaces/:id` já existente (o frontend chama isso separadamente); aqui só o
 * contexto que não tem outro lugar pra morar (segmento/tamanho/objetivo). Idempotente: chamar de
 * novo só sobrescreve os campos informados e nunca regride `currentStep` se o usuário já avançou
 * mais (ex.: já está em "team" e reabriu a etapa 1 numa segunda aba). */
export async function saveCompanyStep(deps: OnboardingUseCaseDeps, input: SaveCompanyStepInput): Promise<WorkspaceOnboarding> {
  await assertWorkspaceBelongsToTenant(deps, input.tenantId, input.workspaceId);
  const progress = await deps.workspaceOnboardingRepository.ensureStarted({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  const completedSteps = addCompletedStep(progress.completedSteps, "company");
  const alreadyPastCompany = progress.currentStep !== "company";
  await recordStepCompletedIfNew(deps, input.tenantId, input.workspaceId, progress.completedSteps, completedSteps, "company");
  return deps.workspaceOnboardingRepository.update(input.workspaceId, {
    completedSteps,
    ...(input.segment !== undefined ? { companySegment: input.segment } : {}),
    ...(input.size !== undefined ? { companySize: input.size || null } : {}),
    ...(input.goal !== undefined ? { primaryGoal: input.goal } : {}),
    ...(alreadyPastCompany ? {} : { currentStep: nextOnboardingStep("company") }),
  });
}

export type InviteDuringOnboardingInput = { tenantId: string; workspaceId: string; email: string; role: TenantRole; invitedByUserId: string };
export type InviteDuringOnboardingResult = { invite: TenantMemberInvite; alreadyPending: boolean };

/**
 * Etapa "Equipe". Reusa `inviteMember` integralmente — a ÚNICA coisa que esta camada adiciona é o
 * que `inviteMember` não faz sozinho e que o pedido exige explicitamente: (1) respeitar o limite
 * de usuários do plano (`assertWithinLimit`, nunca duplicando a regra — só chamando o serviço já
 * existente ANTES de convidar) e (2) nunca criar um segundo convite pendente pro mesmo email
 * (idempotência — clicar duas vezes não duplica).
 */
export async function inviteTeamMemberDuringOnboarding(deps: OnboardingUseCaseDeps, input: InviteDuringOnboardingInput): Promise<InviteDuringOnboardingResult> {
  await assertWorkspaceBelongsToTenant(deps, input.tenantId, input.workspaceId);
  const email = input.email.trim().toLowerCase();

  const existingInvites = await listTenantInvites(deps.inviteDeps, input.tenantId);
  const pending = existingInvites.find((candidate) => candidate.email === email && candidate.status === "pending");
  if (pending) {
    await markStepEngaged(deps, input.tenantId, input.workspaceId, "team");
    return { invite: pending, alreadyPending: true };
  }

  await assertWithinLimit(deps.entitlementDeps, { tenantId: input.tenantId, resource: "users" });
  const { invite } = await inviteMember(deps.inviteDeps, { tenantId: input.tenantId, email, role: input.role, invitedByUserId: input.invitedByUserId, workspaceId: input.workspaceId });
  await markStepEngaged(deps, input.tenantId, input.workspaceId, "team");
  return { invite, alreadyPending: false };
}

export type ConnectChannelDuringOnboardingInput = { tenantId: string; workspaceId: string; displayName: string };
export type ConnectChannelDuringOnboardingResult = { connection: MessagingConnection; reused: boolean };

/**
 * Etapa "Canal". Reusa `createConnection`/`listConnections` integralmente. Idempotência: se o
 * workspace já tem QUALQUER conexão, reaproveita a mais recente em vez de criar outra (clicar
 * duas vezes nunca duplica) — só passa pelo limite de plano (`messaging_connections`) quando de
 * fato vai criar uma conexão nova.
 *
 * `inboxModuleEnabled` é checado ANTES de tudo — feature flag e entitlement são independentes por
 * design (não-negociável): um ambiente com o módulo desligado nunca deveria conseguir criar uma
 * conexão só porque o plano permitiria, e um plano sem cota nunca é contornado só porque o módulo
 * está ligado. A operação só acontece quando OS DOIS permitirem.
 */
export async function connectChannelDuringOnboarding(deps: OnboardingUseCaseDeps, input: ConnectChannelDuringOnboardingInput): Promise<ConnectChannelDuringOnboardingResult> {
  await assertWorkspaceBelongsToTenant(deps, input.tenantId, input.workspaceId);
  if (!deps.inboxModuleEnabled) {
    throw new Error("ONBOARDING_CHANNEL_MODULE_DISABLED: o módulo Conversas está desabilitado neste ambiente.");
  }

  const existing = await listConnections(deps.inboxDeps, { tenantId: input.tenantId, workspaceId: input.workspaceId });
  if (existing.length > 0) {
    await markStepEngaged(deps, input.tenantId, input.workspaceId, "channel");
    return { connection: existing[existing.length - 1], reused: true };
  }

  await assertWithinLimit(deps.entitlementDeps, { tenantId: input.tenantId, resource: "messaging_connections" });
  const connection = await createConnection(deps.inboxDeps, { tenantId: input.tenantId, workspaceId: input.workspaceId, displayName: input.displayName });
  await markStepEngaged(deps, input.tenantId, input.workspaceId, "channel");
  return { connection, reused: false };
}

async function markStepEngaged(deps: OnboardingUseCaseDeps, tenantId: string, workspaceId: string, step: OnboardingStep): Promise<void> {
  // Leitura, nunca criação: o wizard sempre chama `startOnboarding` antes de qualquer ação real
  // (convite/conexão). Se a linha ainda não existir por algum motivo, isto é só um efeito
  // colateral de tracking — nunca deve quebrar a ação real que já aconteceu.
  const progress = await deps.workspaceOnboardingRepository.getByWorkspace(workspaceId);
  if (!progress) return;
  const completedSteps = addCompletedStep(progress.completedSteps, step);
  if (completedSteps.length === progress.completedSteps.length) return;
  await recordStepCompletedIfNew(deps, tenantId, workspaceId, progress.completedSteps, completedSteps, step);
  await deps.workspaceOnboardingRepository.update(workspaceId, { completedSteps });
}

export type AdvanceOnboardingStepInput = { tenantId: string; workspaceId: string; step: OnboardingStep; skipped?: boolean };

/** Transição genérica "saí desta etapa" — usada por Comercial (reconhecer o pipeline padrão) e
 * como "pular"/"continuar depois" em qualquer etapa opcional. `skipped: true` NUNCA marca a etapa
 * como concluída (só avança `currentStep`) — o checklist da Home precisa distinguir "fiz" de "vou
 * fazer depois". Idempotente: chamar com o mesmo `step` de novo não duplica nada no array. */
export async function advanceOnboardingStep(deps: OnboardingUseCaseDeps, input: AdvanceOnboardingStepInput): Promise<WorkspaceOnboarding> {
  await assertWorkspaceBelongsToTenant(deps, input.tenantId, input.workspaceId);
  const progress = await deps.workspaceOnboardingRepository.ensureStarted({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  const completedSteps = input.skipped ? progress.completedSteps : addCompletedStep(progress.completedSteps, input.step);
  const alreadyPast = progress.currentStep !== input.step;
  if (!input.skipped) {
    await recordStepCompletedIfNew(deps, input.tenantId, input.workspaceId, progress.completedSteps, completedSteps, input.step);
  }
  return deps.workspaceOnboardingRepository.update(input.workspaceId, {
    completedSteps,
    ...(alreadyPast ? {} : { currentStep: nextOnboardingStep(input.step) }),
  });
}

/** Idempotente: completar de novo um onboarding já concluído só devolve o estado atual, nunca
 * reseta `completedAt`. */
export async function completeOnboarding(deps: OnboardingUseCaseDeps, input: { tenantId: string; workspaceId: string }): Promise<WorkspaceOnboarding> {
  await assertWorkspaceBelongsToTenant(deps, input.tenantId, input.workspaceId);
  const progress = await deps.workspaceOnboardingRepository.ensureStarted({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  if (progress.status === "completed") return progress;
  if (deps.productAnalytics) {
    await recordProductEvent(deps.productAnalytics, { eventName: "onboarding_completed", source: "server", tenantId: input.tenantId, workspaceId: input.workspaceId });
  }
  return deps.workspaceOnboardingRepository.update(input.workspaceId, {
    status: "completed",
    currentStep: "done",
    completedAt: new Date().toISOString(),
  });
}
