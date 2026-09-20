import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

// Regressões de UI com API simulada. Não substituem QA autenticado em produção.
test.use({ channel: "chrome", timezoneId: "America/Sao_Paulo" });

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function fixture(page: Page, dealCount = 1) {
  await mockConversasBackend(page);
  const contact = { id: "crm-phase3", name: "Cliente QA Fase 3", tags: [], createdAt: new Date().toISOString() };
  const deals = Array.from({ length: dealCount }, (_, i) => ({ id: `deal-${i}`, contactId: contact.id, pipelineId: "pipeline-qa", stageId: "stage-qa", title: `Negócio QA ${i + 1}`, valueCents: 10000, currency: "BRL", lastStageChangedAt: new Date().toISOString() }));
  const tasks: any[] = [];
  let denyPatch = false;
  await page.route("**/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/inbox/conversations") return ok({ conversations: [{ id: "conv-phase3", contactId: "inbox-phase3", crmContactId: contact.id, contactName: contact.name, connectionId: "conn-qa", status: "open", chatType: "direct", unreadCount: 0 }] });
    if (path.endsWith("/messages")) return ok({ messages: [] });
    if (path.endsWith("/lead-score")) return ok({ score: 0, temperature: "frio", factors: [] });
    if (path === `/v1/contacts/${contact.id}`) return ok(contact);
    if (path === "/v1/contacts") return ok([contact]);
    if (path === "/v1/deals") return ok(deals);
    if (path === "/v1/pipelines") return ok([{ id: "pipeline-qa", name: "Comercial QA", isDefault: true }]);
    if (path.endsWith("/stages")) return ok([{ id: "stage-qa", pipelineId: "pipeline-qa", name: "Aberto", position: 0 }]);
    if (path.startsWith("/v1/tasks")) {
      if (method === "GET") return ok(tasks.filter(t => !url.searchParams.get("status") || t.status === url.searchParams.get("status")));
      if (method === "POST" && path === "/v1/tasks") {
        const task = { ...route.request().postDataJSON(), id: `task-${tasks.length}`, status: "pending", createdAt: new Date().toISOString() };
        tasks.push(task);
        return ok(task);
      }
      const task = tasks.find(t => t.id === path.split("/")[3]);
      if (method === "PATCH") {
        if (denyPatch) return route.fulfill({ status: 403, json: { ok: false, error: { code: "FORBIDDEN", message: "Sem permissão para reagendar", recoverable: false } } });
        Object.assign(task, route.request().postDataJSON());
      }
      if (path.endsWith("/complete")) Object.assign(task, { status: "done", completedAt: new Date().toISOString() });
      return ok(task);
    }
    return route.fallback();
  });
  return { tasks, setDenyPatch: (value: boolean) => { denyPatch = value; } };
}

