import { test, expect, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

test.use({ channel: "chrome", timezoneId: "America/Sao_Paulo" });

/** Sales Engine — QA em browser real (rede mockada): proposta pública (cliente no celular),
 * cockpit da oportunidade (margem/negociação/aprovação) e Desempenho. */

const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

function publicProposal(overrides: Record<string, unknown> = {}) {
  return {
    number: "PROP-2026-001",
    version: 2,
    title: "Plano Enterprise",
    introduction: "Conforme conversamos, segue a proposta.",
    items: [
      { name: "Licença Enterprise", quantity: 10, unitPriceCents: 9500, subtotalCents: 95000, billingType: "monthly" },
      { name: "Implantação", quantity: 1, unitPriceCents: 150000, subtotalCents: 150000, billingType: "one_time" },
    ],
    subtotalCents: 245000,
    discountCents: 5000,
    totalCents: 240000,
    currency: "BRL",
    validUntil: future,
    conditions: "Pagamento em 30 dias.",
    status: "viewed",
    superseded: false,
    customerName: "Ana Souza",
    customerCompany: "Empresa ABC",
    issuerName: "Vorix QA",
    declineReasons: ["Preço", "Prazo", "Concorrente", "Outro"],
    ...overrides,
  };
}

async function mockPublic(page: Page, state: { current: Record<string, unknown>; calls: string[] }) {
  await page.route("**/v1/public/proposals/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    state.calls.push(`${route.request().method()} ${path}`);
    if (path.endsWith("/accept")) state.current = { ...state.current, status: "accepted", respondedAt: new Date().toISOString() };
    if (path.endsWith("/reject")) state.current = { ...state.current, status: "rejected", rejectionReason: route.request().postDataJSON()?.reason };
    if (path.endsWith("/engagement") || path.endsWith("/download")) return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ json: { ok: true, data: state.current } });
  });
}

