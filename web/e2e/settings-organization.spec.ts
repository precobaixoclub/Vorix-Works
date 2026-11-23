import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 10: Configurações unificadas. Chromium real, API 100% simulada:
 * nenhuma cobrança, nenhuma alteração de usuário/permissão e nenhuma reconexão de integração. O mock
 * recusa qualquer escrita e os testes exigem que não haja nenhuma.
 */

const OTHER_ID = "ws-qa-casamento";
const iso = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const integration = (id: string, channel: string, status: string, displayName: string) => ({ id, channel, status, displayName, createdAt: iso(-100), updatedAt: iso(-1) });
const ws = (id: string, name: string, integrations: unknown[]) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: { timezone: "America/Sao_Paulo", language: "pt-BR" }, createdAt: iso(-500), updatedAt: iso(-5), campaignIds: [], integrations, members: [] });
const WORKSPACES = [
  ws(WORKSPACE_ID, "Vorix Works", [integration("i-wa", "whatsapp", "connected", "WhatsApp Comercial"), integration("i-ig", "instagram", "pending", "@vorixworks"), integration("i-fb", "facebook", "disconnected", "Página Vorix")]),
  ws(OTHER_ID, "Casamento São Paulo", [integration("i-wa2", "whatsapp", "connected", "WhatsApp Casamento")]),
];
const MEMBERS = [
  { id: "mb-1", userId: "user-qa", name: "QA Reviewer", email: "qa@vorix.dev", tenantId: TENANT_ID, role: "owner", status: "active", isAccountOwner: true, workspaceIds: null },
  { id: "mb-2", userId: "user-2", name: "Gerente Ana", email: "ana@cliente.invalid", tenantId: TENANT_ID, role: "admin", status: "active", workspaceIds: null },
  { id: "mb-3", userId: "user-3", name: "Atendente Bia", email: "bia@cliente.invalid", tenantId: TENANT_ID, role: "editor", status: "active", workspaceIds: [WORKSPACE_ID] },
  { id: "mb-4", userId: "user-4", name: "Ex-colaborador", email: "ex@cliente.invalid", tenantId: TENANT_ID, role: "editor", status: "disabled", workspaceIds: [WORKSPACE_ID] },
];

type Options = { solutions?: string[]; role?: string; permissions?: readonly string[]; activeSolution?: string };

async function setup(page: Page, options: Options = {}) {
  const log = { writes: [] as string[], gets: [] as { path: string; ws: string | null }[] };
  await loginCookie(page.context());
  await mockConversasBackend(page);
  if (options.activeSolution) await page.addInitScript((value) => sessionStorage.setItem("vorix:active-solution", value), options.activeSolution);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (method === "GET") log.gets.push({ path, ws: url.searchParams.get("workspaceId") });
    if (method !== "GET" && /^\/v1\/(tenant-members|billing|workspaces|meeting-plans|meetings|social|meta)/.test(path)) { log.writes.push(`${method} ${path}`); return route.fulfill({ status: 500, json: { ok: false, error: { code: "TEST_GUARD", message: "Escrita bloqueada no teste.", recoverable: false } } }); }
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: options.role ?? "owner", permissions: options.permissions ?? OWNER_PERMISSIONS, teams: [], isAccountOwner: (options.role ?? "owner") === "owner" });
    if (path === "/v1/solutions") return ok({ solutions: (options.solutions ?? ["conversations", "site", "marketing", "meetings"]).map((key) => ({ key, name: key, internal: false })) });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch) return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));
    if (path === "/v1/tenant-members") return ok(MEMBERS);
    if (path === "/v1/tenant-members/invites") return ok([{ id: "inv-1", email: "novo@cliente.invalid", role: "editor", status: "pending", createdAt: iso(-3), expiresAt: iso(100) }]);
    if (path === "/v1/meetings/google/status") return ok({ configured: true, status: "connected", googleEmail: "agenda@vorix.invalid", lastSyncedAt: iso(-1) });
    if (path === "/v1/billing/overview") return route.fulfill({ status: 503, json: { ok: false, error: { code: "BILLING_UNAVAILABLE", message: "Cobrança indisponível no teste.", recoverable: true } } });
    if (path === "/v1/meeting-plans") return ok({ catalog: { trial: { code: "trial", name: "Teste", priceCents: 0, currency: "BRL", recordingMinutes: 60, recordingHours: 1, retentionDays: 7, maxConcurrentRecordings: 1, summary: "Teste", days: 7 }, plans: [] }, subscription: { tenantId: TENANT_ID, planCode: "professional", status: "active", currentPeriodStart: iso(-200), currentPeriodEnd: iso(200), cancelAtPeriodEnd: false }, trialAvailable: false, checkoutOpen: false, canManage: true, rules: { exportWindowDays: 30, retentionNoticeDays: [7], maxRecordingMinutes: 240 } });
    if (path === "/v1/meetings/preferences") return ok({ autoRecordMode: "off", defaultTemplate: "general", tenant: { consentNoticeEnabled: true, consentMessage: "Esta reunião será gravada." } });
    if (path === "/v1/meetings/usage") return ok({ period: "2026-11", minutesUsed: 10, minutesLimit: 600, storageBytesUsed: 1e6, storageBytesLimit: 1e10, aiAnalyses: 0 });
    if (path === "/v1/meetings/keyword-trackers") return ok([]);
    return route.fallback();
  });
  return log;
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;
const settingsNav = (page: Page) => page.getByTestId("settings-nav");
const categories = (page: Page) => settingsNav(page).locator("[data-category]");
const menu = (page: Page) => page.locator("nav[aria-label='Menu principal'] [data-area-items='settings']");

