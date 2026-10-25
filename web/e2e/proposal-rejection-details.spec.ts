import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

const comment = "Precisamos receber os produtos até sexta-feira.\nPodemos combinar uma nova data para a entrega?";

async function fixture(page: Page, hasResponse = true) {
  await mockConversasBackend(page);
  const now = new Date().toISOString();
  let reads = 0;
  const proposal = { id: "proposal-rejected", title: "Proposta de materiais", tenantId: "tenant-qa", workspaceId: WORKSPACE_ID, contactId: "contact-1", dealId: "deal-1", number: "PROP-2026-0042", version: 1, status: "rejected", items: [{ name: "Lâmpada", quantity: 1, unitPriceCents: 9500, subtotalCents: 9500 }, { name: "Tijolo", quantity: 1, unitPriceCents: 400, subtotalCents: 400 }], discountCents: 0, totalCents: 9900, currency: "BRL", validUntil: "2027-12-31", viewCount: 1, respondedAt: now, createdAt: now, updatedAt: now, rejectionReason: hasResponse ? "Prazo" : undefined, rejectionComment: hasResponse ? comment : undefined };
  await page.route("**/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === "/v1/proposals") { reads++; data = [proposal]; }
    else if (path === "/v1/contacts") data = [{ id: "contact-1", name: "Ana Souza", tags: [] }];
    else if (path === "/v1/deals") data = [{ id: "deal-1", title: "Venda de materiais", contactId: "contact-1", status: "open", pipelineId: "pipeline-1", stageId: "stage-1", currency: "BRL", valueCents: 9900 }];
    // Older timeline entries stored only the reason; the saved proposal still has the comment.
    else if (path === "/v1/proposals/proposal-rejected/timeline") data = [{ id: "event-1", eventType: "proposal_rejected", occurredAt: now, payload: hasResponse ? { reason: "Prazo" } : {} }];
    else if (path.endsWith("/stages")) data = [{ id: "stage-1", name: "Aberto", position: 0 }, { id: "stage-lost", name: "Perdido", position: 1, isLost: true }];
    else return route.fallback();
    return route.fulfill({ json: { ok: true, data } });
  });
  return { get reads() { return reads; } };
}

test.beforeEach(async ({ context }) => { await loginCookie(context); });

test("detalhe destaca motivo e comentário completos e oferece botões claros", async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/proposals`);
  await page.locator("article").getByRole("button").first().click();
  const modal = page.getByRole("dialog", { name: "Proposta de materiais", exact: true });
  const feedback = modal.getByRole("region", { name: "Resposta do cliente", exact: true });
  await expect(feedback).toBeVisible();
  await expect(feedback.getByText("Motivo da recusa", { exact: true })).toBeVisible();
  await expect(feedback.getByText("Prazo", { exact: true })).toBeVisible();
  await expect(feedback.getByText("Comentário do cliente", { exact: true })).toBeVisible();
  await expect(feedback.locator("dd").last()).toHaveText(comment);
  expect(await feedback.locator("dd").last().evaluate(element => getComputedStyle(element).whiteSpace)).toBe("pre-wrap");
  await expect.poll(() => state.reads).toBeGreaterThanOrEqual(2);
  for (const name of ["Criar nova proposta", "Criar follow-up", "Marcar oportunidade como perdida"]) {
    const button = feedback.getByRole("button", { name, exact: true });
    await expect.poll(async () => (await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await button.evaluate(element => getComputedStyle(element).borderTopStyle)).not.toBe("none");
  }
  await expect(modal.getByRole("button", { name: "Gerar novo link", exact: true })).toHaveCount(0);
  await expect(modal.getByText(/token bruto/i)).toHaveCount(0);
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("proposal-customer-response.png"), fullPage: true });
  await modal.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(modal.getByText("Prazo", { exact: true })).toBeVisible();
  await expect(modal.getByText(comment, { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "Resumo", exact: true }).click();
  await feedback.getByRole("button", { name: "Criar follow-up", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Criar follow-up", exact: true })).toBeVisible();
});

test("recusa sem motivo ou comentário mostra ausências explícitas", async ({ page }) => {
  await fixture(page, false);
  await page.goto(`/workspaces/${WORKSPACE_ID}/proposals?proposal=proposal-rejected`);
  const modal = page.getByRole("dialog", { name: "Proposta de materiais", exact: true });
  const feedback = modal.getByRole("region", { name: "Resposta do cliente", exact: true });
  await expect(feedback.getByText("Não informado pelo cliente", { exact: true })).toBeVisible();
  await expect(feedback.getByText("O cliente não deixou comentário.", { exact: true })).toBeVisible();
  await feedback.getByRole("button", { name: "Criar nova proposta", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Nova proposta", exact: true });
  await expect(create).toBeVisible();
  await expect(create.getByRole("combobox").filter({ hasText: "Venda de materiais" })).toBeVisible();
});
