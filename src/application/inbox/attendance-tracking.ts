import type { InboxConversation } from "../../domain/inbox/inbox.model.js";
import type {
  InboxAssignmentEndReason,
  InboxAssignmentSource,
  InboxAttendance,
  InboxAttendanceOpenReason,
  InboxClosureType,
  InboxDistributionRule,
} from "../../domain/inbox/attendance.model.js";
import { CLOSURE_NAME_MAX_LENGTH, DEFAULT_CLOSURE_CATALOG } from "../../domain/inbox/attendance.model.js";
import type { InboxAttendanceRepositoryPort, InboxAttendanceWithAssignments } from "../ports/inbox-attendance-repository.port.js";
import type { InboxClosureCatalogRepositoryPort } from "../ports/inbox-closure-catalog-repository.port.js";
import type { InboxConversationEventRepositoryPort } from "../ports/inbox-conversation-event-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";

/**
 * Ciclo de atendimento (migration 0172) — o que acontece por baixo de cada ação da Inbox: abrir o
 * atendimento, trocar o responsável (encerra um ciclo de responsabilidade e abre outro) e marcar a
 * primeira resposta de quem é responsável AGORA. Opcional como o resto do módulo: sem
 * `attendanceRepository`, tudo aqui é no-op e a Inbox funciona como antes.
 *
 * Falha aqui nunca desfaz a ação do atendente (atribuir, transferir, responder): o registro é
 * best-effort com aviso no log — a exceção é finalizar, que valida e grava o atendimento antes de
 * mudar o status da conversa (ver `closeConversation`).
 */
export type AttendanceTrackingDeps = {
  attendanceRepository?: InboxAttendanceRepositoryPort;
  conversationEventRepository: InboxConversationEventRepositoryPort;
};

const SOURCE_BY_RULE: Partial<Record<InboxDistributionRule, InboxAssignmentSource>> = {
  round_robin: "routing",
  fixed: "routing",
  last_assignee: "last_assignee",
  triage: "triage",
  manual: "manual",
  agent_started: "agent_started",
};

function warn(action: string, error: unknown): void {
  console.warn(`[inbox] falha ao registrar ${action} do ciclo de atendimento (best-effort):`, error instanceof Error ? error.message : error);
}

/**
 * Garante UM atendimento aberto para a conversa (idempotente e atômico no banco). Quando abre um
 * novo, registra o marco "Novo atendimento iniciado" com canal, equipe, responsável e a regra de
 * distribuição, e abre o ciclo de responsabilidade do responsável atual — cujo relógio de
 * primeira resposta começa em `at`.
 */
export async function ensureOpenAttendance(
  deps: AttendanceTrackingDeps,
  conversation: InboxConversation,
  input: { at: string; openedBy: string; openReason: InboxAttendanceOpenReason; distributionRule?: InboxDistributionRule },
): Promise<InboxAttendance | undefined> {
  const repository = deps.attendanceRepository;
  if (!repository) return undefined;
  const existing = await repository.getOpenByConversation(conversation.id);
  if (existing) return existing;
  const { attendance, created } = await repository.openIfNone({
    tenantId: conversation.tenantId,
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    contactId: conversation.contactId,
    connectionId: conversation.connectionId,
    teamId: conversation.currentTeamId,
    openedAt: input.at,
    openedBy: input.openedBy,
    openReason: input.openReason,
    distributionRule: input.distributionRule,
  });
  if (!created) return attendance;
  if (conversation.assignedUserId) {
    await repository.changeResponsible({
      attendanceId: attendance.id,
      toUserId: conversation.assignedUserId,
      teamId: conversation.currentTeamId,
      at: input.at,
      source: (input.distributionRule && SOURCE_BY_RULE[input.distributionRule]) ?? "manual",
      assignedBy: input.openedBy,
      endReason: "reassigned",
    });
  }
  await deps.conversationEventRepository.record({
    tenantId: conversation.tenantId,
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    attendanceId: attendance.id,
    type: "attendance_opened",
    performedBy: input.openedBy,
    toUserId: conversation.assignedUserId,
    toPhaseId: conversation.currentPhaseId,
    reason: input.openReason,
    metadata: {
      number: attendance.number,
      connectionId: conversation.connectionId,
      ...(conversation.currentTeamId ? { teamId: conversation.currentTeamId } : {}),
      ...(input.distributionRule ? { distributionRule: input.distributionRule } : {}),
    },
  });
  return attendance;
}

