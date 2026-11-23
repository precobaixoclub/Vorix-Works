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

  it("só Meetings: Início (unificado, Fase 3), Reuniões e Configurações — sem Vendas", () => {
    expect(keys(["meetings"])).toEqual(["home", "meetings", "settings"]);
  });

  it("só Site: Vendas aponta para as oportunidades e propostas do próprio Site", () => {
    const areas = buildGlobalNavigation(["site"]);
    expect(areas.map((area) => area.key)).toEqual(["home", "sales", "site", "settings"]);
    const sales = areas.find((area) => area.key === "sales")!;
    expect(sales.href).toBe("/site/oportunidades");
    // Fase 7: produtos e pedidos também ficam em Vendas (rotas do próprio Site numa conta só com Site).
    expect(sales.items.map((item) => item.href)).toEqual(["/site/oportunidades", "/site/propostas", "/site/products", "/site/pedidos"]);
  });

  it("cada tela de uma área pertence à ferramenta que a área exige (o guarda do servidor continua valendo)", () => {
    const requires: Record<string, SolutionKey | "core" | "sales"> = { home: "core", conversations: "conversations", sales: "sales", marketing: "marketing", site: "site", meetings: "meetings", results: "conversations", settings: "core" };
    for (const area of buildGlobalNavigation(ALL)) {
      for (const href of [area.href, ...area.items.map((item) => item.href)]) {
        const owner = routeOwner(`${BASE}${href}`, BASE);
        if (requires[area.key] === "sales") expect(["conversations", "site"]).toContain(owner);
        // Fase 5: Configurações › Marca e identidade / Redes sociais continuam sendo telas do Marketing
        // (o guarda de solução segue valendo) — só mudaram de lugar no menu.
        else if (area.key === "settings" && (href === "/settings/marca" || href === "/social/integrations")) expect(owner, href).toBe("marketing");
        // Fase 6: Configurações › Atendimento e canais é tela do Conversas.
        else if (area.key === "settings" && href === "/settings/attendance") expect(owner, href).toBe("conversations");
        // Fase 9: Configurações › Reuniões abre as preferências, que continuam sendo tela do Reuniões.
        else if (area.key === "settings" && href === "/meetings/settings") expect(owner, href).toBe("meetings");
        else expect(owner, `${area.key} ${href}`).toBe(requires[area.key]);
      }
    }
  });
});

/** Telas que continuam existindo, mas saíram do menu: abrem por dentro de outro destino (Fases 4 e 5). */
const MOVED: Record<string, { target: string; why: string }> = {
  "/social/compose": { target: "/create", why: "→ encaminha para Criar conteúdo › Publicar conteúdo pronto (mesmo compositor)" },
  "/publish": { target: "/create", why: "→ link \"estúdio avançado\" dentro de Publicar conteúdo pronto (opções exclusivas de TikTok/YouTube/Story)" },
  "/social/calendar": { target: "/calendar", why: "→ encaminha para o Calendário único (mesmo detalhe com as ações por rede)" },
  "/knowledge": { target: "/settings/marca", why: "→ encaminha para Configurações › Marca e identidade (mesmas abas)" },
  // Fase 7: as rotas do Site mostram as MESMAS telas do CRM; com Conversas encaminham para Vendas.
  "/site/products": { target: "/products", why: "→ mesma tela de Produtos (Vendas)" },
  "/site/oportunidades": { target: "/deals", why: "→ mesma tela de Oportunidades (Vendas)" },
  "/site/propostas": { target: "/proposals", why: "→ mesma tela de Propostas (Vendas)" },
};

