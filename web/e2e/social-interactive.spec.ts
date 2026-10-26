import { expect, test } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

test("Conexão: checkpoint visível, interação humana e conclusão pela interface", async ({ context, page }) => {
  await loginCookie(context); await mockConversasBackend(page);
  await page.route("**/v1/solutions", route => route.fulfill({ json: { ok: true, data: { solutions: [{ key: "marketing", name: "Marketing", internal: false }] } } }));
  const actions: unknown[] = []; let finished = false;
  await page.route("**/v1/social/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path.endsWith("/frame")) data = { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", width: 1280, height: 800, status: "CHECKPOINT_REQUIRED", expiresAt: new Date(Date.now() + 600000).toISOString() };
    if (path.endsWith("/interact")) actions.push(route.request().postDataJSON().action);
    if (path.endsWith("/finish")) { finished = true; data = { connected: true }; }
    if (path.endsWith("/accounts")) data = { accounts: [], networks: [] };
    if (path.endsWith("/settings")) data = { timezone: "America/Sao_Paulo", networks: [] };
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/social/connect?network=instagram&flow=11111111-1111-4111-8111-111111111111`);
  await expect(page.getByRole("heading", { name: "Conectar Instagram" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("confirmação de segurança");
  await page.getByLabel("Texto para o campo selecionado na rede").fill("input-not-persisted");
  await page.getByRole("button", { name: "Enviar ao campo selecionado" }).click();
  await expect.poll(() => actions.length).toBe(1);
  await expect(page.getByLabel("Texto para o campo selecionado na rede")).toHaveValue("");
  expect(actions[0]).toEqual({ kind: "text", text: "input-not-persisted" });
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("input-not-persisted");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect.poll(() => finished).toBe(true);
  await expect(page).toHaveURL(/social\/integrations/);
});