/** Best-effort de `ensureOpenAttendance` — nunca derruba o fluxo que chamou. */
export async function ensureOpenAttendanceSafely(
  deps: AttendanceTrackingDeps,
  conversation: InboxConversation,
  input: Parameters<typeof ensureOpenAttendance>[2],
): Promise<InboxAttendance | undefined> {
  try {
    return await ensureOpenAttendance(deps, conversation, input);
  } catch (error) {
    warn("a abertura", error);
    return undefined;
  }
}

/**
 * Sincroniza o ciclo de responsabilidade com o responsável ATUAL da conversa (`conversation` já
 * depois da mudança). Encerra o ciclo de quem saiu (com o motivo e para quem foi) e abre o de
 * quem entrou, com o relógio de primeira resposta começando agora — nunca no horário de abertura
 * do atendimento. Conversa finalizada não tem atendimento aberto: nada a registrar.
 */
export async function trackResponsibleChange(
  deps: AttendanceTrackingDeps,
  conversation: InboxConversation,
  input: { performedBy: string; source: InboxAssignmentSource; endReason: InboxAssignmentEndReason; at?: string },
): Promise<void> {
  if (!deps.attendanceRepository || conversation.status === "resolved" || conversation.status === "archived") return;
  try {
    const at = input.at ?? new Date().toISOString();
    const attendance =
      (await deps.attendanceRepository.getOpenByConversation(conversation.id)) ??
      (await ensureOpenAttendance(deps, conversation, { at, openedBy: input.performedBy, openReason: "assignment", distributionRule: input.source === "manual" ? "manual" : undefined }));
    if (!attendance) return;
    await deps.attendanceRepository.changeResponsible({
      attendanceId: attendance.id,
      toUserId: conversation.assignedUserId,
      teamId: conversation.currentTeamId,
      at,
      source: input.source,
      assignedBy: input.performedBy,
      endReason: input.endReason,
    });
  } catch (error) {
    warn("a troca de responsável", error);
  }
}

/** Primeira resposta HUMANA: do atendimento e, se quem respondeu é o responsável atual, do ciclo dele. */
export async function trackFirstResponse(deps: AttendanceTrackingDeps, input: { conversationId: string; userId: string; messageId: string; at: string }): Promise<void> {
  if (!deps.attendanceRepository) return;
  try {
    const attendance = await deps.attendanceRepository.getOpenByConversation(input.conversationId);
    if (!attendance) return;
    await deps.attendanceRepository.recordFirstResponse({ attendanceId: attendance.id, userId: input.userId, messageId: input.messageId, at: input.at });
  } catch (error) {
    warn("a primeira resposta", error);
  }
}

// ── Catálogo de finalização (Configurações > Atendimento > Tipos de finalização) ──────────────

export type ClosureCatalogDeps = { closureCatalogRepository?: InboxClosureCatalogRepositoryPort; workspaceRepository: WorkspaceRepositoryPort };

function requireCatalog(deps: ClosureCatalogDeps): InboxClosureCatalogRepositoryPort {
  if (!deps.closureCatalogRepository) throw new Error("INBOX_CLOSURE_CATALOG_NOT_CONFIGURED: tipos de finalização não estão disponíveis neste ambiente.");
  return deps.closureCatalogRepository;
}

async function mustWorkspaceBelongToTenant(deps: ClosureCatalogDeps, tenantId: string, workspaceId: string): Promise<void> {
  const workspace = await deps.workspaceRepository.getById(workspaceId);
  if (!workspace || workspace.tenantId !== tenantId) throw new Error(`INBOX_WORKSPACE_NOT_FOUND: workspace "${workspaceId}" não existe.`);
}

