import { createHash } from "node:crypto";
import type { Deal, PipelineStage, Task } from "../../domain/crm/crm.model.js";
import {
  computeCommercialTotals,
  commercialTermsKey,
  defaultStageProbability,
  evaluateCommercialTerms,
  priceLine,
  type BillingType,
  type CommercialEvaluation,
  type CommercialTotals,
  type EffectiveCommercialPolicy,
  type PricingLineInput,
} from "../../domain/sales/pricing.js";
import type { CommercialApprovalRequest, DealItem } from "../../domain/sales/sales.model.js";
import type { CreateDealItemInput } from "../ports/sales-engine-repository.port.js";
import { notifyBestEffort } from "../notification/notification-use-cases.js";
import { evaluateAutomationTrigger } from "../crm/automation-use-cases.js";
import type { AutomationTrigger } from "../../domain/crm/crm.model.js";
import { resolveProductPricing } from "./catalog-use-cases.js";
import { applyApprovalDecisionToProposals } from "./proposal-sales-use-cases.js";
import {
  listManagerUserIds,
  loadCommercialSettings,
  mustDealInWorkspace,
  resolveEffectivePolicy,
  resolveVisibility,
  type SalesActor,
  type SalesEngineDeps,
  type SalesVisibility,
} from "./sales-context.js";

// --------------------------------------------------------------------------------------------
// Totais e avaliação
// --------------------------------------------------------------------------------------------

export function itemsToPricingLines(items: readonly DealItem[]): (PricingLineInput & { productId?: string; variantId?: string })[] {
  return items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    quantity: item.quantity,
    unitCostCents: item.unitCostCentsSnapshot,
    listPriceCents: item.listPriceCentsSnapshot,
    minimumPriceCents: item.minimumPriceCentsSnapshot,
    proposedUnitPriceCents: item.proposedUnitPriceCents,
    billingType: item.billingTypeSnapshot,
  }));
}

/** Totais da oportunidade. Sem itens = valor manual puro (sem custo/margem inventados). */
export function computeDealTotals(deal: Deal, items: readonly DealItem[], defaultContractMonths?: number): CommercialTotals {
  if (items.length === 0) {
    return {
      itemCount: 0, listTotalCents: deal.valueCents, subtotalProposedCents: deal.valueCents, globalDiscountCents: 0, totalCents: deal.valueCents,
      discountCents: 0, discountBp: 0, belowMinimum: false, mrrCents: 0, arrCents: 0, oneTimeCents: deal.valueCents, tcvCents: deal.valueCents,
    };
  }
  return computeCommercialTotals(itemsToPricingLines(items), { globalDiscountCents: deal.discountCents, contractMonths: deal.contractMonths ?? defaultContractMonths });
}

export function termsFingerprint(dealId: string, lines: readonly { productId?: string; variantId?: string; quantity: number; proposedUnitPriceCents: number }[], globalDiscountCents: number): string {
  return createHash("sha256").update(`${dealId}|${commercialTermsKey(lines, globalDiscountCents)}`).digest("hex");
}

export type ApprovalState = {
  required: boolean;
  status: "not_required" | "approved" | "pending" | "rejected" | "missing";
  fingerprint?: string;
  request?: CommercialApprovalRequest;
};

/** Estado de aprovação dos termos ATUAIS — aprovação antiga de outros termos nunca vale. */
export async function resolveApprovalState(deps: Pick<SalesEngineDeps, "approvalRepository">, deal: Deal, lines: readonly { productId?: string; variantId?: string; quantity: number; proposedUnitPriceCents: number }[], globalDiscountCents: number, evaluation: CommercialEvaluation): Promise<ApprovalState> {
  if (!evaluation.requiresApproval) return { required: false, status: "not_required" };
  const fingerprint = termsFingerprint(deal.id, lines, globalDiscountCents);
  const approved = await deps.approvalRepository.findApproved(deal.id, fingerprint);
  if (approved) return { required: true, status: "approved", fingerprint, request: approved };
  const recent = await deps.approvalRepository.listByWorkspace({ tenantId: deal.tenantId, workspaceId: deal.workspaceId, dealId: deal.id, limit: 20 });
  const sameTerms = recent.find((request) => request.termsFingerprint === fingerprint);
  if (sameTerms?.status === "pending") return { required: true, status: "pending", fingerprint, request: sameTerms };
  if (sameTerms?.status === "rejected") return { required: true, status: "rejected", fingerprint, request: sameTerms };
  return { required: true, status: "missing", fingerprint };
}

async function policyForDeal(deps: SalesEngineDeps, deal: Deal, actor: SalesActor): Promise<EffectiveCommercialPolicy> {
  return resolveEffectivePolicy(deps, { tenantId: deal.tenantId, workspaceId: deal.workspaceId, userId: deal.ownerUserId ?? actor.userId });
}

async function recalculateDealValue(deps: SalesEngineDeps, deal: Deal): Promise<Deal> {
  if (deal.valueMode !== "calculated") return deal;
  const items = await deps.dealItemRepository.listByDeal(deal.id);
  const totals = computeDealTotals(deal, items);
  return totals.totalCents === deal.valueCents ? deal : deps.dealRepository.setValue(deal.id, totals.totalCents);
}

function assertDealOpen(deal: Deal): void {
  if (deal.status !== "open") throw new Error(`DEAL_CLOSED: oportunidade ${deal.status === "won" ? "ganha" : deal.status === "lost" ? "perdida" : "cancelada"} não pode ter os termos alterados — reabra antes.`);
}

