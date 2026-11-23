import { describe, expect, it } from "vitest";
import { PERIODS, SECTION_FILTERS, localDate, marketingPeriod, periodRange, resolveResultsSection, resultsSectionsFor, sitePeriod } from "@/features/results/model";

const all = () => true;
const NOW = new Date(2026, 10, 23, 22, 30); // 23/11/2026 às 22h30 (horário local)

describe("Resultados — seções por ferramenta contratada (Fase 12)", () => {
  it("conta completa: visão geral + uma seção por ferramenta", () => {
    expect(resultsSectionsFor(["conversations", "marketing", "site", "meetings"], all).map((section) => section.value)).toEqual(["overview", "attendance", "commercial", "marketing", "site", "meetings"]);
  });
  it("ferramenta não contratada não aparece; sem permissão aparece marcada (não some)", () => {
    expect(resultsSectionsFor(["meetings"], all).map((section) => section.value)).toEqual(["overview", "meetings"]);
    const site = resultsSectionsFor(["site"], (permission) => permission !== "analytics:read").find((section) => section.value === "site")!;
    expect(site.allowed).toBe(false);
    expect(resultsSectionsFor(["site"], all).find((section) => section.value === "site")!.allowed).toBe(true);
  });
  it("?secao= desconhecida ou de ferramenta não contratada abre a visão geral", () => {
    const sections = resultsSectionsFor(["meetings"], all);
    expect(resolveResultsSection("meetings", sections)).toBe("meetings");
    expect(resolveResultsSection("commercial", sections)).toBe("overview");
    expect(resolveResultsSection(null, sections)).toBe("overview");
  });
  it("relatórios detalhados continuam acessíveis a partir de cada seção", () => {
    const sections = resultsSectionsFor(["conversations", "marketing", "site", "meetings"], all);
    expect(sections.find((section) => section.value === "commercial")!.details?.map(([, href]) => href)).toEqual(["/performance", "/reports"]);
    expect(sections.find((section) => section.value === "site")!.details?.[0]?.[1]).toBe("/site/analytics");
  });
});

describe("Resultados — períodos", () => {
  it("datas locais: às 22h30 'hoje' continua sendo hoje (antes, em UTC, virava amanhã)", () => {
    expect(localDate(NOW)).toBe("2026-11-23");
    expect(periodRange("today", "", "", NOW)).toEqual({ from: "2026-11-23", to: "2026-11-23" });
    expect(periodRange("last_7_days", "", "", NOW)).toEqual({ from: "2026-11-17", to: "2026-11-23" });
    expect(periodRange("last_90_days", "", "", NOW)).toEqual({ from: "2026-08-26", to: "2026-11-23" });
    expect(periodRange("custom", "2026-11-01", "2026-11-10", NOW)).toEqual({ from: "2026-11-01", to: "2026-11-10" });
  });
  it("Marketing: só presets que o servidor conhece; 90 dias vai como intervalo (antes quebrava)", () => {
    expect(marketingPeriod("last_30_days", {})).toBe("last_30_days");
    expect(marketingPeriod("today", {})).toBe("today");
    expect(marketingPeriod("last_90_days", { from: "2026-08-26", to: "2026-11-23" })).toBe("custom:2026-08-26:2026-11-23");
    expect(marketingPeriod("custom", { from: "2026-11-01" })).toBeUndefined();
  });
  it("Site: formato da analytics do site (today | 7d | 30d | custom com datas)", () => {
    expect(sitePeriod("last_7_days", {})).toEqual({ period: "7d" });
    expect(sitePeriod("last_90_days", { from: "2026-08-26", to: "2026-11-23" })).toEqual({ period: "custom", from: "2026-08-26", to: "2026-11-23" });
    expect(sitePeriod("custom", {})).toBeUndefined();
  });
  it("cada seção só mostra os filtros que mudam os números; Reuniões tem período fixo", () => {
    expect(SECTION_FILTERS.meetings).toEqual({ period: false, channel: false, commercial: false });
    expect(SECTION_FILTERS.commercial.commercial).toBe(true);
    expect(SECTION_FILTERS.attendance.channel).toBe(false);
    expect(PERIODS.map((period) => period.value)).toEqual(["today", "last_7_days", "last_30_days", "last_90_days", "custom"]);
  });
});
