import type { Deal } from "../../domain/crm/crm.model.js";
import {
  DEFAULT_CLOSE_REASONS,
  type CloseReason,
  type CloseReasonKind,
  type CommercialPolicy,
  type CommercialSettings,
  type Competitor,
  type CustomFieldType,
  type DealCustomFieldDefinition,
  type DealParticipant,
  type ParticipantRole,
  type PolicyScopeType,
} from "../../domain/sales/sales.model.js";
import { TENANT_ROLES } from "../../domain/identity/identity.model.js";
import { loadCommercialSettings, mustDealInWorkspace, resolveEffectivePolicy, type SalesActor, type SalesEngineDeps } from "./sales-context.js";

type ConfigDeps = Pick<SalesEngineDeps, "salesConfigRepository" | "membershipRepository" | "teamMembershipRepository" | "dealRepository" | "contactRepository" | "timelineEventRepository">;

const TEMPLATE_MAX = 4000;

export async function getCommercialSettings(deps: ConfigDeps, input: { tenantId: string; workspaceId: string }): Promise<CommercialSettings> {
  return loadCommercialSettings(deps, input.tenantId, input.workspaceId);
}

export async function updateCommercialSettings(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; patch: Partial<Omit<CommercialSettings, "tenantId" | "workspaceId" | "updatedAt">> }): Promise<CommercialSettings> {
  for (const key of ["proposalWhatsappTemplate", "proposalReminderTemplate"] as const) {
    const value = input.patch[key];
    if (value !== undefined && value !== null && (value.length > TEMPLATE_MAX || (key === "proposalWhatsappTemplate" && value.trim() && !value.includes("{{proposal_link}}")))) {
      throw new Error(`COMMERCIAL_SETTINGS_INVALID: o modelo da mensagem precisa conter {{proposal_link}} e ter até ${TEMPLATE_MAX} caracteres.`);
    }
  }
  const existing = await deps.salesConfigRepository.getSettings(input.workspaceId);
  if (existing && existing.tenantId !== input.tenantId) throw new Error("COMMERCIAL_SETTINGS_INVALID: workspace de outro tenant.");
  return deps.salesConfigRepository.upsertSettings({ tenantId: input.tenantId, workspaceId: input.workspaceId, ...input.patch });
}

// ---------------------------------------------------------------------------------------------
// Política comercial (autonomia)
// ---------------------------------------------------------------------------------------------

export async function listCommercialPolicies(deps: ConfigDeps, input: { tenantId: string; workspaceId: string }): Promise<CommercialPolicy[]> {
  return deps.salesConfigRepository.listPolicies(input);
}

export async function upsertCommercialPolicy(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; scopeType: PolicyScopeType; scopeId?: string; minMarginBp?: number | null; maxDiscountBp?: number | null; allowBelowMinimum?: boolean }): Promise<CommercialPolicy> {
  if (input.scopeType !== "workspace" && !input.scopeId) throw new Error("COMMERCIAL_POLICY_INVALID: informe a quem a política se aplica.");
  if (input.scopeType === "role" && !TENANT_ROLES.includes(input.scopeId as never)) throw new Error("COMMERCIAL_POLICY_INVALID: papel desconhecido.");
  if (input.scopeType === "user") {
    const membership = await deps.membershipRepository.getByUserAndTenant(input.scopeId as string, input.tenantId);
    if (!membership) throw new Error("COMMERCIAL_POLICY_INVALID: usuário não pertence a esta conta.");
  }
  return deps.salesConfigRepository.upsertPolicy(input);
}

export async function deleteCommercialPolicy(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; policyId: string }): Promise<void> {
  const policy = await deps.salesConfigRepository.getPolicy(input.policyId);
  if (!policy || policy.tenantId !== input.tenantId || policy.workspaceId !== input.workspaceId) throw new Error(`COMMERCIAL_POLICY_NOT_FOUND: política "${input.policyId}" não existe.`);
  await deps.salesConfigRepository.deletePolicy(policy.id);
}

export async function getEffectivePolicyFor(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; userId: string }) {
  return resolveEffectivePolicy(deps, input);
}

// ---------------------------------------------------------------------------------------------
// Motivos (ganho/perda/recusa) e concorrentes
// ---------------------------------------------------------------------------------------------

