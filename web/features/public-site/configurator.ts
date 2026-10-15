import type { CapacityRecommendationOption, PublicPlan } from "@/features/platform-plans/api";
import { PUBLIC_CONTACT, PUBLIC_REFERENCE_PRICES, type PublicProductCatalog } from "./catalog";

/**
 * "Monte seu Vorix" — lógica pura do configurador público (sem DOM, sem fetch).
 *
 * Unidades comerciais, separadas por produto:
 * - Conversas: usuários e números conectados. O valor vem SEMPRE do simulador oficial do backend
 *   (`POST /v1/platform/plans/simulate` → `recommendBestPlan`, a mesma conta do checkout). Este
 *   módulo só monta a apresentação do que a API devolveu; nunca recalcula.
 * - Meetings: gravações simultâneas (nunca "bots" nem contas de gravação — contas conectadas são
 *   infraestrutura operacional e podem sobrar como reserva, sem virar cobrança).
 *
 * Meetings e Suite ainda NÃO são contratáveis: o configurador mostra referência provisória e leva
 * para conversa com o time, nunca para checkout.
 */

export const CONFIGURATOR_LIMITS = Object.freeze({
  users: { min: 1, max: 100 },
  numbers: { min: 1, max: 20 },
  recordings: { min: 1, max: 10 },
});

/** Decisões comerciais ainda em aberto — centralizadas aqui, nunca valores inventados na UI. */
export const PENDING_COMMERCIAL_PRICES = Object.freeze({
  /** Preço por gravação simultânea adicional do Meetings: ainda não definido. */
  meetingsAdditionalConcurrentRecording: null as number | null,
});

export type ConfiguratorField = keyof typeof CONFIGURATOR_LIMITS;

export type ConfiguratorState = {
  conversations: boolean;
  meetings: boolean;
  users: number;
  numbers: number;
  recordings: number;
};

export function initialConfiguratorState(startPlan: Pick<PublicPlan, "includedUsers" | "includedWhatsappConnections"> | null): ConfiguratorState {
  return {
    conversations: true,
    meetings: false,
    users: clamp("users", startPlan?.includedUsers ?? 2),
    numbers: clamp("numbers", startPlan?.includedWhatsappConnections ?? 1),
    recordings: 1,
  };
}

export function clamp(field: ConfiguratorField, value: number): number {
  const { min, max } = CONFIGURATOR_LIMITS[field];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function adjustQuantity(state: ConfiguratorState, field: ConfiguratorField, delta: number): ConfiguratorState {
  return { ...state, [field]: clamp(field, state[field] + delta) };
}

export function setQuantity(state: ConfiguratorState, field: ConfiguratorField, value: number): ConfiguratorState {
  return { ...state, [field]: clamp(field, value) };
}

/** Pelo menos um produto fica selecionado — desmarcar o último não faz nada. */
export function toggleProduct(state: ConfiguratorState, key: "conversations" | "meetings"): ConfiguratorState {
  const next = { ...state, [key]: !state[key] };
  return next.conversations || next.meetings ? next : state;
}

/** Cotação oficial inicial sem chamar a API: a capacidade incluída do plano de entrada É o plano. */
export function includedPlanQuote(plan: PublicPlan | null): CapacityRecommendationOption | null {
  if (!plan) return null;
  return {
    planCode: plan.code, currency: plan.currency, baseMonthlyAmount: plan.monthlyPriceUsd,
    includedUsers: plan.includedUsers, includedWhatsappConnections: plan.includedWhatsappConnections,
    additionalUsers: 0, additionalWhatsappConnections: 0, userAddonMonthlyAmount: 0, whatsappAddonMonthlyAmount: 0,
    addonsMonthlyAmount: 0, totalMonthlyAmount: plan.monthlyPriceUsd, feasible: true,
  };
}

export type QuoteLine = {
  product: "conversations" | "meetings";
  label: string;
  /** `null` = valor ainda não definido comercialmente. */
  amount: number | null;
  provisional: boolean;
};

export type Quote = {
  title: "Vorix Conversas" | "Vorix Meetings" | "Suite Vorix";
  summary: { product: "conversations" | "meetings"; name: string; details: string[] }[];
  lines: QuoteLine[];
  currency: string;
  /** Soma das linhas com valor conhecido. */
  knownTotal: number | null;
  /** Todas as linhas têm valor e nenhuma é provisória. */
  totalIsOfficial: boolean;
  /** Alguma linha ainda não tem valor comercial. */
  hasUndefinedAmounts: boolean;
  contractable: boolean;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string } | null;
  notes: string[];
};

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