function normalizeClosureName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > CLOSURE_NAME_MAX_LENGTH) throw new Error(`INBOX_CLOSURE_NAME_INVALID: o nome precisa ter de 1 a ${CLOSURE_NAME_MAX_LENGTH} caracteres.`);
  return name;
}

function assertUniqueName(names: readonly string[], name: string, label: string): void {
  if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) throw new Error(`INBOX_CLOSURE_NAME_TAKEN: já existe ${label} chamado "${name}".`);
}

/** Lista o catálogo, criando a sugestão inicial na primeira vez (nunca de novo, mesmo que o
 * administrador exclua tudo depois). */
export async function listClosureTypes(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string }): Promise<InboxClosureType[]> {
  const catalog = requireCatalog(deps);
  await mustWorkspaceBelongToTenant(deps, input.tenantId, input.workspaceId);
  await catalog.seedIfEmpty({ tenantId: input.tenantId, workspaceId: input.workspaceId, catalog: DEFAULT_CLOSURE_CATALOG });
  return catalog.listByWorkspace(input.workspaceId);
}

async function mustClosureTypeBelongToWorkspace(deps: ClosureCatalogDeps, id: string, tenantId: string, workspaceId: string): Promise<InboxClosureType> {
  const type = await requireCatalog(deps).getType(id);
  if (!type || type.tenantId !== tenantId || type.workspaceId !== workspaceId) throw new Error(`INBOX_CLOSURE_TYPE_NOT_FOUND: tipo de finalização "${id}" não existe.`);
  return type;
}

export async function createClosureType(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string; name: string }): Promise<InboxClosureType> {
  const name = normalizeClosureName(input.name);
  const existing = await listClosureTypes(deps, input);
  assertUniqueName(existing.map((type) => type.name), name, "um tipo");
  return requireCatalog(deps).createType({ tenantId: input.tenantId, workspaceId: input.workspaceId, name });
}

export async function updateClosureType(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string; closureTypeId: string; name?: string; isActive?: boolean }): Promise<InboxClosureType> {
  const current = await mustClosureTypeBelongToWorkspace(deps, input.closureTypeId, input.tenantId, input.workspaceId);
  const name = input.name === undefined ? undefined : normalizeClosureName(input.name);
  if (name && name.toLowerCase() !== current.name.toLowerCase()) {
    const existing = await requireCatalog(deps).listByWorkspace(input.workspaceId);
    assertUniqueName(existing.filter((type) => type.id !== current.id).map((type) => type.name), name, "um tipo");
  }
  return requireCatalog(deps).updateType(current.id, { name, isActive: input.isActive });
}

export async function deleteClosureType(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string; closureTypeId: string }): Promise<void> {
  const current = await mustClosureTypeBelongToWorkspace(deps, input.closureTypeId, input.tenantId, input.workspaceId);
  await requireCatalog(deps).deleteType(current.id);
}

export async function reorderClosureTypes(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string; closureTypeIds: string[] }): Promise<InboxClosureType[]> {
  const existing = await listClosureTypes(deps, input);
  const ids = new Set(existing.map((type) => type.id));
  if (input.closureTypeIds.length !== existing.length || new Set(input.closureTypeIds).size !== existing.length || !input.closureTypeIds.every((id) => ids.has(id))) {
    throw new Error("INBOX_CLOSURE_REORDER_MISMATCH: a lista precisa conter exatamente todos os tipos, uma vez cada.");
  }
  await requireCatalog(deps).reorderTypes(input.workspaceId, input.closureTypeIds);
  return requireCatalog(deps).listByWorkspace(input.workspaceId);
}

export async function createClosureSubtype(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string; closureTypeId: string; name: string }): Promise<InboxClosureType> {
  const type = await mustClosureTypeBelongToWorkspace(deps, input.closureTypeId, input.tenantId, input.workspaceId);
  const name = normalizeClosureName(input.name);
  assertUniqueName(type.subtypes.map((subtype) => subtype.name), name, "um subtipo");
  await requireCatalog(deps).createSubtype({ tenantId: input.tenantId, workspaceId: input.workspaceId, closureTypeId: type.id, name });
  return (await requireCatalog(deps).getType(type.id))!;
}

