import { test, expect, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

test.use({ channel: "chrome", timezoneId: "America/Sao_Paulo" });

type Proposal = Record<string, any> & { id: string; status: string };

async function commercialFixture(page: Page, dealCount = 2) {
  await mockConversasBackend(page);
  const now = new Date().toISOString();
  const contact = { id: "contact-phase4", name: "Cliente Fase 4", company: "Empresa QA", tags: [], createdAt: now };
  const deals = Array.from({ length: dealCount }, (_, index) => ({ id: `deal-phase4-${index + 1}`, contactId: contact.id, pipelineId: "pipeline-phase4", stageId: "stage-open", title: `Negocio Fase 4 ${index + 1}`, valueCents: 450000, currency: "BRL", lastStageChangedAt: now }));
  const templates = [{ id: "template-phase4", tenantId: "tenant", workspaceId: WORKSPACE_ID, name: "Plano Premium", defaultTitle: "Proposta Comercial - Plano Premium", defaultItems: [{ name: "Plano Premium", quantity: 1, unitPriceCents: 450000, subtotalCents: 450000 }], defaultConditions: "Pagamento em 2 parcelas", defaultValidDays: 7, active: true, createdAt: now, updatedAt: now }];
  const proposals: Proposal[] = [];
  const sends: any[] = [];

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/inbox/conversations") return ok({ conversations: [{ id: "conversation-phase4", contactId: "inbox-contact", crmContactId: contact.id, contactName: contact.name, contactPhone: "+5511999999999", connectionId: "connection", status: "open", chatType: "direct", unreadCount: 0 }] });
    if (path.endsWith("/messages")) return ok({ messages: [] });
    if (path === `/v1/contacts/${contact.id}`) return ok(contact);
    if (path === "/v1/contacts") return ok([contact]);
    if (path === "/v1/deals") return ok(deals);
    if (path === "/v1/tasks") return ok([]);
    if (path === "/v1/products") return ok([]);
    if (path === "/v1/pipelines") return ok([{ id: "pipeline-phase4", name: "Comercial", isDefault: true }]);
    if (path.endsWith("/stages")) return ok([{ id: "stage-open", pipelineId: "pipeline-phase4", name: "Aberto", position: 0 }]);
    if (path.endsWith("/lead-score")) return ok({ score: 0, temperature: "frio", factors: [] });
    if (path === "/v1/commercial-suggestions") return ok([]);
    if (path === "/v1/proposal-templates") {
      if (method === "GET") return ok(templates);
      const body = route.request().postDataJSON();
      const created = { ...body, id: `template-${templates.length + 1}`, tenantId: "tenant", active: true, createdAt: now, updatedAt: now, defaultItems: body.defaultItems.map((item: any) => ({ ...item, subtotalCents: item.quantity * item.unitPriceCents })) };
      templates.push(created);
      return ok(created);
    }
    if (path === "/v1/proposals") {
      if (method === "GET") return ok(proposals.filter((proposal) => !url.searchParams.get("contactId") || proposal.contactId === url.searchParams.get("contactId")));
      const body = route.request().postDataJSON();
      const proposal = { ...body, id: `proposal-${proposals.length + 1}`, tenantId: "tenant", status: "draft", currency: "BRL", items: body.items.map((item: any) => ({ ...item, subtotalCents: item.quantity * item.unitPriceCents })), totalCents: body.items.reduce((sum: number, item: any) => sum + item.quantity * item.unitPriceCents, 0) - (body.discountCents ?? 0), viewCount: 0, createdAt: now, updatedAt: now, publicToken: "raw-token" };
      proposals.unshift(proposal);
      return ok(proposal);
    }
    if (path.endsWith("/send-whatsapp")) {
      const body = route.request().postDataJSON(); sends.push(body);
      const proposal = proposals.find((item) => path.includes(item.id))!; Object.assign(proposal, { status: "sent", sentAt: now }); return ok(proposal);
    }
    if (path.endsWith("/timeline")) return ok([]);
    return route.fallback();
  });
  return { contact, deals, proposals, sends, templates };
}

