import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 13: site público, planos, cadastro e onboarding. Nenhuma conta real é
 * criada: o cadastro é simulado (API interceptada) e nenhum checkout é iniciado.
 */

const PUBLIC_PAGES = ["/", "/precos", "/produtos/conversas", "/produtos/marketing", "/produtos/site", "/produtos/meetings", "/empresa", "/login", "/signup", "/terms", "/privacy", "/data-deletion"];

test.describe("Fase 13 — site público", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("todas as páginas públicas abrem com título e cabeçalho principal", async ({ page }) => {
    for (const path of PUBLIC_PAGES) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(400);
      await expect(page.locator("h1").first(), path).toBeVisible();
      expect((await page.title()).length, path).toBeGreaterThan(3);
    }
  });

  test("nenhum link interno quebrado nem âncora inexistente nas páginas públicas", async ({ page, request }) => {
    const checked = new Map<string, number>();
    const anchorsByPage = new Map<string, Set<string>>();
    const broken: string[] = [];
    const idsOf = async (path: string) => {
      if (!anchorsByPage.has(path)) {
        const probe = await page.context().newPage();
        await probe.goto(path);
        anchorsByPage.set(path, new Set(await probe.locator("[id]").evaluateAll((nodes) => nodes.map((node) => node.id))));
        await probe.close();
      }
      return anchorsByPage.get(path)!;
    };
    for (const path of ["/", "/precos", "/produtos/conversas", "/produtos/marketing", "/produtos/site", "/produtos/meetings", "/empresa"]) {
      await page.goto(path);
      const hrefs = await page.locator("a[href^='/'], a[href^='#']").evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute("href")!))]);
      for (const href of hrefs) {
        const [target, hash] = href.startsWith("#") ? [path, href.slice(1)] : href.split("#");
        const url = target || path;
        if (!checked.has(url)) checked.set(url, (await request.get(url, { maxRedirects: 5 })).status());
        if (checked.get(url)! >= 400) broken.push(`${path} → ${href} (${checked.get(url)})`);
        if (hash && !(await idsOf(url)).has(hash)) broken.push(`${path} → ${href} (âncora inexistente)`);
      }
    }
    expect(broken).toEqual([]);
  });

  test("as quatro ferramentas no menu público, com a mesma lista em todas as páginas", async ({ page }) => {
    for (const path of ["/", "/precos"]) {
      await page.goto(path);
      await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("button", { name: /Produtos/ }).click();
      const menu = page.locator(".public-product-menu");
      await expect(menu.locator("a strong")).toHaveText(["Vorix Conversas", "Vorix Marketing", "Vorix Site", "Vorix Meetings"]);
      await expect(menu.locator("a").nth(1)).toHaveAttribute("href", "/produtos/marketing");
      await page.keyboard.press("Escape");
    }
  });

  test("Marketing: página própria com capacidades reais e sem preço inventado; Preços mostra Site e Marketing sob consulta", async ({ page }) => {
    await page.goto("/produtos/marketing");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Da ideia à publicação");
    await expect(page.getByText("Publicação no Instagram e no Facebook", { exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("R$");
    await page.goto("/precos");
    await expect(page.locator("#vorix-site")).toBeVisible();
    await expect(page.locator("#vorix-marketing")).toContainText("sob consulta");
  });

  test("informação comercial coerente: o Site não diz mais que a loja está 'em preparação'", async ({ page }) => {
    await page.goto("/produtos/site");
    await expect(page.locator("main")).not.toContainText("em preparação");
    await expect(page.locator("main")).toContainText("checkout online");
  });

  test("SEO: sitemap só com páginas públicas (inclui Marketing) e robots bloqueia as áreas privadas", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/produtos/marketing");
    for (const privatePath of ["/workspaces", "/admin", "/conta", "/login"]) expect(sitemap.includes(`vorixworks.com${privatePath}<`) || sitemap.includes(`vorixworks.com${privatePath}/`)).toBe(false);
    const robots = await (await request.get("/robots.txt")).text();
    for (const rule of ["Disallow: /workspaces/", "Disallow: /admin/", "Disallow: /conta/"]) expect(robots).toContain(rule);
  });

  test("SEO: título, descrição e canônico próprios no cadastro e na página de Marketing; login fora do índice", async ({ page }) => {
    await page.goto("/produtos/marketing");
    await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", /\/produtos\/marketing$/);
    await expect(page.locator("meta[name='description']")).toHaveAttribute("content", /Ideias/);
    await page.goto("/signup");
    await expect(page).toHaveTitle(/Criar conta/);
    await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", /\/signup$/);
    await page.goto("/login");
    await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", /noindex/);
  });
});

