import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";
import { openSiteSection } from "./fixtures/site-editor-nav";
import { initialSiteSnapshot } from "../features/sites/customization";
import { SITE_EDITOR_SECTIONS } from "../features/sites/editor-groups";
import type { SiteSnapshot, TenantSite } from "../features/sites/types";

/**
 * Reorganização de UX — Fase 8: editor de sites e loja. Chromium real, API 100% simulada: nenhuma
 * publicação real, nenhuma troca de domínio, nenhum pedido. Publicar só é testado até a confirmação
 * (cancelada) — o mock registra qualquer chamada de publicação e os testes exigem que não haja.
 */

const OTHER_ID = "ws-qa-casamento";
const iso = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const ws = (id: string, name: string) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: {}, createdAt: iso(-500), updatedAt: iso(-500), campaignIds: [], integrations: [], members: [] });
const WORKSPACES = [ws(WORKSPACE_ID, "Vorix Works"), ws(OTHER_ID, "Casamento São Paulo")];

const COMMERCE = {
  settings: {
    mode: "SHOWCASE", showcaseCta: "LEARN_MORE", createOpportunityFromWhatsapp: true, cartLead: false, form: { openAttendance: true, createOpportunity: false }, notifyTeam: false, outOfStock: "ASK_AVAILABILITY",
    checkout: { reservationMinutes: 30, requireDocument: false, orderCrm: "CONTACT_ONLY", payment: { provider: "NONE", pix: false, card: false }, shipping: { handlingDays: 1, regions: [], pickup: { enabled: false, address: "", instructions: "", days: 0 }, freeShipping: { enabled: false, minSubtotalCents: 0, days: 0 }, fixed: { enabled: false, label: "", priceCents: 0, days: 0 }, table: [], provider: { key: "NONE" } } },
  },
  rules: [],
  baseVersion: "v1",
};

type Options = { solutions?: string[]; permissions?: readonly string[]; site?: "none" | "draft" | "published" | "pending"; failSites?: boolean };

function makeSite(kind: Options["site"], workspaceId = WORKSPACE_ID): TenantSite | undefined {
  if (kind === "none") return undefined;
  const draft: SiteSnapshot = initialSiteSnapshot(workspaceId === WORKSPACE_ID ? "Loja Vorix QA" : "Casamento QA", "nexus");
  const site: TenantSite = { id: `site-${workspaceId}`, workspaceId, tenantId: TENANT_ID, slug: workspaceId === WORKSPACE_ID ? "loja-vorix-qa" : "casamento-qa", draft, revision: 3, updatedAt: iso(-1) };
  if (kind === "published" || kind === "pending") {
    const published = structuredClone(draft);
    site.published = published;
    site.publishedAt = "2026-11-20T12:00:00.000Z";
    if (kind === "pending") site.draft = { ...draft, content: { ...draft.content, name: "Loja Vorix QA — nova coleção" } };
  }
  return site;
}