test.beforeEach(async ({ context }) => { await loginCookie(context); });

test("cria pela conversa com modelo, escolhe Deal e envia no pipeline", async ({ page }) => {
  const state = await commercialFixture(page, 2);
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas?conversation=conversation-phase4`);
  await page.getByRole("button", { name: "Detalhes", exact: true }).click();
  await page.getByRole("button", { name: "+ Gerar proposta", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Gerar proposta" });
  await create.getByLabel("Modelo").click();
  await page.getByRole("option", { name: "Plano Premium", exact: true }).click();
  await create.getByLabel(/Neg.cio/).click();
  await page.getByRole("option", { name: "Negocio Fase 4 2", exact: true }).click();
  await expect(create.getByLabel(/T.tulo/)).toHaveValue("Proposta Comercial - Plano Premium");
  await create.getByRole("button", { name: "Criar proposta", exact: true }).click();
  await expect(create).toBeHidden();
  expect(state.proposals).toHaveLength(1);
  expect(state.proposals[0].contactId).toBe(state.contact.id);
  expect(state.proposals[0].dealId).toBe(state.deals[1].id);
  const detail = page.getByRole("dialog", { name: "Proposta Comercial - Plano Premium" });
  await detail.getByRole("button", { name: "Enviar no WhatsApp", exact: true }).click();
  await expect.poll(() => state.sends.length).toBe(1);
  expect(state.sends[0].conversationId).toBe("conversation-phase4");
  expect(state.sends[0].message).toContain("{{proposalUrl}}");
  expect(state.sends[0].idempotencyKey).toBeTruthy();
  expect(state.proposals[0].status).toBe("sent");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("gerencia modelos dentro de Propostas", async ({ page }) => {
  const state = await commercialFixture(page, 1);
  await page.goto(`/workspaces/${WORKSPACE_ID}/proposals`);
  await page.getByRole("button", { name: "Modelos", exact: true }).click();
  await expect(page.getByText("Plano Premium", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Novo modelo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo modelo" });
  await dialog.getByLabel("Nome do modelo").fill("Consultoria");
  await dialog.getByLabel(/T.tulo padr.o/).fill("Proposta de Consultoria");
  await dialog.getByRole("button", { name: "Item avulso" }).click();
  await dialog.getByLabel("Nome do item 1").fill("Diagnostico");
  await dialog.getByLabel("Valor do item 1").fill("1200");
  await dialog.getByRole("button", { name: "Salvar modelo" }).click();
  await expect(dialog).toBeHidden();
  expect(state.templates.some((template) => template.name === "Consultoria")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("pagina publica e legivel e recusa com motivo", async ({ page }) => {
  const proposal = { id: "public-phase4", title: "Proposta Mobile", status: "viewed", currency: "BRL", items: [{ name: "Implantacao", quantity: 1, unitPriceCents: 250000, subtotalCents: 250000 }], discountCents: 0, totalCents: 250000, validUntil: "2026-12-31", conditions: "Pagamento na entrega", viewCount: 2, customerName: "Cliente Mobile", customerCompany: "Empresa Mobile", issuerName: "Vorix QA", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  let rejection: any;
  await page.route("**/v1/public/proposals/**", async (route) => { const path = new URL(route.request().url()).pathname; if (path.endsWith("/reject")) { rejection = route.request().postDataJSON(); proposal.status = "rejected"; } return route.fulfill({ json: { ok: true, data: proposal } }); });
  await page.goto("/p/token-phase4");
  await expect(page.getByText("Cliente: Cliente Mobile · Empresa Mobile")).toBeVisible();
  await page.getByRole("button", { name: "Recusar", exact: true }).click();
  await page.getByLabel("Motivo").click();
  await page.getByRole("option", { name: "Preco", exact: true }).click();
  await page.getByLabel("Comentario (opcional)").fill("Preciso renegociar");
  await page.getByRole("button", { name: "Confirmar recusa" }).click();
  expect(rejection).toEqual({ reason: "price", comment: "Preciso renegociar" });
  await expect(page.getByText("Voce recusou esta proposta.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