test.describe("Fase 13 — acesso, cadastro e onboarding", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("login: erro ligado aos campos e caminho real para senha esquecida (sem fluxo fictício)", async ({ page }) => {
    await page.route("**/v1/auth/login", (route) => route.fulfill({ status: 401, json: { ok: false, error: { code: "INVALID_CREDENTIALS", message: "INVALID_CREDENTIALS: credenciais inválidas", recoverable: false } } }));
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("pessoa@empresa.invalid");
    await page.getByLabel("Senha").fill("senha-errada");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator("#login-error")).toHaveText("E-mail ou senha incorretos.");
    await expect(page.getByLabel("E-mail")).toHaveAttribute("aria-describedby", /login-error/);
    await page.getByText("Esqueceu a senha?").click();
    await expect(page.getByText("A redefinição de senha ainda não é feita por aqui.")).toBeVisible();
  });

  test("cadastro sem plano não promete teste com prazo; e-mail já cadastrado leva ao login", async ({ page }) => {
    await page.route("**/v1/auth/signup", (route) => route.fulfill({ status: 409, json: { ok: false, error: { code: "CONFLICT", message: "SIGNUP_EMAIL_ALREADY_REGISTERED: já existe", recoverable: false } } }));
    await page.goto("/signup");
    await expect(page.getByText("Crie sua conta sem cartão.")).toBeVisible();
    await expect(page.getByText(/7 dias/)).toHaveCount(0);
    await page.getByLabel("Nome").fill("Pessoa QA");
    await page.getByLabel("E-mail").fill("existe@empresa.invalid");
    await page.getByLabel("Senha").fill("senha-segura-123");
    await page.getByRole("button", { name: "Criar conta" }).click();
    const alert = page.locator("#signup-error");
    await expect(alert).toContainText("Já existe uma conta com este e-mail.");
    await expect(alert.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/login");
  });

  test("cadastro simulado: um clique só, conta criada e chegada ao onboarding do workspace", async ({ page, context }) => {
    let signups = 0;
    await mockConversasBackend(page);
    await page.route("**/v1/auth/signup", async (route) => {
      signups += 1;
      await loginCookie(context);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route.fulfill({ status: 201, json: { ok: true, data: { accessToken: "token-qa", expiresIn: 900, user: { id: "user-qa", email: "nova@empresa.invalid", name: "Nova Pessoa", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", trialStarted: false } } });
    });
    await page.route("**/v1/workspaces", (route) => route.fulfill({ json: { ok: true, data: [{ id: WORKSPACE_ID, tenantId: TENANT_ID, name: "Workspace de Nova Pessoa", status: "active", settings: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), campaignIds: [], integrations: [], members: [] }] } }));
    await page.route("**/v1/onboarding**", (route) => route.fulfill({ json: { ok: true, data: { id: "ob-1", tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, status: "in_progress", currentStep: "company", completedSteps: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), channelModuleEnabled: true } } }));
    await page.goto("/signup");
    await page.getByLabel("Nome").fill("Nova Pessoa");
    await page.getByLabel("E-mail").fill("nova@empresa.invalid");
    await page.getByLabel("Senha").fill("senha-segura-123");
    const submit = page.getByRole("button", { name: "Criar conta" });
    await submit.click();
    await expect(page.getByRole("button", { name: "Criando conta..." })).toBeDisabled();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${WORKSPACE_ID}/onboarding`));
    expect(signups).toBe(1);
  });

  test("onboarding concluído: primeiros passos de cada ferramenta contratada, só com links", async ({ page }) => {
    await loginCookie(page.context());
    await mockConversasBackend(page);
    await page.route("**/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
      if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: OWNER_PERMISSIONS, teams: [], isAccountOwner: true });
      if (path === "/v1/solutions") return ok({ solutions: ["conversations", "marketing", "site", "meetings"].map((key) => ({ key, name: key, internal: false })) });
      if (path === "/v1/onboarding") return ok({ id: "ob-1", tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, status: "in_progress", currentStep: "done", completedSteps: ["company", "commercial"], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), channelModuleEnabled: true });
      return route.fallback();
    });
    await page.goto(`/workspaces/${WORKSPACE_ID}/onboarding`);
    const steps = page.getByTestId("onboarding-first-steps");
    await expect(steps.locator("[data-tool]")).toHaveCount(4);
    await expect(steps.getByRole("link", { name: "Conectar a Google Agenda" })).toHaveAttribute("href", `/workspaces/${WORKSPACE_ID}/meetings/integrations`);
    await expect(page.getByRole("button", { name: "Ir para o Início" })).toBeVisible();
  });
});

test.describe("Fase 13 — responsividade do site público", () => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: páginas públicas e de acesso sem rolagem lateral`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      for (const path of ["/", "/precos", "/produtos/marketing", "/produtos/site", "/login", "/signup"]) {
        await page.goto(path);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${path} ${width}`).toBe(true);
      }
    });
  }
});

test.describe("capturas da Fase 13", () => {
  test.skip(!process.env.PHASE13_CAPTURE_DIR, "defina PHASE13_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["home-desktop", "/", 1440],
    ["precos-desktop", "/precos", 1440],
    ["marketing-desktop", "/produtos/marketing", 1440],
    ["marketing-tablet", "/produtos/marketing", 768],
    ["login-celular", "/login", 390],
    ["cadastro-celular", "/signup", 390],
    ["home-celular", "/", 390],
  ] as const;
  for (const [name, path, width] of shots) {
    test(name, async ({ page }: { page: Page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto(path);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${process.env.PHASE13_CAPTURE_DIR}/${name}.png` });
    });
  }
});