test.describe("Fase 10 — Configurações", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("conta completa: categorias claras e opções de TODAS as ferramentas contratadas", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/settings`);
    await expect(categories(page)).toHaveCount(7);
    await expect(categories(page).locator("> p")).toHaveText(["Minha conta", "Espaço de trabalho", "Atendimento e vendas", "Site", "Reuniões", "Integrações", "Conta e assinatura"]);
    await expect(settingsNav(page).locator("button[aria-current='page']")).toHaveText("Geral");
    await expect(page.getByText("Dados da empresa")).toBeVisible();
    await expect(page.getByLabel("Nome do workspace")).toHaveValue("Vorix Works");
    // Conversas e Marketing contratados: as duas opções aparecem juntas (antes, só a da ferramenta "ativa").
    await expect(page.getByText("Contato automático (CRM)")).toBeVisible();
    await expect(page.getByLabel("Formato padrão de conteúdo")).toBeVisible();
    expect(log.writes).toEqual([]);
  });

  test("a ferramenta 'ativa' da sessão não esconde as outras configurações", async ({ page }) => {
    await setup(page, { activeSolution: "site" });
    await page.goto(`${base()}/settings`);
    await expect(settingsNav(page).getByRole("button", { name: "Contas de gravação" })).toBeVisible();
    await expect(settingsNav(page).getByRole("button", { name: "Encerramento e avaliação" })).toBeVisible();
    await settingsNav(page).getByRole("button", { name: "Marca e identidade" }).click();
    await expect(page).toHaveURL(new RegExp(`${base()}/settings/marca$`));
  });

  test("só o Site: sem atendimento, reuniões ou marca — e o link direto de outra ferramenta volta para Geral", async ({ page }) => {
    await setup(page, { solutions: ["site"] });
    await page.goto(`${base()}/settings`);
    await expect(categories(page).locator("> p")).toHaveText(["Minha conta", "Espaço de trabalho", "Site", "Integrações", "Conta e assinatura"]);
    await expect(settingsNav(page).getByRole("button", { name: "Produtos" })).toBeVisible();
    await expect(settingsNav(page).getByRole("button", { name: /Marca|Encerramento|Contas de gravação/ })).toHaveCount(0);
    await page.goto(`${base()}/settings/automations`);
    await expect(page).toHaveURL(new RegExp(`${base()}/settings$`));
  });

  test("menu global: Configurações em blocos, com os destinos de um clique das fases anteriores", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/settings`);
    await expect(menu(page).locator("a")).toHaveText(["Meu perfil", "Geral", "Atendimento e canais", "Marca e identidade", "Reuniões", "Integrações", "Redes sociais", "Plano e cobrança"]);
    await expect(menu(page).locator("p")).toHaveText(["Minha conta", "Espaço de trabalho", "Integrações", "Conta e assinatura"]);
    await menu(page).locator("a", { hasText: "Meu perfil" }).click();
    await expect(page).toHaveURL(new RegExp(`${base()}/settings/perfil$`));
    await expect(menu(page).locator("a[aria-current='page']")).toHaveText("Meu perfil");
  });

  test("Meu perfil: dados da pessoa separados da empresa, com papel e ferramentas", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/settings/perfil`);
    const identity = page.getByTestId("profile-identity");
    await expect(identity).toContainText("QA Reviewer");
    await expect(identity).toContainText("qa@vorix.dev");
    await expect(identity).toContainText("Administrador");
    await expect(identity.getByRole("link", { name: "Usuários e permissões" })).toBeVisible();
    await expect(page.getByTestId("profile-tools").locator("li")).toHaveText(["Conversas", "Site", "Marketing", "Reuniões"]);
    await expect(page.getByTestId("profile-appearance").getByRole("button")).toBeVisible();
    await expect(page.getByTestId("profile-security")).toContainText("troca de senha");
  });

  test("Meu perfil de quem não administra: sem atalho para editar usuários", async ({ page }) => {
    await setup(page, { role: "editor", permissions: OWNER_PERMISSIONS.filter((permission) => !permission.startsWith("tenant_member:")) });
    await page.goto(`${base()}/settings/perfil`);
    await expect(page.getByTestId("profile-identity")).toContainText("Atendente");
    await expect(page.getByTestId("profile-identity")).toContainText("peça a quem administra");
    await expect(page.getByTestId("profile-identity").getByRole("link")).toHaveCount(0);
  });

  test("usuários e permissões: quem tem acesso, quem administra e o que cada papel faz", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/settings/users`);
    await expect(page.getByRole("heading", { name: "Usuários e permissões" })).toBeVisible();
    const overview = page.getByTestId("access-overview");
    await expect(overview.getByTestId("access-active")).toHaveText("3");
    await expect(overview.getByTestId("access-admins")).toHaveText("2");
    await expect(overview).toContainText("Responsável principal pela conta: QA Reviewer");
    await expect(overview).toContainText("1 desativado(s)");
    await expect(overview.getByTestId("role-summary").locator("li").nth(0)).toContainText("Administrador: gerencia usuários e equipes, cuida do plano e da cobrança");
    await expect(overview.getByTestId("role-summary").locator("li").nth(2)).toContainText("Atendente: opera as ferramentas contratadas");
    expect(log.writes).toEqual([]);
  });

  test("integrações por finalidade, só com a situação que o servidor informa", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/settings/integracoes`);
    const messaging = page.getByTestId("integrations-messaging");
    await expect(messaging).toContainText("WhatsApp Comercial");
    await expect(messaging.locator("[data-state='connected']")).toHaveText("Conectado");
    const social = page.getByTestId("integrations-social");
    await expect(social.locator("[data-state='attention']")).toHaveText("Requer atenção");
    await expect(social.locator("[data-state='disconnected']")).toHaveText("Desconectado");
    await expect(social.getByRole("link", { name: "Redes sociais" })).toHaveAttribute("href", `${base()}/social/integrations`);
    await expect(page.getByTestId("integrations-meetings")).toContainText("Google Agenda · agenda@vorix.invalid");
    await expect(page.getByTestId("integrations-meetings").locator("[data-state='connected']")).toBeVisible();
    await expect(page.getByTestId("integrations-commerce").getByRole("link", { name: "Marketplaces" })).toHaveAttribute("href", `${base()}/settings/marketplaces`);
    expect(log.writes).toEqual([]);
  });

  test("integrações numa conta só com Reuniões: nada de canais, redes ou comércio", async ({ page }) => {
    const log = await setup(page, { solutions: ["meetings"] });
    await page.goto(`${base()}/settings/integracoes`);
    await expect(page.getByTestId("integrations-meetings")).toBeVisible();
    await expect(page.getByTestId("integrations-messaging")).toHaveCount(0);
    await expect(page.getByTestId("integrations-social")).toHaveCount(0);
    await expect(page.getByTestId("integrations-commerce")).toHaveCount(0);
    expect(log.gets.some((get) => get.path === "/v1/meetings/google/status")).toBe(true);
  });

  test("integrações numa conta sem Reuniões não consulta a Google Agenda", async ({ page }) => {
    const log = await setup(page, { solutions: ["site"] });
    await page.goto(`${base()}/settings/integracoes`);
    await expect(page.getByTestId("integrations-commerce")).toBeVisible();
    await expect(page.getByTestId("integrations-meetings")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(log.gets.some((get) => get.path === "/v1/meetings/google/status")).toBe(false);
  });

  test("plano de Reuniões: um lugar só (Conta e assinatura), mesmo se a cobrança da plataforma falhar", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/meetings/settings`);
    await expect(page.getByTestId("meetings-plan-link").getByRole("link", { name: "Ver plano de Reuniões" })).toHaveAttribute("href", `${base()}/settings/plano#plano-reunioes`);
    await page.getByTestId("meetings-plan-link").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/settings/plano#plano-reunioes$`));
    await expect(page.getByText("Cobrança indisponível no teste.")).toBeVisible();
    await expect(page.locator("#plano-reunioes")).toBeVisible();
  });

  test("links antigos continuam: /settings/products leva ao catálogo; /connections abre o Instagram Direct", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/settings/products`);
    await expect(page).toHaveURL(new RegExp(`${base()}/products$`));
    await page.goto(`${base()}/connections`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Instagram Direct" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${base()}/connections$`));
  });

  test("troca de workspace nas Integrações mostra só as contas do novo espaço", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/settings/integracoes`);
    await expect(page.getByTestId("integrations-messaging")).toContainText("WhatsApp Comercial");
    await page.getByTestId("workspace-switcher").click();
    await page.locator(`[data-workspace-option='${OTHER_ID}']`).click();
    await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}/settings/integracoes`));
    await expect(page.getByTestId("integrations-messaging")).toContainText("WhatsApp Casamento");
    await expect(page.getByText("WhatsApp Comercial")).toHaveCount(0);
  });
});

