/**
 * Sales Engine — precificação. Funções PURAS e determinísticas: o backend é a autoridade dos
 * números comerciais (o frontend só exibe). Dinheiro sempre em centavos inteiros; margem e desconto
 * em basis points (1% = 100 bp) inteiros; arredondamento sempre `Math.round` no fim de cada linha,
 * nunca float acumulado entre linhas.
 *
 * Conceitos separados de propósito (nunca colapsados num único "price"):
 * - custo (`unitCostCents`) — o que a empresa paga; pode ser desconhecido;
 * - preço de tabela (`listPriceCents`) — referência de desconto;
 * - preço mínimo (`minimumPriceCents`) — limite sem aprovação; pode não existir;
 * - preço proposto (`proposedUnitPriceCents`) — o que o vendedor oferece; pode ser ACIMA da tabela.
 */

export const BILLING_TYPES = ["one_time", "monthly", "quarterly", "annual", "per_unit", "per_hour", "custom"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const RECURRING_BILLING_TYPES: readonly BillingType[] = ["monthly", "quarterly", "annual"];

export type PricingLineInput = {
  quantity: number;
  unitCostCents?: number | null;
  listPriceCents: number;
  minimumPriceCents?: number | null;
  proposedUnitPriceCents: number;
  billingType: BillingType;
};

export type PricingLine = {
  subtotalListCents: number;
  subtotalProposedCents: number;
  /** `undefined` quando o custo do item é desconhecido — nunca tratado como zero. */
  subtotalCostCents?: number;
  /** Desconto em relação à tabela (nunca negativo; preço acima da tabela gera `premiumCents`). */
  discountCents: number;
  discountBp: number;
  premiumCents: number;
  grossProfitCents?: number;
  grossMarginBp?: number;
  /** Subtotal no preço mínimo; `undefined` quando o item não tem mínimo. */
  subtotalMinimumCents?: number;
  /** Quanto ainda dá pra ceder até o mínimo (negativo = abaixo do mínimo). */
  negotiationRoomCents?: number;
  belowMinimum: boolean;
  /** Receita recorrente mensal equivalente desta linha (0 para cobrança única). */
  mrrCents: number;
};

export function bp(part: number, whole: number): number | undefined {
  if (!whole) return undefined;
  return Math.round((part * 10000) / whole);
}

function money(quantity: number, unitCents: number): number {
  return Math.round(quantity * unitCents);
}

export function monthlyEquivalentCents(billingType: BillingType, subtotalCents: number): number {
  if (billingType === "monthly") return subtotalCents;
  if (billingType === "quarterly") return Math.round(subtotalCents / 3);
  if (billingType === "annual") return Math.round(subtotalCents / 12);
  return 0;
}

export function priceLine(input: PricingLineInput): PricingLine {
  const subtotalListCents = money(input.quantity, input.listPriceCents);
  const subtotalProposedCents = money(input.quantity, input.proposedUnitPriceCents);
  const hasCost = input.unitCostCents !== undefined && input.unitCostCents !== null;
  const subtotalCostCents = hasCost ? money(input.quantity, input.unitCostCents as number) : undefined;
  const hasMinimum = input.minimumPriceCents !== undefined && input.minimumPriceCents !== null;
  const subtotalMinimumCents = hasMinimum ? money(input.quantity, input.minimumPriceCents as number) : undefined;
  const difference = subtotalListCents - subtotalProposedCents;
  const discountCents = Math.max(0, difference);
  const grossProfitCents = subtotalCostCents === undefined ? undefined : subtotalProposedCents - subtotalCostCents;
  return {
    subtotalListCents,
    subtotalProposedCents,
    subtotalCostCents,
    discountCents,
    discountBp: bp(discountCents, subtotalListCents) ?? 0,
    premiumCents: Math.max(0, -difference),
    grossProfitCents,
    grossMarginBp: grossProfitCents === undefined ? undefined : bp(grossProfitCents, subtotalProposedCents),
    subtotalMinimumCents,
    negotiationRoomCents: subtotalMinimumCents === undefined ? undefined : subtotalProposedCents - subtotalMinimumCents,
    belowMinimum: hasMinimum && input.proposedUnitPriceCents < (input.minimumPriceCents as number),
    mrrCents: monthlyEquivalentCents(input.billingType, subtotalProposedCents),
  };
}

export type CommercialTotals = {
  itemCount: number;
  listTotalCents: number;
  subtotalProposedCents: number;
  /** Desconto global (da oportunidade/proposta) já limitado ao subtotal — nunca aplicado duas vezes. */
  globalDiscountCents: number;
  totalCents: number;
  /** Desconto total frente à tabela (itens + global), nunca negativo. */
  discountCents: number;
  discountBp: number;
  /** Custo total — `undefined` se QUALQUER item tem custo desconhecido (margem não é inventada). */
  costCents?: number;
  grossProfitCents?: number;
  grossMarginBp?: number;
  /** Total no preço mínimo (itens sem mínimo entram pelo proposto — não abrem nem fecham espaço). */
  minimumTotalCents?: number;
  negotiationRoomCents?: number;
  belowMinimum: boolean;
  mrrCents: number;
  arrCents: number;
  oneTimeCents: number;
  tcvCents: number;
  /** Meses usados no TCV; `undefined` = recorrência anualizada (ARR), nunca contrato forçado. */
  contractMonths?: number;
};

export function computeCommercialTotals(lines: readonly PricingLineInput[], options: { globalDiscountCents?: number; contractMonths?: number | null } = {}): CommercialTotals {
  const priced = lines.map((line) => ({ line, priced: priceLine(line) }));
  const listTotalCents = priced.reduce((sum, item) => sum + item.priced.subtotalListCents, 0);
  const subtotalProposedCents = priced.reduce((sum, item) => sum + item.priced.subtotalProposedCents, 0);
  const globalDiscountCents = Math.min(Math.max(0, options.globalDiscountCents ?? 0), subtotalProposedCents);
  const totalCents = subtotalProposedCents - globalDiscountCents;
  const factor = subtotalProposedCents > 0 ? totalCents / subtotalProposedCents : 1;
  const costKnown = priced.length > 0 && priced.every((item) => item.priced.subtotalCostCents !== undefined);
  const costCents = costKnown ? priced.reduce((sum, item) => sum + (item.priced.subtotalCostCents as number), 0) : undefined;
  const grossProfitCents = costCents === undefined ? undefined : totalCents - costCents;
  const hasAnyMinimum = priced.some((item) => item.priced.subtotalMinimumCents !== undefined);
  const minimumTotalCents = hasAnyMinimum ? priced.reduce((sum, item) => sum + (item.priced.subtotalMinimumCents ?? item.priced.subtotalProposedCents), 0) : undefined;
  const negotiationRoomCents = minimumTotalCents === undefined ? undefined : totalCents - minimumTotalCents;
  const recurringMonthly = priced.reduce((sum, item) => sum + item.priced.mrrCents, 0);
  const recurringSubtotal = priced.filter((item) => RECURRING_BILLING_TYPES.includes(item.line.billingType)).reduce((sum, item) => sum + item.priced.subtotalProposedCents, 0);
  const mrrCents = Math.round(recurringMonthly * factor);
  const arrCents = mrrCents * 12;
  const oneTimeCents = Math.round((subtotalProposedCents - recurringSubtotal) * factor);
  const contractMonths = options.contractMonths ?? undefined;
  const discountCents = Math.max(0, listTotalCents - totalCents);
  return {
    itemCount: lines.length,
    listTotalCents,
    subtotalProposedCents,
    globalDiscountCents,
    totalCents,
    discountCents,
    discountBp: bp(discountCents, listTotalCents) ?? 0,
    costCents,
    grossProfitCents,
    grossMarginBp: grossProfitCents === undefined ? undefined : bp(grossProfitCents, totalCents),
    minimumTotalCents,
    negotiationRoomCents,
    belowMinimum: priced.some((item) => item.priced.belowMinimum) || (negotiationRoomCents !== undefined && negotiationRoomCents < 0),
    mrrCents,
    arrCents,
    oneTimeCents,
    tcvCents: oneTimeCents + (contractMonths ? mrrCents * contractMonths : arrCents),
    contractMonths,
  };
}

/** Política comercial efetiva (já resolvida por usuário > equipe > papel > workspace). */
export type EffectiveCommercialPolicy = {
  minMarginBp?: number;
  maxDiscountBp?: number;
  allowBelowMinimum: boolean;
  /** De onde veio cada limite — explica ao vendedor por que pediu aprovação. */
  source: "user" | "team" | "role" | "workspace" | "none";
};

export const APPROVAL_REASONS = ["below_minimum_price", "margin_below_policy", "discount_above_autonomy"] as const;
export type ApprovalReason = (typeof APPROVAL_REASONS)[number];

export type NegotiationHealth = "healthy" | "near_limit" | "below_limit";

export type CommercialEvaluation = {
  reasons: ApprovalReason[];
  requiresApproval: boolean;
  health: NegotiationHealth;
};

/** Nunca bloqueia preço ACIMA da tabela (aumenta margem); só pede aprovação quando cruza a política. */
export function evaluateCommercialTerms(totals: CommercialTotals, policy: EffectiveCommercialPolicy): CommercialEvaluation {
  const reasons: ApprovalReason[] = [];
  if (totals.belowMinimum && !policy.allowBelowMinimum) reasons.push("below_minimum_price");
  if (policy.minMarginBp !== undefined && totals.grossMarginBp !== undefined && totals.grossMarginBp < policy.minMarginBp) reasons.push("margin_below_policy");
  if (policy.maxDiscountBp !== undefined && totals.discountBp > policy.maxDiscountBp) reasons.push("discount_above_autonomy");
  let health: NegotiationHealth = "healthy";
  if (reasons.length > 0 || totals.belowMinimum) health = "below_limit";
  else {
    const roomTight = totals.negotiationRoomCents !== undefined && totals.totalCents > 0 && totals.negotiationRoomCents <= Math.round(totals.totalCents * 0.05);
    const marginTight = policy.minMarginBp !== undefined && totals.grossMarginBp !== undefined && totals.grossMarginBp - policy.minMarginBp <= 500;
    const discountTight = policy.maxDiscountBp !== undefined && policy.maxDiscountBp - totals.discountBp <= 200 && totals.discountBp > 0;
    if (roomTight || marginTight || discountTight) health = "near_limit";
  }
  return { reasons, requiresApproval: reasons.length > 0, health };
}

/** Impressão digital dos termos comerciais: uma aprovação vale para ESTES termos; qualquer mudança
 * de item/quantidade/preço/desconto exige nova aprovação (nunca reaproveitada silenciosamente). */
export function commercialTermsKey(lines: readonly { productId?: string; variantId?: string; quantity: number; proposedUnitPriceCents: number }[], globalDiscountCents: number): string {
  const normalized = lines.map((line) => [line.productId ?? "", line.variantId ?? "", Number(line.quantity.toFixed(3)), line.proposedUnitPriceCents]);
  return JSON.stringify({ lines: normalized, globalDiscountCents });
}

/** Probabilidade padrão de uma etapa aberta sem probabilidade configurada: distribuída pela posição. */
export function defaultStageProbability(openStageIndex: number, openStageCount: number): number {
  if (openStageCount <= 0) return 0;
  return Math.round(((openStageIndex + 1) * 100) / (openStageCount + 1));
}
