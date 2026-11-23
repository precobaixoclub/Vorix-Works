import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 11: Administração da Vorix separada do ambiente do cliente. API 100%
 * simulada; nenhuma operação administrativa é executada (o mock recusa qualquer escrita).
 */

const iso = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const WORKSPACES = [{ id: WORKSPACE_ID, tenantId: TENANT_ID, name: "Vorix Works", status: "active", settings: {}, createdAt: iso(-500), updatedAt: iso(-5), campaignIds: [], integrations: [], members: [] }];

type Options = { platformAdmin?: boolean; role?: string; solutions?: string[] };

async function setup(page: Page, options: Options = {}) {
  const log = { gets: [] as string[], writes: [] as string[] };
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (request.method() === "GET") log.gets.push(path);
    else if (/^\/v1\/(admin|system)/.test(path)) { log.writes.push(path); return route.fulfill({ status: 500, json: { ok: false, error: { code: "TEST_GUARD", message: "Escrita bloqueada no teste.", recoverable: false } } }); }
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: options.platformAdmin ?? false }, tenantId: TENANT_ID, role: options.role ?? "owner", permissions: OWNER_PERMISSIONS, teams: [], isAccountOwner: true });
    if (path === "/v1/solutions") return ok({ solutions: (options.solutions ?? ["conversations", "marketing"]).map((key) => ({ key, name: key, internal: false })) });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch && wsMatch[1] !== "credits") return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));
    if (path.startsWith("/v1/admin/") || path.startsWith("/v1/system/")) return route.fulfill({ status: 503, json: { ok: false, error: { code: "UNAVAILABLE", message: "Indisponível no teste.", recoverable: true } } });
    return route.fallback();
  });
  return log;
}

const base = `/workspaces/${WORKSPACE_ID}`;
const backstage = (page: Page) => page.locator("nav[aria-label='Menu principal']");

test.describe("Fase 11 — Administração da Vorix", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("cliente (mesmo dono do workspace) não entra na administração", async ({ page }) => {
    const log = await setup(page, { platformAdmin: false });
    await page.goto("/admin/tenants");
    await expect(page).toHaveURL(/\/workspaces$/);
    expect(log.gets.filter((path) => path.startsWith("/v1/admin/"))).toEqual([]);
  });

  test("admin da plataforma: ambiente separado, categorias com acesso direto e item ativo", async ({ page }) => {
    await setup(page, { platformAdmin: true });
    await page.goto("/admin/tenants");
    const nav = page.locator("aside nav[aria-label='Admin']");
    await expect(page.locator("aside")).toContainText("Administração da Vorix");
    await expect(nav.locator("[data-admin-group] > p")).toHaveText(["Plataforma", "Clientes", "Inteligência artificial", "Cobrança e avisos", "Ferramentas", "Configurações"]);
    await expect(nav.locator("a[aria-current='page']")).toHaveText("Empresas e planos");
    await nav.getByRole("link", { name: "Reuniões: transcrição" }).click();
    await expect(page).toHaveURL(/\/admin\/meetings-transcription$/);
    await expect(nav.locator("a[aria-current='page']")).toHaveText("Reuniões: transcrição");
    await expect(page.getByRole("link", { name: "← Configurações" })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Voltar ao Vorix" })).toHaveAttribute("href", "/workspaces");
  });

  test("admin no celular: seletor agrupado leva à tela", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, { platformAdmin: true });
    await page.goto("/admin");
    const select = page.getByLabel("Seção da administração");
    await expect(select.locator("optgroup")).toHaveCount(6);
    await select.selectOption("/admin/growth");
    await expect(page).toHaveURL(/\/admin\/growth$/);
  });

  test("operação técnica do cliente: ferramentas do workspace sim; infraestrutura da plataforma não", async ({ page }) => {
    const log = await setup(page, { platformAdmin: false });
    await page.goto(`${base}/planning`);
    // Em /planning o bloco "Operação técnica" já abre expandido.
    const items = backstage(page).locator(`a[href^='${base}/']`).filter({ hasText: /Planejamento|Runtime|Execução|Publicação técnica|Provedores|Governança|^Operação$/ });
    await expect(items).toHaveText(["Planejamento", "Runtime", "Execução", "Publicação técnica", "Provedores", "Governança"]);
    await page.goto(`${base}/operations`);
    await expect(page.getByTestId("platform-only")).toContainText("Área da administração da Vorix");
    await page.waitForTimeout(800);
    expect(log.gets.filter((path) => path.startsWith("/v1/system/"))).toEqual([]);
    // Sem link para o painel /admin no menu do usuário.
    await page.getByRole("button", { name: /Menu do usuário/ }).click();
    await expect(page.getByRole("link", { name: /Administração da/ })).toHaveCount(0);
  });

  test("admin da plataforma no workspace: vê a Operação e o atalho para a administração", async ({ page }) => {
    const log = await setup(page, { platformAdmin: true });
    await page.goto(`${base}/operations`);
    // O admin não é barrado: a tela monta e consulta a operação (com a API simulada fora do ar).
    await expect.poll(() => log.gets.some((path) => path.startsWith("/v1/system/"))).toBe(true);
    await expect(page.getByTestId("platform-only")).toHaveCount(0);
    await page.goto(`${base}/planning`);
    await expect(backstage(page).locator(`a[href='${base}/operations']`)).toHaveText("Operação");
    await page.getByRole("button", { name: /Menu do usuário/ }).click();
    await expect(page.getByRole("link", { name: "Administração da Vorix" })).toHaveAttribute("href", "/admin");
    expect(log.writes).toEqual([]);
  });

  test("atendente não vê nem abre a operação técnica", async ({ page }) => {
    await setup(page, { role: "editor" });
    await page.goto(`${base}/planning`);
    await expect(page.getByText("Bastidor restrito")).toBeVisible();
    await expect(backstage(page).getByRole("button", { name: "Operação técnica" })).toHaveCount(0);
  });
});

test.describe("Fase 11 — responsividade da administração", () => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: administração sem rolagem lateral (claro e escuro)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await setup(page, { platformAdmin: true });
      for (const theme of ["light", "dark"]) {
        await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
        for (const path of ["/admin", "/admin/tenants", "/admin/configuracoes"]) {
          await page.goto(path);
          await page.waitForTimeout(500);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${path} ${width} ${theme}`).toBe(true);
        }
      }
    });
  }
});

test.describe("capturas da Fase 11", () => {
  test.skip(!process.env.PHASE11_CAPTURE_DIR, "defina PHASE11_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["admin-desktop", "/admin/configuracoes", 1440, "light", true],
    ["admin-tablet", "/admin/tenants", 768, "dark", true],
    ["admin-celular", "/admin", 390, "light", true],
    ["operacao-restrita-cliente", `${base}/operations`, 1440, "light", false],
  ] as const;
  for (const [name, path, width, theme, admin] of shots) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
      await setup(page, { platformAdmin: admin });
      await page.goto(path);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${process.env.PHASE11_CAPTURE_DIR}/${name}.png` });
    });
  }
});
