import { PUBLIC_CONTACT, type PublicProductCatalog } from "./catalog";
import { clamp, formatMoney, includedPlanQuote } from "./configurator";
import { MODULE_KEYS, MODULE_SHOWCASE, type ModuleKey } from "./showcase";
import type { CapacityRecommendationOption, PublicPlan } from "@/features/platform-plans/api";

export type PublicPeriod = "monthly" | "yearly";
export type ModuleSelection = {
  modules: readonly ModuleKey[];
  planCode: PublicPlan["code"] | null;
  period: PublicPeriod;
  users: number;
  numbers: number;
  recordings: number;
};

export function initialSelection(catalog: PublicProductCatalog, module: string | undefined): ModuleSelection {
  const plan = catalog.plans[0];
  const modules = module === "completo" ? MODULE_KEYS : module === "suite" ? ["conversations", "meetings"] as const : [MODULE_KEYS.find(key => key === module) ?? "conversations"];
  return { modules, planCode: plan?.code ?? null, period: "monthly", users: clamp("users", plan?.includedUsers ?? 2), numbers: clamp("numbers", plan?.includedWhatsappConnections ?? 1), recordings: 1 };
}

export function toggleModule(selection: ModuleSelection, module: ModuleKey): ModuleSelection {
  const modules = MODULE_KEYS.filter(key => key === module ? !selection.modules.includes(key) : selection.modules.includes(key));
  return modules.length ? { ...selection, modules } : selection;
}

export function capacityForPlan(plan: PublicPlan, selection: ModuleSelection, options?: readonly CapacityRecommendationOption[]): CapacityRecommendationOption | null {
  const official = options?.find(item => item.planCode === plan.code);
  if (official) return official.feasible && official.currency === plan.currency ? official : null;
  if (options) return null;
  const fits = (plan.includedUsers === null || selection.users <= plan.includedUsers)
    && (plan.includedWhatsappConnections === null || selection.numbers <= plan.includedWhatsappConnections);
  return fits ? includedPlanQuote(plan) : null;
}

export type ModuleLine = {
  module: ModuleKey;
  label: string;
  amount: number | null;
  currency: string;
  kind: "base" | "addon";
};

export type ApprovedBundlePolicy = {
  eligible: readonly ModuleKey[];
  basisPointsByCount: Readonly<Partial<Record<2 | 3 | 4, number>>>;
};

/** A subscription offer can provide an approved policy in the future. Addon lines are never eligible. */
export function bundleSavings(lines: readonly ModuleLine[], approved?: ApprovedBundlePolicy): number {
  if (!approved) return 0;
  const bases = lines.filter(line => line.kind === "base" && line.amount !== null && approved.eligible.includes(line.module));
  const count = new Set(bases.map(line => line.module)).size;
  const rate = count === 2 || count === 3 || count === 4 ? approved.basisPointsByCount[count] ?? 0 : 0;
  const baseInCents = bases.reduce((sum, line) => sum + Math.round((line.amount ?? 0) * 100), 0);
  return Math.round(baseInCents * Math.max(0, Math.min(10_000, rate)) / 10_000) / 100;
}

const money = (value: number | undefined | null): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const positive = (value: number | undefined | null): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const count = (quantity: number | null, singular: string, plural: string) =>
  quantity === null ? `${plural} ilimitados` : `${quantity} ${quantity === 1 ? singular : plural}`;

export function checkoutHref(selection: ModuleSelection, includeMeetings: boolean) {
  const params = new URLSearchParams({ plan: selection.planCode ?? "", users: String(selection.users), numbers: String(selection.numbers) });
  if (selection.period === "yearly") params.set("intervalo", "anual");
  if (includeMeetings) params.set("recordings", String(selection.recordings));
  return `/signup?${params}`;
}

