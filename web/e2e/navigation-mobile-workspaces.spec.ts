import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 2: navegação do celular e troca de espaço de trabalho, num Chromium
 * real com a API toda mockada (nenhuma chamada sai da máquina). Cobre a barra inferior por
 * ferramentas contratadas, o "Menu" (seta não navega), a troca de workspace com busca e
 * isolamento, Voltar, links diretos, áreas não contratadas e a responsividade de 320 px ao desktop.
 */

type SolutionKey = "conversations" | "marketing" | "meetings" | "site";
const OTHER_ID = "ws-qa-casamento";
const now = new Date().toISOString();
const workspace = (id: string, name: string) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: {}, createdAt: now, updatedAt: now, campaignIds: [], integrations: [], members: [] });
const WORKSPACES = [
  workspace(WORKSPACE_ID, "Vorix Works"),
  workspace(OTHER_ID, "Casamento São Paulo"),
  workspace("ws-qa-cmkv", "CMKV Acessórios"),
  workspace("ws-qa-rumo", "Rumo ao Altar"),
  workspace("ws-qa-bambilu", "Bambilu Fashion"),
  workspace("ws-qa-aurora", "Aurora Eventos"),
  workspace("ws-qa-zeta", "Zeta Consultoria com um nome bem comprido para testar o corte"),
];

async function setup(page: Page, solutions: readonly SolutionKey[] = ["conversations", "marketing", "site", "meetings"], role = "owner") {
  const writes: string[] = [];
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !path.startsWith("/v1/auth/") && !path.endsWith("/stream-token")) writes.push(`${request.method()} ${path}`);
    if (path === "/v1/auth/refresh") return ok({ accessToken: "qa", expiresIn: 900, tenantId: TENANT_ID, role });
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role, permissions: OWNER_PERMISSIONS, teams: [], isAccountOwner: role === "owner" });
    if (path === "/v1/solutions") return ok({ solutions: solutions.map((key) => ({ key, name: key, internal: false })) });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const match = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (match && request.method() === "GET") {
      const found = WORKSPACES.find((item) => item.id === match[1]);
      return found ? ok(found) : route.fulfill({ status: 404, json: { ok: false, error: { code: "NOT_FOUND", message: "não encontrado" } } });
    }
    return route.fallback();
  });
  return { writes };
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;
const bar = (page: Page) => page.getByTestId("mobile-bottom-nav");
const barLabels = (page: Page) => bar(page).locator("a, button").evaluateAll((els) => els.map((el) => el.textContent?.trim()));

test.describe("celular", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("barra inferior: áreas principais da conta completa + Menu", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/conversas`);
    await expect(bar(page)).toBeVisible();
    await expect.poll(() => barLabels(page)).toEqual(["Início", "Conversas", "Marketing", "Meu site", "Reuniões", "Menu"]);
    await expect(bar(page).locator("[data-area='conversations']")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("nav[aria-label='Menu principal']")).toBeHidden();
  });

  test("só ferramentas contratadas, sem botão vazio (conta só com Conversas)", async ({ page }) => {
    await setup(page, ["conversations"]);
    await page.goto(`${base()}/conversas`);
    await expect.poll(() => barLabels(page)).toEqual(["Início", "Conversas", "Vendas", "Resultados", "Menu"]);
    // Os botões ocupam a barra inteira (nenhuma vaga vazia).
    const widths = await bar(page).locator("a, button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(Math.min(...widths)).toBeGreaterThan(60);
  });

  test("conta só com Reuniões: nada de Conversas/Marketing; link de Marketing mostra 'Página não disponível'", async ({ page }) => {
    await setup(page, ["meetings"]);
    // A API mockada não tem dados de Reuniões; a tela bloqueada do Marketing mostra o menu do mesmo jeito.
    await page.goto(`${base()}/ideias`);
    await expect(page.getByTestId("solution-blocked")).toBeVisible();
    await expect.poll(() => barLabels(page)).toEqual(["Reuniões", "Menu"]);
    await bar(page).getByRole("button", { name: /menu/i }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu.locator("[data-area]")).toHaveText(["Reuniões", "Configurações"]);
    await expect(menu.locator("[data-area='meetings']")).toHaveAttribute("href", `${base()}/meetings`);
    await page.keyboard.press("Escape");
  });

  test("Menu: lista todas as áreas, a seta não navega, escolher uma tela navega e fecha", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/conversas`);
    await bar(page).getByRole("button", { name: /menu/i }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Vorix Works")).toBeVisible();
    await expect(menu.locator("[data-area]")).toHaveText(["Início", "Conversas", "Vendas", "Marketing", "Meu site", "Reuniões", "Resultados", "Configurações"]);
    await expect(menu.locator("[data-area='conversations']")).toHaveAttribute("data-active", "true");
    const before = page.url();
    await menu.getByRole("button", { name: "Mostrar telas de Vendas" }).click();
    expect(page.url()).toBe(before);
    await expect(menu.locator("[data-area-items='sales'] a")).toHaveText(["Oportunidades", "Contatos", "Produtos", "Tarefas", "Propostas", "Oportunidades do site", "Propostas do site"]);
    await menu.locator("[data-area-items='sales'] a", { hasText: /^Contatos$/ }).click();
    await expect(page).toHaveURL(new RegExp(`${base()}/contacts$`));
    await expect(menu).toBeHidden();
    // Área fora da barra: o botão Menu fica aceso.
    await expect(bar(page).getByRole("button", { name: /menu/i })).toHaveAttribute("data-active", "true");
    // Voltar do navegador volta para Conversas e a barra acompanha.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}/conversas$`));
    await expect(bar(page).locator("[data-area='conversations']")).toHaveAttribute("aria-current", "page");
  });

  test("Menu fecha com Esc, com o X e devolve o foco ao botão", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/conversas`);
    const trigger = bar(page).getByRole("button", { name: /menu/i });
    await trigger.click();
    await expect(page.getByRole("button", { name: "Fechar menu" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole("button", { name: "Fechar menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();
  });

  test("link direto acende a área certa na barra", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/meetings/agenda`);
    await expect(bar(page).locator("[data-area='meetings']")).toHaveAttribute("aria-current", "page");
  });

  test("bastidor só para owner/admin", async ({ page }) => {
    await setup(page, ["conversations", "marketing"], "member");
    await page.goto(`${base()}/conversas`);
    await bar(page).getByRole("button", { name: /menu/i }).click();
    await expect(page.getByRole("dialog", { name: "Menu" }).getByText("Bastidor")).toHaveCount(0);
  });
});