test("cliente aceita a proposta vendo o resumo antes de confirmar (sem login)", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const state: { current: Record<string, unknown>; calls: string[] } = { current: publicProposal(), calls: [] };
  await mockPublic(page, state);
  await page.goto("/p/token-qa");
  await expect(page.getByRole("heading", { name: "Plano Enterprise" })).toBeVisible();
  await expect(page.getByText("PROP-2026-001 · versão 2")).toBeVisible();
  await expect(page.getByText("Para Ana Souza · Empresa ABC")).toBeVisible();
  await expect(page.getByText(/R\$\s2\.400,00/).first()).toBeVisible();
  await expect(page.getByText("/mês").first()).toBeVisible();
  await page.getByRole("button", { name: "Aceitar proposta" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirmar aceite" });
  await expect(dialog.getByText("Isto não é uma assinatura eletrônica.", { exact: false })).toBeVisible();
  await expect(dialog.getByText("10 × Licença Enterprise")).toBeVisible();
  await dialog.getByRole("button", { name: "Confirmar aceite" }).click();
  await expect(page.getByText(/Proposta aceita/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar proposta" })).toHaveCount(0);
  expect(state.calls.filter((call) => call.endsWith("/accept"))).toHaveLength(1);
  await context.close();
});

test("cliente recusa escolhendo um motivo configurado", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const state: { current: Record<string, unknown>; calls: string[] } = { current: publicProposal(), calls: [] };
  await mockPublic(page, state);
  await page.goto("/p/token-qa");
  await page.getByRole("button", { name: "Recusar proposta" }).click();
  await page.getByRole("button", { name: "Prazo" }).click();
  await page.getByRole("button", { name: "Confirmar recusa" }).click();
  await expect(page.getByText(/Você recusou esta proposta/)).toBeVisible();
  expect(state.current.rejectionReason).toBe("Prazo");
  await context.close();
});

test("versão substituída não mostra ações de aceite", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockPublic(page, { current: publicProposal({ superseded: true, status: "superseded" }), calls: [] });
  await page.goto("/p/token-old");
  await expect(page.getByText(/substituída por uma proposta mais recente/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar proposta" })).toHaveCount(0);
  await context.close();
});

const now = new Date().toISOString();
const deal = { id: "deal-se", tenantId: "tenant-qa", workspaceId: WORKSPACE_ID, pipelineId: "pipe-se", stageId: "stage-a", contactId: "contact-se", title: "Plano Enterprise ABC", valueCents: 95000, currency: "BRL", ownerUserId: "user-qa", createdAt: now, updatedAt: now, lastStageChangedAt: now, status: "open", valueMode: "calculated", forecastCategory: "commit", discountCents: 0, customFields: {} };
const commercial = {
  dealId: "deal-se", status: "open", valueMode: "calculated", currency: "BRL", valueCents: 95000,
  items: [{ id: "item-1", dealId: "deal-se", productId: "p1", position: 0, productNameSnapshot: "Licença Enterprise", billingTypeSnapshot: "one_time", quantity: 1, listPriceCentsSnapshot: 100000, minimumPriceCentsSnapshot: 80000, proposedUnitPriceCents: 95000, subtotalListCents: 100000, subtotalProposedCents: 95000, discountCents: 5000, grossMarginBp: 5789 }],
  totals: { itemCount: 1, listTotalCents: 100000, subtotalProposedCents: 95000, globalDiscountCents: 0, totalCents: 95000, discountCents: 5000, discountBp: 500, grossMarginBp: 5789, grossProfitCents: 55000, minimumTotalCents: 80000, negotiationRoomCents: 15000, belowMinimum: false, mrrCents: 0, arrCents: 0, oneTimeCents: 95000, tcvCents: 95000 },
  visibility: { canViewCost: false, canViewMargin: true, isManager: false },
  policy: { minMarginBp: 5000, allowBelowMinimum: false, source: "workspace" },
  evaluation: { reasons: [], requiresApproval: false, health: "healthy" },
  approval: { required: false, status: "not_required" },
  probability: { value: 75, source: "stage" },
  weightedValueCents: 71250,
  forecastCategory: "commit",
  aging: { daysOpen: 3, daysInStage: 1, stale: false, expectedCloseOverdue: false },
};

async function mockCockpit(page: Page) {
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/solutions") return ok({ solutions: [{ key: "conversations", name: "Conversas", internal: false }] });
    if (path === "/v1/deals") return ok([deal]);
    if (path === "/v1/deals/deal-se/commercial") return ok(commercial);
    if (path === "/v1/deals/deal-se/insights") return ok({ dealId: "deal-se", risks: [{ code: "no_next_action", title: "Sem próxima ação definida" }], explanations: ["Há até R$ 150,00 de espaço comercial antes do preço mínimo."], goalImpact: { available: true, ownerUserId: "user-qa", targetCents: 10000000, realizedCents: 6800000, attainmentBp: 6800, remainingCents: 3200000, dealValueCents: 95000, dealShareOfGoalBp: 95, afterCloseCents: 6895000, afterCloseAttainmentBp: 6895, afterCloseRemainingCents: 3105000 }, aiAvailable: false, hasConversation: false, marginVisible: true });
    if (path === "/v1/deals/deal-se/timeline") return ok([]);
    if (path === "/v1/pipelines") return ok([{ id: "pipe-se", name: "Comercial", isDefault: true }]);
    if (path.endsWith("/stages")) return ok([{ id: "stage-a", pipelineId: "pipe-se", name: "Negociação", position: 0, isWon: false, isLost: false }, { id: "stage-won", pipelineId: "pipe-se", name: "Ganho", position: 1, isWon: true, isLost: false }]);
    if (path === "/v1/contacts") return ok([{ id: "contact-se", name: "Ana Souza", tags: [], createdAt: now }]);
    if (path === "/v1/tasks" || path === "/v1/proposals" || path === "/v1/sales-reasons" || path === "/v1/sales-competitors" || path === "/v1/deal-custom-fields" || path === "/v1/products") return ok([]);
    if (path === "/v1/commercial-settings") return ok({ workspaceId: WORKSPACE_ID, sellersCanViewCost: false, sellersCanViewMargin: true, dealVisibility: "all", proposalAcceptAutoWin: false, rankingEnabled: false, visibility: commercial.visibility });
    return route.fallback();
  });
}

test("cockpit mostra negociação, margem, espaço até o mínimo e impacto na meta", async ({ page, context }) => {
  await loginCookie(context);
  await mockCockpit(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals?dealId=deal-se`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Plano Enterprise ABC").first()).toBeVisible();
  await expect(dialog.getByText("Saudável")).toBeVisible();
  await expect(dialog.getByText("Ainda pode negociar")).toBeVisible();
  await expect(dialog.getByText(/R\$\s150,00/).first()).toBeVisible();
  await expect(dialog.getByText("57,9%").first()).toBeVisible();
  await expect(dialog.getByText(/Se fechar: .* 69% da meta/)).toBeVisible();
  await expect(dialog.getByText("Sem próxima ação definida").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Ganha" })).toBeVisible();
  // Vendedor sem permissão de custo: custo nunca aparece.
  await expect(dialog.getByText("Custo", { exact: true })).toHaveCount(0);
});
