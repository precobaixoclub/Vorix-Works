import { describe, expect, it } from "vitest";
import { activeGlobalArea, activeGlobalItem, buildGlobalNavigation } from "../components/global-navigation";
import { MARKETING_BACKSTAGE_NAV, SOLUTION_NAVIGATION } from "../components/workspace-navigation";
import { routeOwner, type SolutionKey } from "../lib/solutions";

const BASE = "/workspaces/ws-1";
const ALL: SolutionKey[] = ["conversations", "marketing", "site", "meetings"];
const keys = (available: SolutionKey[]) => buildGlobalNavigation(available).map((area) => area.key);

describe("menu global — áreas por ferramenta contratada", () => {
  it("conta completa: as 8 áreas, na ordem do menu", () => {
    expect(keys(ALL)).toEqual(["home", "conversations", "sales", "marketing", "site", "meetings", "results", "settings"]);
    expect(buildGlobalNavigation(ALL).map((area) => area.label)).toEqual(["Início", "Conversas", "Vendas", "Marketing", "Meu site", "Reuniões", "Resultados", "Configurações"]);
  });

  it("só Conversas: nada de Marketing, Site ou Reuniões aparece como se estivesse liberado", () => {
    expect(keys(["conversations"])).toEqual(["home", "conversations", "sales", "results", "settings"]);
  });

  it("só Meetings: Reuniões e Configurações (sem Início do Conversas, sem Vendas)", () => {
    expect(keys(["meetings"])).toEqual(["meetings", "settings"]);
  });

  it("só Site: Vendas aponta para as oportunidades e propostas do próprio Site", () => {
    const areas = buildGlobalNavigation(["site"]);
    expect(areas.map((area) => area.key)).toEqual(["sales", "site", "settings"]);
    const sales = areas.find((area) => area.key === "sales")!;
    expect(sales.href).toBe("/site/oportunidades");
    expect(sales.items.map((item) => item.href)).toEqual(["/site/oportunidades", "/site/propostas"]);
  });

  it("cada tela de uma área pertence à ferramenta que a área exige (o guarda do servidor continua valendo)", () => {
    const requires: Record<string, SolutionKey | "core" | "sales"> = { home: "conversations", conversations: "conversations", sales: "sales", marketing: "marketing", site: "site", meetings: "meetings", results: "conversations", settings: "core" };
    for (const area of buildGlobalNavigation(ALL)) {
      for (const href of [area.href, ...area.items.map((item) => item.href)]) {
        const owner = routeOwner(`${BASE}${href}`, BASE);
        if (requires[area.key] === "sales") expect(["conversations", "site"]).toContain(owner);
        else expect(owner, `${area.key} ${href}`).toBe(requires[area.key]);
      }
    }
  });
});

describe("menu global — nenhuma tela existente se perde", () => {
  it("toda tela dos menus antigos (todas as ferramentas) continua alcançável no menu global", () => {
    const reachable = new Set(buildGlobalNavigation(ALL).flatMap((area) => [area.href, ...area.items.map((item) => item.href)]));
    for (const [key, navigation] of Object.entries(SOLUTION_NAVIGATION)) {
      const old = [navigation.home, ...(navigation.primaryAction ? [navigation.primaryAction] : []), ...(navigation.featured ? [navigation.featured] : []), ...navigation.sections.flatMap((section) => section.items)];
      for (const item of old) expect(reachable.has(item.href), `${key}: ${item.label} (${item.href})`).toBe(true);
    }
  });

  it("URLs inalteradas: todo link é relativo ao workspace (o mesmo workspace em toda a navegação)", () => {
    for (const area of buildGlobalNavigation(ALL)) {
      for (const href of [area.href, ...area.items.map((item) => item.href)]) {
        expect(href === "" || href.startsWith("/")).toBe(true);
        expect(href).not.toMatch(/workspaces|https?:/);
      }
    }
  });
});

describe("menu global — área e tela ativas", () => {
  const areas = buildGlobalNavigation(ALL);
  const cases: Array<[string, string | undefined]> = [
    ["", "home"],
    ["/", "home"],
    ["/conversas", "conversations"],
    ["/kanban", "conversations"],
    ["/radar", "conversations"],
    ["/deals", "sales"],
    ["/deals/deal-1", "sales"],
    ["/contacts", "sales"],
    ["/products", "sales"],
    ["/proposals", "sales"],
    ["/site/oportunidades", "sales"],
    ["/site/propostas", "sales"],
    ["/ideias", "marketing"],
    ["/production", "marketing"],
    ["/social/compose", "marketing"],
    ["/knowledge", "marketing"],
    ["/operations", "marketing"],
    ["/site", "site"],
    ["/site/products", "site"],
    ["/commerce", "site"],
    ["/meetings", "meetings"],
    ["/meetings/central/meeting-1", "meetings"],
    ["/results", "results"],
    ["/performance", "results"],
    ["/reports", "results"],
    ["/settings", "settings"],
    ["/settings/users", "settings"],
    ["/connections", "settings"],
    ["/onboarding", undefined],
  ];
  it.each(cases)("%s → %s", (path, expected) => {
    expect(activeGlobalArea(`${BASE}${path}`, BASE, areas)).toBe(expected);
  });

  it("prefixo parecido não acende a área errada (/sites não é /site; /dealsX não é /deals)", () => {
    expect(activeGlobalArea(`${BASE}/sites`, BASE, areas)).toBeUndefined();
    expect(activeGlobalArea(`${BASE}/dealsX`, BASE, areas)).toBeUndefined();
  });

  it("outra conta/workspace nunca acende nada", () => {
    expect(activeGlobalArea("/workspaces/ws-2/conversas", BASE, areas)).toBeUndefined();
    expect(activeGlobalArea("/admin", BASE, areas)).toBeUndefined();
  });

  it("área sem acesso não acende (rota de Marketing numa conta só com Conversas)", () => {
    expect(activeGlobalArea(`${BASE}/ideias`, BASE, buildGlobalNavigation(["conversations"]))).toBeUndefined();
  });

  it("subitem ativo é o de prefixo mais longo; Em produção acende o Bolsão", () => {
    const meetings = areas.find((area) => area.key === "meetings");
    expect(activeGlobalItem(`${BASE}/meetings/agenda`, BASE, meetings)).toBe("/meetings/agenda");
    expect(activeGlobalItem(`${BASE}/meetings`, BASE, meetings)).toBe("/meetings");
    const marketing = areas.find((area) => area.key === "marketing");
    expect(activeGlobalItem(`${BASE}/production`, BASE, marketing)).toBe("/ideias");
    expect(activeGlobalItem(`${BASE}/social/calendar`, BASE, marketing)).toBe("/social/calendar");
    const site = areas.find((area) => area.key === "site");
    expect(activeGlobalItem(`${BASE}/site/pedidos`, BASE, site)).toBe("/site/pedidos");
    expect(activeGlobalItem(`${BASE}/site`, BASE, site)).toBe("/site");
  });

  it("bastidor técnico continua mapeado para o Marketing", () => {
    for (const item of MARKETING_BACKSTAGE_NAV) expect(activeGlobalArea(`${BASE}${item.href}`, BASE, areas)).toBe("marketing");
  });
});
