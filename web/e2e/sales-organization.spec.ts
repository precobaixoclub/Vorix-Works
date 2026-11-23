import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 7: Vendas. Chromium real, API 100% mockada (nenhum pedido, proposta ou
 * oportunidade real é criado ou alterado). Cobre o menu por ferramenta/permissão sem duplicidade,
 * oportunidades com origem real e vínculo ao pedido do Site, propostas por situação (sem consulta
 * por filtro), atividades por link direto, produtos e pedidos, rotas antigas do Site, Voltar, troca
 * de workspace, erros e responsividade.
 */

const OTHER_ID = "ws-qa-casamento";
const now = Date.now();
const iso = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
const ws = (id: string, name: string) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: {}, createdAt: iso(-500), updatedAt: iso(-500), campaignIds: [], integrations: [], members: [] });
const WORKSPACES = [ws(WORKSPACE_ID, "Vorix Works"), ws(OTHER_ID, "Casamento São Paulo")];

const STAGES = [
  { id: "st-new", pipelineId: "pipe-1", name: "Novo", position: 0, isWon: false, isLost: false, createdAt: iso(-500) },
  { id: "st-prop", pipelineId: "pipe-1", name: "Proposta", position: 1, isWon: false, isLost: false, createdAt: iso(-500) },
  { id: "st-won", pipelineId: "pipe-1", name: "Ganho", position: 2, isWon: true, isLost: false, createdAt: iso(-500) },
];
const deal = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, pipelineId: "pipe-1", stageId: "st-new", title, valueCents: 250_000, currency: "BRL", status: "open", ownerUserId: "user-qa", contactId: "contact-1", customFields: {}, createdAt: iso(-48), updatedAt: iso(-2), lastStageChangedAt: iso(-2), ...over });
const DEALS = [
  deal("deal-site", "Pedido #1042 — loja online", { origin: "site_checkout", customFields: { commerceOrderId: "ord-1", commerceOrderNumber: 1042 } }),
  deal("deal-wa", "Carla — Vestido longo", { origin: "whatsapp", stageId: "st-prop" }),
  deal("deal-manual", "Buffet completo"),
];
const proposal = (id: string, status: string, title: string) => ({ id, tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, dealId: "deal-wa", contactId: "contact-1", title, status, totalCents: 450_000, currency: "BRL", items: [], discountCents: 0, version: 1, createdAt: iso(-30), updatedAt: iso(-3), ...(status === "viewed" ? { viewedAt: iso(-3), lastViewedAt: iso(-3) } : {}) });
const PROPOSALS = [proposal("p-draft", "draft", "Rascunho buffet"), proposal("p-sent", "sent", "Enviada vestido"), proposal("p-viewed", "viewed", "Vista sem resposta"), proposal("p-acc", "accepted", "Aceita festa"), proposal("p-inv", "invoiced", "Faturada"), proposal("p-rej", "rejected", "Recusada")];
const task = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, title, type: "call", status: "pending", dueAt: iso(30), dealId: "deal-wa", createdAt: iso(-50), updatedAt: iso(-50), ...over });
const TASKS = [task("t-late", "Retornar orçamento atrasado", { dueAt: iso(-50) }), task("t-next", "Enviar contrato")];
const ORDERS = [{ id: "ord-1", number: 1042, source: "site", status: "PAID", paymentStatus: "PAID", shippingStatus: "PENDING", stockState: "reserved", customerDisplayName: "Ana Souza", customer: { name: "Ana Souza", email: "", phone: "" }, refundedCents: 0, totalCents: 25_990, subtotalCents: 25_990, discountCents: 0, shippingCents: 0, currency: "BRL", items: [{ id: "it-1", productId: "prod-1", name: "Vestido longo", quantity: 1, unitPriceCents: 25_990, totalCents: 25_990 }], utm: {}, createdAt: iso(-20), paidAt: iso(-19) }];

type Options = { solutions?: string[]; permissions?: readonly string[]; failDeals?: boolean };

