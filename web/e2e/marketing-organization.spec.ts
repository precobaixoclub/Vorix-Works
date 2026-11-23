import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 5: Marketing organizado. Chromium real com API 100% mockada (nada é
 * publicado, nenhuma IA paga). Cobre o Calendário único (publicações reais + ideias planejadas,
 * filtros, mês/semana/lista, detalhes e rota antiga), a biblioteca, o Bolsão (inclusive CSV),
 * Marca e identidade em Configurações, o menu definitivo, a Operação técnica e a responsividade.
 */

const OTHER_ID = "ws-qa-casamento";
const now = new Date();
const today = (hour: number) => { const date = new Date(now); date.setHours(hour, 0, 0, 0); return date.toISOString(); };
const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const ws = (id: string, name: string) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: {}, createdAt: today(0), updatedAt: today(0), campaignIds: [], integrations: [], members: [] });
const WORKSPACES = [ws(WORKSPACE_ID, "Vorix Works"), ws(OTHER_ID, "Casamento São Paulo")];
const IMG = "https://cdn.example.test/arte.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+P/fwAJiAPmBTOYqwAAAABJRU5ErkJggg==", "base64");

const destination = (id: string, network: string, state: string, over: Record<string, unknown> = {}) => ({ id, accountId: `acc-${network}`, network, username: "loja", format: "feed_image", formatLabel: "Imagem no feed", caption: "Coleção de verão chegou", hashtags: [], media: [{ url: IMG, kind: "image" }], audioMode: "NONE", state, attemptCount: 0, actions: [], ...over });
const POSTS = [
  { id: "s1", state: "SCHEDULED", scheduledAt: today(15), timezone: "America/Sao_Paulo", createdAt: today(8), requiresApproval: false, history: [], destinations: [destination("d1", "instagram", "SCHEDULED", { scheduledAt: today(15) }), destination("d2", "facebook", "SCHEDULED", { scheduledAt: today(15) })] },
  { id: "s2", state: "FAILED", scheduledAt: today(9), timezone: "America/Sao_Paulo", createdAt: today(7), requiresApproval: false, history: [{ at: today(9), kind: "created", label: "Publicação criada" }], destinations: [destination("d3", "tiktok", "FAILED", { scheduledAt: today(9), caption: "Promoção relâmpago", problem: "O TikTok rejeitou esta mídia.", actions: ["retry"] })] },
  { id: "s3", state: "AWAITING_APPROVAL", scheduledAt: today(18), timezone: "America/Sao_Paulo", createdAt: today(7), requiresApproval: true, history: [], destinations: [destination("d4", "instagram", "AWAITING_APPROVAL", { scheduledAt: today(18), caption: "Bastidores do ateliê" })] },
];
const idea = (id: string, title: string, status: string, over: Record<string, unknown> = {}) => ({ id, externalId: id, title, category: "Moda", commercialObjective: "", targetAudience: "", concept: "", keyMessage: `Mensagem de ${title}`, format: "single_image", approach: "", visualDirection: "", narrativeStructure: "", caption: "", cta: "", priority: "normal", status, statusChangedAt: today(0), ...over });
const IDEAS = [idea("i1", "Vestido do mês", "available", { scheduledDate: ymd }), idea("i2", "Look de madrinha", "in_production", { scheduledDate: ymd }), idea("i3", "Bastidores", "produced")];