/** Semeia os motivos padrão só na primeira leitura do workspace — depois são 100% do tenant. */
export async function listCloseReasons(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; kind?: CloseReasonKind; includeInactive?: boolean }): Promise<CloseReason[]> {
  if ((await deps.salesConfigRepository.countCloseReasons(input.workspaceId)) === 0) {
    for (const kind of Object.keys(DEFAULT_CLOSE_REASONS) as CloseReasonKind[]) {
      let position = 0;
      for (const label of DEFAULT_CLOSE_REASONS[kind]) await deps.salesConfigRepository.createCloseReason({ tenantId: input.tenantId, workspaceId: input.workspaceId, kind, label, position: position++ });
    }
  }
  return deps.salesConfigRepository.listCloseReasons(input);
}

export async function createCloseReason(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; kind: CloseReasonKind; label: string }): Promise<CloseReason> {
  const existing = await listCloseReasons(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, kind: input.kind, includeInactive: true });
  return deps.salesConfigRepository.createCloseReason({ ...input, label: input.label.trim(), position: existing.length });
}

export async function updateCloseReason(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; reasonId: string; patch: { label?: string; active?: boolean; position?: number } }): Promise<CloseReason> {
  const reason = await deps.salesConfigRepository.getCloseReason(input.reasonId);
  if (!reason || reason.tenantId !== input.tenantId || reason.workspaceId !== input.workspaceId) throw new Error(`SALES_REASON_NOT_FOUND: motivo "${input.reasonId}" não existe.`);
  return deps.salesConfigRepository.updateCloseReason(reason.id, { ...input.patch, label: input.patch.label?.trim() });
}

export async function listCompetitors(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; includeInactive?: boolean }): Promise<Competitor[]> {
  return deps.salesConfigRepository.listCompetitors(input);
}

export async function createCompetitor(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; name: string }): Promise<Competitor> {
  if (!input.name.trim()) throw new Error("SALES_COMPETITOR_INVALID: informe o nome do concorrente.");
  return deps.salesConfigRepository.upsertCompetitor(input);
}

export async function updateCompetitor(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; competitorId: string; patch: { name?: string; active?: boolean } }): Promise<Competitor> {
  const competitor = await deps.salesConfigRepository.getCompetitor(input.competitorId);
  if (!competitor || competitor.tenantId !== input.tenantId || competitor.workspaceId !== input.workspaceId) throw new Error(`SALES_COMPETITOR_NOT_FOUND: concorrente "${input.competitorId}" não existe.`);
  return deps.salesConfigRepository.updateCompetitor(competitor.id, input.patch);
}

// ---------------------------------------------------------------------------------------------
// Campos personalizados da oportunidade
// ---------------------------------------------------------------------------------------------

const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

export async function listDealCustomFields(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; includeInactive?: boolean }): Promise<DealCustomFieldDefinition[]> {
  return deps.salesConfigRepository.listCustomFields(input);
}

export async function createDealCustomField(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; key: string; label: string; fieldType: CustomFieldType; options?: readonly string[] }): Promise<DealCustomFieldDefinition> {
  if (!FIELD_KEY.test(input.key)) throw new Error("DEAL_CUSTOM_FIELD_INVALID: a chave deve começar com letra e usar só minúsculas, números e _.");
  const options = (input.options ?? []).map((option) => option.trim()).filter(Boolean);
  if ((input.fieldType === "select" || input.fieldType === "multi_select") && options.length === 0) throw new Error("DEAL_CUSTOM_FIELD_INVALID: campos de seleção precisam de opções.");
  const existing = await deps.salesConfigRepository.listCustomFields({ tenantId: input.tenantId, workspaceId: input.workspaceId, includeInactive: true });
  return deps.salesConfigRepository.createCustomField({ ...input, label: input.label.trim(), options, position: existing.length });
}

export async function updateDealCustomField(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; fieldId: string; patch: { label?: string; options?: readonly string[]; position?: number; active?: boolean } }): Promise<DealCustomFieldDefinition> {
  const field = await deps.salesConfigRepository.getCustomField(input.fieldId);
  if (!field || field.tenantId !== input.tenantId || field.workspaceId !== input.workspaceId) throw new Error(`DEAL_CUSTOM_FIELD_NOT_FOUND: campo "${input.fieldId}" não existe.`);
  return deps.salesConfigRepository.updateCustomField(field.id, input.patch);
}