async function openConversation(page: Page) {
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas?conversation=conv-phase3`);
  await page.getByRole("button", { name: "Detalhes", exact: true }).click();
  await expect(page.getByText("Próxima ação", { exact: true })).toBeVisible();
}

test.beforeEach(async ({ context }) => { await loginCookie(context); });

for (const dealCount of [0, 1, 2]) {
  test(`criar na conversa com ${dealCount} negócios, reagendar e concluir`, async ({ page }, testInfo) => {
    const state = await fixture(page, dealCount);
    await openConversation(page);
    await page.getByRole("button", { name: "+ Criar próxima ação", exact: true }).click();
    const dialog = page.getByRole("dialog").last();
    await dialog.getByRole("button", { name: "Amanhã", exact: true }).click();
    const day = (await dialog.getByLabel("Quando").inputValue()).slice(0, 10);
    await dialog.getByLabel("Quando").fill(`${day}T14:00`);
    if (dealCount === 2) {
      await expect(dialog.getByLabel("Relacionar esta tarefa a qual negócio?")).toContainText("Sem negócio");
      await dialog.getByLabel("Relacionar esta tarefa a qual negócio?").click();
      await page.getByRole("option", { name: "Negócio QA 2", exact: true }).click();
    } else {
      await expect(dialog.getByLabel("Relacionar esta tarefa a qual negócio?")).toHaveCount(0);
    }
    await capture(page, testInfo, "phase3-criacao-inline");
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await dialog.getByRole("button", { name: "Criar", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].contactId).toBe("crm-phase3");
    expect(state.tasks[0].dealId).toBe(dealCount === 0 ? undefined : `deal-${dealCount - 1}`);
    expect(state.tasks[0].dueAt).toBe(`${day}T17:00:00.000Z`);
    await expect(page.getByText("Responsável: Sem responsável", { exact: true })).toBeVisible();
    expect(page.url()).toContain("/conversas?");
    await page.getByRole("button", { name: "Reagendar", exact: true }).click();
    await expect(page.getByLabel("Nova data e horário")).toHaveValue(`${day}T14:00`);
    await capture(page, testInfo, "phase3-reagendar");
    await page.getByLabel("Nova data e horário").fill(`${day}T16:00`);
    state.setDenyPatch(true);
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Não foi possível reagendar", { exact: true })).toBeVisible();
    expect(state.tasks[0].dueAt).toBe(`${day}T17:00:00.000Z`);
    state.setDenyPatch(false);
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByLabel("Nova data e horário")).toBeHidden();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].dueAt).toBe(`${day}T19:00:00.000Z`);
    await capture(page, testInfo, "phase3-conversa");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Concluir", exact: true }).click();
    await expect(page.getByText("Nenhuma próxima atividade.", { exact: true })).toBeVisible();
    expect(state.tasks[0].status).toBe("done");
    expect(state.tasks[0].completedAt).toBeTruthy();
  });
}

test("negócio embutido recarrega tarefas imediatamente na conversa", async ({ page }) => {
  const state = await fixture(page);
  await openConversation(page);
  await page.getByRole("button", { name: "Abrir negócio", exact: true }).click();
  await page.getByRole("button", { name: "+ Nova tarefa", exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reagendar", exact: true }).last()).toBeVisible();
  expect(state.tasks[0].dealId).toBe("deal-0");
  await page.getByRole("dialog").getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(page.getByText("Nenhuma atividade pendente.", { exact: true })).toBeVisible();
});

test("Contact 360, Tarefas, conversa e Home compartilham a tarefa atrasada", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const state = await fixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/contacts?contactId=crm-phase3`);
  await page.getByRole("button", { name: "Criar tarefa", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "Nova próxima ação", exact: true });
  await createDialog.getByLabel("Título", { exact: true }).fill("Follow-up controlado Fase 3");
  await createDialog.getByLabel("Quando").fill("2026-01-01T14:00");
  await createDialog.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(createDialog).toBeHidden();
  expect(page.url()).toContain("/contacts?");
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0].contactId).toBe("crm-phase3");
  await page.getByRole("dialog").getByRole("button", { name: /^Tarefas/ }).click();
  await expect(page.getByText("Atrasadas (1)", { exact: true })).toBeVisible();
  await capture(page, testInfo, "phase3-contact360");
  await page.goto(`/workspaces/${WORKSPACE_ID}/tasks`);
  await page.getByRole("button", { name: /^Atrasadas/ }).click();
  await expect(page.getByRole("heading", { name: "Follow-up controlado Fase 3", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Abrir conversa", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/conversas\\?conversation=conv-phase3"));
  await page.getByRole("button", { name: "Detalhes", exact: true }).click();
  await expect(page.getByText("Follow-up controlado Fase 3", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Atrasada", { exact: true })).toBeVisible();
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await expect(page.getByText("Follow-up controlado Fase 3", { exact: true })).toBeVisible();
  await capture(page, testInfo, "phase3-home");
  expect(state.tasks).toHaveLength(1);
});