/** Mesmo motor de automações do CRM (nunca um segundo motor) — falha nunca derruba o fluxo. */
export async function fireDealAutomation(deps: SalesEngineDeps, deal: Deal, trigger: AutomationTrigger): Promise<void> {
  if (!deps.automation) return;
  try {
    const contact = deal.contactId ? await deps.automation.contactRepository.getById(deal.contactId) : undefined;
    await evaluateAutomationTrigger(deps.automation, { tenantId: deal.tenantId, workspaceId: deal.workspaceId, trigger, deal, contact });
  } catch (error) {
    console.warn("[sales] automação falhou (best-effort):", error instanceof Error ? error.message : error);
  }
}

async function recordDealEvent(deps: SalesEngineDeps, deal: Deal, eventType: string, actor: SalesActor | undefined, payload: Record<string, unknown>): Promise<void> {
  await deps.timelineEventRepository.record({
    tenantId: deal.tenantId, workspaceId: deal.workspaceId, entityType: "deal", entityId: deal.id, eventType,
    actorType: actor ? "user" : "system", actorId: actor?.userId, payload,
  });
}

// --------------------------------------------------------------------------------------------
// Itens da oportunidade
// --------------------------------------------------------------------------------------------

function buildItemRecord(base: { tenantId: string; workspaceId: string; dealId: string; position: number; productId?: string; variantId?: string; name: string; code?: string; unit?: string; billingType: BillingType; quantity: number; unitCostCents?: number; listPriceCents: number; minimumPriceCents?: number; proposedUnitPriceCents: number; commissionType?: "percent" | "fixed"; commissionValue?: number }): CreateDealItemInput {
  const priced = priceLine({ quantity: base.quantity, unitCostCents: base.unitCostCents, listPriceCents: base.listPriceCents, minimumPriceCents: base.minimumPriceCents, proposedUnitPriceCents: base.proposedUnitPriceCents, billingType: base.billingType });
  return {
    tenantId: base.tenantId, workspaceId: base.workspaceId, dealId: base.dealId, productId: base.productId, variantId: base.variantId, position: base.position,
    productNameSnapshot: base.name, productCodeSnapshot: base.code, billingTypeSnapshot: base.billingType, unitSnapshot: base.unit, quantity: base.quantity,
    unitCostCentsSnapshot: base.unitCostCents, listPriceCentsSnapshot: base.listPriceCents, minimumPriceCentsSnapshot: base.minimumPriceCents,
    proposedUnitPriceCents: base.proposedUnitPriceCents, subtotalListCents: priced.subtotalListCents, subtotalProposedCents: priced.subtotalProposedCents,
    subtotalCostCents: priced.subtotalCostCents, discountCents: priced.discountCents, grossProfitCents: priced.grossProfitCents, grossMarginBp: priced.grossMarginBp,
    commissionTypeSnapshot: base.commissionType, commissionValueSnapshot: base.commissionValue,
  };
}

function proposedFrom(listPriceCents: number, input: { proposedUnitPriceCents?: number; discountBp?: number }): number {
  if (input.proposedUnitPriceCents !== undefined) return input.proposedUnitPriceCents;
  if (input.discountBp !== undefined) return Math.round((listPriceCents * (10000 - input.discountBp)) / 10000);
  return listPriceCents;
}

function assertQuantity(quantity: number): void {
  if (!(quantity > 0) || !Number.isFinite(quantity) || Math.round(quantity * 1000) !== quantity * 1000) throw new Error("DEAL_ITEM_INVALID: quantidade deve ser positiva (até 3 casas decimais).");
}

export type AddDealItemInput = {
  workspaceId: string;
  dealId: string;
  productId?: string;
  variantId?: string;
  /** Item avulso (sem catálogo): nome + preço de tabela obrigatórios. */
  name?: string;
  listPriceCents?: number;
  unitCostCents?: number;
  minimumPriceCents?: number;
  billingType?: BillingType;
  quantity: number;
  proposedUnitPriceCents?: number;
  discountBp?: number;
};

export async function addDealItem(deps: SalesEngineDeps, actor: SalesActor, input: AddDealItemInput): Promise<DealItem> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  assertDealOpen(deal);
  assertQuantity(input.quantity);
  const settings = await loadCommercialSettings(deps, actor.tenantId, input.workspaceId);
  const visibility = resolveVisibility(actor, settings);
  const existing = await deps.dealItemRepository.listByDeal(deal.id);
  let record: CreateDealItemInput;
  if (input.productId) {
    const pricing = await resolveProductPricing(deps, { tenantId: actor.tenantId, workspaceId: input.workspaceId, productId: input.productId, variantId: input.variantId, priceBookId: deal.priceBookId });
    if (pricing.currency !== deal.currency) throw new Error(`DEAL_ITEM_INVALID: o produto está em ${pricing.currency} e a oportunidade em ${deal.currency}.`);
    record = buildItemRecord({
      tenantId: deal.tenantId, workspaceId: deal.workspaceId, dealId: deal.id, position: existing.length, productId: pricing.productId, variantId: pricing.variantId,
      name: pricing.name, code: pricing.code, unit: pricing.unit, billingType: pricing.billingType, quantity: input.quantity, unitCostCents: pricing.costCents,
      listPriceCents: pricing.listPriceCents, minimumPriceCents: pricing.minimumPriceCents, proposedUnitPriceCents: proposedFrom(pricing.listPriceCents, input),
      commissionType: pricing.commissionType, commissionValue: pricing.commissionValue,
    });
  } else {
    const name = input.name?.trim();
    const listPriceCents = input.listPriceCents ?? input.proposedUnitPriceCents;
    if (!name || listPriceCents === undefined) throw new Error("DEAL_ITEM_INVALID: item avulso precisa de nome e preço.");
    record = buildItemRecord({
      tenantId: deal.tenantId, workspaceId: deal.workspaceId, dealId: deal.id, position: existing.length, name, billingType: input.billingType ?? "one_time",
      quantity: input.quantity, unitCostCents: visibility.canViewCost ? input.unitCostCents : undefined, listPriceCents,
      minimumPriceCents: visibility.isManager ? input.minimumPriceCents : undefined, proposedUnitPriceCents: proposedFrom(listPriceCents, input),
    });
  }
  const item = await deps.dealItemRepository.create(record);
  // Primeiro produto: o valor calculado passa a ser o padrão (o usuário pode voltar ao manual).
  let current = deal;
  if (existing.length === 0 && deal.valueMode === "manual") current = await deps.dealRepository.update(deal.id, { valueMode: "calculated" });
  await recalculateDealValue(deps, current);
  await recordDealEvent(deps, deal, "deal_item_added", actor, { itemId: item.id, name: item.productNameSnapshot, quantity: item.quantity, listPriceCents: item.listPriceCentsSnapshot, proposedUnitPriceCents: item.proposedUnitPriceCents });
  return item;
}

