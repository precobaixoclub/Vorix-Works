import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 4: "Criar conteúdo" como porta única do Marketing. Chromium real com
 * a API 100% mockada: nenhuma rede social real, nenhuma geração paga de IA. Cobre Bolsão → IA →
 * Revisão, ideia nova, mídia pronta, rascunho, redes, agendar/publicar agora, duplicidade, conexão
 * indisponível, permissões, isolamento entre workspaces, "+ Criar" do Início, links antigos e
 * responsividade.
 */

const OTHER_ID = "ws-qa-casamento";
const now = new Date().toISOString();
const ws = (id: string, name: string) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: {}, createdAt: now, updatedAt: now, campaignIds: [], integrations: [], members: [] });
const WORKSPACES = [ws(WORKSPACE_ID, "Vorix Works"), ws(OTHER_ID, "Casamento São Paulo")];
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const idea = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, externalId: id, title, category: "Moda", commercialObjective: "Vender", targetAudience: "Noivas", concept: "", keyMessage: `Mensagem de ${title}`, format: "single_image", approach: "", visualDirection: "", narrativeStructure: "", caption: "", cta: "", priority: "normal", status: "available", statusChangedAt: now, ...over });
const IDEAS: Record<string, unknown[]> = {
  [WORKSPACE_ID]: [
    idea("idea-1", "Vestido do mês", { suggestedDate: "2026-12-05", creativePrompt: "Ateliê com luz natural", referenceImages: ["https://cdn.example.test/ref-1.jpg"] }),
    idea("idea-2", "Bastidores do ateliê"),
    idea("idea-3", "Coleção antiga", { status: "published" }),
    idea("idea-4", "Em andamento", { status: "in_production", executionRunId: "run-old" }),
  ],
  [OTHER_ID]: [idea("idea-b1", "Buffet completo")],
};

const formats = [
  { format: "feed_image", label: "Imagem no feed", features: ["caption", "hashtags"], maxItems: 1, kinds: ["image"], maxCaptionLength: 2200 },
  { format: "carousel", label: "Carrossel", features: ["caption", "hashtags"], maxItems: 10, kinds: ["image"], maxCaptionLength: 2200 },
  { format: "reel", label: "Reel", features: ["caption", "hashtags"], maxItems: 1, kinds: ["video"], maxCaptionLength: 2200 },
];

type Options = { permissions?: readonly string[]; runState?: "waiting_for_approval" | "failed"; failFirstPost?: boolean; tiktokUnavailable?: boolean };