/** Valida e normaliza valores de campos personalizados contra as definições ativas do workspace. */
export async function normalizeCustomFieldValues(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; values: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const definitions = new Map((await deps.salesConfigRepository.listCustomFields({ tenantId: input.tenantId, workspaceId: input.workspaceId })).map((field) => [field.key, field]));
  const normalized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input.values)) {
    const field = definitions.get(key);
    if (!field) throw new Error(`DEAL_CUSTOM_FIELD_INVALID: campo "${key}" não existe.`);
    if (raw === null || raw === "") continue;
    const invalid = () => new Error(`DEAL_CUSTOM_FIELD_INVALID: valor inválido para "${field.label}".`);
    switch (field.fieldType) {
      case "text": if (typeof raw !== "string" || raw.length > 2000) throw invalid(); normalized[key] = raw; break;
      case "number": if (typeof raw !== "number" || !Number.isFinite(raw)) throw invalid(); normalized[key] = raw; break;
      case "currency": if (typeof raw !== "number" || !Number.isInteger(raw)) throw invalid(); normalized[key] = raw; break;
      case "date": if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw invalid(); normalized[key] = raw; break;
      case "boolean": if (typeof raw !== "boolean") throw invalid(); normalized[key] = raw; break;
      case "select": if (typeof raw !== "string" || !field.options.includes(raw)) throw invalid(); normalized[key] = raw; break;
      case "multi_select": if (!Array.isArray(raw) || raw.some((value) => typeof value !== "string" || !field.options.includes(value))) throw invalid(); normalized[key] = [...new Set(raw as string[])]; break;
    }
  }
  return normalized;
}

export async function setDealCustomFields(deps: ConfigDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; values: Record<string, unknown> }): Promise<Deal> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  const normalized = await normalizeCustomFieldValues(deps, { tenantId: actor.tenantId, workspaceId: input.workspaceId, values: input.values });
  const merged: Record<string, unknown> = { ...deal.customFields };
  for (const key of Object.keys(input.values)) {
    if (key in normalized) merged[key] = normalized[key];
    else delete merged[key];
  }
  const updated = await deps.dealRepository.update(deal.id, { customFields: merged });
  await deps.timelineEventRepository.record({ tenantId: deal.tenantId, workspaceId: deal.workspaceId, entityType: "deal", entityId: deal.id, eventType: "deal_custom_fields_changed", actorType: "user", actorId: actor.userId, payload: { keys: Object.keys(input.values) } });
  return updated;
}

// ---------------------------------------------------------------------------------------------
// Participantes (comitê de compra) e duplicidade
// ---------------------------------------------------------------------------------------------

export async function listDealParticipants(deps: ConfigDeps, actor: SalesActor, input: { workspaceId: string; dealId: string }): Promise<DealParticipant[]> {
  await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  return deps.salesConfigRepository.listParticipants(input.dealId);
}

export async function upsertDealParticipant(deps: ConfigDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; contactId: string; role: ParticipantRole }): Promise<DealParticipant> {
  await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  const contact = deps.contactRepository ? await deps.contactRepository.getById(input.contactId) : undefined;
  if (!contact || contact.tenantId !== actor.tenantId || contact.workspaceId !== input.workspaceId) throw new Error(`CONTACT_NOT_FOUND: contato "${input.contactId}" não existe.`);
  return deps.salesConfigRepository.upsertParticipant({ tenantId: actor.tenantId, workspaceId: input.workspaceId, dealId: input.dealId, contactId: input.contactId, role: input.role });
}

export async function removeDealParticipant(deps: ConfigDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; contactId: string }): Promise<void> {
  await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  await deps.salesConfigRepository.removeParticipant(input.dealId, input.contactId);
}

/** Aviso (nunca bloqueio) de oportunidade aberta parecida: mesmo contato no mesmo pipeline ou mesmo título. */
export async function findPossibleDuplicateDeals(deps: ConfigDeps, input: { tenantId: string; workspaceId: string; contactId?: string; pipelineId: string; title: string }): Promise<Deal[]> {
  if (!input.title.trim() && !input.contactId) return [];
  return deps.dealRepository.findOpenSimilar({ ...input, limit: 5 });
}