export async function updateDealItem(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; itemId: string; quantity?: number; proposedUnitPriceCents?: number; discountBp?: number }): Promise<DealItem> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  assertDealOpen(deal);
  const item = await deps.dealItemRepository.getById(input.itemId);
  if (!item || item.dealId !== deal.id) throw new Error(`DEAL_ITEM_NOT_FOUND: item "${input.itemId}" não existe.`);
  const quantity = input.quantity ?? item.quantity;
  assertQuantity(quantity);
  const proposed = input.proposedUnitPriceCents !== undefined || input.discountBp !== undefined ? proposedFrom(item.listPriceCentsSnapshot, input) : item.proposedUnitPriceCents;
  // O snapshot (tabela/mínimo/custo/nome) é preservado — só quantidade e preço negociado mudam.
  const record = buildItemRecord({
    tenantId: item.tenantId, workspaceId: item.workspaceId, dealId: item.dealId, position: item.position, productId: item.productId, variantId: item.variantId,
    name: item.productNameSnapshot, code: item.productCodeSnapshot, unit: item.unitSnapshot, billingType: item.billingTypeSnapshot, quantity,
    unitCostCents: item.unitCostCentsSnapshot, listPriceCents: item.listPriceCentsSnapshot, minimumPriceCents: item.minimumPriceCentsSnapshot,
    proposedUnitPriceCents: proposed, commissionType: item.commissionTypeSnapshot, commissionValue: item.commissionValueSnapshot,
  });
  const updated = await deps.dealItemRepository.replace(item.id, record);
  await recalculateDealValue(deps, deal);
  if (proposed !== item.proposedUnitPriceCents || quantity !== item.quantity) {
    await recordDealEvent(deps, deal, "deal_price_changed", actor, { itemId: item.id, name: item.productNameSnapshot, fromUnitPriceCents: item.proposedUnitPriceCents, toUnitPriceCents: proposed, fromQuantity: item.quantity, toQuantity: quantity });
  }
  return updated;
}

export async function removeDealItem(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; itemId: string }): Promise<void> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  assertDealOpen(deal);
  const item = await deps.dealItemRepository.getById(input.itemId);
  if (!item || item.dealId !== deal.id) throw new Error(`DEAL_ITEM_NOT_FOUND: item "${input.itemId}" não existe.`);
  await deps.dealItemRepository.delete(item.id);
  await recalculateDealValue(deps, deal);
  await recordDealEvent(deps, deal, "deal_item_removed", actor, { itemId: item.id, name: item.productNameSnapshot });
}

/** Termos da oportunidade em nível de negócio: modo do valor, desconto global, contrato, tabela,
 * probabilidade e categoria de forecast. Muda o valor calculado na hora (backend é a autoridade). */
export async function updateDealCommercialTerms(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; valueMode?: Deal["valueMode"]; discountCents?: number; contractMonths?: number | null; priceBookId?: string | null; probability?: number | null; forecastCategory?: Deal["forecastCategory"]; valueCents?: number }): Promise<Deal> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  const changesTerms = input.valueMode !== undefined || input.discountCents !== undefined || input.contractMonths !== undefined || input.priceBookId !== undefined || input.valueCents !== undefined;
  if (changesTerms) assertDealOpen(deal);
  if (input.priceBookId) {
    const book = await deps.salesCatalogRepository.getPriceBook(input.priceBookId);
    if (!book || book.tenantId !== actor.tenantId || book.workspaceId !== input.workspaceId) throw new Error(`PRICE_BOOK_NOT_FOUND: tabela "${input.priceBookId}" não existe.`);
  }
  const nextMode = input.valueMode ?? deal.valueMode;
  if (nextMode === "calculated" && input.valueCents !== undefined) throw new Error("DEAL_VALUE_CALCULATED: no modo calculado o valor vem dos itens — mude para manual para informar o valor.");
  const updated = await deps.dealRepository.update(deal.id, {
    valueMode: input.valueMode,
    discountCents: input.discountCents,
    contractMonths: input.contractMonths,
    priceBookId: input.priceBookId,
    probability: input.probability,
    forecastCategory: input.forecastCategory,
    valueCents: nextMode === "manual" ? input.valueCents : undefined,
  });
  const recalculated = await recalculateDealValue(deps, updated);
  const changes: Record<string, unknown> = {};
  for (const key of ["valueMode", "discountCents", "contractMonths", "priceBookId", "probability", "forecastCategory", "valueCents"] as const) {
    if (input[key] !== undefined && input[key] !== deal[key]) changes[key] = { from: deal[key] ?? null, to: input[key] };
  }
  if (Object.keys(changes).length > 0) await recordDealEvent(deps, deal, "deal_terms_changed", actor, { changes });
  return recalculated;
}