async function setup(page: Page, options: Options = {}) {
  const log = { posts: [] as Record<string, unknown>[], generate: [] as Record<string, unknown>[], patches: [] as { id: string; body: Record<string, unknown> }[], workspaceIds: new Set<string>(), uploads: 0 };
  let postAttempts = 0;
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    let body: { workspaceId?: string } | null = null;
    try { body = method !== "GET" ? (request.postDataJSON() as { workspaceId?: string } | null) : null; } catch { body = null; } // upload = multipart
    const workspaceId = url.searchParams.get("workspaceId") ?? body?.workspaceId ?? null;
    if (workspaceId) log.workspaceIds.add(workspaceId);
    const ok = (data: unknown, status = 200) => route.fulfill({ status, json: { ok: true, data } });

    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "Marina Costa", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: options.permissions ?? OWNER_PERMISSIONS, teams: [], isAccountOwner: true });
    if (path === "/v1/solutions") return ok({ solutions: [{ key: "conversations", name: "c", internal: false }, { key: "marketing", name: "m", internal: false }] });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch) return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));
    if (path === "/v1/editorial-ideas" && method === "GET") return ok(IDEAS[workspaceId ?? WORKSPACE_ID] ?? []);
    if (/^\/v1\/editorial-ideas\/[^/]+\/brief$/.test(path)) {
      const id = path.split("/")[3];
      return ok({ name: "Vestido do mês", objective: "Vender", ideaText: "Mensagem de Vestido do mês", format: "single_image", creativePrompt: `prompt-original-${id}`, targetAudience: "Noivas" });
    }
    if (/^\/v1\/editorial-ideas\/[^/]+$/.test(path) && method === "PATCH") {
      const id = path.split("/")[3]!;
      const body = request.postDataJSON() as Record<string, unknown>;
      log.patches.push({ id, body });
      const current = (IDEAS[WORKSPACE_ID] as { id: string }[]).find((item) => item.id === id) ?? idea(id, "Ideia");
      return ok({ ...current, ...body });
    }
    if (path === "/v1/editorial-ideas" && method === "POST") return ok(idea("idea-new", "Nova"));
    if (path === "/v1/production/ideas/generate") {
      log.generate.push(request.postDataJSON() as Record<string, unknown>);
      return ok({ executionRunId: "run-new" });
    }
    if (path === "/v1/execution-runs/run-new") {
      const state = options.runState ?? "waiting_for_approval";
      return ok({ run: { id: "run-new", state }, attempts: state === "failed" ? [{ failure: { code: "GENERATION_FAILED", message: "A IA não conseguiu criar a arte desta vez." } }] : [], artifacts: [], tasks: [] });
    }
    if (path === "/v1/production/creative-engine/status") return ok({ enabled: true });
    if (path === "/v1/production-settings") return ok({ productionPrompt: "" });
    if (path === "/v1/assets") return ok([]);
    if (path === "/v1/publication-media/upload") {
      log.uploads += 1;
      return ok({ url: `https://cdn.example.test/upload-${log.uploads}.png`, contentType: "image/png", sizeBytes: 68 });
    }
    if (path === "/v1/social/settings") return ok({ timezone: "America/Sao_Paulo", networks: [] });
    if (path === "/v1/social/composer") {
      return ok({
        accounts: [
          { accountId: "acc-instagram", network: "instagram", username: "loja", publishable: true, formats, musicSearch: false },
          ...(options.tiktokUnavailable ? [{ accountId: "acc-tiktok", network: "tiktok", username: "loja", publishable: false, warning: "Sua conta do TikTok precisa ser reconectada.", formats: [], musicSearch: false }] : []),
        ],
      });
    }
    if (path === "/v1/social/posts/validate") {
      const body = request.postDataJSON() as { destinations: { accountId: string; format: string }[] };
      return ok({ destinations: body.destinations.map((item) => ({ accountId: item.accountId, network: "instagram", format: item.format, issues: [], warnings: [] })) });
    }
    if (path === "/v1/social/posts" && method === "POST") {
      postAttempts += 1;
      log.posts.push(request.postDataJSON() as Record<string, unknown>);
      if (options.failFirstPost && postAttempts === 1) return route.fulfill({ status: 503, json: { ok: false, error: { code: "TEMPORARY", message: "Instabilidade momentânea. Tente de novo.", recoverable: true } } });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return ok({ id: "post-1", state: "SCHEDULED", createdAt: now, requiresApproval: false, destinations: [], history: [] }, 201);
    }
    if (path === "/v1/social/posts" && method === "GET") {
      return ok({ posts: workspaceId === WORKSPACE_ID ? [
        { id: "p-a", state: "SCHEDULED", createdAt: now, requiresApproval: false, destinations: [], history: [] },
        { id: "p-b", state: "FAILED", createdAt: now, requiresApproval: false, destinations: [], history: [] },
        { id: "p-c", state: "AWAITING_APPROVAL", createdAt: now, requiresApproval: true, destinations: [], history: [] },
      ] : [] });
    }
    return route.fallback();
  });
  return log;
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;

