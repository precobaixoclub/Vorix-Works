import { expect, test } from "@playwright/test";
import { loginCookie, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

const products = ["conversas", "marketing", "site", "meetings"] as const;
const fixtureBase = process.env.VORIX_PUBLIC_QA_BASE_URL;

test.describe("Site comercial com catálogo local simulado", () => {
  test.skip(!fixtureBase, "Use a prévia local com a API de catálogo simulada.");

  test.beforeEach(async ({ context }) => {
    await context.route("**/*", route => {
      const { hostname } = new URL(route.request().url());
      return ["localhost", "127.0.0.1"].includes(hostname) ? route.continue() : route.abort();
    });
  });

  test("home e páginas de produto exibem a interface real, com imagens responsivas e navegação por teclado", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("do primeiro contato ao resultado");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Pular para o conteúdo" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#conteudo$/);
    await expect(page.locator("#solucoes article[data-module]")).toHaveCount(4);
    const dashboard = page.locator(".vc-hero-main img");
    await expect.poll(() => dashboard.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    if ((page.viewportSize()?.width ?? 0) <= 600) {
      expect(await dashboard.evaluate(img => (img as HTMLImageElement).currentSrc)).toContain("dashboard-mobile");
    }
    for (const slug of products) {
      const link = page.locator(`#solucoes a[href="/produtos/${slug}"]`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/produtos/${slug}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const screenshots = page.locator("main img[src*='/marketing/comercial/']");
      expect(await screenshots.count()).toBeGreaterThanOrEqual(4);
      for (const shot of await screenshots.all()) {
        await shot.scrollIntoViewIfNeeded();
        await expect.poll(() => shot.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect(shot).toHaveAttribute("alt", /\S+/);
        await expect(shot).toHaveAttribute("width", "1440");
        await expect(shot).toHaveAttribute("height", "960");
      }
      await expect(page.locator(".vc-gallery img").first()).toHaveAttribute("loading", "lazy");
      await page.getByRole("banner").getByRole("link", { name: "Vorix — início" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("do primeiro contato ao resultado");
    }
  });

  test("adicionais, recomendação explícita, combinações e períodos", async ({ page }) => {
    await page.goto("/precos");
    const summary = page.getByRole("complementary", { name: "Resumo da configuração" });
    const quote = (amount: number) => expect(summary.locator(".vc-quote-total strong")).toHaveText(`R$ ${amount.toLocaleString("pt-BR")}`);
    const checkout = summary.getByRole("link", { name: "Continuar para contratação" });
    const contact = summary.getByRole("link", { name: "Solicitar condições" });
    const choose = (name: string) => page.locator(".vc-picker-card").filter({ has: page.getByRole("checkbox", { name: `Vorix ${name}`, exact: true }) }).click();
    await quote(149);
    await expect(checkout).toHaveAttribute("href", /plan=START&users=2&numbers=1/);
    await page.getByLabel("Usuários", { exact: true }).fill("5");
    await page.getByLabel("Números de WhatsApp", { exact: true }).fill("2");
    await quote(345);
    await expect(page.getByText("Vale comparar o plano Pro.")).toBeVisible();
    await expect(page.getByLabel("Plano de Conversas")).toHaveValue("START");
    await page.getByRole("button", { name: "Selecionar Pro" }).click();
    await quote(299);
    await choose("Meetings");
    await page.getByLabel("Gravações simultâneas", { exact: true }).fill("2");
    await quote(513);
    await expect(checkout).toHaveAttribute("href", /plan=PRO.*recordings=2/);
    await choose("Marketing");
    await expect(contact).toHaveAttribute("href", /^mailto:comercial@vorixworks\.com/);
    await expect(checkout).toHaveCount(0);
    await choose("Site");
    const email = await contact.getAttribute("href");
    expect(decodeURIComponent(email ?? "")).toContain("Conversas, Marketing, Site, Meetings");
    await expect(summary).not.toContainText("419,90");
    await choose("Marketing");
    await choose("Site");
    await page.getByRole("radio", { name: "Anual" }).check();
    await quote(5130);
    await expect(checkout).toHaveAttribute("href", /intervalo=anual&recordings=2/);
    await page.getByLabel("Usuários", { exact: true }).fill("6");
    await expect(contact).toBeVisible();
    await expect(summary).toContainText("O catálogo público não informa");
    await choose("Conversas");
    await expect(summary.getByRole("link", { name: "Configurar na minha conta" })).toHaveAttribute("href", "/login?destino=reunioes");
  });

  test("checkout simulado recebe plano, período e capacidades, com cadastro único", async ({ context, page, baseURL }) => {
    const payments: unknown[] = [];
    let signups = 0;
    await page.route("**/v1/auth/signup", async route => {
      signups += 1;
      await loginCookie(context, baseURL);
      return route.fulfill({ status: 201, json: { ok: true, data: {
        accessToken: "qa-token", expiresIn: 900, tenantId: TENANT_ID, role: "owner",
        user: { id: "qa", email: "qa@empresa.invalid", name: "Pessoa QA", isPlatformAdmin: false },
      } } });
    });
    await page.route("**/v1/workspaces", route => route.fulfill({ json: { ok: true, data: [{ id: WORKSPACE_ID }] } }));
    await page.route("**/v1/billing/checkout", route => {
      payments.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, data: { checkoutUrl: `${baseURL}/gateway-simulado` } } });
    });
    await page.route("**/gateway-simulado", route => route.fulfill({ contentType: "text/plain", body: "Gateway simulado" }));
    await page.goto("/precos?modulo=suite");
    await page.getByRole("radio", { name: "Anual" }).check();
    await page.getByLabel("Gravações simultâneas", { exact: true }).fill("2");
    await page.getByRole("link", { name: "Continuar para contratação" }).click();
    await expect(page.getByText(/ciclo anual/)).toBeVisible();
    await page.getByLabel("Nome", { exact: true }).fill("Pessoa QA");
    await page.getByLabel("E-mail", { exact: true }).fill("qa@empresa.invalid");
    await page.getByLabel("Senha", { exact: true }).fill("senha-demonstrativa");
    await page.getByRole("button", { name: "Criar conta e ir para o pagamento" }).click();
    await expect(page).toHaveURL(/gateway-simulado$/);
    expect(signups).toBe(1);
    expect(payments).toEqual([{
      planCode: "START", billingInterval: "yearly", capacity: { users: 2, whatsappConnections: 1, concurrentRecordings: 2 },
      successPath: `/workspaces/${WORKSPACE_ID}/onboarding?checkout=sucesso`,
      cancelPath: `/workspaces/${WORKSPACE_ID}/settings/plano?checkout=cancelado`,
    }]);
  });

  test("direciona assinantes para a conta sem aceitar destinos arbitrários", async ({ request, baseURL }) => {
    const legacy = await request.get("/produtos/meetings/planos", { maxRedirects: 0 });
    const builder = new URL(legacy.headers().location, baseURL);
    expect([builder.pathname, builder.searchParams.get("modulo"), builder.hash]).toEqual(["/precos", "meetings", "#monte"]);
    const guest = await request.get("/conta/plano", { maxRedirects: 0 });
    expect(new URL(guest.headers().location, baseURL).pathname).toBe("/login");
    expect(new URL(guest.headers().location, baseURL).searchParams.get("destino")).toBe("assinatura");
    const cookie = { Cookie: "zuno_refresh_token=fixture" };
    const meetings = await request.get("/login?destino=reunioes", { maxRedirects: 0, headers: cookie });
    expect(new URL(meetings.headers().location, baseURL).hash).toBe("#plano-reunioes");
    const arbitrary = await request.get("/login?destino=https%3A%2F%2Fempresa.invalid", { maxRedirects: 0, headers: cookie });
    expect(new URL(arbitrary.headers().location, baseURL).pathname).toBe("/workspaces");
  });

  test("resumo e seleção têm contraste legível nas duas preferências de tema", async ({ page }) => {
    await page.goto("/precos");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const ratios = await page.evaluate(() => {
        const luminance = (color: string) => {
          const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(value => Number(value) / 255);
          return channels.reduce((total, value, index) => total + [0.2126, 0.7152, 0.0722][index]
            * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4), 0);
        };
        return [
          [".vc-config-summary h2", ".vc-config-summary"],
          [".vc-quote-total strong", ".vc-quote-total"],
          [".vc-picker-card strong", ".vc-picker-card"],
        ].map(([text, panel]) => {
          const foreground = luminance(getComputedStyle(document.querySelector(text)!).color);
          const background = luminance(getComputedStyle(document.querySelector(panel)!).backgroundColor);
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
      });
      expect(ratios.every(ratio => ratio >= 4.5), `${colorScheme}: ${ratios.join(", ")}`).toBe(true);
    }
  });
});
