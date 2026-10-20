import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

const items = [
  { name: "Plataforma de atendimento", description: "Implantação, configuração do canal e treinamento da equipe.", quantity: 2, unitPriceCents: 125000, subtotalCents: 250000, billingType: "one_time" },
  { name: "Acompanhamento mensal", description: "Suporte e acompanhamento da operação.", quantity: 1, unitPriceCents: 49900, subtotalCents: 49900, billingType: "monthly" },
];
const validUntil = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const publicContent = { number: "PROP-2026-0042", version: 1, title: "Uma nova fase para sua operação", introduction: "Preparamos uma solução para organizar seu atendimento e acompanhar cada oportunidade.", customerName: "Ana Souza", customerCompany: "Empresa ABC", issuerName: "Orbit Studio", items, subtotalCents: 299900, discountCents: 5000, totalCents: 294900, currency: "BRL", validUntil, conditions: "Implantação em até 10 dias. Pagamento em duas parcelas.", terms: "O escopo considerado está descrito nos itens desta proposta.", status: "viewed", superseded: false, declineReasons: ["Preço", "Prazo", "Outro"] };

async function sellerFixture(page: Page, options: { approval?: boolean; failSendOnce?: boolean; noConversation?: boolean } = {}) {
  await mockConversasBackend(page);
  const now = new Date().toISOString();
  const deal = { id: "deal-aurora", title: "Solução de atendimento", contactId: "crm-aurora", ownerUserId: "user-qa", pipelineId: "pipeline-aurora", stageId: "stage-aurora", status: "open", valueCents: 294900, currency: "BRL", createdAt: now, updatedAt: now, lastStageChangedAt: now };
  const contact = { id: deal.contactId, name: "Ana Souza", company: "Empresa ABC", tags: [], customFields: {} };
  const generations: Record<string, unknown>[] = [], sends: Record<string, unknown>[] = [];
  await page.route("**/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let data: unknown;
    if (path === "/v1/deals") data = [deal];
    else if (path === "/v1/pipelines") data = [{ id: deal.pipelineId, name: "Pipeline padrão", isDefault: true }];
    else if (path.endsWith(`/pipelines/${deal.pipelineId}/stages`)) data = [{ id: deal.stageId, pipelineId: deal.pipelineId, name: "Novo", position: 0, isWon: false, isLost: false }];
    else if (path === "/v1/contacts") data = [contact];
    else if (path === `/v1/contacts/${contact.id}`) data = contact;
    else if (path === `/v1/deals/${deal.id}/commercial`) data = { items: items.map(item => ({ ...item, productNameSnapshot: item.name })), approval: { required: Boolean(options.approval) } };
    else if (path === "/v1/proposal-templates") data = [];
    else if (path === "/v1/inbox/conversations") data = { conversations: options.noConversation ? [] : [{ id: "conv-aurora", connectionId: "conn-1", connectionProvider: "wuzapi", chatType: "direct", contactId: "inbox-aurora", crmContactId: contact.id, contactName: contact.name, contactPhone: "+5511999990001", status: "open", unreadCount: 0, assignedUserId: "user-qa" }] };
    else if (path === `/v1/deals/${deal.id}/proposals`) {
      const input = request.postDataJSON(); generations.push(input);
      data = { ...publicContent, ...input, id: "proposal-aurora", contactId: contact.id, dealId: deal.id, publicToken: "private-generated-token", status: options.approval ? "pending_approval" : "draft", approvalRequired: Boolean(options.approval) };
    } else if (path === "/v1/proposals/proposal-aurora/send-whatsapp") {
      sends.push(request.postDataJSON());
      if (options.failSendOnce && sends.length === 1) return route.fulfill({ status: 503, json: { ok: false, error: { code: "TEMPORARY", message: "Tente enviar novamente.", recoverable: true } } });
      data = { ...publicContent, id: "proposal-aurora", status: "sent" };
    } else return route.fallback();
    await route.fulfill({ json: { ok: true, data } });
  });
  return { generations, sends };
}