test.describe("Criar conteúdo — desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("porta única: escolha entre IA e conteúdo pronto + jornada com números reais", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/create`);
    await expect(page.getByRole("heading", { level: 1, name: "Criar conteúdo" })).toBeVisible();
    await expect(page.getByTestId("create-modes").getByRole("tab")).toHaveText([/Criar com IA/, /Publicar conteúdo pronto/]);
    const pipeline = page.getByTestId("content-pipeline");
    await expect(pipeline.locator("[data-step='ideas']")).toContainText("2");
    await expect(pipeline.locator("[data-step='in_production']")).toContainText("1");
    await expect(pipeline.locator("[data-step='review']")).toContainText("1");
    await expect(pipeline.locator("[data-step='scheduled']")).toContainText("1");
    await expect(pipeline.locator("[data-step='failed']")).toContainText("1");
    await expect(pipeline.locator("[data-step='failed']")).toHaveAttribute("href", `${base()}/campaigns?status=failed`);
    // Menu: Criar conteúdo aceso; Publicar/Criar publicação não estão mais no menu.
    const nav = page.locator("nav[aria-label='Menu principal']");
    await expect(nav.locator("[data-area-items='marketing'] a[aria-current='page']")).toHaveText("Criar conteúdo");
    // Fase 5: menu definitivo (Publicações virou o Calendário único; Integrações e Marca foram para Configurações).
    await expect(nav.locator("[data-area-items='marketing'] a")).toHaveText(["Bolsão de ideias", "Criar conteúdo", "Revisão", "Conteúdos", "Calendário", "Anúncios"]);
  });

  test("1. a partir do Bolsão: preserva prompt e referências, marca a ideia em produção e leva à Revisão", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/create?modo=ia`);
    const picker = page.getByTestId("idea-picker");
    await expect(picker.locator("[data-idea]")).toHaveCount(2); // só pendentes
    await expect(picker.locator("[data-idea='idea-1']")).toContainText("data editorial 05/12");
    await expect(picker).toContainText("1 em produção");
    await picker.locator("[data-idea='idea-1']").click();
    await expect(page.getByTestId("idea-picker-selected")).toContainText("Mensagem de Vestido do mês");
    await page.getByTestId("idea-picker-produce").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/review$`));
    expect(log.generate).toHaveLength(1);
    expect(log.generate[0]).toMatchObject({ workspaceId: WORKSPACE_ID, creativePrompt: "prompt-original-idea-1", referenceImages: ["https://cdn.example.test/ref-1.jpg"], channel: "instagram" });
    expect(log.patches).toEqual([{ id: "idea-1", body: { workspaceId: WORKSPACE_ID, status: "in_production", executionRunId: "run-new" } }]);
  });

  test("1b. criação falhou: a ideia volta a ficar disponível e a mensagem explica", async ({ page }) => {
    const log = await setup(page, { runState: "failed" });
    await page.goto(`${base()}/create?modo=ia`);
    await page.getByTestId("idea-picker").locator("[data-idea='idea-2']").click();
    await page.getByTestId("idea-picker-produce").click();
    await expect(page.getByTestId("idea-picker").getByRole("alert")).toContainText("A IA não conseguiu criar a arte desta vez.");
    await expect(page).toHaveURL(new RegExp(`${base()}/create\\?modo=ia$`));
    expect(log.patches.map((patch) => patch.body.status)).toEqual(["in_production", "available"]);
  });

  test("2. a partir de uma ideia nova: mesmo motor, leva à Revisão", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/create?modo=ia`);
    await page.getByLabel("O que você quer criar?").fill("Post anunciando a nova coleção de noivas");
    await page.getByRole("button", { name: "Gerar conteúdo" }).click();
    await expect(page).toHaveURL(new RegExp(`${base()}/review$`));
    expect(log.generate[0]).toMatchObject({ ideaText: "Post anunciando a nova coleção de noivas", workspaceId: WORKSPACE_ID });
  });

  test("3-9. mídia pronta: enviar, escolher rede, prévia, resumo, salvar e recuperar rascunho, agendar", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/create?modo=pronto`);
    await page.getByLabel("Enviar arquivos").setInputFiles({ name: "peca.png", mimeType: "image/png", buffer: TINY_PNG });
    await expect(page.getByTestId("social-media-list").locator("li")).toHaveCount(1);
    await page.getByLabel("Legenda", { exact: true }).fill("Nova coleção chegando!");
    await page.getByRole("checkbox", { name: /Instagram/ }).click();
    await expect(page.getByTestId("social-preview")).toContainText("Nova coleção chegando!");
    await expect(page.getByTestId("composer-summary")).toContainText("Conteúdo enviado por você");
    await expect(page.getByTestId("composer-summary")).toContainText("Instagram · Imagem no feed");
    // Salvar rascunho e recuperar depois de recarregar.
    await page.getByRole("button", { name: "Salvar rascunho" }).click();
    await page.reload();
    await expect(page.getByTestId("composer-saved-draft")).toBeVisible();
    await page.getByRole("button", { name: "Recuperar rascunho" }).click();
    await expect(page.getByLabel("Legenda", { exact: true })).toHaveValue("Nova coleção chegando!");
    await expect(page.getByTestId("social-media-list").locator("li")).toHaveCount(1);
    // Agendar (data/hora da PUBLICAÇÃO, distinta da data editorial).
    await page.getByRole("radio", { name: "Agendar" }).click();
    await expect(page.getByLabel("Data da publicação")).toBeVisible();
    await expect(page.getByTestId("composer-summary")).toContainText(" às ");
    await page.getByRole("button", { name: "Agendar publicação" }).click();
    await expect(page).toHaveURL(/\/calendar\?post=post-1/);
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0]).toMatchObject({ workspaceId: WORKSPACE_ID, when: { mode: "schedule", timezone: "America/Sao_Paulo" }, base: { caption: "Nova coleção chegando!", media: [{ url: "https://cdn.example.test/upload-1.png", kind: "image" }] } });
    // Publicado/agendado: o rascunho some.
    await page.goto(`${base()}/create?modo=pronto`);
    await expect(page.getByLabel("Legenda", { exact: true })).toBeVisible();
    await expect(page.getByTestId("composer-saved-draft")).toHaveCount(0);
  });

  test("9-10. publicar agora preservado e sem duplicidade (duplo clique e nova tentativa usam a mesma chave)", async ({ page }) => {
    const log = await setup(page, { failFirstPost: true });
    await page.goto(`${base()}/create?modo=pronto&media=${encodeURIComponent("https://cdn.example.test/arte.png")}&caption=${encodeURIComponent("Promoção relâmpago")}`);
    await page.getByRole("checkbox", { name: /Instagram/ }).click();
    const publish = page.getByRole("button", { name: "Publicar agora" }).last();
    await publish.dblclick();
    await expect.poll(() => log.posts.length).toBe(1); // falhou (503): nada publicado, uma tentativa só
    await page.waitForTimeout(500);
    expect(log.posts).toHaveLength(1);
    await publish.click();
    await expect(page).toHaveURL(/\/calendar\?post=post-1/);
    expect(log.posts).toHaveLength(2);
    expect(log.posts[0]!.when).toEqual({ mode: "now" });
    expect(log.posts[1]!.idempotencyKey).toBe(log.posts[0]!.idempotencyKey);
  });

  test("11. conexão indisponível é explicada com a ação certa", async ({ page }) => {
    await setup(page, { tiktokUnavailable: true });
    await page.goto(`${base()}/create?modo=pronto`);
    const choices = page.getByTestId("social-network-choices");
    await expect(choices).toContainText("Sua conta do TikTok precisa ser reconectada.");
    await expect(choices.getByRole("link", { name: "Reconectar TikTok" })).toBeVisible();
    await expect(choices.getByRole("checkbox", { name: /TikTok/ })).toHaveCount(0);
  });

  test("12. sem permissão de publicar: avisado na escolha e o botão não publica", async ({ page }) => {
    const permissions = OWNER_PERMISSIONS.filter((permission) => permission !== "marketing:social_publish" && permission !== "marketing:social_schedule");
    const log = await setup(page, { permissions });
    await page.goto(`${base()}/create`);
    await expect(page.getByTestId("create-modes")).toContainText("Seu perfil pode montar o post, mas não publicar nem agendar.");
    await page.goto(`${base()}/create?modo=pronto&media=${encodeURIComponent("https://cdn.example.test/arte.png")}&caption=Oi`);
    await page.getByRole("checkbox", { name: /Instagram/ }).click();
    await page.getByRole("button", { name: "Publicar agora" }).last().click({ force: true });
    await page.waitForTimeout(600);
    expect(log.posts).toHaveLength(0);
  });

  test("13. trocar de workspace não leva rascunho, ideias nem publicações da empresa anterior", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/create?modo=pronto&media=${encodeURIComponent("https://cdn.example.test/arte.png")}&caption=${encodeURIComponent("Só da Vorix")}`);
    await page.getByRole("button", { name: "Salvar rascunho" }).click();
    await page.getByTestId("workspace-switcher").click();
    log.workspaceIds.clear();
    await page.locator(`[data-workspace-option='${OTHER_ID}']`).click();
    await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}/create$`));
    await expect(page.getByTestId("content-pipeline").locator("[data-step='ideas']")).toContainText("1");
    await expect(page.getByTestId("content-pipeline").locator("[data-step='failed']")).toContainText("0");
    await page.getByTestId("create-modes").locator("[data-mode='pronto']").click();
    await expect(page.getByLabel("Legenda", { exact: true })).toHaveValue("");
    await expect(page.getByTestId("composer-saved-draft")).toHaveCount(0);
    await page.getByTestId("create-modes").locator("[data-mode='ia']").click();
    await expect(page.getByTestId("idea-picker").locator("[data-idea]")).toHaveText([/Buffet completo/]);
    expect([...log.workspaceIds]).toEqual([OTHER_ID]);
  });

  test("14. '+ Criar' do Início abre direto o fluxo certo", async ({ page }) => {
    await setup(page);
    await page.goto(base());
    await page.getByTestId("home-create").click();
    await page.getByTestId("home-create-menu").locator("[data-create='content']").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/create\\?modo=ia$`));
    await expect(page.getByTestId("idea-picker")).toBeVisible();
    await page.goto(base());
    await page.getByTestId("home-create").click();
    await page.getByTestId("home-create-menu").locator("[data-create='post']").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/create\\?modo=pronto$`));
    await expect(page.getByTestId("social-network-choices")).toBeVisible();
  });

  test("15. links antigos: /social/compose e /create?draft= continuam funcionando; Voltar não fica preso", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/ideias`);
    await page.goto(`${base()}/social/compose?media=${encodeURIComponent("https://cdn.example.test/v.png")}&caption=${encodeURIComponent("Da Revisão")}&source=run-7`);
    await expect(page).toHaveURL(new RegExp(`${base()}/create\\?modo=pronto&media=`));
    await expect(page.getByLabel("Legenda", { exact: true })).toHaveValue("Da Revisão");
    await expect(page.getByTestId("composer-summary")).toContainText("Criado com IA e aprovado na Revisão");
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}/ideias$`));
    await page.goto(`${base()}/create?draft=${encodeURIComponent("Ideia vinda do atalho")}`);
    await expect(page.getByLabel("O que você quer criar?")).toHaveValue("Ideia vinda do atalho");
    await expect(page.getByTestId("create-modes").locator("[data-mode='ia']")).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Criar conteúdo — responsividade", () => {
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    test(`${width}px: escolha, IA e conteúdo pronto sem rolagem lateral`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page);
      for (const query of ["", "?modo=ia", "?modo=pronto"]) {
        await page.goto(`${base()}/create${query}`);
        await expect(page.getByTestId("create-hub")).toBeVisible();
        if (query === "?modo=ia") await expect(page.getByTestId("idea-picker").locator("[data-idea]").first()).toBeVisible();
        if (query === "?modo=pronto") await expect(page.getByTestId("social-network-choices")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}${query}`).toBe(true);
        const tabs = await page.getByTestId("create-modes").getByRole("tab").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((box) => ({ right: box.right, height: box.height })));
        for (const tab of tabs) {
          expect(tab.right).toBeLessThanOrEqual(width);
          expect(tab.height).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }
});

// Capturas para o relatório (só com CREATE_CAPTURE_DIR; dados 100% simulados).
test.describe("capturas de Criar conteúdo", () => {
  test.skip(!process.env.CREATE_CAPTURE_DIR, "defina CREATE_CAPTURE_DIR para gerar as capturas");
  for (const [name, width, height] of [["desktop", 1440, 1000], ["celular", 390, 844]] as const) {
    for (const [mode, query] of [["escolha", ""], ["ia", "?modo=ia"], ["pronto", `?modo=pronto&media=${encodeURIComponent("https://cdn.example.test/arte.png")}&caption=${encodeURIComponent("Nova coleção de noivas chegando! ✨")}&source=run-7`]] as const) {
      test(`${name} ${mode}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.addInitScript(() => window.localStorage.setItem("theme", "light"));
        await setup(page);
        await page.route("https://cdn.example.test/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+P/fwAJiAPmBTOYqwAAAABJRU5ErkJggg==", "base64") }));
        await page.goto(`${base()}/create${query}`);
        await expect(page.getByTestId("create-hub")).toBeVisible();
        if (mode === "ia") { await page.getByTestId("idea-picker").locator("[data-idea='idea-1']").click(); }
        if (mode === "pronto") { await page.getByRole("checkbox", { name: /Instagram/ }).click(); }
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${process.env.CREATE_CAPTURE_DIR}/criar-${mode}-${name}.png`, fullPage: true });
      });
    }
  }
});