async function setup(page: Page, options: Options = {}) {
  const log = { writes: [] as { method: string; path: string; body?: unknown }[], gets: [] as { path: string; ws: string | null }[] };
  const sites = new Map<string, TenantSite | undefined>([[WORKSPACE_ID, makeSite(options.site ?? "pending")], [OTHER_ID, makeSite("published", OTHER_ID)]]);
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const workspaceId = url.searchParams.get("workspaceId");
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (method === "GET") log.gets.push({ path, ws: workspaceId });
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: options.permissions ?? [...OWNER_PERMISSIONS, "order:read"], teams: [], isAccountOwner: true });
    if (path === "/v1/solutions") return ok({ solutions: (options.solutions ?? ["conversations", "site", "marketing"]).map((key) => ({ key, name: key, internal: false })) });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch) return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));
    if (path.startsWith("/v1/sites")) {
      if (method !== "GET") log.writes.push({ method, path, body: request.postDataJSON?.() ?? undefined });
      if (path === "/v1/sites" && method === "GET") {
        if (options.failSites) return route.fulfill({ status: 500, json: { ok: false, error: { code: "INTERNAL", message: "Falha simulada ao carregar o site.", recoverable: true } } });
        const site = sites.get(workspaceId ?? WORKSPACE_ID);
        return ok({ sites: site ? [site] : [], publicBaseDomain: "vorix.site", customDomainTarget: "sites.vorix.site" });
      }
      const site = [...sites.values()].find((item) => item && path.startsWith(`/v1/sites/${item.id}`));
      if (!site) return route.fulfill({ status: 404, json: { ok: false, error: { code: "NOT_FOUND", message: "Site não encontrado." } } });
      if (path.endsWith("/preview")) return ok({ id: site.id, slug: site.slug, content: site.draft.content, theme: site.draft.theme, layoutConfig: site.draft.layoutConfig, products: [], categories: [], brands: [], commerceEnabled: false });
      if (path.endsWith("/commerce-draft")) return ok(COMMERCE);
      if (path.endsWith("/domains")) return ok([]);
      if (path.endsWith("/sales-intents")) return ok([]);
      if (path.endsWith("/commerce/checkout-status")) return ok({ ready: false, missing: ["payment"], sandboxAllowed: false, credentials: { MERCADO_PAGO: { connected: false }, MELHOR_ENVIO: { connected: false } } });
      if (path.endsWith("/template-packages")) return ok([]);
      if (path === `/v1/sites/${site.id}` && method === "PUT") {
        const body = request.postDataJSON() as { draft: SiteSnapshot };
        const saved = { ...site, draft: body.draft, revision: site.revision + 1, updatedAt: new Date().toISOString() };
        sites.set(site.workspaceId, saved);
        return ok(saved);
      }
      if (path.endsWith("/publish")) return route.fulfill({ status: 500, json: { ok: false, error: { code: "TEST_GUARD", message: "Publicação bloqueada no teste." } } });
      return ok({});
    }
    return route.fallback();
  });
  return { log, site: () => sites.get(WORKSPACE_ID), publishes: () => log.writes.filter((write) => write.path.endsWith("/publish")) };
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;
const groups = (page: Page) => page.getByRole("navigation", { name: "Grupos do editor" });
const sectionNav = (page: Page) => page.getByRole("navigation", { name: "Navegação da seção" });
const activeGroup = (page: Page) => groups(page).locator("button[aria-current='true']");

