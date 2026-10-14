import { describe, expect, it } from "vitest";
import { SETTINGS_NAV, SOLUTION_NAVIGATION, buildRouteLabels, isBackstagePath } from "../components/workspace-navigation";
import { SOLUTION_HOME_PATH, isRouteBlocked, resolveActiveSolution, routeOwner } from "../lib/solutions";

const BASE = "/workspaces/ws-1";

describe("routeOwner", () => {
  it("classifica as telas do Vorix Conversas", () => {
    for (const path of ["", "/conversas", "/kanban", "/contacts", "/deals", "/tasks", "/proposals", "/results", "/deals/abc"]) {
      expect(routeOwner(`${BASE}${path}`, BASE)).toBe("conversations");
    }
  });

  it("classifica as telas do Vorix Marketing, inclusive o bastidor", () => {
    for (const path of ["/create", "/production", "/campaigns", "/calendar", "/publish", "/meta-ads", "/knowledge", "/planning", "/operations", "/campaigns/123"]) {
      expect(routeOwner(`${BASE}${path}`, BASE)).toBe("marketing");
    }
  });

  it("configurações, integrações e onboarding são do Core", () => {
    for (const path of ["/settings", "/settings/users", "/settings/plano", "/connections", "/onboarding"]) {
      expect(routeOwner(`${BASE}${path}`, BASE)).toBe("core");
    }
  });
});

describe("isRouteBlocked", () => {
  it("bloqueia Marketing para conta só com Conversas", () => {
    expect(isRouteBlocked("marketing", ["conversations"])).toBe(true);
    expect(isRouteBlocked("conversations", ["conversations"])).toBe(false);
    expect(isRouteBlocked("core", ["conversations"])).toBe(false);
  });

  it("libera Marketing para conta com acesso interno", () => {
    expect(isRouteBlocked("marketing", ["conversations", "marketing"])).toBe(false);
  });
});

describe("resolveActiveSolution", () => {
  it("usa a solução dona da rota", () => {
    expect(resolveActiveSolution({ owner: "marketing", available: ["conversations", "marketing"] })).toBe("marketing");
    expect(resolveActiveSolution({ owner: "conversations", available: ["conversations", "marketing"] })).toBe("conversations");
  });

  it("nunca ativa uma solução sem acesso", () => {
    expect(resolveActiveSolution({ owner: "marketing", available: ["conversations"] })).toBe("conversations");
    expect(resolveActiveSolution({ owner: "core", available: ["conversations"], remembered: "marketing" })).toBe("conversations");
  });

  it("em telas do Core mantém a última solução visitada", () => {
    expect(resolveActiveSolution({ owner: "core", available: ["conversations", "marketing"], remembered: "marketing" })).toBe("marketing");
    expect(resolveActiveSolution({ owner: "core", available: ["conversations", "marketing"] })).toBe("conversations");
  });
});

describe("navegação por solução", () => {
  const hrefsOf = (key: "conversations" | "meetings" | "marketing") => {
    const nav = SOLUTION_NAVIGATION[key];
    return [nav.home, ...(nav.primaryAction ? [nav.primaryAction] : []), ...nav.sections.flatMap((section) => section.items), ...nav.backstage, ...nav.mobilePrimary, ...nav.mobileMenu.flatMap((section) => section.items)].map((item) => item.href);
  };
  const settingsHrefs = SETTINGS_NAV.map((item) => item.href);

  it("o menu do Conversas não tem nenhuma tela do Marketing", () => {
    for (const href of hrefsOf("conversations")) {
      if (settingsHrefs.includes(href)) continue;
      expect(routeOwner(`${BASE}${href}`, BASE), href).toBe("conversations");
    }
    expect(SOLUTION_NAVIGATION.conversations.primaryAction).toBeUndefined();
    expect(SOLUTION_NAVIGATION.conversations.backstage).toHaveLength(0);
  });

  it("o menu do Marketing não tem nenhuma tela do Conversas", () => {
    for (const href of hrefsOf("marketing")) {
      if (settingsHrefs.includes(href)) continue;
      expect(routeOwner(`${BASE}${href}`, BASE), href).toBe("marketing");
    }
  });

  it("o menu do Meetings só tem telas do Meetings (nada do Conversas)", () => {
    for (const href of hrefsOf("meetings")) {
      if (settingsHrefs.includes(href)) continue;
      expect(routeOwner(`${BASE}${href}`, BASE), href).toBe("meetings");
    }
  });

  it("Meetings funciona sem Conversas: rotas do Conversas bloqueadas, Meetings livre", () => {
    expect(routeOwner(`${BASE}/meetings/central/meeting-1`, BASE)).toBe("meetings");
    expect(isRouteBlocked("conversations", ["meetings"])).toBe(true);
    expect(isRouteBlocked("meetings", ["meetings"])).toBe(false);
    expect(isRouteBlocked("meetings", ["conversations"])).toBe(true);
    expect(resolveActiveSolution({ owner: "core", available: ["meetings"] })).toBe("meetings");
  });

  it("a home de cada solução pertence à própria solução", () => {
    expect(routeOwner(`${BASE}${SOLUTION_HOME_PATH.conversations}`, BASE)).toBe("conversations");
    expect(routeOwner(`${BASE}${SOLUTION_HOME_PATH.marketing}`, BASE)).toBe("marketing");
    expect(routeOwner(`${BASE}${SOLUTION_HOME_PATH.meetings}`, BASE)).toBe("meetings");
  });

  it("bastidor e rótulos de breadcrumb continuam resolvendo", () => {
    expect(isBackstagePath(`${BASE}/planning`, BASE)).toBe(true);
    expect(isBackstagePath(`${BASE}/conversas`, BASE)).toBe(false);
    const labels = buildRouteLabels(BASE, ["conversations"]);
    expect(labels[`${BASE}/conversas`]).toBe("Conversas");
    expect(labels[`${BASE}/settings`]).toBe("Configurações");
    // Sem a solução, o breadcrumb não revela nem o nome da tela do Marketing.
    expect(labels[`${BASE}/production`]).toBeUndefined();
    expect(buildRouteLabels(BASE, ["conversations", "marketing"])[`${BASE}/production`]).toBe("Produção");
  });
});