async function setup(page: Page, options: Options = {}) {
  const log = { gets: [] as { path: string; ws: string | null; status: string | null }[], moves: [] as unknown[] };
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const workspaceId = url.searchParams.get("workspaceId");
    if (method === "GET") log.gets.push({ path, ws: workspaceId, status: url.searchParams.get("status") });
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    const mine = !workspaceId || workspaceId === WORKSPACE_ID;
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: options.permissions ?? [...OWNER_PERMISSIONS, "order:read"], teams: [], isAccountOwner: true });
    if (path === "/v1/solutions") return ok({ solutions: (options.solutions ?? ["conversations", "site"]).map((key) => ({ key, name: key, internal: false })) });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch) return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));
    if (path === "/v1/pipelines") return ok(mine ? [{ id: "pipe-1", name: "Comercial", isDefault: true }] : []);
    if (/^\/v1\/pipelines\/[^/]+\/stages$/.test(path)) return ok(STAGES);
    if (path === "/v1/deals" && method === "GET") {
      if (options.failDeals) return route.fulfill({ status: 500, json: { ok: false, error: { code: "INTERNAL", message: "Falha simulada nas oportunidades.", recoverable: true } } });
      return ok(mine ? DEALS : []);
    }
    if (/^\/v1\/deals\/[^/]+$/.test(path)) return ok(DEALS.find((item) => item.id === path.split("/")[3]));
    if (/^\/v1\/deals\/[^/]+\/move-stage$/.test(path)) { log.moves.push(request.postDataJSON()); return ok({ ...DEALS[2], stageId: (request.postDataJSON() as { stageId: string }).stageId }); }
    if (/^\/v1\/deals\/[^/]+\/(timeline|commercial)$/.test(path)) return ok(path.endsWith("timeline") ? [] : { items: [], approval: { required: false } });
    if (path === "/v1/proposals" && method === "GET") return ok(mine ? PROPOSALS : []);
    if (/^\/v1\/proposals\/[^/]+\/timeline$/.test(path)) return ok([]);
    if (path === "/v1/tasks" && method === "GET") return ok(mine ? TASKS.filter((item) => !url.searchParams.get("status") || item.status === url.searchParams.get("status")) : []);
    if (path === "/v1/contacts") return ok(mine ? [{ id: "contact-1", name: "Carla Mendes", tags: [], createdAt: iso(-100) }] : []);
    if (path === "/v1/contacts/contact-1") return ok({ id: "contact-1", name: "Carla Mendes", tags: [], createdAt: iso(-100) });
    if (path === "/v1/catalog-bulk/products") return ok({ items: mine ? [{ id: "prod-1", name: "Vestido longo", priceCents: 129_000, currency: "BRL", active: true, details: { siteVisible: true }, createdAt: iso(-100), updatedAt: iso(-10) }] : [], total: mine ? 1 : 0 });
    if (path === "/v1/product-metadata") return ok({ categories: [], brands: [], attributes: [] });
    if (path === "/v1/commerce/orders") return ok(mine ? { orders: ORDERS, total: 1 } : { orders: [], total: 0 });
    if (path === "/v1/commerce/orders/ord-1") return ok({ order: ORDERS[0], payments: [], events: [], shipments: [], returns: [], actions: { canCancel: false, canRefund: false, partialRefund: false, canLabel: false, canManageReturns: false, canRefresh: false } });
    return route.fallback();
  });
  return log;
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;
const nav = (page: Page) => page.locator("nav[aria-label='Menu principal']");

