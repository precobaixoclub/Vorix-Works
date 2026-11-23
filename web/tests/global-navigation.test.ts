import { describe, expect, it } from "vitest";
import { MOBILE_BAR_SLOTS, WORKSPACE_SEARCH_MIN, activeGlobalArea, activeGlobalItem, buildGlobalNavigation, mobileBarAreas, organizeWorkspaces, workspaceInitials, workspaceSwitchHref } from "../components/global-navigation";
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

// ---------------------------------------------------------------- Fase 2

/** Todas as combinações de ferramentas contratadas (16). */
const COMBOS: SolutionKey[][] = Array.from({ length: 16 }, (_, mask) => ALL.filter((_, index) => mask & (1 << index)));
const bar = (available: SolutionKey[]) => mobileBarAreas(buildGlobalNavigation(available)).map((area) => area.key);

describe("Fase 2 — barra inferior do celular", () => {
  it("conta completa: Início, Conversas, Marketing, Meu site, Reuniões (Vendas/Resultados/Configurações no Menu)", () => {
    expect(bar(ALL)).toEqual(["home", "conversations", "marketing", "site", "meetings"]);
  });

  it("vaga de ferramenta não contratada é ocupada por Vendas/Resultados — nunca botão vazio", () => {
    expect(bar(["conversations"])).toEqual(["home", "conversations", "sales", "results"]);
    expect(bar(["conversations", "marketing"])).toEqual(["home", "conversations", "marketing", "sales", "results"]);
    expect(bar(["conversations", "marketing", "site"])).toEqual(["home", "conversations", "marketing", "site", "sales"]);
    expect(bar(["site"])).toEqual(["site", "sales"]);
    expect(bar(["meetings"])).toEqual(["meetings"]);
    expect(bar(["marketing", "meetings"])).toEqual(["marketing", "meetings"]);
  });

  it.each(COMBOS.map((combo) => [combo.join("+") || "(nenhuma)", combo] as const))("%s: barra ⊂ menu, sem repetição, sem Configurações, no máximo 5", (_label, combo) => {
    const areas = buildGlobalNavigation(combo).map((area) => area.key);
    const keysInBar = bar(combo);
    expect(keysInBar.length).toBeLessThanOrEqual(MOBILE_BAR_SLOTS);
    expect(new Set(keysInBar).size).toBe(keysInBar.length);
    expect(keysInBar).not.toContain("settings");
    for (const key of keysInBar) expect(areas).toContain(key);
    // Nenhuma ferramenta sem contrato aparece na barra.
    if (!combo.includes("marketing")) expect(keysInBar).not.toContain("marketing");
    if (!combo.includes("site")) expect(keysInBar).not.toContain("site");
    if (!combo.includes("meetings")) expect(keysInBar).not.toContain("meetings");
    if (!combo.includes("conversations")) expect(keysInBar.filter((key) => key === "home" || key === "conversations" || key === "results")).toEqual([]);
  });
});

describe("Fase 2 — destino ao trocar de espaço de trabalho", () => {
  const areas = buildGlobalNavigation(ALL);
  const to = (path: string, available = areas) => workspaceSwitchHref(`${BASE}${path}`, BASE, "ws-2", available);
  const cases: Array<[string, string]> = [
    ["", "/workspaces/ws-2"],
    ["/conversas", "/workspaces/ws-2/conversas"],
    ["/deals", "/workspaces/ws-2/deals"],
    ["/deals/deal-123", "/workspaces/ws-2/deals"],
    ["/contacts/contact-9/edit", "/workspaces/ws-2/contacts"],
    ["/meetings/agenda", "/workspaces/ws-2/meetings/agenda"],
    ["/meetings/central/meeting-77", "/workspaces/ws-2/meetings/central"],
    ["/production", "/workspaces/ws-2/ideias"],
    ["/campaigns/cmp-1", "/workspaces/ws-2/campaigns"],
    ["/site/pedidos/order-5", "/workspaces/ws-2/site/pedidos"],
    ["/site/oportunidades", "/workspaces/ws-2/site/oportunidades"],
    ["/settings/users", "/workspaces/ws-2/settings"],
    ["/runtime", "/workspaces/ws-2/ideias"],
    ["/onboarding", "/workspaces/ws-2"],
  ];
  it.each(cases)("%s → %s", (path, expected) => {
    expect(to(path)).toBe(expected);
  });

  it("nunca leva o id do workspace anterior, query nem hash", () => {
    for (const [path] of cases) {
      const href = workspaceSwitchHref(`${BASE}${path}?filtro=ganhos#lista`, BASE, "ws-2", areas);
      expect(href.startsWith("/workspaces/ws-2")).toBe(true);
      expect(href).not.toContain("ws-1");
      expect(href).not.toMatch(/[?#]/);
    }
  });

  it("conta sem Conversas: fora de uma área conhecida vai direto à primeira ferramenta (sem redirecionar pela raiz)", () => {
    expect(to("/onboarding", buildGlobalNavigation(["meetings"]))).toBe("/workspaces/ws-2/meetings");
    expect(to("/ideias", buildGlobalNavigation(["site"]))).toBe("/workspaces/ws-2/site/oportunidades");
  });
});

describe("Fase 2 — lista do seletor de espaços", () => {
  const list = [
    { id: "b", name: "Rumo ao Altar" },
    { id: "a", name: "Vorix Works" },
    { id: "c", name: "Casamento São Paulo" },
    { id: "d", name: "aurora Eventos" },
    { id: "e", name: "Ângulo Arquitetura" },
  ];
  it("atual primeiro, os demais em ordem alfabética (acentos e caixa não atrapalham)", () => {
    expect(organizeWorkspaces(list, "a").map((item) => item.name)).toEqual(["Vorix Works", "Ângulo Arquitetura", "aurora Eventos", "Casamento São Paulo", "Rumo ao Altar"]);
  });
  it("busca ignora acento e maiúsculas e não altera a lista original", () => {
    const copy = [...list];
    expect(organizeWorkspaces(list, "a", "SAO").map((item) => item.id)).toEqual(["c"]);
    expect(organizeWorkspaces(list, "a", "angulo").map((item) => item.id)).toEqual(["e"]);
    expect(organizeWorkspaces(list, "a", "nada disso")).toEqual([]);
    expect(organizeWorkspaces(list, "a", "  ").length).toBe(list.length);
    expect(list).toEqual(copy);
  });
  it("busca só aparece com vários espaços", () => {
    expect(WORKSPACE_SEARCH_MIN).toBeGreaterThan(2);
  });
  it("iniciais do selo", () => {
    expect(workspaceInitials("Rumo ao Altar")).toBe("RA");
    expect(workspaceInitials("Vorix Works")).toBe("VW");
    expect(workspaceInitials("CMKV")).toBe("CM");
    expect(workspaceInitials("Casa da Maria")).toBe("CM");
    expect(workspaceInitials("ângulo")).toBe("ÂN");
    expect(workspaceInitials("")).toBe("?");
  });
});