async function mustSubtypeBelongToType(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string; closureTypeId: string; closureSubtypeId: string }): Promise<InboxClosureType> {
  const type = await mustClosureTypeBelongToWorkspace(deps, input.closureTypeId, input.tenantId, input.workspaceId);
  if (!type.subtypes.some((subtype) => subtype.id === input.closureSubtypeId)) throw new Error(`INBOX_CLOSURE_SUBTYPE_NOT_FOUND: subtipo de finalização "${input.closureSubtypeId}" não existe.`);
  return type;
}

export async function updateClosureSubtype(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string; closureTypeId: string; closureSubtypeId: string; name?: string; isActive?: boolean }): Promise<InboxClosureType> {
  const type = await mustSubtypeBelongToType(deps, input);
  const name = input.name === undefined ? undefined : normalizeClosureName(input.name);
  if (name) assertUniqueName(type.subtypes.filter((subtype) => subtype.id !== input.closureSubtypeId).map((subtype) => subtype.name), name, "um subtipo");
  await requireCatalog(deps).updateSubtype(input.closureSubtypeId, { name, isActive: input.isActive });
  return (await requireCatalog(deps).getType(type.id))!;
}

export async function deleteClosureSubtype(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string; closureTypeId: string; closureSubtypeId: string }): Promise<InboxClosureType> {
  const type = await mustSubtypeBelongToType(deps, input);
  await requireCatalog(deps).deleteSubtype(input.closureSubtypeId);
  return (await requireCatalog(deps).getType(type.id))!;
}

export async function reorderClosureSubtypes(deps: ClosureCatalogDeps, input: { tenantId: string; workspaceId: string; closureTypeId: string; closureSubtypeIds: string[] }): Promise<InboxClosureType> {
  const type = await mustClosureTypeBelongToWorkspace(deps, input.closureTypeId, input.tenantId, input.workspaceId);
  const ids = new Set(type.subtypes.map((subtype) => subtype.id));
  if (input.closureSubtypeIds.length !== type.subtypes.length || new Set(input.closureSubtypeIds).size !== type.subtypes.length || !input.closureSubtypeIds.every((id) => ids.has(id))) {
    throw new Error("INBOX_CLOSURE_REORDER_MISMATCH: a lista precisa conter exatamente todos os subtipos, uma vez cada.");
  }
  await requireCatalog(deps).reorderSubtypes(type.id, input.closureSubtypeIds);
  return (await requireCatalog(deps).getType(type.id))!;
}

/** Valida a escolha do modal de finalização: tipo e subtipo ATIVOS, do workspace, e o subtipo
 * pertence ao tipo. Devolve os nomes para o snapshot do atendimento. */
export async function resolveClosureChoice(
  deps: ClosureCatalogDeps,
  input: { tenantId: string; workspaceId: string; closureTypeId?: string; closureSubtypeId?: string },
): Promise<{ typeId: string; typeName: string; subtypeId: string; subtypeName: string }> {
  if (!input.closureTypeId || !input.closureSubtypeId) throw new Error("INBOX_CLOSURE_REQUIRED: escolha o tipo e o subtipo da finalização.");
  const type = await requireCatalog(deps).getType(input.closureTypeId);
  if (!type || type.tenantId !== input.tenantId || type.workspaceId !== input.workspaceId || !type.isActive) {
    throw new Error("INBOX_CLOSURE_INVALID: tipo de finalização inexistente ou desativado.");
  }
  const subtype = type.subtypes.find((item) => item.id === input.closureSubtypeId);
  if (!subtype || !subtype.isActive) throw new Error("INBOX_CLOSURE_INVALID: subtipo inexistente, desativado ou de outro tipo.");
  return { typeId: type.id, typeName: type.name, subtypeId: subtype.id, subtypeName: subtype.name };
}

export type { InboxAttendanceWithAssignments };
