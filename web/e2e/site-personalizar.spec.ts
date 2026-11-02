import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID, TENANT_ID } from "./fixtures/mock-backend";
import { initialSiteSnapshot } from "../features/sites/customization";
import type { TenantSite } from "../features/sites/types";

async function fixture(page: Page, existing = false) {
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/solutions", route => route.fulfill({ json: { ok: true, data: { solutions: [{ key: "conversations", name: "Conversas", internal: false }, { key: "site", name: "Site", internal: false }] } } }));
  let site: TenantSite | undefined = existing ? { id: "site-editor-qa", workspaceId: WORKSPACE_ID, tenantId: TENANT_ID, slug: "empresa-qa", draft: initialSiteSnapshot("Empresa QA", "nexus"), revision: 1, updatedAt: new Date().toISOString() } : undefined;
  const writes: string[] = [];
  await page.route("**/v1/sites**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/sites" && request.method() === "GET") return ok({ sites: site ? [site] : [] });
    if (path === "/v1/sites" && request.method() === "POST") {
      writes.push("create");
      site = { ...request.postDataJSON(), id: "site-editor-qa", workspaceId: WORKSPACE_ID, tenantId: TENANT_ID, revision: 1, updatedAt: new Date().toISOString() };
      return ok(site);
    }
    if (path.endsWith("/preview") && site) return ok({ id: site.id, slug: site.slug, ...site.draft, products: [], categories: [], brands: [], commerceEnabled: false });
    if (path === "/v1/sites/site-editor-qa" && request.method() === "PUT" && site) {
      writes.push("save"); site = { ...site, draft: request.postDataJSON().draft, revision: site.revision + 1 }; return ok(site);
    }
    if (request.method() !== "GET") writes.push(path);
    return route.fallback();
  });
  return { writes, current: () => site };
}

for (const template of ["nexus", "aura", "pulse"]) {
  test(`primeiro Personalizar ${template} abre editor, altera e salva rascunho sem publicar`, async ({ page }, info) => {
    const state = await fixture(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/site`);
    await expect(page.getByLabel("Endereço do site", { exact: true })).not.toHaveValue("");
    await page.getByTestId(`template-card-${template}`).getByRole("button", { name: /^Personalizar / }).click();
    await expect(page).toHaveURL(/section=aparencia/);
    await expect(page.getByLabel("Cor principal", { exact: true })).toBeVisible();
    expect(state.current()?.draft.theme.template).toBe(template);
    await page.getByLabel("Cor principal", { exact: true }).fill("#543abc");
    await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await expect.poll(() => state.writes).toEqual(["create", "save"]);
    expect(state.current()?.publishedAt).toBeUndefined();
    await page.reload();
    await expect(page.getByLabel("Cor principal", { exact: true })).toHaveValue("#543ABC");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`personalizar-${template}.png`), fullPage: true });
  });
}

test("Personalizar troca modelo existente e abre campos sem criar outro site", async ({ page }) => {
  const state = await fixture(page, true);
  await page.goto(`/workspaces/${WORKSPACE_ID}/site?section=modelos`);
  await page.getByTestId("template-card-aura").getByRole("button", { name: "Personalizar Aura", exact: true }).click();
  await expect(page).toHaveURL(/section=aparencia/);
  await expect(page.getByLabel("Cor principal", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
  await expect.poll(() => state.writes).toEqual(["save"]);
  expect(state.current()?.draft.theme.template).toBe("aura");
});