test.describe("troca de espaço de trabalho", () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    test(`busca, marca o atual e troca sem levar filtros nem registro (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { writes } = await setup(page);
      await page.goto(`${base()}/conversas`);
      await page.goto(`${base()}/deals?status=won&q=carla`);
      const switcher = page.getByTestId("workspace-switcher");
      await expect(switcher).toContainText("Vorix Works");
      await switcher.click();
      const options = page.locator("[data-workspace-option]");
      await expect(options).toHaveCount(WORKSPACES.length);
      await expect(options.first()).toContainText("Vorix Works");
      await expect(options.first()).toContainText("Atual");
      await expect(options.first()).toHaveAttribute("aria-current", "true");
      // Ordem alfabética depois do atual.
      await expect(options.nth(1)).toContainText("Aurora Eventos");
      // Busca sem acento/caixa.
      await page.getByPlaceholder("Buscar espaço").fill("SAO paulo");
      await expect(options).toHaveCount(1);
      await page.getByPlaceholder("Buscar espaço").fill("xyz");
      await expect(page.getByText("Nenhum espaço encontrado com esse nome.")).toBeVisible();
      await page.getByPlaceholder("Buscar espaço").fill("casamento");
      await options.first().click();
      // Mesma área (Vendas → Oportunidades) no outro espaço, sem a busca/filtro do anterior.
      await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}/deals$`));
      await expect(switcher).toContainText("Casamento São Paulo");
      // O seletor reabre limpo (sem a busca anterior).
      await switcher.click();
      await expect(page.getByPlaceholder("Buscar espaço")).toHaveValue("");
      await expect(options.first()).toContainText("Casamento São Paulo");
      await page.keyboard.press("Escape");
      // Todos os links do app agora apontam para o novo espaço.
      const hrefs = await page.locator("a[href^='/workspaces/']").evaluateAll((els) => els.map((el) => el.getAttribute("href")!));
      expect(hrefs.filter((href) => !href.startsWith(base(OTHER_ID)))).toEqual([]);
      // Voltar retorna ao espaço anterior, na tela anterior.
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${base()}/deals\\?status=won&q=carla$`));
      await expect(switcher).toContainText("Vorix Works");
      expect(writes).toEqual([]);
    });
  }

  test("registro aberto não é levado para o outro espaço; tela interna de Reuniões é mantida", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await page.goto(`${base()}/meetings/agenda`);
    await page.getByTestId("workspace-switcher").click();
    await expect(page.locator(`[data-workspace-option='${OTHER_ID}']`)).toHaveAttribute("href", `${base(OTHER_ID)}/meetings/agenda`);
    await page.keyboard.press("Escape");
    await page.goto(`${base()}/settings/users`);
    await page.getByTestId("workspace-switcher").click();
    await expect(page.locator(`[data-workspace-option='${OTHER_ID}']`)).toHaveAttribute("href", `${base(OTHER_ID)}/settings`);
  });
});

test.describe("responsividade", () => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: sem rolagem lateral, sem texto cortado, sem sobreposição`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 720 : 900 });
      await setup(page);
      await page.goto(`${base()}/conversas`);
      await expect(page.getByTestId("workspace-switcher")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const switcherBox = await page.getByTestId("workspace-switcher").boundingBox();
      expect(switcherBox!.x + switcherBox!.width).toBeLessThanOrEqual(width);
      if (width < 768) {
        await expect(bar(page)).toBeVisible();
        const items = await bar(page).locator("a, button").evaluateAll((els) =>
          els.map((el) => {
            const box = el.getBoundingClientRect();
            const label = el.querySelector("span:last-child") as HTMLElement;
            return { left: box.left, right: box.right, height: box.height, cut: label.scrollWidth > label.clientWidth + 0.5 };
          }),
        );
        expect(items).toHaveLength(6);
        for (const item of items) {
          expect(item.cut).toBe(false);
          expect(item.height).toBeGreaterThanOrEqual(44);
          expect(item.left).toBeGreaterThanOrEqual(0);
          expect(item.right).toBeLessThanOrEqual(width);
        }
        for (let index = 1; index < items.length; index += 1) expect(items[index]!.left).toBeGreaterThanOrEqual(items[index - 1]!.right - 0.5);
        await bar(page).getByRole("button", { name: /menu/i }).click();
        const menu = page.getByRole("dialog", { name: "Menu" });
        await expect(menu).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const menuBox = await menu.boundingBox();
        expect(menuBox!.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
      } else {
        await expect(bar(page)).toBeHidden();
        await expect(page.locator("nav[aria-label='Menu principal']")).toBeVisible();
      }
      await page.getByTestId("workspace-switcher").click();
      const panel = page.locator("[data-workspace-option]").first();
      await expect(panel).toBeVisible();
      const listBox = await page.getByRole("list", { name: "Espaços de trabalho" }).boundingBox();
      expect(listBox!.x).toBeGreaterThanOrEqual(0);
      expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test.describe("sem regressão da Fase 1 (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("8 áreas, 1 clique troca de ferramenta no mesmo espaço, seta não navega", async ({ page }) => {
    await setup(page);
    // Em Conversas o menu lateral abre recolhido (modo foco, já era assim); a lista começa em Contatos.
    await page.goto(`${base()}/contacts`);
    const nav = page.locator("nav[aria-label='Menu principal']");
    await expect(nav.locator("[data-area]")).toHaveText(["Início", "Conversas", "Vendas", "Marketing", "Meu site", "Reuniões", "Resultados", "Configurações"]);
    await nav.locator("[data-area='sales']").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/deals$`));
    await expect(nav.locator("[data-area='sales']")).toHaveAttribute("data-active", "true");
    const before = page.url();
    await nav.getByRole("button", { name: "Mostrar telas de Reuniões" }).click();
    expect(page.url()).toBe(before);
    await expect(nav.locator("[data-area-items='meetings'] a")).toHaveCount(8);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}/contacts$`));
    await expect(nav.locator("[data-area='sales']")).toHaveAttribute("data-active", "true");
    await expect(nav.locator("[data-area-items='sales'] a[aria-current='page']")).toHaveText("Contatos");
    await nav.locator("[data-area='marketing']").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/ideias$`));
  });

  test("desktop e celular mostram as mesmas áreas", async ({ page }) => {
    await setup(page, ["conversations", "site"]);
    await page.goto(`${base()}/conversas`);
    const nav = page.locator("nav[aria-label='Menu principal']");
    await expect(nav.locator("[data-area]").first()).toBeVisible();
    const desktop = await nav.locator("[data-area]").evaluateAll((els) => els.map((el) => el.getAttribute("data-area")));
    await page.setViewportSize({ width: 390, height: 844 });
    await bar(page).getByRole("button", { name: /menu/i }).click();
    const mobile = await page.getByRole("dialog", { name: "Menu" }).locator("[data-area]").evaluateAll((els) => els.map((el) => el.getAttribute("data-area")));
    expect(desktop).toEqual(["home", "conversations", "sales", "site", "results", "settings"]);
    expect(mobile).toEqual(desktop);
  });
});
