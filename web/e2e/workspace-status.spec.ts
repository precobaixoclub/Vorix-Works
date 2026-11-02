import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

async function fixture(page: Page, options: { status?: "active" | "inactive" | "archived"; canTransition?: boolean; failures?: number } = {}) {
  const now = new Date().toISOString();
  let workspace = { id: WORKSPACE_ID, tenantId: TENANT_ID, name: "Empresa de teste", status: options.status ?? "active", settings: {}, createdAt: now, updatedAt: now, campaignIds: [], integrations: [], members: [] };
  const writes: string[] = [];
  let failures = options.failures ?? 0;
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", name: "Gestor", email: "qa@example.test", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: ["workspace:read", "workspace:update", ...(options.canTransition === false ? [] : ["workspace:transition"])], teams: [] });
    if (path === "/v1/workspaces" && request.method() === "GET") return ok(!url.searchParams.get("status") || url.searchParams.get("status") === workspace.status ? [workspace] : []);
    if (path === `/v1/workspaces/${WORKSPACE_ID}` && request.method() === "PATCH") {
      writes.push("update");
      workspace = { ...workspace, ...request.postDataJSON() };
      return ok(workspace);
    }
    if (path === `/v1/workspaces/${WORKSPACE_ID}` && request.method() === "GET") return ok(workspace);
    if (path === `/v1/workspaces/${WORKSPACE_ID}/activate` || path === `/v1/workspaces/${WORKSPACE_ID}/deactivate`) {
      writes.push(path.endsWith("/activate") ? "activate" : "deactivate");
      if (failures-- > 0) return route.fulfill({ status: 503, json: { ok: false, error: { code: "UNAVAILABLE", message: "Não foi possível alterar a situação. Tente novamente." } } });
      workspace = { ...workspace, status: path.endsWith("/activate") ? "active" : "inactive" };
      return ok(workspace);
    }
    return route.fallback();
  });
  return { writes, current: () => workspace };
}

test("inativa e reativa pelo modal, mantém o nome e atualiza filtros e persistência", async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto("/workspaces");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Editar Espaço de Trabalho" });
  await expect(modal.getByLabel("Situação do espaço")).toHaveValue("active");
  await modal.getByLabel("Situação do espaço").selectOption("inactive");
  await page.screenshot({ path: info.outputPath("workspace-status.png"), fullPage: true });
  await modal.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(modal).toBeHidden();
  expect(state.writes).toEqual(["deactivate"]);
  await expect(page.getByText("Inativo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ativos", exact: true }).click();
  await expect(page.getByText("Nenhum espaço encontrado")).toBeVisible();
  await page.getByRole("button", { name: "Inativos", exact: true }).click();
  await expect(page.getByText("Empresa de teste", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Inativo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await modal.getByLabel("Situação do espaço").selectOption("active");
  await modal.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByText("Ativo", { exact: true })).toBeVisible();
  expect(state.writes).toEqual(["deactivate", "activate"]);
  expect(state.current().name).toBe("Empresa de teste");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("cancelar descarta a mudança de situação", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/workspaces");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Situação do espaço").selectOption("inactive");
  await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(modal).toBeHidden();
  expect(state.writes).toEqual([]);
  await expect(page.getByText("Ativo", { exact: true })).toBeVisible();
});

test("falha na mudança mantém o modal e permite tentar novamente sem repetir nome já salvo", async ({ page }) => {
  const state = await fixture(page, { failures: 1 });
  await page.goto("/workspaces");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Nome", { exact: true }).fill("Empresa renomeada");
  await modal.getByLabel("Situação do espaço").selectOption("inactive");
  await modal.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(modal.getByRole("alert")).toContainText("Tente novamente");
  expect(state.writes).toEqual(["update", "deactivate"]);
  await modal.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(modal).toBeHidden();
  expect(state.writes).toEqual(["update", "deactivate", "deactivate"]);
  await expect(page.getByText("Inativo", { exact: true })).toBeVisible();
  await expect(page.getByText("Empresa renomeada", { exact: true })).toBeVisible();
});

test("usuário sem permissão não altera situação e espaço arquivado não oferece reativação", async ({ page }) => {
  const state = await fixture(page, { canTransition: false });
  await page.goto("/workspaces");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Situação do espaço")).toBeDisabled();
  await expect(modal.getByText("Você não tem permissão para ativar ou inativar este espaço.")).toBeVisible();
  expect(state.writes).toEqual([]);
});

test("espaço arquivado mantém a situação terminal", async ({ page }) => {
  await fixture(page, { status: "archived" });
  await page.goto("/workspaces");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByText("Arquivado", { exact: true })).toBeVisible();
  await expect(modal.getByRole("combobox")).toHaveCount(0);
});