describe("menu global — nenhuma tela existente se perde", () => {
  it("toda tela dos menus antigos (todas as ferramentas) continua alcançável no menu global", () => {
    const reachable = new Set(buildGlobalNavigation(ALL).flatMap((area) => [area.href, ...area.items.map((item) => item.href)]));
    for (const [key, navigation] of Object.entries(SOLUTION_NAVIGATION)) {
      const old = [navigation.home, ...(navigation.primaryAction ? [navigation.primaryAction] : []), ...(navigation.featured ? [navigation.featured] : []), ...navigation.sections.flatMap((section) => section.items)];
      for (const item of old) {
        const moved = MOVED[item.href];
        if (moved) expect(reachable.has(moved.target), `${item.href} ${moved.why}`).toBe(true);
        else expect(reachable.has(item.href), `${key}: ${item.label} (${item.href})`).toBe(true);
      }
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
    ["/contacts", "conversations"], // Fase 6: Contatos é do atendimento
    ["/products", "sales"],
    ["/proposals", "sales"],
    ["/site/oportunidades", "sales"],
    ["/site/propostas", "sales"],
    ["/ideias", "marketing"],
    ["/production", "marketing"],
    ["/social/compose", "marketing"],
    ["/knowledge", "settings"],
    ["/operations", "marketing"],
    ["/site", "site"],
    ["/site/products", "sales"], // Fase 7: produtos em Vendas
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
    expect(activeGlobalItem(`${BASE}/social/calendar`, BASE, marketing)).toBe("/calendar");
    const site = areas.find((area) => area.key === "site");
    // Fase 7: Pedidos fica em Vendas.
    expect(activeGlobalItem(`${BASE}/site/pedidos`, BASE, areas.find((area) => area.key === "sales"))).toBe("/site/pedidos");
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
    expect(bar(["site"])).toEqual(["home", "site", "sales"]);
    expect(bar(["meetings"])).toEqual(["home", "meetings"]);
    expect(bar(["marketing", "meetings"])).toEqual(["home", "marketing", "meetings"]);
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
    if (!combo.includes("conversations")) expect(keysInBar.filter((key) => key === "conversations" || key === "results")).toEqual([]);
    // Fase 3: o Início unificado existe em toda conta e é sempre o primeiro botão.
    expect(keysInBar[0]).toBe("home");
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
    ["/site/oportunidades", "/workspaces/ws-2/deals"], // Fase 7: a mesma tela do CRM
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

  it("fora de uma área conhecida vai ao Início unificado do outro espaço (Fase 3: existe em toda conta)", () => {
    expect(to("/onboarding", buildGlobalNavigation(["meetings"]))).toBe("/workspaces/ws-2");
    expect(to("/ideias", buildGlobalNavigation(["site"]))).toBe("/workspaces/ws-2");
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

describe("Fase 4 — Marketing com uma porta única de criação", () => {
  const marketing = () => buildGlobalNavigation(["marketing"]).find((area) => area.key === "marketing")!;
  it("menu do Marketing: Criar conteúdo e Revisão no lugar de Publicar/Criar publicação", () => {
    expect(marketing().items.map((item) => item.label)).toEqual(["Bolsão de ideias", "Criar conteúdo", "Revisão", "Conteúdos", "Calendário", "Anúncios"]);
    expect(marketing().items.some((item) => item.href === "/publish" || item.href === "/social/compose")).toBe(false);
  });
  it("compositor e estúdio avançado acendem Criar conteúdo; Em produção continua no Bolsão", () => {
    expect(activeGlobalItem(`${BASE}/social/compose`, BASE, marketing())).toBe("/create");
    expect(activeGlobalItem(`${BASE}/publish`, BASE, marketing())).toBe("/create");
    expect(activeGlobalItem(`${BASE}/production`, BASE, marketing())).toBe("/ideias");
    expect(activeGlobalItem(`${BASE}/review`, BASE, marketing())).toBe("/review");
    expect(activeGlobalArea(`${BASE}/publish`, BASE, buildGlobalNavigation(["marketing"]))).toBe("marketing");
  });
});

describe("Fase 5 — menu definitivo do Marketing", () => {
  const areas = buildGlobalNavigation(ALL);
  const marketing = areas.find((area) => area.key === "marketing")!;
  const settings = areas.find((area) => area.key === "settings")!;
  it("Produção e Publicação em blocos; sem Publicações, Integrações nem Marca no Marketing", () => {
    expect(marketing.items.map((item) => [item.section, item.label])).toEqual([
      ["Produção", "Bolsão de ideias"], ["Produção", "Criar conteúdo"], ["Produção", "Revisão"], ["Produção", "Conteúdos"],
      ["Publicação", "Calendário"], ["Publicação", "Anúncios"],
    ]);
  });
  it("Configurações ganha Marca e identidade e Redes sociais só quando há Marketing", () => {
    // Fase 10: + Meu perfil, Integrações e Plano e cobrança (comuns a todas as contas), em blocos.
    expect(settings.items.map((item) => item.href)).toEqual(["/settings/perfil", "/settings", "/settings/attendance", "/settings/marca", "/meetings/settings", "/settings/integracoes", "/social/integrations", "/settings/plano"]);
    expect(buildGlobalNavigation(["marketing"]).find((area) => area.key === "settings")!.items.map((item) => item.href)).toEqual(["/settings/perfil", "/settings", "/settings/marca", "/settings/integracoes", "/social/integrations", "/settings/plano"]);
    // Sem Marketing: nem Marca e identidade, nem Redes sociais.
    expect(buildGlobalNavigation(["site"]).find((area) => area.key === "settings")!.items.map((item) => item.href)).toEqual(["/settings/perfil", "/settings", "/settings/integracoes", "/settings/plano"]);
  });
  it("rotas antigas e novas acendem o lugar certo", () => {
    const at = (path: string) => activeGlobalArea(`${BASE}${path}`, BASE, areas);
    expect(at("/settings/marca")).toBe("settings");
    expect(at("/knowledge")).toBe("settings");
    expect(at("/social/integrations")).toBe("settings");
    expect(at("/social/calendar")).toBe("marketing");
    expect(at("/calendar")).toBe("marketing");
    expect(activeGlobalItem(`${BASE}/settings/marca`, BASE, settings)).toBe("/settings/marca");
    expect(activeGlobalItem(`${BASE}/knowledge`, BASE, settings)).toBe("/settings/marca");
    expect(activeGlobalItem(`${BASE}/settings/users`, BASE, settings)).toBe("/settings");
    expect(routeOwner(`${BASE}/settings/marca`, BASE)).toBe("marketing");
    expect(routeOwner(`${BASE}/settings/users`, BASE)).toBe("core");
  });
});

describe("Fase 6 — Conversas organizado", () => {
  const areas = buildGlobalNavigation(ALL);
  const conversations = areas.find((area) => area.key === "conversations")!;
  const sales = areas.find((area) => area.key === "sales")!;
  it("Atendimento (Caixa de entrada, Atendimentos, Contatos) e Acompanhamento (Radar)", () => {
    expect(conversations.items.map((item) => [item.section, item.label, item.href])).toEqual([
      ["Atendimento", "Caixa de entrada", "/conversas"],
      ["Atendimento", "Atendimentos", "/kanban"],
      ["Atendimento", "Contatos", "/contacts"],
      ["Acompanhamento", "Radar", "/radar"],
    ]);
  });
  it("Vendas sem Contatos (fica para a Fase 7 a reorganização comercial); nenhuma tela some", () => {
    expect(sales.items.some((item) => item.href === "/contacts")).toBe(false);
    expect(activeGlobalArea(`${BASE}/contacts`, BASE, areas)).toBe("conversations");
    expect(activeGlobalArea(`${BASE}/contacts/c1`, BASE, areas)).toBe("conversations");
    expect(activeGlobalItem(`${BASE}/contacts`, BASE, conversations)).toBe("/contacts");
    expect(activeGlobalArea(`${BASE}/deals`, BASE, areas)).toBe("sales");
  });
  it("Configurações › Atendimento e canais é do Conversas e só aparece com Conversas", () => {
    expect(buildGlobalNavigation(["conversations"]).find((area) => area.key === "settings")!.items.map((item) => item.label)).toEqual(["Meu perfil", "Geral", "Atendimento e canais", "Integrações", "Plano e cobrança"]);
    expect(buildGlobalNavigation(["site"]).find((area) => area.key === "settings")!.items.map((item) => item.label)).not.toContain("Atendimento e canais");
    expect(routeOwner(`${BASE}/settings/attendance`, BASE)).toBe("conversations");
    expect(activeGlobalArea(`${BASE}/settings/attendance`, BASE, areas)).toBe("settings");
  });
});

describe("Fase 7 — Vendas sem duplicidade, por ferramenta e permissão", () => {
  const sales = (available: SolutionKey[], can?: (permission: string) => boolean) => buildGlobalNavigation(available, can).find((area) => area.key === "sales");
  it("Conversas + Site: um item de cada (nada de 'Oportunidades do site' duplicado), em dois blocos", () => {
    expect(sales(["conversations", "site"])!.items.map((item) => [item.section, item.label, item.href])).toEqual([
      ["Gestão comercial", "Oportunidades", "/deals"],
      ["Gestão comercial", "Propostas", "/proposals"],
      ["Gestão comercial", "Atividades", "/tasks"],
      ["Produtos e pedidos", "Produtos", "/products"],
      ["Produtos e pedidos", "Pedidos", "/site/pedidos"],
    ]);
    const labels = sales(["conversations", "site"])!.items.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it("só Conversas: CRM completo, sem Pedidos (não há loja)", () => {
    expect(sales(["conversations"])!.items.map((item) => item.href)).toEqual(["/deals", "/proposals", "/tasks", "/products"]);
  });
  it("só Site: rotas do próprio Site (as do CRM são do Conversas), sem Atividades", () => {
    expect(sales(["site"])!.items.map((item) => item.href)).toEqual(["/site/oportunidades", "/site/propostas", "/site/products", "/site/pedidos"]);
    for (const item of sales(["site"])!.items) expect(routeOwner(`${BASE}${item.href}`, BASE)).toBe("site");
  });
  it("permissões: só aparece o que a pessoa pode ler; sem nada, a área some", () => {
    const only = (...permissions: string[]) => (permission: string) => permissions.includes(permission);
    expect(sales(["conversations", "site"], only("deal:read", "commerce:read"))!.items.map((item) => item.label)).toEqual(["Oportunidades", "Pedidos"]);
    expect(sales(["conversations"], only())).toBeUndefined();
    // sem permissões carregadas, vale a ferramenta contratada (o servidor barra de qualquer forma)
    expect(sales(["conversations"])!.items).toHaveLength(4);
  });
  it("Site fica com a loja (Editor e Analytics); pedidos e produtos acendem Vendas", () => {
    const areas = buildGlobalNavigation(["conversations", "site"]);
    expect(areas.find((area) => area.key === "site")!.items.map((item) => item.label)).toEqual(["Editor do site", "Analytics"]);
    expect(activeGlobalArea(`${BASE}/site/pedidos`, BASE, areas)).toBe("sales");
    expect(activeGlobalArea(`${BASE}/site/products`, BASE, areas)).toBe("sales");
    expect(activeGlobalArea(`${BASE}/site/analytics`, BASE, areas)).toBe("site");
    expect(activeGlobalArea(`${BASE}/site`, BASE, areas)).toBe("site");
  });
});
