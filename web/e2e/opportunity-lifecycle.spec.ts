import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID, TENANT_ID } from "./fixtures/mock-backend";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";

async function fixture(page: Page, lost = false) {
  await mockConversasBackend(page);
  const now = new Date().toISOString();
  const stages = ["Novo", "Negociação", "Ganha", "Perdida"].map((name, position) => ({ id: `life-stage-${position}`, name, position, pipelineId: "life-pipeline", isWon: position === 2, isLost: position === 3, requiredFields: [], createdAt: now }));
  let deal = { id: "life-deal", tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, pipelineId: "life-pipeline", stageId: stages[lost ? 3 : 0].id, title: "Venda presencial", valueCents: 100000, currency: "BRL", ownerUserId: "user-qa", valueMode: "manual", status: lost ? "lost" : "open", lossReason: lost ? "Prazo" : undefined, closeComment: lost ? "O cliente precisa receber até sexta-feira." : undefined, closedAt: lost ? now : undefined, firstClosedAt: lost ? now : undefined, archivedAt: lost ? now : undefined, createdAt: now, updatedAt: now, lastStageChangedAt: now, finalValueCents: undefined as number | undefined };
  let settings = { workspaceId: WORKSPACE_ID, sellersCanViewCost: false, sellersCanViewMargin: true, dealVisibility: "all", proposalAcceptAutoWin: true, rankingEnabled: false, closedDealArchiveDays: null as number | null, visibility: { isManager: true, canViewCost: true, canViewMargin: true } };
  let reasons = ["Preço", "Prazo", "Outro"].map((label, position) => ({ id: `reason-${position}`, kind: "lost", label, position, active: true }));
  const moves: Record<string, unknown>[] = [];
  const saved: Record<string, unknown>[] = [];
  await page.route("**/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    let data: unknown;
    if (path === "/v1/pipelines") data = [{ id: "life-pipeline", name: "Comercial", isDefault: true }];
    else if (path.endsWith("/stages")) data = stages;
    else if (path === "/v1/deals") {
      const view = url.searchParams.get("boardView");
      data = (view === "operational" && deal.archivedAt) || (view === "archived" && !deal.archivedAt) ? [] : [deal];
    } else if (path === "/v1/deals/life-deal") data = deal;
    else if (path === "/v1/deals/life-deal/move-stage") {
      const body = request.postDataJSON(); moves.push(body);
      const stage = stages.find(s => s.id === body.stageId)!;
      deal = { ...deal, stageId: stage.id, status: stage.isWon ? "won" : stage.isLost ? "lost" : "open", finalValueCents: stage.isWon ? body.finalValueCents : undefined, archivedAt: undefined, closedAt: stage.isWon ? body.closedAt : undefined, closeComment: body.lossComment };
      data = deal;
    } else if (path === "/v1/deals/life-deal/reopen") {
      moves.push(request.postDataJSON());
      deal = { ...deal, status: "open", stageId: stages[1].id, archivedAt: undefined, closedAt: undefined, lossReason: undefined, closeComment: undefined };
      data = deal;
    } else if (path === "/v1/deals/life-deal/timeline") data = [{ id: "life-event", eventType: "deal_lost", actorType: "user", actorId: "user-qa", occurredAt: now, payload: { fromStageId: stages[1].id, toStageId: stages[3].id, lossReason: "Prazo", comment: "O cliente precisa receber até sexta-feira." } }];
    else if (path === "/v1/deals/life-deal/commercial") data = { dealId: deal.id, status: deal.status, currency: "BRL", valueCents: deal.valueCents, items: [], totals: { itemCount: 0, totalCents: deal.valueCents, mrrCents: 0 }, visibility: settings.visibility, policy: {}, evaluation: { health: "healthy", reasons: [], requiresApproval: false }, approval: { required: false }, probability: { value: deal.status === "won" ? 100 : 10 }, weightedValueCents: 10000, aging: { daysOpen: 1, daysInStage: 1 } };
    else if (path === "/v1/deals/life-deal/insights") data = { risks: [], explanations: [], aiAvailable: false, goalImpact: { available: false } };
    else if (path === "/v1/commercial-settings") {
      if (method === "PATCH") { const body = request.postDataJSON(); saved.push(body); settings = { ...settings, ...body }; }
      data = settings;
    } else if (path === "/v1/sales-reasons") {
      if (method === "POST") { const body = request.postDataJSON(); reasons.push({ ...body, id: "new-reason", active: true, position: reasons.length }); data = reasons.at(-1); }
      else data = reasons.filter(r => !url.searchParams.get("kind") || r.kind === url.searchParams.get("kind"));
    } else if (path === "/v1/sales-reasons/reorder") {
      const { reasonIds } = request.postDataJSON(); reasons = reasonIds.map((id: string, position: number) => ({ ...reasons.find(r => r.id === id)!, position })); return route.fulfill({ status: 204 });
    } else if (path.startsWith("/v1/sales-reasons/")) {
      const id = path.split("/").at(-1);
      if (method === "DELETE") { reasons = reasons.filter(r => r.id !== id); return route.fulfill({ status: 204 }); }
      reasons = reasons.map(r => r.id === id ? { ...r, ...request.postDataJSON() } : r); data = reasons.find(r => r.id === id);
    } else if (path === "/v1/products/stock-risk") data = { products: [], deals: [] };
    else if (["/v1/proposals", "/v1/contacts", "/v1/tasks", "/v1/products", "/v1/commercial-policies", "/v1/sales-competitors", "/v1/deal-custom-fields", "/v1/price-books"].includes(path)) data = [];
    else return route.fallback();
    return route.fulfill({ json: { ok: true, data } });
  });
  return { moves, saved, get deal() { return deal; }, get reasons() { return reasons; } };
}