test("gera pelo card, revisa o modelo e envia ao WhatsApp sem duplicar a proposta na repetição", async ({ context, page }) => {
  await loginCookie(context);
  const fixture = await sellerFixture(page, { failSendOnce: true });
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
  await page.locator("article:visible").getByRole("button", { name: "Gerar proposta", exact: true }).click();
  const generator = page.getByRole("dialog", { name: "Gerar proposta", exact: true });
  await expect(generator).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(generator).toContainText("Ana Souza");
  await expect(generator.getByLabel("Válida até")).not.toHaveValue("");
  await generator.getByLabel("Condições comerciais (opcional)").fill("Pagamento em duas parcelas.");
  await generator.getByRole("button", { name: "Gerar proposta", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Revise e envie sua proposta" });
  await expect(review.getByRole("heading", { name: "Solução de atendimento", exact: true })).toBeVisible();
  await expect(review.getByText("Plataforma de atendimento", { exact: true })).toBeVisible();
  expect(fixture.generations).toHaveLength(1);
  expect(fixture.generations[0]).not.toHaveProperty("items");
  await review.getByRole("button", { name: "Enviar pelo WhatsApp", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("Tente enviar novamente.");
  await review.getByRole("button", { name: "Enviar pelo WhatsApp", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Proposta enviada", exact: true })).toBeVisible();
  expect(fixture.generations).toHaveLength(1);
  expect(fixture.sends).toHaveLength(2);
  expect(fixture.sends[0].idempotencyKey).toBe(fixture.sends[1].idempotencyKey);
  expect(fixture.sends[0].conversationId).toBe("conv-aurora");
});

test("modelo pendente de aprovação não oferece envio", async ({ context, page }) => {
  await loginCookie(context);
  const fixture = await sellerFixture(page, { approval: true });
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
  await page.locator("article:visible").getByRole("button", { name: "Gerar proposta", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Gerar proposta", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Revise e envie sua proposta" });
  await expect(review).toContainText("precisa da aprovação do gestor");
  await expect(review.getByRole("button", { name: "Enviar pelo WhatsApp" })).toHaveCount(0);
  expect(fixture.sends).toHaveLength(0);
});

test("contato sem conversa mantém o rascunho e explica como enviar depois", async ({ context, page }) => {
  await loginCookie(context);
  const fixture = await sellerFixture(page, { noConversation: true });
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
  await page.locator("article:visible").getByRole("button", { name: "Gerar proposta", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Gerar proposta", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Revise e envie sua proposta" });
  await expect(review).toContainText("O rascunho está salvo");
  await expect(review.getByRole("button", { name: "Enviar pelo WhatsApp" })).toHaveCount(0);
  expect(fixture.generations).toHaveLength(1);
  expect(fixture.sends).toHaveLength(0);
});

for (const decision of ["accept", "reject"] as const) {
  test(`cliente consulta o modelo responsivo e pode ${decision === "accept" ? "aceitar" : "recusar"} sem login`, async ({ page }, info) => {
    let status = "viewed";
    let decisions = 0;
    await page.route("**/v1/public/proposals/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/accept") || path.endsWith("/reject")) { decisions++; status = path.endsWith("/accept") ? "accepted" : "rejected"; }
      if (path.endsWith("/engagement") || path.endsWith("/download")) return route.fulfill({ status: 204, body: "" });
      await route.fulfill({ json: { ok: true, data: { ...publicContent, status, respondedAt: status === "viewed" ? undefined : new Date().toISOString() } } });
    });
    await page.goto("/p/token-aurora");
    await expect(page.getByRole("heading", { name: publicContent.title, exact: true })).toBeVisible();
    await expect(page.getByText("Para Ana Souza · Empresa ABC", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aceitar proposta", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("aurora.png"), fullPage: true });
    if (decision === "accept") {
      await page.getByRole("button", { name: "Aceitar proposta", exact: true }).click();
      expect(decisions).toBe(0);
      await page.getByRole("dialog", { name: "Confirmar aceite" }).getByRole("button", { name: "Confirmar aceite", exact: true }).click();
      await expect(page.getByText(/Proposta aceita/)).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Recusar proposta", exact: true }).click();
      await page.getByRole("button", { name: "Prazo", exact: true }).click();
      await page.getByLabel("Comentário (opcional)").fill("Vamos combinar uma nova data.");
      await page.getByRole("button", { name: "Confirmar recusa", exact: true }).click();
      await expect(page.getByText(/Você recusou esta proposta/)).toBeVisible();
    }
    expect(decisions).toBe(1);
    await expect(page.getByRole("button", { name: "Aceitar proposta", exact: true })).toHaveCount(0);
    expect(await page.context().cookies()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "zuno_refresh_token" })]));
  });
}