export function makeModularQuote(catalog: PublicProductCatalog, selection: ModuleSelection, options?: readonly CapacityRecommendationOption[]) {
  const official = catalog.billing?.priceSource === "plan_versions";
  const plan = catalog.plans.find(item => item.code === selection.planCode);
  const capacity = plan ? capacityForPlan(plan, selection, options) : null;
  const hasConversas = selection.modules.includes("conversations");
  const hasMeetings = selection.modules.includes("meetings");
  const annual = selection.period === "yearly";
  const offer = official ? catalog.billing?.meetingsOffer : null;
  const lines: ModuleLine[] = [];
  const notes: string[] = [];
  const currency = plan?.currency ?? offer?.currency ?? "BRL";
  const totalUsers = plan?.includedUsers === null ? 0 : Math.max(0, selection.users - (plan?.includedUsers ?? 0));
  const totalNumbers = plan?.includedWhatsappConnections === null ? 0 : Math.max(0, selection.numbers - (plan?.includedWhatsappConnections ?? 0));
  const addLine = (module: ModuleKey, label: string, amount: number | null, kind: ModuleLine["kind"] = "base", lineCurrency = currency) => {
    lines.push({ module, label, amount, kind, currency: lineCurrency });
  };
  if (hasConversas) {
    const planName = plan ? ` ${plan.name}` : "";
    const included = plan ? ` · ${count(plan.includedUsers, "usuário", "usuários")} e ${count(plan.includedWhatsappConnections, "WhatsApp", "WhatsApps")}` : "";
    addLine("conversations", `Conversas${planName}${included}`, positive(annual ? plan?.yearlyPriceUsd : capacity?.baseMonthlyAmount ?? plan?.monthlyPriceUsd));
    if (totalUsers) addLine("conversations", `${count(totalUsers, "usuário adicional", "usuários adicionais")}`, annual ? null : money(capacity?.userAddonMonthlyAmount), "addon");
    if (totalNumbers) addLine("conversations", `${count(totalNumbers, "WhatsApp adicional", "WhatsApps adicionais")}`, annual ? null : money(capacity?.whatsappAddonMonthlyAmount), "addon");
    if (annual && (totalUsers || totalNumbers)) notes.push("O catálogo público não informa o preço anual de usuários e WhatsApps adicionais. Compare no mensal ou solicite a cotação anual.");
  }
  if (hasMeetings) {
    const included = offer?.includedConcurrentRecordings ?? 1;
    const extra = Math.max(0, selection.recordings - included);
    addLine("meetings", `Meetings · ${count(included, "simultânea incluída", "simultâneas incluídas")}`, positive(annual ? offer?.baseYearlyPrice : offer?.baseMonthlyPrice), "base", offer?.currency);
    const unit = positive(annual ? offer?.additionalRecordingYearlyPrice : offer?.additionalRecordingMonthlyPrice);
    if (extra) addLine("meetings", count(extra, "simultânea adicional", "simultâneas adicionais"), unit === null ? null : unit * extra, "addon", offer?.currency);
    notes.push("O valor de Meetings é pela capacidade de gravação. A assinatura base da conta é separada.");
  }
  if (selection.modules.includes("marketing")) addLine("marketing", "Marketing · condições sob consulta", null);
  if (selection.modules.includes("site")) addLine("site", "Site · condições sob consulta", null);

  const known = lines.filter(line => line.amount !== null);
  const subtotal = known.length && new Set(known.map(line => line.currency)).size === 1
    ? known.reduce((sum, line) => sum + Math.round((line.amount ?? 0) * 100), 0) / 100 : null;
  const discount = subtotal === null ? 0 : bundleSavings(lines);
  const complete = subtotal !== null && lines.every(line => line.amount !== null);
  const available = (key: ModuleKey) => catalog.products.find(item => item.key === key)?.contractable === true;
  const direct = official && hasConversas && available("conversations") && Boolean(capacity) && complete
    && selection.modules.every(key => key === "conversations" || (key === "meetings" && available(key)));
  const meetingsAccount = selection.modules.length === 1 && hasMeetings && available("meetings") && complete;
  const period = annual ? "ano" : "mês";
  const namedModules = selection.modules.map(key => MODULE_SHOWCASE[key].name);
  const summary = [
    `Módulos: ${namedModules.join(", ")}`,
    `Período: ${annual ? "anual" : "mensal"}`,
    ...(hasConversas ? [`Conversas ${plan?.name ?? ""}: ${selection.users} usuários e ${selection.numbers} WhatsApps`] : []),
    ...(hasMeetings ? [`Meetings: ${selection.recordings} gravação(ões) simultânea(s)`] : []),
    ...lines.map(line => `${line.label} — ${line.amount === null ? "sob consulta" : `${formatMoney(line.amount, line.currency)}/${period}`}`),
    ...(subtotal !== null ? [`Subtotal conhecido: ${formatMoney(subtotal, known[0].currency)}/${period}`] : []),
  ].join("\n");
  const contact = `${PUBLIC_CONTACT}?subject=${encodeURIComponent("Configuração do meu Vorix")}&body=${encodeURIComponent(summary)}`;
  return {
    lines, notes, subtotal, discount, total: subtotal === null ? null : subtotal - discount,
    complete, period, currency: known[0]?.currency ?? currency, direct, summary,
    href: direct ? checkoutHref(selection, hasMeetings) : meetingsAccount ? "/login?destino=reunioes" : contact,
    action: direct ? "Continuar para contratação" : meetingsAccount ? "Configurar na minha conta" : "Solicitar condições",
  };
}
