import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 12: Resultados unificados. API 100% simulada. Verifica fontes por
 * seção, consultas sob demanda, períodos coerentes, estados distintos (sem permissão, erro, vazio,
 * não contratado) e isolamento por workspace.
 */

const OTHER_ID = "ws-qa-casamento";
const iso = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const ws = (id: string, name: string) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: {}, createdAt: iso(-500), updatedAt: iso(-5), campaignIds: [], integrations: [], members: [] });
const WORKSPACES = [ws(WORKSPACE_ID, "Vorix Works"), ws(OTHER_ID, "Casamento São Paulo")];

const inbox = (received: number) => ({ receivedCount: received, openCount: 4, pendingCount: 2, resolvedCount: received - 6, backlogCount: 3, avgFirstResponseSeconds: 420, aiResolvedMessageCount: 10, humanResolvedMessageCount: 30, volumeByAgent: [], closingReasons: [] });
const commercial = (won: number) => ({ dealsCreatedCount: 18, openPipelineValueCents: 4_500_000, wonCount: won, wonValueCents: 1_290_000, lostCount: 2, conversionRate: 0.3, avgTicketCents: 258_000, proposalsSentCount: 6, proposalsAcceptedCount: 3, dealsWithoutNextActionCount: 1, stageAging: [], lossReasons: [], revenueByOrigin: [] });
const siteReport = (empty = false) => ({
  range: { from: "2026-10-25", to: "2026-11-23", timezone: "America/Sao_Paulo", start: iso(-700), end: iso(0) }, scope: "workspace",
  metrics: empty ? {} : { SITE_VIEW: { count: 240, visitors: 96 }, INTENT: { count: 7, visitors: 7 } }, revenue: {}, funnel: [],
  conversions: empty ? [] : [{ key: "view_to_intent", label: "Visita → intenção", numerator: 7, denominator: 96, rate: 7.29 }],
  series: [], products: [], acquisition: [], productTotal: 0, acquisitionTotal: 0, leads: [], empty, futureData: false, notes: empty ? [] : ["Visitantes são identificadores únicos por site."],
});

type Options = { solutions?: string[]; permissions?: readonly string[]; failCommercial?: boolean; siteEmpty?: boolean };

async function setup(page: Page, options: Options = {}) {
  const log = { gets: [] as { path: string; ws: string | null; search: string }[] };
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const workspaceId = url.searchParams.get("workspaceId");
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (request.method() === "GET") log.gets.push({ path, ws: workspaceId, search: url.search });
    const mine = !workspaceId || workspaceId === WORKSPACE_ID;
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: options.permissions ?? [...OWNER_PERMISSIONS, "analytics:read", "site:read", "commerce:read", "marketing:social_read"], teams: [], isAccountOwner: true });
    if (path === "/v1/solutions") return ok({ solutions: (options.solutions ?? ["conversations", "marketing", "site", "meetings"]).map((key) => ({ key, name: key, internal: false })) });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch && wsMatch[1] !== "credits") return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));
    if (path === "/v1/inbox/metrics") return ok(inbox(mine ? 42 : 9));
    if (path === "/v1/commercial-metrics") return options.failCommercial ? route.fulfill({ status: 500, json: { ok: false, error: { code: "INTERNAL", message: "Falha simulada nas métricas comerciais.", recoverable: true } } }) : ok(commercial(mine ? 5 : 1));
    if (path === "/v1/pipelines") return ok([{ id: "pipe-1", name: "Comercial", isDefault: true }]);
    if (path === "/v1/social/posts") return ok({ posts: [] });
    if (path === "/v1/tiktok/posts" || path === "/v1/youtube/posts") return ok([]);
    if (path === "/v1/analytics/publication" || path === "/v1/analytics/providers") return ok({ rows: [], series: { points: [] } });
    if (path === "/v1/analytics/alerts") return ok([]);
    if (path === "/v1/site-analytics") return ok(siteReport(options.siteEmpty));
    if (path === "/v1/meetings/dashboard") return ok({ meetingsToday: mine ? 3 : 0, meetingsThisWeek: mine ? 8 : 1, recordingNow: 0, processing: 1, recordedSeconds: 36_000, transcriptsAvailable: 12, limits: { maxConcurrentRecordings: 2, monthlyRecordingMinutes: 600, meetingRetentionDays: 90, maxStorageBytes: 1e10 }, realRecordingEnabled: true });
    return route.fallback();
  });
  return log;
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;
const card = (page: Page, key: string) => page.getByTestId(`results-card-${key}`);
const count = (log: Awaited<ReturnType<typeof setup>>, path: string) => log.gets.filter((get) => get.path === path).length;