// --------------------------------------------------------------------------------------------
// Resumo comercial (cockpit)
// --------------------------------------------------------------------------------------------

export type RedactedTotals = Omit<CommercialTotals, "costCents" | "grossProfitCents" | "grossMarginBp"> & { costCents?: number; grossProfitCents?: number; grossMarginBp?: number };

export function redactItem(item: DealItem, visibility: SalesVisibility): DealItem {
  return {
    ...item,
    unitCostCentsSnapshot: visibility.canViewCost ? item.unitCostCentsSnapshot : undefined,
    subtotalCostCents: visibility.canViewCost ? item.subtotalCostCents : undefined,
    grossProfitCents: visibility.canViewMargin ? item.grossProfitCents : undefined,
    grossMarginBp: visibility.canViewMargin ? item.grossMarginBp : undefined,
    commissionValueSnapshot: visibility.canViewMargin ? item.commissionValueSnapshot : undefined,
  };
}

export function redactTotals(totals: CommercialTotals, visibility: SalesVisibility): RedactedTotals {
  return {
    ...totals,
    costCents: visibility.canViewCost ? totals.costCents : undefined,
    grossProfitCents: visibility.canViewMargin ? totals.grossProfitCents : undefined,
    grossMarginBp: visibility.canViewMargin ? totals.grossMarginBp : undefined,
  };
}

export type StageProbability = { value: number; source: "deal" | "stage" | "default" | "terminal" };

export function resolveDealProbability(deal: Deal, stages: readonly PipelineStage[]): StageProbability {
  if (deal.status === "won") return { value: 100, source: "terminal" };
  if (deal.status === "lost" || deal.status === "cancelled") return { value: 0, source: "terminal" };
  if (deal.probability !== undefined) return { value: deal.probability, source: "deal" };
  const stage = stages.find((item) => item.id === deal.stageId);
  if (stage?.isWon) return { value: 100, source: "terminal" };
  if (stage?.isLost) return { value: 0, source: "terminal" };
  if (stage?.probability !== undefined) return { value: stage.probability, source: "stage" };
  const open = stages.filter((item) => !item.isWon && !item.isLost);
  const index = open.findIndex((item) => item.id === deal.stageId);
  return { value: defaultStageProbability(Math.max(0, index), open.length), source: "default" };
}

const DAY_MS = 86_400_000;

export function nextPendingDealTask(tasks: readonly Task[]): Task | undefined {
  return tasks.filter((task) => task.status === "pending").sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"))[0];
}

export type DealCommercialSummary = {
  dealId: string;
  status: Deal["status"];
  valueMode: Deal["valueMode"];
  currency: string;
  valueCents: number;
  items: DealItem[];
  totals: RedactedTotals;
  visibility: SalesVisibility;
  policy: { minMarginBp?: number; maxDiscountBp?: number; allowBelowMinimum: boolean; source: EffectiveCommercialPolicy["source"] };
  evaluation: CommercialEvaluation;
  approval: Omit<ApprovalState, "fingerprint">;
  probability: StageProbability;
  weightedValueCents: number;
  forecastCategory: Deal["forecastCategory"];
  aging: { daysOpen: number; daysInStage: number; daysWithoutActivity?: number; staleAfterDays?: number; stale: boolean; expectedCloseOverdue: boolean };
  nextActivity?: { id: string; title: string; type: Task["type"]; dueAt?: string; overdue: boolean };
};

export async function getDealCommercialSummary(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; now?: Date }): Promise<DealCommercialSummary> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  const settings = await loadCommercialSettings(deps, actor.tenantId, input.workspaceId);
  const visibility = resolveVisibility(actor, settings);
  const [items, stages, policy] = await Promise.all([
    deps.dealItemRepository.listByDeal(deal.id),
    deps.pipelineStageRepository.listByPipeline(deal.pipelineId),
    policyForDeal(deps, deal, actor),
  ]);
  const totals = computeDealTotals(deal, items, settings.defaultContractMonths);
  const evaluation = items.length ? evaluateCommercialTerms(totals, policy) : { reasons: [], requiresApproval: false, health: "healthy" as const };
  const approval = await resolveApprovalState(deps, deal, itemsToPricingLines(items), deal.discountCents, evaluation);
  const probability = resolveDealProbability(deal, stages);
  const now = input.now ?? new Date();
  const stage = stages.find((item) => item.id === deal.stageId);
  const tasks = deps.taskRepository ? await deps.taskRepository.listByWorkspace({ tenantId: deal.tenantId, workspaceId: deal.workspaceId, dealId: deal.id, limit: 200 }) : [];
  const next = nextPendingDealTask(tasks);
  const timeline = await deps.timelineEventRepository.listByEntity({ entityType: "deal", entityId: deal.id, limit: 1 });
  const lastActivityIso = [timeline[0]?.occurredAt, ...tasks.map((task) => task.completedAt)].filter((value): value is string => Boolean(value)).sort().pop();
  const daysInStage = Math.floor((now.getTime() - new Date(deal.lastStageChangedAt).getTime()) / DAY_MS);
  return {
    dealId: deal.id,
    status: deal.status,
    valueMode: deal.valueMode,
    currency: deal.currency,
    valueCents: deal.valueCents,
    items: items.map((item) => redactItem(item, visibility)),
    totals: redactTotals(totals, visibility),
    visibility,
    policy: { minMarginBp: visibility.canViewMargin ? policy.minMarginBp : undefined, maxDiscountBp: policy.maxDiscountBp, allowBelowMinimum: policy.allowBelowMinimum, source: policy.source },
    evaluation,
    approval: { required: approval.required, status: approval.status, request: approval.request },
    probability,
    weightedValueCents: Math.round((deal.valueCents * probability.value) / 100),
    forecastCategory: deal.forecastCategory,
    aging: {
      daysOpen: Math.floor((now.getTime() - new Date(deal.createdAt).getTime()) / DAY_MS),
      daysInStage,
      daysWithoutActivity: lastActivityIso ? Math.floor((now.getTime() - new Date(lastActivityIso).getTime()) / DAY_MS) : undefined,
      staleAfterDays: stage?.staleAfterDays,
      stale: deal.status === "open" && stage?.staleAfterDays !== undefined && daysInStage >= stage.staleAfterDays,
      expectedCloseOverdue: deal.status === "open" && Boolean(deal.expectedCloseDate) && (deal.expectedCloseDate as string) < now.toISOString().slice(0, 10),
    },
    nextActivity: next ? { id: next.id, title: next.title, type: next.type, dueAt: next.dueAt, overdue: Boolean(next.dueAt) && (next.dueAt as string) < now.toISOString() } : undefined,
  };
}