async function setup(page: Page, options: { solutions?: string[]; role?: string; permissions?: readonly string[] } = {}) {
  const log = { workspaceIds: new Set<string>(), imports: [] as string[], writes: [] as string[] };
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("https://cdn.example.test/**", (route) => route.fulfill({ contentType: "image/png", body: PNG }));
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const workspaceId = url.searchParams.get("workspaceId");
    if (workspaceId) log.workspaceIds.add(workspaceId);
    if (!["GET", "HEAD"].includes(method) && !path.startsWith("/v1/auth/") && !path.endsWith("/stream-token")) log.writes.push(`${method} ${path}`);
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    const mine = !workspaceId || workspaceId === WORKSPACE_ID;
    if (path === "/v1/auth/refresh") return ok({ accessToken: "qa", expiresIn: 900, tenantId: TENANT_ID, role: options.role ?? "owner" });
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "Marina Costa", isPlatformAdmin: false }, tenantId: TENANT_ID, role: options.role ?? "owner", permissions: options.permissions ?? OWNER_PERMISSIONS, teams: [], isAccountOwner: (options.role ?? "owner") === "owner" });
    if (path === "/v1/solutions") return ok({ solutions: (options.solutions ?? ["conversations", "marketing"]).map((key) => ({ key, name: key, internal: false })) });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch) return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));
    if (path === "/v1/social/posts" && method === "GET") return ok({ posts: mine ? POSTS : [] });
    const postMatch = /^\/v1\/social\/posts\/([^/]+)$/.exec(path);
    if (postMatch) return ok(POSTS.find((post) => post.id === postMatch[1]));
    if (path === "/v1/social/settings") return ok({ timezone: "America/Sao_Paulo", networks: [] });
    if (path === "/v1/tiktok/posts") return ok(mine ? [{ publicationId: "tt1", state: "published", description: "Vídeo antigo do estúdio", media: { imageUrls: [IMG] }, createdAt: today(6), publishedAt: today(11) }] : []);
    if (path === "/v1/youtube/posts") return ok([]);
    if (path === "/v1/editorial-ideas" && method === "GET") return ok(mine ? IDEAS : []);
    if (path === "/v1/editorial-ideas/import-spreadsheet") {
      log.imports.push((request.postDataJSON() as { csv: string }).csv);
      return ok({ created: 2, skipped: 0, total: 2 });
    }
    if (path === "/v1/brand-profile") return ok({ workspaceId: WORKSPACE_ID, brandName: "Vorix Works", businessDescription: "Ateliê de noivas", positioning: "", targetAudience: "" });
    if (path === "/v1/brand-identity") return ok({ profileId: "bp1", identity: { colors: [{ hex: "#6C33AC", role: "PRIMARY" }, { hex: "#F5E6C8", role: "SECONDARY" }], logos: [], imageStyles: [], forbiddenPatterns: [], preferredPatterns: [], schemaVersion: 1, version: 1, updatedAt: today(0) } });
    if (path === "/v1/assets") return ok([{ id: "logo1", workspaceId: WORKSPACE_ID, kind: "logo", materialType: "logo_principal", status: "active", name: "Logo principal", tags: [], storageRef: { provider: "s3", objectKey: "logo", metadata: { url: "https://cdn.example.test/logo.png", contentType: "image/png" } }, createdAt: today(0), updatedAt: today(0) }]);
    if (path === "/v1/production-settings") return ok({ productionPrompt: "" });
    return route.fallback();
  });
  return log;
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;
const items = (page: Page) => page.getByTestId("marketing-calendar").locator("[data-item]");