test.beforeEach(async ({ context }) => { await loginCookie(context); });

test("as ações respeitam permissões removidas mesmo com o perfil Administrador", async ({ page }) => {
  await fixture(page);
  await page.route("**/v1/auth/me", route => route.fulfill({ json: { ok: true, data: {
    user: { id: "user-qa", name: "QA Reviewer", email: "qa@vorix.dev" }, tenantId: TENANT_ID, role: "owner", teams: [],
    permissions: OWNER_PERMISSIONS.filter(permission => !["deal:win", "deal:lose", "pipeline:configure", "proposal:manage"].includes(permission)),
  } } }));
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
  await expect(page.getByRole("button", { name: "Fases", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gerar proposta", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Ações da oportunidade", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ganha", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Perdida", exact: true })).toHaveCount(0);
});

test("ganho no Kanban confirma valor final e data sem exigir proposta", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
  await page.getByRole("button", { name: "Ações da oportunidade", exact: true }).click();
  await page.getByRole("button", { name: "Ganha", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Marcar como ganha", exact: true });
  await expect(modal.getByText("Você pode registrar a venda com ou sem proposta.", { exact: false })).toBeVisible();
  await modal.getByLabel("Valor final", { exact: true }).fill("850,00");
  await expect(modal.getByLabel("Data do fechamento", { exact: true })).toHaveValue(/\d{4}-\d{2}-\d{2}T/);
  await modal.getByRole("button", { name: "Confirmar venda", exact: true }).click();
  await expect(modal).toBeHidden();
  expect(state.moves[0].finalValueCents).toBe(85000);
  expect(state.moves[0].closedAt).toMatch(/^\d{4}-/);
  expect(state.deal.status).toBe("won");
});

test("consulta arquivadas, mostra resposta da perda e reabre com histórico legível", async ({ page }, info) => {
  const state = await fixture(page, true);
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
  await page.getByRole("combobox", { name: "Exibir", exact: true }).click();
  await page.getByRole("option", { name: "Arquivadas", exact: true }).click();
  await page.getByRole("article").filter({ hasText: "Venda presencial" }).click();
  const modal = page.getByRole("dialog", { name: "Venda presencial", exact: true });
  await expect(modal.getByText("Motivo da perda", { exact: true })).toBeVisible();
  await expect(modal.getByText("O cliente precisa receber até sexta-feira.", { exact: true })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Mostrar no Kanban", exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(modal.getByText("Negociação → Perdida", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("opportunity-closed-history.png"), fullPage: true });
  await modal.getByRole("button", { name: "Reabrir", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Ganha", exact: true })).toBeVisible();
  expect(state.deal.status).toBe("open");
  expect(state.deal.archivedAt).toBeUndefined();
});

test("configura retenção e administra motivos de perda no celular e desktop", async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings/commercial`);
  await page.getByText("6. Arquivamento do Kanban", { exact: true }).click();
  await page.getByRole("combobox", { name: "Ocultar oportunidades encerradas após", exact: true }).click();
  await page.getByRole("option", { name: "7 dias", exact: true }).click();
  await page.getByRole("button", { name: "Salvar arquivamento", exact: true }).click();
  await expect.poll(() => state.saved[0]?.closedDealArchiveDays).toBe(7);
  await page.getByText("4. Motivos de venda e concorrentes", { exact: true }).click();
  await page.getByRole("button", { name: "Renomear Prazo", exact: true }).click();
  await page.getByRole("textbox", { name: "Nome do motivo Prazo", exact: true }).fill("Prazo de entrega");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect.poll(() => state.reasons[1].label).toBe("Prazo de entrega");
  await page.getByRole("button", { name: "Subir motivo Prazo de entrega", exact: true }).click();
  await expect.poll(() => state.reasons[0].label).toBe("Prazo de entrega");
  await page.screenshot({ path: info.outputPath("opportunity-loss-reasons.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