test.describe("Fase 8 — editor do site organizado", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("abre em Modelo com os cinco grupos, nome do site, workspace e estado da publicação", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/site`);
    await expect(groups(page).getByRole("button")).toHaveText(["Modelo", "Aparência", "Conteúdo", "Vendas", "Publicação e domínio"]);
    await expect(activeGroup(page)).toHaveText("Modelo");
    await expect(page.getByText("Loja Vorix QA — nova coleção · Vorix Works")).toBeVisible();
    await expect(page.getByText("Site publicado", { exact: true })).toBeVisible();
    await expect(page.getByText("Alterações não publicadas", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pré-visualizar", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Publicar site", exact: true })).toBeEnabled();
    await expect(page.getByTestId("site-guide-model")).toContainText("Visualizar não muda nada");
  });

  test("modo foco: o menu global abre recolhido no editor (e expande se a pessoa pedir)", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/site`);
    const toggle = page.getByRole("button", { name: "Expandir menu", exact: true });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("button", { name: "Recolher menu", exact: true })).toBeVisible();
  });

  test("links antigos ?section= abrem a mesma seção, agora dentro do grupo certo", async ({ page }) => {
    await setup(page);
    for (const item of SITE_EDITOR_SECTIONS) {
      await page.goto(`${base()}/site?section=${item.value}`);
      await expect(activeGroup(page), item.value).toHaveAttribute("data-group", item.group);
      if (SITE_EDITOR_SECTIONS.filter((entry) => entry.group === item.group).length > 1) await expect(sectionNav(page).locator("button[aria-current='page']"), item.value).toHaveText(item.label);
    }
  });

  test("tocar num grupo abre a primeira seção dele e atualiza o endereço; Voltar sai do editor", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}`);
    await page.goto(`${base()}/site`);
    await groups(page).getByRole("button", { name: "Conteúdo", exact: true }).click();
    await expect(page).toHaveURL(/section=banners/);
    await expect(sectionNav(page).getByRole("button")).toHaveText(["Banners e destaques", "Seções da página inicial", "Páginas", "Cabeçalho e menu", "Rodapé", "Contato e redes sociais", "Textos do site"]);
    await openSiteSection(page, "Rodapé");
    await expect(page).toHaveURL(/section=rodape/);
    await openSiteSection(page, "Endereço e domínio");
    await expect(page).toHaveURL(/section=dominio/);
    // A troca de seção substitui o endereço (não empilha histórico): Voltar sai do editor.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}$`));
  });

  test("modelos: Visualizar não altera nada; Personalizar muda só o rascunho; Usar este modelo pede confirmação e não publica sem ela", async ({ page }) => {
    const state = await setup(page);
    await page.goto(`${base()}/site?section=modelos`);
    await page.getByRole("button", { name: "Visualizar Aura", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    expect(state.log.writes).toEqual([]);
    expect(state.site()?.draft.theme.template).toBe("nexus");

    await page.getByTestId("template-card-aura").getByRole("button", { name: "Usar este modelo", exact: true }).click();
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(confirm).toContainText("Publicar o modelo Aura?");
    await expect(confirm).toContainText("Seus textos e imagens são mantidos.");
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    expect(state.publishes()).toEqual([]);

    await page.getByTestId("template-card-aura").getByRole("button", { name: "Personalizar Aura", exact: true }).click();
    await expect(page).toHaveURL(/section=aparencia/);
    await expect.poll(() => state.site()?.draft.theme.template, { timeout: 8000 }).toBe("aura");
    expect(state.site()?.draft.content.name).toBe("Loja Vorix QA — nova coleção");
    expect(state.site()?.published?.theme.template).toBe("nexus");
    expect(state.publishes()).toEqual([]);
  });

  test("aparência: deixa claro que é a identidade do site, separada de Marca e identidade", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/site?section=aparencia`);
    const guide = page.getByTestId("site-guide-appearance");
    await expect(guide).toContainText("valem só para o site");
    await expect(guide.getByRole("link", { name: "Configurações › Marca e identidade" })).toHaveAttribute("href", `${base()}/settings/marca`);
  });

  test("aparência sem Marketing: não oferece link para uma tela que a conta não tem", async ({ page }) => {
    await setup(page, { solutions: ["site"] });
    await page.goto(`${base()}/site?section=geral`);
    await expect(page.getByTestId("site-guide-appearance")).toContainText("Nada aqui altera outras ferramentas");
    await expect(page.getByTestId("site-guide-appearance").getByRole("link")).toHaveCount(0);
  });

  test("autosave continua: editar o nome salva o rascunho sozinho, sem publicar e sem botão Salvar novo", async ({ page }) => {
    const state = await setup(page);
    await page.goto(`${base()}/site?section=geral`);
    await page.getByLabel("Nome do site", { exact: true }).fill("Loja Vorix QA — verão");
    await expect.poll(() => state.site()?.draft.content.name, { timeout: 8000 }).toBe("Loja Vorix QA — verão");
    await expect(page.getByText("Rascunho salvo automaticamente", { exact: true })).toBeVisible();
    await openSiteSection(page, "Rodapé");
    await openSiteSection(page, "Sua marca e logo");
    await expect(page.getByLabel("Nome do site", { exact: true })).toHaveValue("Loja Vorix QA — verão");
    expect(state.publishes()).toEqual([]);
    await expect(page.getByRole("button", { name: /^Salvar/ })).toHaveCount(0);
  });

  test("vendas com Conversas: atalhos para Produtos e Pedidos de Vendas, sem recriar listas", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/site?section=loja`);
    const guide = page.getByTestId("site-guide-sales");
    await expect(guide.getByRole("link", { name: "Produtos" })).toHaveAttribute("href", `${base()}/products`);
    await expect(guide.getByRole("link", { name: "Pedidos" })).toHaveAttribute("href", `${base()}/site/pedidos`);
    await expect(sectionNav(page).getByRole("button")).toHaveText(["Vitrine de produtos", "Como vender pelo site", "Regras comerciais"]);
  });

  test("vendas numa conta só com Site: Produtos usa a rota do Site", async ({ page }) => {
    await setup(page, { solutions: ["site"] });
    await page.goto(`${base()}/site?section=catalogo`);
    await expect(page.getByTestId("site-guide-sales").getByRole("link", { name: "Produtos" })).toHaveAttribute("href", `${base()}/site/products`);
  });

  test("vendas sem permissão de produtos e pedidos: atalhos não aparecem", async ({ page }) => {
    await setup(page, { permissions: OWNER_PERMISSIONS.filter((permission) => !["product:read", "order:read", "commerce:read"].includes(permission)) });
    await page.goto(`${base()}/site?section=regras`);
    await expect(page.getByTestId("site-guide-sales")).toBeVisible();
    await expect(page.getByTestId("site-guide-sales").getByRole("link")).toHaveCount(0);
  });

  test("publicação: resumo com no ar, alterações pendentes, endereço e SEO; Ajustar leva à seção; Prévia ≠ Publicar", async ({ page }) => {
    const state = await setup(page);
    await page.goto(`${base()}/site?section=dominio`);
    const summary = page.getByTestId("site-publication-summary");
    await expect(summary.locator("[data-item='published']")).toHaveAttribute("data-ok", "true");
    await expect(summary.locator("[data-item='changes']")).toHaveAttribute("data-ok", "false");
    await expect(summary.locator("[data-item='address']")).toContainText("loja-vorix-qa.vorix.site");
    await expect(summary.locator("[data-item='seo']")).toHaveAttribute("data-ok", "false");
    await summary.locator("[data-item='seo']").getByRole("button", { name: "Ajustar" }).click();
    await expect(page).toHaveURL(/section=seo/);

    await summary.getByRole("button", { name: "Ver prévia" }).click();
    await expect(page.getByRole("dialog", { name: "Prévia do seu site" })).toBeVisible();
    await expect(page.getByText("Prévia do rascunho. Nada muda no site publicado até você publicar.")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(state.publishes()).toEqual([]);

    await summary.getByRole("button", { name: "Revisar e publicar" }).click();
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    // Modelo atual (Nexus) usa a confirmação de modelo: explica que os visitantes passam a ver o rascunho.
    await expect(confirm).toContainText("Publicar o modelo Nexus?");
    await expect(confirm).toContainText("Os visitantes passarão a ver o site");
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    expect(state.publishes()).toEqual([]);
  });

  test("site ainda não publicado: resumo diz que só você vê a prévia", async ({ page }) => {
    await setup(page, { site: "draft" });
    await page.goto(`${base()}/site?section=seo`);
    const summary = page.getByTestId("site-publication-summary");
    await expect(summary.locator("[data-item='published']")).toContainText("Ainda não publicado");
    await expect(summary.getByRole("button", { name: "Revisar e publicar" })).toBeEnabled();
    await expect(summary.getByRole("link", { name: "Abrir site publicado" })).toHaveCount(0);
  });

  test("primeiro acesso: sem site, mostra a criação com modelos (sem grupos de edição vazios)", async ({ page }) => {
    await setup(page, { site: "none" });
    await page.goto(`${base()}/site`);
    await expect(page.getByLabel("Endereço do site", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Criar meu site com/ })).toBeVisible();
    await expect(groups(page)).toHaveCount(0);
  });

  test("somente leitura: navega e vê a prévia, mas não edita nem publica", async ({ page }) => {
    const state = await setup(page, { permissions: OWNER_PERMISSIONS.filter((permission) => !["site:manage", "site:publish", "commerce:manage"].includes(permission)) });
    await page.goto(`${base()}/site?section=geral`);
    await expect(page.getByText("Seu perfil permite visualizar.")).toBeVisible();
    await expect(page.getByLabel("Nome do site", { exact: true })).toBeDisabled();
    await openSiteSection(page, "Endereço e domínio");
    const summary = page.getByTestId("site-publication-summary");
    await expect(summary.getByRole("button", { name: "Revisar e publicar" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Publicar site", exact: true })).toBeDisabled();
    await summary.getByRole("button", { name: "Ver prévia" }).click();
    await expect(page.getByRole("dialog", { name: "Prévia do seu site" })).toBeVisible();
    expect(state.log.writes).toEqual([]);
  });

  test("erro ao carregar o site é explicado com Tentar novamente", async ({ page }) => {
    await setup(page, { failSites: true });
    await page.goto(`${base()}/site`);
    await expect(page.getByText("Falha simulada ao carregar o site.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
  });

  test("troca de workspace: o editor mostra o site do novo workspace e não consulta o anterior", async ({ page }) => {
    const state = await setup(page);
    await page.goto(`${base()}/site?section=geral`);
    await expect(page.getByLabel("Nome do site", { exact: true })).toHaveValue("Loja Vorix QA — nova coleção");
    await page.getByTestId("workspace-switcher").click();
    await page.locator(`[data-workspace-option='${OTHER_ID}']`).click();
    await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}/site`));
    const switchedAt = state.log.gets.length;
    await expect(page.getByText("Casamento QA · Casamento São Paulo")).toBeVisible();
    await page.waitForTimeout(1200);
    expect(state.log.gets.slice(switchedAt).filter((get) => get.path.startsWith("/v1/sites") && get.ws && get.ws !== OTHER_ID).map((get) => get.path)).toEqual([]);
    expect(state.publishes()).toEqual([]);
  });
});

test.describe("Fase 8 — responsividade", () => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: grupos, guias e resumo sem rolagem lateral (claro e escuro)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await setup(page);
      for (const theme of ["light", "dark"]) {
        await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
        for (const section of ["modelos", "aparencia", "banners", "loja", "dominio"]) {
          await page.goto(`${base()}/site?section=${section}`);
          await expect(groups(page)).toBeVisible();
          await page.waitForTimeout(500);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${section} ${width} ${theme}`).toBe(true);
        }
      }
      // Os cinco grupos continuam alcançáveis (rolagem horizontal da própria faixa, não da página).
      for (const name of ["Modelo", "Publicação e domínio"]) {
        const button = groups(page).getByRole("button", { name, exact: true });
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeVisible();
      }
    });
  }
});

// Capturas para o relatório (só com PHASE8_CAPTURE_DIR; dados 100% simulados).
test.describe("capturas da Fase 8", () => {
  test.skip(!process.env.PHASE8_CAPTURE_DIR, "defina PHASE8_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["modelos-desktop", "modelos", 1440, "light"],
    ["aparencia-desktop", "aparencia", 1440, "dark"],
    ["conteudo-desktop", "banners", 1440, "light"],
    ["vendas-desktop", "loja", 1440, "dark"],
    ["publicacao-desktop", "dominio", 1440, "light"],
    ["publicacao-tablet", "dominio", 768, "dark"],
    ["conteudo-tablet", "secoes", 1024, "light"],
    ["modelos-celular", "modelos", 390, "dark"],
    ["vendas-celular", "catalogo", 390, "light"],
    ["publicacao-celular", "seo", 360, "light"],
  ] as const;
  for (const [name, section, width, theme] of shots) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
      await setup(page);
      await page.goto(`${base()}/site?section=${section}`);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${process.env.PHASE8_CAPTURE_DIR}/${name}.png` });
    });
  }
});
