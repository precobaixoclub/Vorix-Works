import { test, expect, type Page } from "@playwright/test";

/**
 * Auditoria de responsividade com backend real de fixture (`playwright.mobile-audit.config.ts`):
 * cada tela, com dados de verdade, não pode passar da largura do celular.
 */
const ROUTES = [
  "", "conversas", "kanban", "contacts", "deals", "proposals", "tasks", "results", "products", "dashboard",
  "settings", "settings/attendance", "settings/automations", "settings/commercial", "settings/goals", "settings/plano", "settings/products", "settings/teams", "settings/users", "settings/marketplaces",
  "site", "site/analytics", "site/oportunidades", "site/pedidos", "site/products", "site/propostas",
];

async function overflowing(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollsX = (element: Element | null): boolean => {
      for (let node = element?.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (["auto", "scroll"].includes(style.overflowX) && node.getBoundingClientRect().right <= width + 1) return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.right <= width + 1) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.position === "fixed") continue;
      if (scrollsX(element)) continue;
      // Só o elemento mais externo que estoura (os filhos dele estouram junto).
      if (element.parentElement && element.parentElement.getBoundingClientRect().right > width + 1 && !scrollsX(element.parentElement) && element.parentElement !== document.body) continue;
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
      offenders.push(`<${element.tagName.toLowerCase()} class="${String(element.getAttribute("class") ?? "").slice(0, 120)}"> +${Math.round(rect.right - width)}px "${text}"`);
    }
    return { pageScrollsX: document.documentElement.scrollWidth > width + 1, offenders: offenders.slice(0, 8) };
  });
}

let scope: { email: string; password: string; workspaceId: string };

test.beforeAll(async ({ request }) => {
  scope = await (await request.get("http://127.0.0.1:3390/fixture-only/scope")).json();
  for (const [phone, body] of [["+5511987650001", "Olá, gostaria de saber o preço do pulverizador e se vocês entregam no interior de São Paulo"], ["+5511987650002", "Bom dia!"]] as const) {
    await request.post("http://127.0.0.1:3390/fixture-only/whatsapp-inbound", { data: { phone, body } });
  }
});

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(scope.email);
  await page.getByLabel("Senha", { exact: true }).fill(scope.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/workspaces(?:\/|$)/);
});

for (const route of ROUTES) {
  test(`/${route || "(início)"} cabe na tela`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/workspaces/${scope.workspaceId}/${route}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/mobile-audit/${testInfo.project.name}/${(route || "inicio").replace(/\//g, "_")}.png`, fullPage: true });
    expect({ errors, ...(await overflowing(page)) }).toEqual({ errors: [], pageScrollsX: false, offenders: [] });
  });
}

test("conversa aberta: tela cheia, ações visíveis e campo de mensagem", async ({ page }, testInfo) => {
  await page.goto(`/workspaces/${scope.workspaceId}/conversas`);
  await page.getByText(/gostaria de saber o preço/).first().click();
  await expect(page.getByRole("button", { name: /Assumir/ })).toBeVisible();
  await expect(page.locator("nav.mobile-chat-hide")).toBeHidden();
  await expect(page.getByPlaceholder(/^Mensagem$|Digite uma mensagem/)).toBeVisible();
  await page.screenshot({ path: `test-results/mobile-audit/${testInfo.project.name}/conversa-aberta.png` });
  expect(await overflowing(page)).toEqual({ pageScrollsX: false, offenders: [] });
  await page.getByRole("button", { name: "Voltar para a lista" }).click();
  await expect(page.locator("nav.mobile-chat-hide")).toBeVisible();
});
