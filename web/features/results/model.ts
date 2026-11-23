import type { SolutionKey } from "@/lib/solutions";

/**
 * Resultados (Reorganização de UX — Fase 12): a central ANALÍTICA da empresa, por ferramenta
 * contratada. Cada seção usa a fonte que já existia (métricas de atendimento, comerciais,
 * publicações, analytics do site, painel de reuniões) e só consulta quando é aberta. Nada aqui
 * inventa número, soma fontes diferentes ou estima conversão.
 */
export type ResultsSectionKey = "overview" | "attendance" | "commercial" | "marketing" | "site" | "meetings";

export type ResultsSection = {
  value: ResultsSectionKey;
  label: string;
  solution?: SolutionKey;
  /** Permissões necessárias (TODAS). Sem elas a seção aparece com "Sem permissão" — não some. */
  permissions?: readonly string[];
  /** Telas completas da ferramenta (relatórios detalhados), que continuam onde estavam. */
  details?: readonly (readonly [string, string])[];
};

export const RESULTS_SECTIONS: readonly ResultsSection[] = [
  { value: "overview", label: "Visão geral" },
  { value: "attendance", label: "Atendimento", solution: "conversations", permissions: ["inbox:read"], details: [["Radar do atendimento", "/radar"]] },
  { value: "commercial", label: "Comercial", solution: "conversations", permissions: ["deal:read"], details: [["Desempenho comercial", "/performance"], ["Relatórios", "/reports"]] },
  { value: "marketing", label: "Marketing", solution: "marketing", permissions: ["marketing:social_read"], details: [["Analytics de Marketing", "/analytics"], ["Calendário", "/calendar"]] },
  // Mesmas permissões da tela "Analytics do site".
  { value: "site", label: "Site", solution: "site", permissions: ["analytics:read", "site:read", "commerce:read"], details: [["Analytics do site", "/site/analytics"]] },
  { value: "meetings", label: "Reuniões", solution: "meetings", permissions: ["meeting:read"], details: [["Visão geral de Reuniões", "/meetings"], ["Gravações", "/meetings/central"]] },
];

export type VisibleResultsSection = ResultsSection & { allowed: boolean };

/** Seções das ferramentas CONTRATADAS; `allowed` diz se a pessoa pode ver os números. */
export function resultsSectionsFor(available: readonly SolutionKey[], can: (permission: string) => boolean): VisibleResultsSection[] {
  return RESULTS_SECTIONS.filter((section) => !section.solution || available.includes(section.solution)).map((section) => ({ ...section, allowed: (section.permissions ?? []).every((permission) => can(permission)) }));
}

export function resolveResultsSection(param: string | null | undefined, sections: readonly { value: ResultsSectionKey }[]): ResultsSectionKey {
  return sections.some((section) => section.value === param) ? (param as ResultsSectionKey) : "overview";
}

// --------------------------------------------------------------------------- Períodos

export type PeriodChoice = "today" | "last_7_days" | "last_30_days" | "last_90_days" | "custom";
export const PERIODS: readonly { value: PeriodChoice; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "last_7_days", label: "Últimos 7 dias" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "last_90_days", label: "Últimos 90 dias" },
  { value: "custom", label: "Personalizado" },
];

/** Data LOCAL (aaaa-mm-dd). Antes usava UTC: depois das 21h em Brasília, "hoje" virava amanhã. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function periodRange(choice: PeriodChoice, customFrom: string, customTo: string, now = new Date()): { from?: string; to?: string } {
  if (choice === "custom") return { from: customFrom || undefined, to: customTo || undefined };
  const days = choice === "today" ? 0 : choice === "last_7_days" ? 6 : choice === "last_90_days" ? 89 : 29;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return { from: localDate(start), to: localDate(now) };
}

/**
 * Período no formato da analytics de Marketing. O servidor conhece "today", "last_7_days" e
 * "last_30_days"; 90 dias NÃO é um preset de lá (a tela antiga mandava "last_90_days" e a consulta
 * quebrava) — vai como intervalo personalizado com as mesmas datas das outras seções.
 */
export function marketingPeriod(choice: PeriodChoice, range: { from?: string; to?: string }): string | undefined {
  if (choice === "today" || choice === "last_7_days" || choice === "last_30_days") return choice;
  if (!range.from || !range.to) return undefined;
  return `custom:${range.from}:${range.to}`;
}

/** Período no formato da analytics do Site (today | 7d | 30d | custom com datas). */
export function sitePeriod(choice: PeriodChoice, range: { from?: string; to?: string }): { period: string; from?: string; to?: string } | undefined {
  if (choice === "today") return { period: "today" };
  if (choice === "last_7_days") return { period: "7d" };
  if (choice === "last_30_days") return { period: "30d" };
  if (!range.from || !range.to) return undefined;
  return { period: "custom", from: range.from, to: range.to };
}

/** Filtros que REALMENTE mudam os números de cada seção (os outros não aparecem). */
export const SECTION_FILTERS: Record<ResultsSectionKey, { period: boolean; channel: boolean; commercial: boolean }> = {
  overview: { period: true, channel: false, commercial: false },
  attendance: { period: true, channel: false, commercial: false },
  commercial: { period: true, channel: true, commercial: true },
  marketing: { period: true, channel: true, commercial: false },
  site: { period: true, channel: false, commercial: false },
  // O painel de reuniões tem período fixo (hoje e esta semana) — dito na tela.
  meetings: { period: false, channel: false, commercial: false },
};