test.describe("Fase 7 — desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("menu de Vendas: Gestão comercial e Produtos e pedidos, sem itens duplicados; Site só com a loja", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/deals`);
    const sales = nav(page).locator("[data-area-items='sales']");
    await expect(sales.locator("[data-section]")).toHaveText(["Gestão comercial", "Produtos e pedidos"]);
    await expect(sales.locator("a")).toHaveText(["Oportunidades", "Propostas", "Atividades", "Produtos", "Pedidos"]);
    await expect(sales.locator("a[aria-current='page']")).toHaveText("Oportunidades");
    await nav(page).getByRole("button", { name: "Mostrar telas de Meu site" }).click();
    await expect(nav(page).locator("[data-area-items='site'] a")).toHaveText(["Editor do site", "Analytics"]);
  });

  test("oportunidades: origem real identificada; detalhe leva ao pedido do Site e ao contato; Voltar funciona", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/deals`);
    await expect(page.locator("[data-origin='site_checkout']").first()).toContainText("Origem: Site (pedido da loja)");
    await expect(page.locator("[data-origin='whatsapp']").first()).toContainText("Origem: Atendimento (WhatsApp)");
    await expect(page.locator("[data-origin]:visible")).toHaveCount(2); // a manual não ganha origem inventada
    await page.goto(`${base()}/deals?dealId=deal-site`);
    // Os dados, vínculos e "Mover etapa" ficam na seção "Dados" do registro (como já era).
    await page.getByRole("navigation", { name: "Seções do registro" }).getByRole("button", { name: "Dados" }).click();
    const order = page.getByTestId("deal-site-order");
    await expect(order).toHaveText("Ver pedido #1042");
    await expect(page.getByRole("link", { name: "Abrir cadastro do contato" })).toHaveAttribute("href", `${base()}/contacts?contactId=contact-1`);
    await order.click();
    await expect(page).toHaveURL(new RegExp(`${base()}/site/pedidos\\?pedido=ord-1$`));
    await expect(nav(page).locator("[data-area='sales']")).toHaveAttribute("data-active", "true");
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}/deals\\?dealId=deal-site$`));
  });

  test("mudança de etapa simulada usa a operação existente", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/deals?dealId=deal-manual`);
    await page.getByRole("navigation", { name: "Seções do registro" }).getByRole("button", { name: "Dados" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Proposta", exact: true }).click();
    await expect.poll(() => log.moves.length).toBe(1);
    expect(log.moves[0]).toMatchObject({ workspaceId: WORKSPACE_ID, stageId: "st-prop" });
  });

  test("propostas: visões pelas situações reais com contagem, sem nova consulta por filtro; link direto", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/proposals`);
    const views = page.getByTestId("proposal-views");
    await expect(views.locator("[data-view]")).toHaveText([/Todas\s*6/, /Em elaboração\s*1/, /Enviadas\s*1/, /Precisam de acompanhamento\s*1/, /Aceitas\s*2/, /Recusadas\s*1/, /Vencidas\s*0/, /Canceladas ou substituídas\s*0/]);
    const before = log.gets.filter((get) => get.path === "/v1/proposals").length;
    await views.locator("[data-view='follow_up']").click();
    await expect(page.getByText("Vista sem resposta").first()).toBeVisible();
    await expect(page.getByText("Enviada vestido")).toHaveCount(0);
    await views.locator("[data-view='accepted']").click();
    await expect(page.getByText("Aceita festa").first()).toBeVisible();
    await expect(page.getByText("Faturada").first()).toBeVisible();
    expect(log.gets.filter((get) => get.path === "/v1/proposals").length).toBe(before); // nenhuma consulta nova
    expect(log.gets.filter((get) => get.path === "/v1/proposals").every((get) => !get.status)).toBe(true);
    await page.goto(`${base()}/proposals?visao=follow_up`);
    await expect(views.locator("[data-view='follow_up']")).toHaveAttribute("aria-selected", "true");
  });

  test("atividades: nome claro e link direto para as atrasadas (atalho do Início)", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/tasks?visao=atrasadas`);
    await expect(page.getByRole("heading", { level: 1, name: "Atividades" })).toBeVisible();
    await expect(page.getByText("Retornar orçamento atrasado")).toBeVisible();
    await expect(page.getByText("Enviar contrato")).toHaveCount(0);
  });

  test("produtos: um catálogo só (o do Site é o mesmo); rota antiga do Site encaminha preservando a busca", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/site/products?q=vestido`);
    await expect(page).toHaveURL(new RegExp(`${base()}/products\\?q=vestido$`));
    await expect(page.getByText("o mesmo usado no site, nas propostas e nas conversas")).toBeVisible();
    await expect(page.getByText("Vestido longo").first()).toBeVisible();
  });

  test("rotas antigas do Site com Conversas: /site/oportunidades e /site/propostas abrem a tela única do CRM (com o registro)", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/ideias`);
    await page.goto(`${base()}/site/oportunidades?dealId=deal-site`);
    await expect(page).toHaveURL(new RegExp(`${base()}/deals\\?dealId=deal-site$`));
    await expect(page.getByRole("dialog", { name: "Pedido #1042 — loja online" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}/ideias$`)); // sem ciclo de redirecionamento
    await page.goto(`${base()}/site/propostas`);
    await expect(page).toHaveURL(new RegExp(`${base()}/proposals$`));
  });

  test("conta só com Site: Vendas usa as rotas do Site (sem Atividades), sem encaminhar para o CRM", async ({ page }) => {
    await setup(page, { solutions: ["site"] });
    await page.goto(`${base()}/site/oportunidades`);
    await expect(page).toHaveURL(new RegExp(`${base()}/site/oportunidades$`));
    const sales = nav(page).locator("[data-area-items='sales']");
    await expect(sales.locator("a")).toHaveText(["Oportunidades", "Propostas", "Produtos", "Pedidos"]);
    await expect(sales.locator("a[aria-current='page']")).toHaveText("Oportunidades");
    await expect(page.getByText("Buffet completo").filter({ visible: true }).first()).toBeVisible();
  });

  test("conta só com Conversas: CRM completo, sem Pedidos", async ({ page }) => {
    await setup(page, { solutions: ["conversations"] });
    await page.goto(`${base()}/deals`);
    await expect(nav(page).locator("[data-area-items='sales'] a")).toHaveText(["Oportunidades", "Propostas", "Atividades", "Produtos"]);
  });

  test("permissão parcial: sem leitura de propostas e pedidos, os itens não aparecem", async ({ page }) => {
    await setup(page, { permissions: OWNER_PERMISSIONS.filter((permission) => permission !== "proposal:read" && permission !== "commerce:read") });
    await page.goto(`${base()}/deals`);
    await expect(nav(page).locator("[data-area-items='sales'] a")).toHaveText(["Oportunidades", "Atividades", "Produtos"]);
  });

  test("pedidos do Site em Vendas", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/site/pedidos?tipo=compras`);
    await expect(page.getByRole("heading", { level: 1, name: "Pedidos" })).toBeVisible();
    await expect(page.getByText("Ana Souza").first()).toBeVisible();
    await expect(nav(page).locator("[data-area-items='sales'] a[aria-current='page']")).toHaveText("Pedidos");
  });

  test("troca de workspace: nenhuma oportunidade da empresa anterior aparece nem é consultada", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/deals`);
    await expect(page.getByText("Buffet completo").filter({ visible: true }).first()).toBeVisible();
    await page.getByTestId("workspace-switcher").click();
    await page.locator(`[data-workspace-option='${OTHER_ID}']`).click();
    await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}/deals$`));
    const switchedAt = log.gets.length;
    await page.waitForTimeout(1500);
    await expect(page.getByText("Buffet completo")).toHaveCount(0);
    expect(log.gets.slice(switchedAt).filter((get) => get.ws && get.ws !== OTHER_ID).map((get) => get.path)).toEqual([]);
  });

  test("erro ao carregar oportunidades é explicado", async ({ page }) => {
    await setup(page, { failDeals: true });
    await page.goto(`${base()}/deals`);
    await expect(page.getByText("Falha simulada nas oportunidades.").first()).toBeVisible();
  });
});

test.describe("Fase 7 — responsividade", () => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: oportunidades, propostas, atividades e pedidos sem rolagem lateral`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await setup(page);
      for (const path of ["/deals", "/proposals", "/tasks", "/site/pedidos?tipo=compras", "/products"]) {
        await page.goto(`${base()}${path}`);
        await page.waitForTimeout(900);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${path} ${width}`).toBe(true);
      }
    });
  }
});

// Capturas para o relatório (só com PHASE7_CAPTURE_DIR; dados 100% simulados).
test.describe("capturas da Fase 7", () => {
  test.skip(!process.env.PHASE7_CAPTURE_DIR, "defina PHASE7_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["oportunidades-desktop", "/deals", 1440, "dark"],
    ["oportunidade-detalhe-desktop", "/deals?dealId=deal-site", 1440, "light"],
    ["propostas-desktop", "/proposals", 1440, "light"],
    ["oportunidades-celular", "/deals", 390, "dark"],
    ["propostas-celular", "/proposals?visao=follow_up", 390, "light"],
    ["pedidos-desktop", "/site/pedidos?tipo=compras", 1440, "dark"],
  ] as const;
  for (const [name, path, width, theme] of shots) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
      await setup(page);
      await page.goto(`${base()}${path}`);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${process.env.PHASE7_CAPTURE_DIR}/${name}.png` });
    });
  }
});