// --------------------------------------------------------------------------------------------
// Aprovação comercial
// --------------------------------------------------------------------------------------------

export async function requestCommercialApproval(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; justification?: string; proposalId?: string }): Promise<CommercialApprovalRequest> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  assertDealOpen(deal);
  const items = await deps.dealItemRepository.listByDeal(deal.id);
  if (items.length === 0) throw new Error("APPROVAL_NOT_REQUIRED: oportunidade sem itens não precisa de aprovação comercial.");
  const policy = await policyForDeal(deps, deal, actor);
  const totals = computeDealTotals(deal, items);
  const evaluation = evaluateCommercialTerms(totals, policy);
  if (!evaluation.requiresApproval) throw new Error("APPROVAL_NOT_REQUIRED: os termos atuais estão dentro da política comercial.");
  const lines = itemsToPricingLines(items);
  const fingerprint = termsFingerprint(deal.id, lines, deal.discountCents);
  const approved = await deps.approvalRepository.findApproved(deal.id, fingerprint);
  if (approved) return approved;
  const atList = computeCommercialTotals(lines.map((line) => ({ ...line, proposedUnitPriceCents: line.listPriceCents })));
  const contact = deal.contactId && deps.contactRepository ? await deps.contactRepository.getById(deal.contactId) : undefined;
  const { request, created } = await deps.approvalRepository.createOrGetPending({
    id: `approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: deal.tenantId,
    workspaceId: deal.workspaceId,
    dealId: deal.id,
    proposalId: input.proposalId,
    requestedByUserId: actor.userId,
    justification: input.justification?.trim() || undefined,
    termsFingerprint: fingerprint,
    reasons: evaluation.reasons,
    snapshot: {
      dealTitle: deal.title,
      contactName: contact?.name,
      ownerUserId: deal.ownerUserId,
      currency: deal.currency,
      listTotalCents: totals.listTotalCents,
      minimumTotalCents: totals.minimumTotalCents,
      requestedTotalCents: totals.totalCents,
      costCents: totals.costCents,
      originalMarginBp: atList.grossMarginBp,
      proposedMarginBp: totals.grossMarginBp,
      discountCents: totals.discountCents,
      discountBp: totals.discountBp,
      policy,
      items: items.map((item) => ({ name: item.productNameSnapshot, quantity: item.quantity, listPriceCents: item.listPriceCentsSnapshot, minimumPriceCents: item.minimumPriceCentsSnapshot, proposedUnitPriceCents: item.proposedUnitPriceCents, unitCostCents: item.unitCostCentsSnapshot })),
    },
  });
  if (created) {
    await recordDealEvent(deps, deal, "deal_approval_requested", actor, { approvalId: request.id, reasons: request.reasons, requestedTotalCents: totals.totalCents });
    await fireDealAutomation(deps, deal, "approval_requested");
    for (const userId of await listManagerUserIds(deps, deal.tenantId)) {
      if (userId === actor.userId) continue;
      notifyBestEffort(deps.notification, {
        tenantId: deal.tenantId, workspaceId: deal.workspaceId, userId, title: "Aprovação comercial pendente",
        body: `${deal.title}: condição fora da política aguardando decisão.`, sourceType: "sales_approval_requested", sourceId: request.id,
        sourceUrl: `/workspaces/${deal.workspaceId}/deals?dealId=${deal.id}`,
      });
    }
  }
  return request;
}

export async function listCommercialApprovals(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; status?: CommercialApprovalRequest["status"]; dealId?: string }): Promise<CommercialApprovalRequest[]> {
  const settings = await loadCommercialSettings(deps, actor.tenantId, input.workspaceId);
  const visibility = resolveVisibility(actor, settings);
  const requests = await deps.approvalRepository.listByWorkspace({ tenantId: actor.tenantId, workspaceId: input.workspaceId, status: input.status, dealId: input.dealId });
  // Vendedor vê os próprios pedidos; gestão vê todos. Custo/margem do snapshot seguem a visibilidade.
  return requests
    .filter((request) => visibility.isManager || request.requestedByUserId === actor.userId)
    .map((request) => ({
      ...request,
      snapshot: {
        ...request.snapshot,
        costCents: visibility.canViewCost ? request.snapshot.costCents : undefined,
        originalMarginBp: visibility.canViewMargin ? request.snapshot.originalMarginBp : undefined,
        proposedMarginBp: visibility.canViewMargin ? request.snapshot.proposedMarginBp : undefined,
        items: Array.isArray(request.snapshot.items) && !visibility.canViewCost ? (request.snapshot.items as Record<string, unknown>[]).map((item) => ({ ...item, unitCostCents: undefined })) : request.snapshot.items,
      },
    }));
}

export async function decideCommercialApproval(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; approvalId: string; decision: "approved" | "rejected"; reason?: string }): Promise<CommercialApprovalRequest> {
  const request = await deps.approvalRepository.getById(input.approvalId);
  if (!request || request.tenantId !== actor.tenantId || request.workspaceId !== input.workspaceId) throw new Error(`APPROVAL_NOT_FOUND: pedido "${input.approvalId}" não existe.`);
  if (input.decision === "rejected" && !input.reason?.trim()) throw new Error("APPROVAL_REASON_REQUIRED: informe o motivo da recusa.");
  const decided = await deps.approvalRepository.decide(request.id, {
    status: input.decision,
    decidedByUserId: actor.userId,
    decisionReason: input.reason?.trim() || undefined,
    approvedValueCents: input.decision === "approved" ? Number(request.snapshot.requestedTotalCents ?? 0) : undefined,
  });
  if (!decided) throw new Error(`APPROVAL_ALREADY_DECIDED: este pedido já está "${request.status}".`);
  await applyApprovalDecisionToProposals(deps, { tenantId: request.tenantId, workspaceId: request.workspaceId, dealId: request.dealId, termsFingerprint: request.termsFingerprint, approved: input.decision === "approved", approvalId: request.id });
  const deal = await deps.dealRepository.getById(request.dealId);
  if (deal) {
    await recordDealEvent(deps, deal, input.decision === "approved" ? "deal_approval_approved" : "deal_approval_rejected", actor, { approvalId: request.id, reason: decided.decisionReason, approvedValueCents: decided.approvedValueCents });
    await fireDealAutomation(deps, deal, "approval_decided");
  }
  notifyBestEffort(deps.notification, {
    tenantId: request.tenantId, workspaceId: request.workspaceId, userId: request.requestedByUserId,
    title: input.decision === "approved" ? "Condição comercial aprovada" : "Condição comercial recusada",
    body: `${String(request.snapshot.dealTitle ?? "Oportunidade")}${decided.decisionReason ? ` — ${decided.decisionReason}` : ""}`,
    sourceType: "sales_approval_decided", sourceId: request.id, sourceUrl: `/workspaces/${request.workspaceId}/deals?dealId=${request.dealId}`,
  });
  return decided;
}

export async function cancelCommercialApproval(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; approvalId: string }): Promise<CommercialApprovalRequest> {
  const request = await deps.approvalRepository.getById(input.approvalId);
  if (!request || request.tenantId !== actor.tenantId || request.workspaceId !== input.workspaceId) throw new Error(`APPROVAL_NOT_FOUND: pedido "${input.approvalId}" não existe.`);
  if (request.requestedByUserId !== actor.userId) throw new Error("APPROVAL_NOT_FOUND: só quem pediu pode cancelar.");
  const cancelled = await deps.approvalRepository.decide(request.id, { status: "cancelled", decidedByUserId: actor.userId });
  if (!cancelled) throw new Error(`APPROVAL_ALREADY_DECIDED: este pedido já está "${request.status}".`);
  return cancelled;
}

/** Verificação usada ANTES de enviar uma proposta: termos fora da política sem aprovação válida
 * para estes mesmos termos bloqueiam o envio (sem bypass pelo frontend). */
export async function assertTermsApproved(deps: SalesEngineDeps, input: { deal: Deal; lines: readonly (PricingLineInput & { productId?: string; variantId?: string })[]; globalDiscountCents: number; actorUserId: string }): Promise<void> {
  if (input.lines.length === 0) return;
  const policy = await resolveEffectivePolicy(deps, { tenantId: input.deal.tenantId, workspaceId: input.deal.workspaceId, userId: input.deal.ownerUserId ?? input.actorUserId });
  const totals = computeCommercialTotals(input.lines, { globalDiscountCents: input.globalDiscountCents });
  const evaluation = evaluateCommercialTerms(totals, policy);
  if (!evaluation.requiresApproval) return;
  const approved = await deps.approvalRepository.findApproved(input.deal.id, termsFingerprint(input.deal.id, input.lines, input.globalDiscountCents));
  if (!approved) throw new Error(`COMMERCIAL_APPROVAL_REQUIRED: condição fora da política (${evaluation.reasons.join(", ")}) — peça aprovação antes de enviar.`);
}

// --------------------------------------------------------------------------------------------
// Fechamento: ganho, perda, cancelamento, reabertura
// --------------------------------------------------------------------------------------------

export type WinDealInput = { workspaceId: string; dealId: string; wonReason?: string; proposalId?: string; comment?: string; finalValueCents?: number };

/** Snapshot definitivo do ganho — a venda histórica nunca muda quando o catálogo muda. */
export async function buildWonClosure(deps: SalesEngineDeps, deal: Deal, actorUserId: string | undefined, input: { wonReason?: string; proposalId?: string; comment?: string; finalValueCents?: number }) {
  const settings = await deps.salesConfigRepository.getSettings(deal.workspaceId);
  const items = await deps.dealItemRepository.listByDeal(deal.id);
  const totals = computeDealTotals(deal, items, settings?.defaultContractMonths);
  const finalValueCents = deal.valueMode === "manual" || items.length === 0 ? (input.finalValueCents ?? deal.valueCents) : totals.totalCents;
  const now = new Date().toISOString();
  return {
    status: "won" as const,
    forecastCategory: "closed" as const,
    closedAt: now,
    closedByUserId: actorUserId ?? null,
    // Crédito determinístico: responsável NO MOMENTO do ganho (quem fechou, se não houver responsável).
    creditedOwnerUserId: deal.ownerUserId ?? actorUserId ?? null,
    creditedTeamId: deal.teamId ?? null,
    wonReason: input.wonReason?.trim() || null,
    lossReason: null,
    closeComment: input.comment?.trim() || null,
    competitorId: null,
    wonProposalId: input.proposalId ?? null,
    finalValueCents,
    finalCostCents: items.length ? totals.costCents ?? null : null,
    finalGrossProfitCents: items.length && totals.costCents !== undefined ? finalValueCents - totals.costCents : null,
    finalMarginBp: items.length && totals.costCents !== undefined && finalValueCents > 0 ? Math.round(((finalValueCents - totals.costCents) * 10000) / finalValueCents) : null,
    finalMrrCents: totals.mrrCents || null,
    finalArrCents: totals.arrCents || null,
    finalTcvCents: items.length ? totals.tcvCents : finalValueCents,
    finalSnapshot: {
      currency: deal.currency,
      valueMode: deal.valueMode,
      ownerUserId: deal.ownerUserId,
      teamId: deal.teamId,
      stageId: deal.stageId,
      contractMonths: totals.contractMonths,
      totals,
      items: items.map((item) => ({
        productId: item.productId, variantId: item.variantId, name: item.productNameSnapshot, code: item.productCodeSnapshot, billingType: item.billingTypeSnapshot,
        quantity: item.quantity, listPriceCents: item.listPriceCentsSnapshot, minimumPriceCents: item.minimumPriceCentsSnapshot, unitCostCents: item.unitCostCentsSnapshot,
        proposedUnitPriceCents: item.proposedUnitPriceCents, subtotalCents: item.subtotalProposedCents, discountCents: item.discountCents,
        grossProfitCents: item.grossProfitCents, commissionType: item.commissionTypeSnapshot, commissionValue: item.commissionValueSnapshot,
      })),
    },
  };
}

async function evaluateForClose(deps: SalesEngineDeps, deal: Deal, actor: SalesActor): Promise<void> {
  const items = await deps.dealItemRepository.listByDeal(deal.id);
  if (items.length === 0) return;
  await assertTermsApproved(deps, { deal, lines: itemsToPricingLines(items), globalDiscountCents: deal.discountCents, actorUserId: actor.userId });
}

async function moveToTerminalStage(deps: SalesEngineDeps, deal: Deal, kind: "won" | "lost", lossReason?: string): Promise<Deal> {
  const stages = await deps.pipelineStageRepository.listByPipeline(deal.pipelineId);
  const target = stages.find((stage) => (kind === "won" ? stage.isWon : stage.isLost));
  if (!target || target.id === deal.stageId) return deal;
  const now = new Date().toISOString();
  const moved = await deps.dealRepository.moveStage(deal.id, { stageId: target.id, wonAt: kind === "won" ? now : null, lostAt: kind === "lost" ? now : null, lossReason: kind === "lost" ? lossReason ?? null : null });
  await deps.timelineEventRepository.record({ tenantId: deal.tenantId, workspaceId: deal.workspaceId, entityType: "deal", entityId: deal.id, eventType: "deal_stage_changed", actorType: "user", payload: { fromStageId: deal.stageId, toStageId: target.id, isWon: kind === "won", isLost: kind === "lost", lossReason } });
  return moved;
}

export type DealClosedHook = (deal: Deal) => Promise<void>;

export async function winDeal(deps: SalesEngineDeps & { onDealWon?: DealClosedHook }, actor: SalesActor, input: WinDealInput): Promise<Deal> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  if (deal.status === "won") return deal;
  if (deal.status !== "open") throw new Error("DEAL_CLOSED: reabra a oportunidade antes de marcá-la como ganha.");
  await evaluateForClose(deps, deal, actor);
  const closure = await buildWonClosure(deps, deal, actor.userId, input);
  if (!(closure.finalValueCents > 0)) throw new Error("DEAL_FINAL_VALUE_REQUIRED: informe o valor final para marcar como ganha.");
  const moved = await moveToTerminalStage(deps, deal, "won");
  const won = await deps.dealRepository.setClosure(moved.id, closure);
  await recordDealEvent(deps, won, "deal_won", actor, { finalValueCents: closure.finalValueCents, finalMarginBp: closure.finalMarginBp, wonReason: closure.wonReason, proposalId: closure.wonProposalId, creditedOwnerUserId: closure.creditedOwnerUserId });
  await fireDealAutomation(deps, won, "deal_won");
  await deps.onDealWon?.(won).catch(() => undefined);
  return won;
}

export async function loseDeal(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; lossReason: string; competitorId?: string; competitorName?: string; comment?: string }): Promise<Deal> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  if (deal.status === "lost") return deal;
  if (deal.status !== "open") throw new Error("DEAL_CLOSED: reabra a oportunidade antes de marcá-la como perdida.");
  const reason = input.lossReason?.trim();
  if (!reason) throw new Error("DEAL_LOSS_REASON_REQUIRED: informe o motivo da perda.");
  let competitorId = input.competitorId;
  if (competitorId) {
    const competitor = await deps.salesConfigRepository.getCompetitor(competitorId);
    if (!competitor || competitor.tenantId !== actor.tenantId || competitor.workspaceId !== input.workspaceId) throw new Error(`SALES_COMPETITOR_NOT_FOUND: concorrente "${competitorId}" não existe.`);
  } else if (input.competitorName?.trim()) {
    competitorId = (await deps.salesConfigRepository.upsertCompetitor({ tenantId: actor.tenantId, workspaceId: input.workspaceId, name: input.competitorName })).id;
  }
  const moved = await moveToTerminalStage(deps, deal, "lost", reason);
  const lost = await deps.dealRepository.setClosure(moved.id, {
    status: "lost", forecastCategory: "omitted", closedAt: new Date().toISOString(), closedByUserId: actor.userId, creditedOwnerUserId: deal.ownerUserId ?? null,
    creditedTeamId: deal.teamId ?? null, wonReason: null, lossReason: reason, closeComment: input.comment?.trim() || null, competitorId: competitorId ?? null,
    wonProposalId: null, finalValueCents: deal.valueCents, finalCostCents: null, finalGrossProfitCents: null, finalMarginBp: null, finalMrrCents: null,
    finalArrCents: null, finalTcvCents: null, finalSnapshot: null,
  });
  await recordDealEvent(deps, lost, "deal_lost", actor, { lossReason: reason, competitorId, valueCents: deal.valueCents });
  await fireDealAutomation(deps, lost, "deal_lost");
  return lost;
}

const REOPEN_CLOSURE = {
  status: "open" as const, forecastCategory: "pipeline" as const, closedAt: null, closedByUserId: null, creditedOwnerUserId: null, creditedTeamId: null,
  wonReason: null, lossReason: null, closeComment: null, competitorId: null, wonProposalId: null, finalValueCents: null, finalCostCents: null,
  finalGrossProfitCents: null, finalMarginBp: null, finalMrrCents: null, finalArrCents: null, finalTcvCents: null, finalSnapshot: null,
};

export async function reopenDeal(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; dealId: string }): Promise<Deal> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  if (deal.status === "open") return deal;
  const stages = await deps.pipelineStageRepository.listByPipeline(deal.pipelineId);
  const current = stages.find((stage) => stage.id === deal.stageId);
  let moved = deal;
  if (current && (current.isWon || current.isLost)) {
    const lastOpen = [...stages].filter((stage) => !stage.isWon && !stage.isLost).sort((a, b) => b.position - a.position)[0];
    if (lastOpen) moved = await deps.dealRepository.moveStage(deal.id, { stageId: lastOpen.id, wonAt: null, lostAt: null, lossReason: null });
  }
  const reopened = await deps.dealRepository.setClosure(moved.id, REOPEN_CLOSURE);
  await recordDealEvent(deps, reopened, "deal_reopened", actor, { fromStatus: deal.status });
  return reopened;
}

export async function cancelDeal(deps: SalesEngineDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; comment?: string }): Promise<Deal> {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  if (deal.status === "cancelled") return deal;
  if (deal.status !== "open") throw new Error("DEAL_CLOSED: reabra a oportunidade antes de cancelá-la.");
  const cancelled = await deps.dealRepository.setClosure(deal.id, { ...REOPEN_CLOSURE, status: "cancelled", forecastCategory: "omitted", closedAt: new Date().toISOString(), closedByUserId: actor.userId, closeComment: input.comment?.trim() || null });
  await recordDealEvent(deps, cancelled, "deal_cancelled", actor, { comment: input.comment });
  return cancelled;
}

/** Chamado por `moveDealStage` (Kanban): entrar numa etapa de ganho/perda fecha com snapshot;
 * voltar para etapa aberta reabre. Mantém o status consistente com a coluna, sem segundo caminho. */
export async function syncClosureWithStage(deps: SalesEngineDeps & { onDealWon?: DealClosedHook }, deal: Deal, stage: PipelineStage, actorUserId: string | undefined, lossReason?: string, lossComment?: string): Promise<Deal> {
  if (stage.isWon && deal.status !== "won") {
    const won = await deps.dealRepository.setClosure(deal.id, await buildWonClosure(deps, deal, actorUserId, {}));
    await deps.timelineEventRepository.record({ tenantId: deal.tenantId, workspaceId: deal.workspaceId, entityType: "deal", entityId: deal.id, eventType: "deal_won", actorType: actorUserId ? "user" : "system", actorId: actorUserId, payload: { finalValueCents: won.finalValueCents, via: "stage" } });
    await fireDealAutomation(deps, won, "deal_won");
    await deps.onDealWon?.(won).catch(() => undefined);
    return won;
  }
  if (stage.isLost && deal.status !== "lost") {
    const lost = await deps.dealRepository.setClosure(deal.id, { ...REOPEN_CLOSURE, status: "lost", forecastCategory: "omitted", closedAt: new Date().toISOString(), closedByUserId: actorUserId ?? null, creditedOwnerUserId: deal.ownerUserId ?? null, creditedTeamId: deal.teamId ?? null, lossReason: lossReason ?? deal.lossReason ?? null, closeComment: lossComment || null, finalValueCents: deal.valueCents });
    await fireDealAutomation(deps, lost, "deal_lost");
    return lost;
  }
  if (!stage.isWon && !stage.isLost && deal.status !== "open") return deps.dealRepository.setClosure(deal.id, REOPEN_CLOSURE);
  return deal;
}

/** Campos exigidos para entrar numa etapa — devolve os rótulos que faltam (vazio = pode entrar). */
export function missingStageRequirements(deal: Deal, itemCount: number, stage: PipelineStage, customFieldLabels: ReadonlyMap<string, string>): string[] {
  const missing: string[] = [];
  for (const field of stage.requiredFields) {
    if (field === "expectedCloseDate" && !deal.expectedCloseDate) missing.push("Previsão de fechamento");
    else if (field === "valueCents" && !(deal.valueCents > 0)) missing.push("Valor");
    else if (field === "contactId" && !deal.contactId) missing.push("Contato");
    else if (field === "ownerUserId" && !deal.ownerUserId) missing.push("Responsável");
    else if (field === "items" && itemCount === 0) missing.push("Produtos");
    else if (field.startsWith("custom:")) {
      const key = field.slice("custom:".length);
      const value = deal.customFields[key];
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) missing.push(customFieldLabels.get(key) ?? key);
    }
  }
  return missing;
}