test.describe("Fase 10 — celular e responsividade", () => {
  test("celular: seletor de seções agrupado leva à tela escolhida", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page);
    await page.goto(`${base()}/settings`);
    const select = page.getByLabel("Seção das configurações");
    await expect(select).toBeVisible();
    await expect(select.locator("optgroup")).toHaveCount(7);
    await select.selectOption("teams");
    await expect(page).toHaveURL(new RegExp(`${base()}/settings/teams$`));
  });

  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: configurações sem rolagem lateral (claro e escuro)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await setup(page);
      for (const theme of ["light", "dark"]) {
        await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
        for (const path of ["/settings", "/settings/perfil", "/settings/integracoes", "/settings/users"]) {
          await page.goto(`${base()}${path}`);
          await page.waitForTimeout(500);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${path} ${width} ${theme}`).toBe(true);
        }
      }
    });
  }
});

// Capturas para o relatório (só com PHASE10_CAPTURE_DIR; dados 100% simulados).
test.describe("capturas da Fase 10", () => {
  test.skip(!process.env.PHASE10_CAPTURE_DIR, "defina PHASE10_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["configuracoes-desktop", "/settings", 1440, "light"],
    ["integracoes-desktop", "/settings/integracoes", 1440, "dark"],
    ["usuarios-desktop", "/settings/users", 1440, "light"],
    ["perfil-tablet", "/settings/perfil", 768, "light"],
    ["configuracoes-celular", "/settings", 390, "dark"],
    ["integracoes-celular", "/settings/integracoes", 360, "light"],
  ] as const;
  for (const [name, path, width, theme] of shots) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
      await setup(page);
      await page.goto(`${base()}${path}`);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${process.env.PHASE10_CAPTURE_DIR}/${name}.png` });
    });
  }
});
