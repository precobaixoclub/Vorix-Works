import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Fase 14 — verificações automáticas de acessibilidade (sem dependência nova): o que impede o uso
 * real por teclado e leitor de tela. Páginas públicas e telas autenticadas com API simulada.
 */

type Issue = { kind: string; detail: string };

async function audit(page: Page): Promise<Issue[]> {
  return page.evaluate(() => {
    const issues: { kind: string; detail: string }[] = [];
    const visible = (el: Element) => {
      const box = (el as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(el as HTMLElement);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && !(el as HTMLElement).closest("[aria-hidden='true']");
    };
    const name = (el: Element) => {
      const labelledby = el.getAttribute("aria-labelledby");
      const byId = labelledby ? labelledby.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
      // Botões e interruptores dentro de <label> recebem o nome do rótulo (elemento rotulável).
      const labelText = el.closest("label")?.textContent ?? "";
      return labelText + (el.getAttribute("aria-label") ?? "") + byId + (el.textContent ?? "") + (el.getAttribute("title") ?? "") + ((el as HTMLInputElement).value && el.tagName === "INPUT" && ["submit", "button"].includes((el as HTMLInputElement).type) ? (el as HTMLInputElement).value : "") + [...el.querySelectorAll("img[alt]")].map((img) => img.getAttribute("alt")).join("");
    };
    for (const el of document.querySelectorAll("button, a[href], [role='button'], [role='tab'], [role='link']")) {
      if (visible(el) && !name(el).trim()) issues.push({ kind: "sem-nome", detail: el.outerHTML.slice(0, 160) });
    }
    for (const el of document.querySelectorAll("input:not([type='hidden']), select, textarea")) {
      if (!visible(el)) continue;
      const id = el.getAttribute("id");
      const labelled = Boolean(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label") || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.getAttribute("title"));
      if (!labelled) issues.push({ kind: "campo-sem-rotulo", detail: el.outerHTML.slice(0, 160) });
    }
    for (const img of document.querySelectorAll("img")) if (visible(img) && !img.hasAttribute("alt")) issues.push({ kind: "imagem-sem-alt", detail: img.outerHTML.slice(0, 160) });
    if (!document.documentElement.lang) issues.push({ kind: "sem-idioma", detail: "<html> sem lang" });
    if (document.querySelectorAll("h1").length === 0) issues.push({ kind: "sem-h1", detail: location.pathname });
    const ids = new Map<string, number>();
    for (const el of document.querySelectorAll("[id]")) if (el.id) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
    for (const [id, count] of ids) if (count > 1 && !id.startsWith("radix-")) issues.push({ kind: "id-duplicado", detail: `${id} ×${count}` });
    return issues;
  });
}

const PUBLIC = ["/", "/precos", "/produtos/conversas", "/produtos/marketing", "/produtos/site", "/produtos/meetings", "/login", "/signup", "/empresa"];

test.describe("Fase 14 — acessibilidade automatizada", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("páginas públicas: sem controles sem nome, campos sem rótulo, imagens sem alt, ids duplicados", async ({ page }) => {
    const all: string[] = [];
    for (const path of PUBLIC) {
      await page.goto(path);
      await page.waitForTimeout(400);
      for (const issue of await audit(page)) all.push(`${path} [${issue.kind}] ${issue.detail}`);
    }
    expect(all).toEqual([]);
  });

  test("telas autenticadas principais: mesmas verificações", async ({ page }) => {
    await loginCookie(page.context());
    await mockConversasBackend(page);
    await page.route("**/v1/auth/me", (route) => route.fulfill({ json: { ok: true, data: { user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: OWNER_PERMISSIONS, teams: [], isAccountOwner: true } } }));
    const all: string[] = [];
    for (const path of ["", "/conversas", "/deals", "/settings", "/settings/perfil", "/settings/integracoes", "/results"]) {
      await page.goto(`/workspaces/${WORKSPACE_ID}${path}`);
      await page.waitForTimeout(1200);
      for (const issue of await audit(page)) all.push(`${path || "/"} [${issue.kind}] ${issue.detail}`);
    }
    expect(all).toEqual([]);
  });

  test("teclado: o primeiro Tab mostra o atalho para o conteúdo e o foco fica visível", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return { text: el.textContent?.trim(), href: el.getAttribute("href"), outline: style.outlineStyle !== "none" || style.boxShadow !== "none" };
    });
    expect(focused.href).toBe("#conteudo");
    expect(focused.outline).toBe(true);
  });
});

test.describe("capturas da Fase 14", () => {
  test.skip(!process.env.PHASE14_CAPTURE_DIR, "defina PHASE14_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["metas-desktop", "/settings/goals", 1440],
    ["conversas-desktop", "/conversas", 1440],
    ["oportunidades-tablet", "/deals", 768],
    ["configuracoes-tablet", "/settings", 768],
    ["inicio-celular", "", 390],
    ["conversas-celular", "/conversas", 390],
  ] as const;
  for (const [name, path, width] of shots) {
    test(name, async ({ page }) => {
      await loginCookie(page.context());
      await mockConversasBackend(page);
      await page.route("**/v1/auth/me", (route) => route.fulfill({ json: { ok: true, data: { user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: OWNER_PERMISSIONS, teams: [], isAccountOwner: true } } }));
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto(`/workspaces/${WORKSPACE_ID}${path}`);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${process.env.PHASE14_CAPTURE_DIR}/${name}.png` });
    });
  }
});