test.describe("Fase 5 — desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("calendário único: publicações reais agrupadas + ideias planejadas, sem confundir as duas", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/calendar`);
    // Mês sem poluição: no máximo 3 itens por dia + "+N mais", que abre a semana com todos.
    const month = page.getByTestId("calendar-month");
    await expect(month.locator("[data-item]")).toHaveCount(3);
    await month.getByRole("button", { name: "+3 mais" }).click();
    const week = page.getByTestId("calendar-week");
    await expect(week.locator("[data-item]")).toHaveCount(6);
    // Post social em Instagram + Facebook aparece UMA vez; cada situação real com o seu selo.
    await expect(week.locator("[data-item='social:s1']")).toHaveCount(1);
    await expect(week.locator("[data-item='social:s2']")).toHaveAttribute("data-status", "failed");
    await expect(week.locator("[data-item='social:s3']")).toHaveAttribute("data-status", "awaiting_approval");
    await expect(week.locator("[data-item='tiktok:tt1']")).toHaveAttribute("data-status", "published");
    await expect(week.locator("[data-item='idea:i1']")).toHaveAttribute("data-kind", "idea");
    // O 'Em produção' com data também aparece como planejamento; a ideia sem data, não.
    await page.getByRole("radio", { name: /Lista/ }).click();
    const list = page.getByTestId("calendar-list");
    await expect(list.locator("[data-item]")).toHaveCount(6);
    await expect(list.locator("[data-item='idea:i2']")).toContainText("Em produção");
    await expect(list.locator("[data-item='social:s1']")).toContainText("Agendado");
    // Contagens por situação viram filtros.
    const chips = page.getByTestId("calendar-status-chips");
    await expect(chips.locator("[data-status='failed']")).toContainText("1");
    await chips.locator("[data-status='failed']").click();
    await expect(list.locator("[data-item]")).toHaveCount(1);
    await chips.locator("[data-status='failed']").click();
    // Ocultar ideias e filtrar por rede.
    await page.getByLabel("Ideias planejadas").uncheck();
    await expect(list.locator("[data-kind='idea']")).toHaveCount(0);
    await page.getByLabel("Rede").selectOption("facebook");
    await expect(list.locator("[data-item]")).toHaveText([/Coleção de verão chegou/]);
  });

  test("detalhes: ideia explica que não é publicação; publicação abre as ações reais por rede", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/calendar`);
    await page.getByRole("radio", { name: /Lista/ }).click();
    await page.getByTestId("calendar-list").locator("[data-item='idea:i1']").click();
    await expect(page.getByTestId("idea-planning-note")).toContainText("Ainda não existe publicação agendada");
    await page.getByRole("link", { name: "Criar com esta ideia" }).click();
    await expect(page).toHaveURL(new RegExp(`${base()}/create\\?modo=ia&ideia=i1$`));
    await expect(page.getByTestId("idea-picker-selected")).toContainText("Vestido do mês");
    await page.goBack();
    await page.getByRole("radio", { name: /Lista/ }).click();
    await page.getByTestId("calendar-list").locator("[data-item='social:s2']").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/calendar\\?post=s2$`));
    await expect(page.getByTestId("social-destinations").getByText("TikTok — Falhou")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar novamente no TikTok" })).toBeVisible();
  });

  test("rota antiga /social/calendar?post= abre o mesmo detalhe no calendário único; Voltar não fica preso", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/ideias`);
    await page.goto(`${base()}/social/calendar?post=s2`);
    await expect(page).toHaveURL(new RegExp(`${base()}/calendar\\?post=s2$`));
    await expect(page.getByTestId("social-destinations")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}/ideias$`));
  });

  test("semana mostra os 7 dias; menu do Marketing em Produção/Publicação, sem telas duplicadas", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/calendar`);
    await page.getByRole("radio", { name: /Semana/ }).click();
    await expect(page.getByTestId("calendar-week").locator("> div")).toHaveCount(7);
    const nav = page.locator("nav[aria-label='Menu principal']");
    const marketing = nav.locator("[data-area-items='marketing']");
    await expect(marketing.locator("[data-section]")).toHaveText(["Produção", "Publicação"]);
    await expect(marketing.locator("a")).toHaveText(["Bolsão de ideias", "Criar conteúdo", "Revisão", "Conteúdos", "Calendário", "Anúncios"]);
    await expect(marketing.locator("a[aria-current='page']")).toHaveText("Calendário");
    await nav.getByRole("button", { name: "Mostrar telas de Configurações" }).click();
    await expect(nav.locator("[data-area-items='settings'] a")).toHaveText(["Geral", "Marca e identidade", "Redes sociais"]);
    await expect(nav.getByRole("button", { name: "Operação técnica" })).toBeVisible();
  });

  test("Operação técnica só para owner/admin", async ({ page }) => {
    await setup(page, { role: "member" });
    await page.goto(`${base()}/calendar`);
    await expect(page.locator("nav[aria-label='Menu principal'] [data-area='marketing']")).toBeVisible();
    await expect(page.getByRole("button", { name: "Operação técnica" })).toHaveCount(0);
  });

  test("biblioteca: conceitos claros, produção em andamento, 'aguardando aprovação' e filtro pelo endereço", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/campaigns?status=failed`);
    await expect(page.getByTestId("concepts-explainer").locator("[data-concept]")).toHaveCount(3);
    await expect(page.getByTestId("concepts-explainer")).toContainText("você está aqui");
    await expect(page.getByTestId("library-production-strip")).toContainText("1 conteúdo(s) para revisar");
    await expect(page.getByTestId("library-production-strip")).toContainText("1 em produção");
    await expect(page.getByText("Promoção relâmpago").first()).toBeVisible();
    await expect(page.getByText("Coleção de verão chegou")).toHaveCount(0);
    await page.getByRole("button", { name: /Aguardando aprovação/ }).first().click();
    await expect(page.getByText("Bastidores do ateliê").first()).toBeVisible();
  });

  test("Bolsão preservado: conceitos explicados e importação CSV continua funcionando", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/ideias`);
    await expect(page.getByTestId("concepts-explainer").locator("[data-concept='idea']")).toContainText("você está aqui");
    await page.locator("input[type='file'][accept*='.csv']").setInputFiles({ name: "ideias.csv", mimeType: "text/csv", buffer: Buffer.from("titulo;formato\nIdeia A;single_image\nIdeia B;single_image\n") });
    await expect(page.getByText("2 ideia(s) importada(s).")).toBeVisible();
    expect(log.imports).toHaveLength(1);
    expect(log.imports[0]).toContain("Ideia A");
  });

  test("Marca e identidade em Configurações: visão das 8 partes, logo, cores e o que falta; rota antiga preservada", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/knowledge?tab=materials`);
    await expect(page).toHaveURL(new RegExp(`${base()}/settings/marca\\?tab=materials$`));
    await expect(page.getByRole("heading", { level: 1, name: "Marca e identidade" })).toBeVisible();
    const overview = page.getByTestId("brand-overview");
    await expect(overview.locator("[data-part]")).toHaveCount(8);
    await expect(overview.locator("[data-part='company']")).toHaveAttribute("data-status", "done");
    await expect(overview.locator("[data-part='logo']")).toHaveAttribute("data-status", "done");
    await expect(overview.locator("[data-part='logo'] img")).toHaveAttribute("src", "https://cdn.example.test/logo.png");
    await expect(overview.locator("[data-part='colors'] [title='#6C33AC']")).toBeVisible();
    await expect(overview.locator("[data-part='guidelines']")).toHaveAttribute("data-status", "pending");
    await expect(page.getByTestId("brand-progress")).toContainText("de 8 prontas");
    await overview.locator("[data-part='guidelines']").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/settings/marca\\?tab=guidelines$`));
    // Configurações › menu lateral acende Marca e identidade.
    await expect(page.locator("nav[aria-label='Menu principal'] [data-area-items='settings'] a[aria-current='page']")).toHaveText("Marca e identidade");
    expect(log.writes).toEqual([]);
  });

  test("conta sem Marketing: Marca e identidade não aparece e a rota mostra 'Página não disponível'", async ({ page }) => {
    await setup(page, { solutions: ["conversations"] });
    await page.goto(`${base()}/settings/marca`);
    await expect(page.getByTestId("solution-blocked")).toBeVisible();
    await expect(page.locator("nav[aria-label='Menu principal'] [data-area-items='settings']")).toHaveCount(0);
  });

  test("troca de workspace: calendário sem dados da empresa anterior", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/calendar`);
    await page.getByRole("radio", { name: /Lista/ }).click();
    await expect(page.getByTestId("calendar-list").locator("[data-item]")).toHaveCount(6);
    await page.getByTestId("workspace-switcher").click();
    log.workspaceIds.clear();
    await page.locator(`[data-workspace-option='${OTHER_ID}']`).click();
    await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}/calendar$`));
    await expect(page.getByText("Seu calendário está livre")).toBeVisible();
    expect([...log.workspaceIds]).toEqual([OTHER_ID]);
  });
});

test.describe("Fase 5 — responsividade", () => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: calendário, biblioteca e marca sem rolagem lateral; celular abre em lista`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page);
      await page.goto(`${base()}/calendar`);
      await expect(items(page).first()).toBeVisible();
      if (width < 768) await expect(page.getByRole("radio", { name: /Lista/ })).toHaveAttribute("aria-checked", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `calendário ${width}`).toBe(true);
      for (const path of ["/campaigns", "/settings/marca", "/ideias"]) {
        await page.goto(`${base()}${path}`);
        await expect(page.getByTestId(path === "/settings/marca" ? "brand-overview" : "concepts-explainer")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} ${width}`).toBe(true);
      }
    });
  }
});

// Capturas para o relatório (só com PHASE5_CAPTURE_DIR; dados 100% simulados).
test.describe("capturas da Fase 5", () => {
  test.skip(!process.env.PHASE5_CAPTURE_DIR, "defina PHASE5_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["calendario-mes-desktop", "/calendar", 1440, "month"],
    ["calendario-semana-desktop", "/calendar", 1440, "week"],
    ["calendario-lista-celular", "/calendar", 390, "list"],
    ["calendario-detalhe-ideia-desktop", "/calendar", 1440, "idea"],
    ["biblioteca-desktop", "/campaigns", 1440, ""],
    ["bolsao-desktop", "/ideias", 1440, ""],
    ["marca-desktop", "/settings/marca", 1440, ""],
    ["marca-celular", "/settings/marca", 390, ""],
  ] as const;
  for (const [name, path, width, mode] of shots) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await page.addInitScript(() => window.localStorage.setItem("theme", "light"));
      await setup(page);
      await page.goto(`${base()}${path}`);
      await page.waitForTimeout(1200);
      if (mode === "week") await page.getByRole("radio", { name: /Semana/ }).click();
      if (mode === "idea") { await page.getByRole("radio", { name: /Lista/ }).click(); await page.getByTestId("calendar-list").locator("[data-item='idea:i1']").click(); }
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${process.env.PHASE5_CAPTURE_DIR}/${name}.png`, fullPage: mode !== "idea" });
    });
  }
});