export function composeQuote(input: {
  state: ConfiguratorState;
  catalog: Pick<PublicProductCatalog, "products" | "plans">;
  conversationsQuote: CapacityRecommendationOption | null;
  quoteFailed?: boolean;
}): Quote {
  const { state, catalog } = input;
  const conversationsProduct = catalog.products.find((product) => product.key === "conversations");
  const meetingsProduct = catalog.products.find((product) => product.key === "meetings");
  const conversationsContractable = conversationsProduct?.contractable === true;
  const meetingsContractable = meetingsProduct?.contractable === true;
  const quote = state.conversations ? input.conversationsQuote : null;
  const plan = quote ? catalog.plans.find((candidate) => candidate.code === quote.planCode) ?? null : null;
  const currency = quote?.currency ?? conversationsProduct?.currency ?? "BRL";

  const lines: QuoteLine[] = [];
  const summary: Quote["summary"] = [];
  if (state.conversations) {
    summary.push({ product: "conversations", name: "Vorix Conversas", details: [plural(state.users, "usuário", "usuários"), plural(state.numbers, "número conectado", "números conectados")] });
    if (quote) {
      const included = [quote.includedUsers === null ? "usuários ilimitados" : plural(quote.includedUsers, "usuário", "usuários"), quote.includedWhatsappConnections === null ? "números ilimitados" : plural(quote.includedWhatsappConnections, "número", "números")].join(" · ");
      lines.push({ product: "conversations", label: `Plano ${plan?.name ?? quote.planCode} · ${included}`, amount: quote.baseMonthlyAmount, provisional: false });
      if (quote.additionalUsers > 0) lines.push({ product: "conversations", label: `+ ${plural(quote.additionalUsers, "usuário adicional", "usuários adicionais")}`, amount: quote.userAddonMonthlyAmount, provisional: false });
      if (quote.additionalWhatsappConnections > 0) lines.push({ product: "conversations", label: `+ ${plural(quote.additionalWhatsappConnections, "número adicional", "números adicionais")}`, amount: quote.whatsappAddonMonthlyAmount, provisional: false });
    } else {
      lines.push({ product: "conversations", label: "Vorix Conversas", amount: null, provisional: false });
    }
  }
  if (state.meetings) {
    summary.push({ product: "meetings", name: "Vorix Meetings", details: [plural(state.recordings, "gravação simultânea", "gravações simultâneas")] });
    lines.push({ product: "meetings", label: "Meetings · 1 gravação simultânea", amount: meetingsProduct?.monthlyPrice ?? PUBLIC_REFERENCE_PRICES.meetings, provisional: true });
    if (state.recordings > 1) {
      const unit = PENDING_COMMERCIAL_PRICES.meetingsAdditionalConcurrentRecording;
      lines.push({ product: "meetings", label: `+ ${plural(state.recordings - 1, "gravação simultânea", "gravações simultâneas")}`, amount: unit === null ? null : unit * (state.recordings - 1), provisional: true });
    }
  }

  const known = lines.filter((line) => line.amount !== null);
  const knownTotal = known.length ? known.reduce((sum, line) => sum + (line.amount ?? 0), 0) : null;
  const hasUndefinedAmounts = lines.some((line) => line.amount === null);
  const totalIsOfficial = !hasUndefinedAmounts && lines.every((line) => !line.provisional);
  const contractable = (!state.conversations || conversationsContractable) && (!state.meetings || meetingsContractable) && !hasUndefinedAmounts && !!(!state.conversations || quote);

  const title: Quote["title"] = state.conversations && state.meetings ? "Suite Vorix" : state.meetings ? "Vorix Meetings" : "Vorix Conversas";
  const contactHref = buildContactHref(title, summary);
  const notes: string[] = [];
  if (input.quoteFailed && state.conversations) notes.push("Não conseguimos calcular Conversas agora. Fale com o time para confirmar os valores.");
  if (state.meetings) notes.push("Meetings está em validação para liberação comercial. O valor é uma referência provisória, sem contratação disponível.");
  if (state.meetings && state.recordings > 1 && PENDING_COMMERCIAL_PRICES.meetingsAdditionalConcurrentRecording === null) notes.push("O valor de gravações simultâneas adicionais será definido na oferta comercial.");
  if (state.conversations && quote && (quote.additionalUsers > 0 || quote.additionalWhatsappConnections > 0) && contractable) notes.push("Usuários e números adicionais são confirmados em Configurações → Plano, logo após criar sua conta.");

  let primaryCta: Quote["primaryCta"];
  let secondaryCta: Quote["secondaryCta"] = null;
  if (contractable && state.conversations && !state.meetings && quote) {
    primaryCta = { label: `Continuar com o plano ${plan?.name ?? quote.planCode}`, href: `/signup?plan=${encodeURIComponent(quote.planCode)}` };
  } else {
    primaryCta = { label: state.meetings ? "Falar com o time sobre esta configuração" : "Falar com o time", href: contactHref };
    if (state.meetings && state.conversations && conversationsContractable && quote) {
      secondaryCta = { label: "Começar agora só com Conversas", href: `/signup?plan=${encodeURIComponent(quote.planCode)}` };
    }
  }
  return { title, summary, lines, currency, knownTotal, totalIsOfficial, hasUndefinedAmounts, contractable, primaryCta, secondaryCta, notes };
}

function buildContactHref(title: string, summary: Quote["summary"]): string {
  const body = [`Olá! Quero conversar sobre esta configuração do Vorix (${title}):`, ...summary.map((item) => `- ${item.name}: ${item.details.join(", ")}`)].join("\n");
  return `${PUBLIC_CONTACT}?subject=${encodeURIComponent(`Configuração ${title}`)}&body=${encodeURIComponent(body)}`;
}

export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}
