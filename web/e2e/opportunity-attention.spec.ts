import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

async function commercialFixture(page: Page) {
  const now = new Date().toISOString();
  const common = { tenantId: "tenant-qa", workspaceId: WORKSPACE_ID, pipelineId: "pipeline-1", stageId: "stage-1", contactId: "crm-1", currency: "BRL", status: "open", createdAt: now, updatedAt: now, lastStageChangedAt: now };
  const deals = [
    { ...common, id: "deal-mine", title: "Minha oportunidade", valueCents: 9900, ownerUserId: "user-qa" },
    { ...common, id: "deal-other", title: "Oportunidade de outro vendedor", valueCents: 15100, ownerUserId: "user-other" },
  ];
  const conversation = { id: "conv-media", connectionId: "conn-1", chatType: "direct", contactId: "contact-1", crmContactId: "crm-1", contactName: "Cleverton Marcelo", contactPhone: "+5511999990001", status: "open", assignedUserId: "user-qa", lastMessageAt: now, unreadCount: 0, isUrgent: false, isPinned: false, aiEnabled: false, automationEnabled: false, lastMessagePreview: { type: "text", direction: "inbound", body: "Quero saber mais" } };
  const ownerQueries: (string | null)[] = [];
  let summaryReads = 0;
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown;
    if (path === "/v1/deals") {
      ownerQueries.push(url.searchParams.get("ownerUserId"));
      data = deals.filter(deal => !url.searchParams.get("ownerUserId") || deal.ownerUserId === url.searchParams.get("ownerUserId"));
    } else if (path === "/v1/deals/open-by-contact") {
      summaryReads += 1;
      data = [{ contactId: "crm-1", count: 2, valueCentsSum: 25000, currency: "BRL" }];
    } else if (path === "/v1/pipelines") data = [{ id: "pipeline-1", name: "Pipeline padrão", isDefault: true }];
    else if (path === "/v1/pipelines/pipeline-1/stages") data = [{ id: "stage-1", pipelineId: "pipeline-1", name: "Novo", position: 0, isWon: false, isLost: false }];
    else if (path === "/v1/contacts") data = [{ id: "crm-1", name: "+5511999990001", tags: [], customFields: {}, createdAt: now, updatedAt: now }];
    else if (path === "/v1/inbox/conversations") data = { conversations: [conversation, { ...conversation, id: "conv-text", contactId: "contact-2", crmContactId: undefined, contactName: "Contato sem oportunidade" }] };
    else return route.fallback();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  return { ownerQueries, get summaryReads() { return summaryReads; } };
}

test.beforeEach(async ({ context, page }) => { await loginCookie(context); await mockConversasBackend(page); });

test("oportunidades começam no vendedor logado e usam o nome conhecido nas conversas", async ({ page }) => {
  const fixture = await commercialFixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
  const cards = page.locator("article:visible");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByText("Cleverton Marcelo", { exact: true })).toBeVisible();
  await expect(cards.first().getByText("Minha oportunidade", { exact: true })).toBeVisible();
  expect(fixture.ownerQueries.length).toBeGreaterThan(0);
  expect(fixture.ownerQueries.every(owner => owner === "user-qa")).toBe(true);
  await expect(page.getByText(/Minhas oportunidades/)).toBeVisible();

  await page.getByRole("button", { name: "Filtros", exact: true }).click();
  await page.getByRole("combobox").filter({ hasText: "QA Reviewer" }).click();
  await page.getByRole("option", { name: "Todos", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(cards).toHaveCount(2);
  expect(fixture.ownerQueries.at(-1)).toBeNull();

  await page.reload();
  await expect(cards).toHaveCount(1);
  expect(fixture.ownerQueries.at(-1)).toBe("user-qa");
});

test("conversas destacam quantidade e soma no contato e na conversa aberta", async ({ page }) => {
  const fixture = await commercialFixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  const notes = page.getByRole("note", { name: /2 oportunidades em andamento:.*250,00/ });
  await expect(notes).toHaveCount(1);
  await expect(notes.first()).toBeVisible();
  expect(fixture.summaryReads).toBe(1);
  await page.getByText("Cleverton Marcelo", { exact: true }).first().click();
  // No celular a lista fica oculta quando a conversa está aberta.
  await expect(notes).toHaveCount((page.viewportSize()?.width ?? 1366) < 768 ? 1 : 2);
  await expect(notes.last()).toBeVisible();
  await expect(notes.last()).toContainText("R$ 250,00");
});