test.describe("Fase 12 — Resultados", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("visão geral: um cartão por ferramenta, com a própria fonte e período, sem misturar números", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/results`);
    await expect(page.getByTestId("results-overview").locator("> section")).toHaveCount(5);
    await expect(card(page, "attendance")).toContainText("42");
    await expect(card(page, "commercial")).toContainText("não é pagamento recebido");
    await expect(card(page, "marketing")).toContainText("Publicações orgânicas");
    await expect(card(page, "site")).toContainText("96");
    await expect(card(page, "meetings")).toContainText("Hoje e esta semana");
    await expect(card(page, "meetings")).toContainText("Total acumulado");
    await expect(page.getByText("Resultado por área")).toHaveCount(0);
    // A visão geral não dispara os relatórios detalhados.
    expect(count(log, "/v1/analytics/providers") + count(log, "/v1/analytics/alerts") + count(log, "/v1/pipelines")).toBe(0);
    // Filtros que não afetam a visão geral não aparecem.
    await expect(page.getByLabel("Origem")).toHaveCount(0);
    await expect(page.getByLabel("Período")).toBeVisible();
  });

  test("comercial: seção no endereço, filtros próprios e relatórios completos preservados; Voltar sai", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}`);
    await page.goto(`${base()}/results`);
    await card(page, "commercial").getByRole("button", { name: "Ver comercial" }).click();
    await expect(page).toHaveURL(/secao=commercial/);
    await expect(page.getByTestId("results-section-commercial")).toContainText("Oportunidades criadas");
    await expect(page.getByText("Valor ganho por origem")).toBeVisible();
    await expect(page.getByLabel("Origem")).toBeVisible();
    await expect(page.getByTestId("results-details").getByRole("link", { name: "Desempenho comercial" })).toHaveAttribute("href", `${base()}/performance`);
    await expect(page.getByTestId("results-details").getByRole("link", { name: "Relatórios" })).toHaveAttribute("href", `${base()}/reports`);
    expect(count(log, "/v1/pipelines")).toBeGreaterThan(0);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}$`));
  });

  test("períodos: 90 dias vai para o Marketing como intervalo real (antes quebrava) e para o Site como 'custom'", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/results?secao=marketing`);
    await page.getByLabel("Período").click();
    await page.getByRole("option", { name: "Últimos 90 dias" }).click();
    await expect.poll(() => log.gets.some((get) => get.path === "/v1/analytics/publication" && get.search.includes("period=custom%3A"))).toBe(true);
    expect(log.gets.some((get) => get.search.includes("last_90_days"))).toBe(false);
    await page.goto(`${base()}/results?secao=site`);
    await page.getByLabel("Período").click();
    await page.getByRole("option", { name: "Últimos 7 dias" }).click();
    await expect.poll(() => log.gets.some((get) => get.path === "/v1/site-analytics" && get.search.includes("period=7d"))).toBe(true);
    await expect(page.getByTestId("site-conversions")).toContainText("Visita → intenção");
  });

  test("reuniões: período fixo explicado e sem filtro de período", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/results?secao=meetings`);
    await expect(page.getByTestId("meetings-fixed-period")).toBeVisible();
    await expect(page.getByLabel("Período")).toHaveCount(0);
  });

  test("sem permissão é diferente de não contratado: o cartão diz e nada é consultado", async ({ page }) => {
    const log = await setup(page, { permissions: OWNER_PERMISSIONS.filter((permission) => permission !== "analytics:read") });
    await page.goto(`${base()}/results`);
    await expect(card(page, "site").locator("[data-state='no-permission']")).toBeVisible();
    await page.waitForTimeout(600);
    expect(count(log, "/v1/site-analytics")).toBe(0);
  });

  test("conta só com Reuniões: Resultados existe (antes era só do Conversas) com a seção de Reuniões", async ({ page }) => {
    const log = await setup(page, { solutions: ["meetings"] });
    await page.goto(`${base()}/results`);
    await expect(page.getByTestId("solution-blocked")).toHaveCount(0);
    await expect(page.getByTestId("results-overview").locator("> section")).toHaveCount(1);
    await expect(card(page, "meetings")).toContainText("3");
    await expect(page.locator("nav[aria-label='Menu principal'] [data-area='results']")).toBeVisible();
    expect(count(log, "/v1/inbox/metrics") + count(log, "/v1/commercial-metrics")).toBe(0);
  });

  test("falha de uma fonte não derruba as outras nem vira zero", async ({ page }) => {
    await setup(page, { failCommercial: true });
    await page.goto(`${base()}/results`);
    await expect(card(page, "commercial")).toContainText("Falha simulada nas métricas comerciais.");
    await expect(card(page, "commercial").getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    await expect(card(page, "attendance")).toContainText("42");
  });

  test("site sem visitas: estado vazio explicado", async ({ page }) => {
    await setup(page, { siteEmpty: true });
    await page.goto(`${base()}/results?secao=site`);
    await expect(page.locator("[data-state='empty']")).toContainText("Nenhuma visita registrada");
  });

  test("troca de workspace: números do novo espaço, sem consultar o anterior", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/results`);
    await expect(card(page, "attendance")).toContainText("42");
    await page.getByTestId("workspace-switcher").click();
    await page.locator(`[data-workspace-option='${OTHER_ID}']`).click();
    await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}/results`));
    const switchedAt = log.gets.length;
    await expect(card(page, "attendance")).toContainText("9");
    await page.waitForTimeout(800);
    expect(log.gets.slice(switchedAt).filter((get) => get.ws && get.ws !== OTHER_ID).map((get) => get.path)).toEqual([]);
  });

  test("relatórios antigos continuam nos mesmos endereços e no menu de Resultados", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/results`);
    const items = page.locator("nav[aria-label='Menu principal'] [data-area-items='results'] a");
    await expect(items).toHaveText(["Painel", "Desempenho comercial", "Relatórios"]);
    await expect(items.nth(1)).toHaveAttribute("href", `${base()}/performance`);
    await expect(items.nth(2)).toHaveAttribute("href", `${base()}/reports`);
  });
});

test.describe("Fase 12 — responsividade", () => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: resultados sem rolagem lateral (claro e escuro)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await setup(page);
      for (const theme of ["light", "dark"]) {
        await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
        for (const path of ["/results", "/results?secao=commercial", "/results?secao=site", "/results?secao=meetings"]) {
          await page.goto(`${base()}${path}`);
          await page.waitForTimeout(600);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${path} ${width} ${theme}`).toBe(true);
        }
      }
    });
  }
});

test.describe("capturas da Fase 12", () => {
  test.skip(!process.env.PHASE12_CAPTURE_DIR, "defina PHASE12_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["resultados-desktop", "/results", 1440, "light"],
    ["resultados-comercial-desktop", "/results?secao=commercial", 1440, "dark"],
    ["resultados-tablet", "/results", 768, "light"],
    ["resultados-celular", "/results", 390, "dark"],
    ["resultados-site-celular", "/results?secao=site", 360, "light"],
  ] as const;
  for (const [name, path, width, theme] of shots) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
      await setup(page);
      await page.goto(`${base()}${path}`);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${process.env.PHASE12_CAPTURE_DIR}/${name}.png` });
    });
  }
});
