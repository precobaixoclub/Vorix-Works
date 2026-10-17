import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Prova em browser (rede mockada) dos ajustes de produto: máscara de moeda + estoque no produto,
 * metas mensais com anual calculada, estrutura/créditos no plano, bloqueio do fim do teste e
 * relatórios com modelos + IA. Saída: docs/feedback-2026-10/screenshots/.
 */
test.use({ channel: "chrome", timezoneId: "America/Sao_Paulo", colorScheme: "dark" });

const OUT = join(process.cwd(), "..", "docs", "feedback-2026-10", "screenshots");
mkdirSync(OUT, { recursive: true });
const iso = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();
const year = new Date().getFullYear();

const products = [
  { id: "p1", tenantId: "t", workspaceId: WORKSPACE_ID, name: "Licença Enterprise", code: "ENT-01", category: "Software", itemType: "product", billingType: "monthly", unit: "licença", priceCents: 9500, listPriceCents: 9500, minimumPriceCents: 8000, costCents: 4000, currency: "BRL", active: true, createdAt: iso(), updatedAt: iso(), trackStock: true, stockQuantity: 3, stockAlertThreshold: 5, lowStock: true, description: "Licença anual com suporte." },
  { id: "p2", tenantId: "t", workspaceId: WORKSPACE_ID, name: "Leitor de código", code: "LEI-2", category: "Hardware", itemType: "product", billingType: "one_time", unit: "un", priceCents: 45000, listPriceCents: 45000, currency: "BRL", active: true, createdAt: iso(), updatedAt: iso(), trackStock: true, stockQuantity: 42, stockAlertThreshold: 10, lowStock: false },
  { id: "p3", tenantId: "t", workspaceId: WORKSPACE_ID, name: "Implantação", code: "IMP", category: "Serviço", itemType: "service", billingType: "one_time", priceCents: 150000, listPriceCents: 150000, currency: "BRL", active: true, createdAt: iso(), updatedAt: iso(), trackStock: false, stockQuantity: 0, lowStock: false },
];

const monthGoal = (month: number, value: number) => ({ id: `g-${month}`, tenantId: "t", workspaceId: WORKSPACE_ID, scopeType: "company", metric: "sales_revenue", periodType: "monthly", periodStart: `${year}-${String(month).padStart(2, "0")}-01`, targetValue: value, currency: "BRL", progress: { targetValue: value, realizedValue: month < 10 ? value * 0.8 : 0, attainmentBp: month < 10 ? 8000 : 0, remainingValue: value * 0.2, reached: false } });
const goals = [
  ...Array.from({ length: 12 }, (_, index) => monthGoal(index + 1, 5_000_000)),
  ...[0, 1, 2, 3].map((quarter) => ({ ...monthGoal(quarter * 3 + 1, 15_000_000), id: `q-${quarter}`, periodType: "quarterly" })),
  { ...monthGoal(1, 60_000_000), id: "annual", periodType: "annual", progress: { targetValue: 60_000_000, realizedValue: 36_000_000, attainmentBp: 6000, remainingValue: 24_000_000, reached: false }, pace: { totalMonths: 12, elapsedMonths: 9, requiredPerRemainingMonth: 8_000_000, projectedValue: 48_000_000 } },
];

const catalog = [
  { key: "commercial_overview", title: "Visão comercial", description: "Oportunidades, pipeline, ganhos, conversão, ticket e ciclo." },
  { key: "revenue_by_origin", title: "Receita por origem", description: "Vendas e receita por origem." },
  { key: "stage_aging", title: "Tempo por etapa", description: "Abertas e tempo médio por etapa." },
  { key: "loss_reasons", title: "Motivos de perda", description: "Por que as oportunidades foram perdidas." },
  { key: "sales_funnel", title: "Funil de vendas", description: "Entradas, avanço e tempo por etapa." },
  { key: "seller_conversion", title: "Conversão por vendedor", description: "Ganhos, perdas e conversão por vendedor." },
  { key: "top_products", title: "Produtos mais vendidos", description: "Quantidade, receita e margem." },
  { key: "proposals_performance", title: "Propostas", description: "Do envio ao aceite." },
  { key: "discounts_approvals", title: "Descontos e aprovações", description: "Descontos e aprovações comerciais." },
  { key: "margin", title: "Margem", description: "Receita, custo e margem." },
  { key: "attendance_overview", title: "Atendimento", description: "Volume e tempos de atendimento." },
  { key: "agent_volume", title: "Volume por atendente", description: "Mensagens por atendente." },
  { key: "csat", title: "Satisfação (CSAT)", description: "Nota média e por atendente." },
  { key: "closing_reasons", title: "Motivos de encerramento", description: "Por que as conversas foram encerradas." },
];
const system = [
  { id: "system:executive_summary", name: "Resumo executivo", description: "O essencial do período: vendas, origem da receita e atendimento.", sections: ["commercial_overview", "revenue_by_origin", "attendance_overview", "csat"] },
  { id: "system:sales_funnel", name: "Funil e conversão", description: "Onde as oportunidades avançam e se perdem.", sections: ["commercial_overview", "sales_funnel", "stage_aging", "loss_reasons"] },
  { id: "system:team_performance", name: "Desempenho da equipe", description: "Conversão por vendedor, volume e satisfação.", sections: ["seller_conversion", "agent_volume", "csat", "discounts_approvals"] },
  { id: "system:products_margin", name: "Produtos e margem", description: "O que mais vende e com que margem.", sections: ["top_products", "margin", "discounts_approvals"] },
  { id: "system:attendance", name: "Atendimento", description: "Volume, tempos e satisfação.", sections: ["attendance_overview", "agent_volume", "csat", "closing_reasons"] },
  { id: "system:proposals", name: "Propostas", description: "Do envio ao aceite.", sections: ["proposals_performance", "discounts_approvals", "commercial_overview"] },
];

type Billing = { status: string; trialDaysRemaining: number | null; paymentMethod?: unknown };

async function mockAll(page: Page, billing: Billing = { status: "active", trialDaysRemaining: null, paymentMethod: { providerPaymentMethodId: "pm", brand: "visa", last4: "4242", expMonth: 12, expYear: 2029 } }) {
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/solutions") return ok({ solutions: [{ key: "conversations", name: "Conversas", internal: false }, { key: "meetings", name: "Meetings", internal: false }] });
    if (path === "/v1/workspaces/credits") return ok({ monthlyCreditsQuota: 2500, creditsConsumedThisMonth: 2420, creditsExtra: 0, remainingCredits: 80 });
    if (path === "/v1/products") return ok(products);
    if (path === "/v1/commercial-settings") return ok({ workspaceId: WORKSPACE_ID, visibility: { canViewCost: true, canViewMargin: true, isManager: true } });
    if (path.includes("/variants")) return ok([]);
    if (path === "/v1/sales-goals") return ok(goals);
    if (path === "/v1/billing/overview") return ok({ planCode: "PRO", planName: "Pro", virtual: false, readOnly: billing.status === "trial_expired", billingInterval: "monthly", status: billing.status, cancelAtPeriodEnd: false, currentPeriodEnd: billing.status === "active" ? iso(12) : null, trialEnd: billing.status.startsWith("trial") ? iso(billing.trialDaysRemaining ?? -1) : null, trialDaysRemaining: billing.trialDaysRemaining, allowedAddonCodes: [], addons: [], availableAddons: [], consumption: [{ resource: "users", used: 4, max: 5 }, { resource: "messaging_connections", used: 2, max: 2 }], paymentMethod: billing.paymentMethod, recentInvoices: [] });
    if (path === "/v1/billing/capacity") return ok({ current: { planCode: "PRO", currency: "BRL", includedUsers: 5, additionalUsers: 1, totalUsers: 6, includedWhatsappConnections: 2, additionalWhatsappConnections: 0, totalWhatsappConnections: 2, concurrentRecordings: 2, baseMonthlyAmount: 297, addonsMonthlyAmount: 253, totalMonthlyAmount: 550 }, pending: [], nextCharge: billing.status === "active" ? { at: iso(12), amount: 550, currency: "BRL" } : undefined, canChangeNow: billing.status === "active", meetingsSellable: true });
    if (path === "/v1/billing/capacity/preview") return ok({ current: {}, requestedOnCurrentPlan: { planCode: "PRO", currency: "BRL", baseMonthlyAmount: 297, includedUsers: 5, includedWhatsappConnections: 2, additionalUsers: 1, additionalWhatsappConnections: 1, userAddonMonthlyAmount: 39, whatsappAddonMonthlyAmount: 79, concurrentRecordings: 3, meetingsMonthlyAmount: 281, addonsMonthlyAmount: 399, totalMonthlyAmount: 696, feasible: true }, recommendation: { options: [], recommended: undefined } });
    if (path === "/v1/billing/credits") return ok({ remainingCredits: 80, monthlyQuota: 2500, consumedThisMonth: 2420, extraCredits: 0, subscriptionStatus: billing.status, pricing: { unitPriceCents: 10, currency: "BRL", minPurchase: 100, maxPurchase: 100000, presets: [500, 1000, 2500, 5000] }, savedCard: billing.paymentMethod ? { brand: "visa", last4: "4242" } : undefined, chargesSavedCard: Boolean(billing.paymentMethod), canPurchase: billing.status !== "trial_expired", purchases: [{ id: "aicp-1", credits: 1000, amountCents: 10000, currency: "BRL", status: "paid", method: "saved_card", createdAt: iso(-12), paidAt: iso(-12) }] });
    if (path === "/v1/platform/plans") return ok({ plans: [{ code: "PRO", name: "Pro", tagline: "Para times em crescimento", monthlyPriceUsd: 297, yearlyPriceUsd: 2970, currency: "BRL", includedUsers: 5, includedWhatsappConnections: 2, monthlyCreditsQuota: 2500, highlighted: true, trialDays: 7 }], addons: [], solutions: [], priceSource: "plan_versions" });
    if (path === "/v1/report-templates" && method === "GET") return ok({ catalog, system, custom: [{ id: "rpt-1", name: "Fechamento semanal", description: "Vendas e perdas da semana.", sections: ["commercial_overview", "seller_conversion", "loss_reasons"], source: "ai", canEdit: true, createdAt: iso(-2) }], aiAvailable: true });
    if (path === "/v1/report-templates/ai-draft") return ok({ name: "Reunião mensal de atendimento", description: "Tempo de resposta, satisfação e volume por atendente.", sections: ["attendance_overview", "csat", "agent_volume"], rationale: "Essas seções mostram velocidade, qualidade e carga de cada atendente.", warnings: [] });
    if (path === "/v1/reports/ai-analysis") return ok({ generatedAt: new Date().toISOString(), summary: "O período fechou com conversão de 66,0% e ticket médio alto, mas a primeira resposta ainda passa de 2 minutos.", highlights: [{ title: "Conversão forte", evidence: "Conversão: 66,0%" }], risks: [{ title: "Primeira resposta lenta", evidence: "1ª resposta média: 3 min" }], recommendations: [{ title: "Ativar resposta automática fora do horário", rationale: "Reduz o tempo da primeira resposta nos picos.", evidence: "1ª resposta média: 3 min" }] });
    if (path === "/v1/commercial-metrics") return ok({ dealsCreatedCount: 14, openPipelineValueCents: 48_500_000, wonCount: 6, wonValueCents: 21_300_000, lostCount: 3, conversionRate: 0.66, avgTicketCents: 3_550_000, avgCycleDays: 12.4, proposalsSentCount: 9, proposalsAcceptedCount: 4, proposalAcceptRate: 0.44, dealsWithoutNextActionCount: 2, stageAging: [{ stageId: "s1", stageName: "Negociação", openCount: 5, avgDaysInStage: 6.2 }], lossReasons: [{ reason: "Preço", count: 2 }, { reason: "Sem retorno", count: 1 }], revenueByOrigin: [{ origin: "WhatsApp", wonCount: 4, wonValueCents: 15_000_000 }, { origin: "Instagram", wonCount: 2, wonValueCents: 6_300_000 }] });
    if (path === "/v1/inbox/metrics") return ok({ receivedCount: 148, openCount: 9, pendingCount: 4, resolvedCount: 135, backlogCount: 13, avgFirstResponseSeconds: 162, avgHandleTimeSeconds: 1260, aiResolvedMessageCount: 61, humanResolvedMessageCount: 87, volumeByAgent: [{ userId: "user-qa", messageCount: 87 }], csatAverage: 4.6, csatResponses: 41, csatRequested: 60, csatByAgent: [{ userId: "user-qa", average: 4.6, responses: 41 }], closingReasons: [{ reason: "Resolvido", count: 120 }] });
    if (path === "/v1/sales-reports") return ok({ conversion: { won: 6, lost: 3, conversionBp: 6666, bySeller: [{ id: "user-qa", won: 6, lost: 3, wonValueCents: 21_300_000, conversionBp: 6666 }], byTeam: [], byPipeline: [], byOrigin: [] }, products: [], losses: { count: 3, valueCents: 0, byReason: [], byCompetitor: [], bySeller: [] }, funnel: [], cycle: {}, proposals: { created: 10, sent: 9, viewed: 7, accepted: 4, declined: 2, expired: 1 }, discounts: { wonWithDiscount: 2, totalDiscountCents: 150_000, averageDiscountBp: 450, approvalsRequested: 1, approvalsApproved: 1, approvalsRejected: 0 }, visibility: { canViewCost: true, canViewMargin: true, isManager: true } });
    return route.fallback();
  });
}

const VIEWPORTS = [{ name: "1440", width: 1440, height: 900 }, { name: "390", width: 390, height: 844 }];

async function capture(page: Page, slug: string, sizes = VIEWPORTS) {
  for (const viewport of sizes) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(OUT, `${slug}-${viewport.name}.png`), fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${slug} @${viewport.name} sem rolagem horizontal`).toBeLessThanOrEqual(1);
  }
}

test.describe("prova dos ajustes de produto", () => {
  test("produtos: estoque baixo, máscara de moeda e observações largas", async ({ page, context }) => {
    await loginCookie(context);
    await mockAll(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/settings/products`);
    await expect(page.getByText("1 produto chegou ao ponto de reposição")).toBeVisible();
    await capture(page, "products-low-stock");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Novo produto" }).click();
    const price = page.getByLabel("Preço de tabela");
    await price.click();
    await page.keyboard.type("123456");
    await expect(price).toHaveValue("1.234,56");
    await page.getByLabel("Controlar estoque").click();
    await page.getByLabel(/Quantidade em estoque/).fill("25");
    await page.getByLabel("Avisar para comprar quando chegar a").fill("5");
    await page.getByLabel("Descrição e observações").fill("Produto importado. Prazo de reposição do fornecedor: 15 dias úteis. Conferir número de série na entrega e registrar no CRM do cliente.");
    await capture(page, "product-form", [VIEWPORTS[0]]);
  });

  test("metas: repetir em todos os meses e anual calculada", async ({ page, context }) => {
    await loginCookie(context);
    await mockAll(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/settings/goals`);
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Empresa" }).click();
    await expect(page.getByText("Meta anual (soma dos meses)")).toBeVisible();
    await expect(page.getByText("12 de 12 meses com meta")).toBeVisible();
    await capture(page, "goals");
  });

  test("plano: estrutura com gravações, próxima cobrança e créditos de IA", async ({ page, context }) => {
    await loginCookie(context);
    await mockAll(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/settings/plano`);
    await expect(page.getByText("Gravações simultâneas (Meetings)")).toBeVisible();
    await capture(page, "billing-structure", [VIEWPORTS[0]]);
    await page.getByRole("button", { name: "Aumentar Gravações simultâneas (Meetings)" }).click().catch(async () => {
      await page.getByText("Gravações simultâneas (Meetings)").locator("..").locator("button").last().click();
    });
    await expect(page.getByText("Próxima cobrança em")).toBeVisible();
    await page.getByText("Sua estrutura").scrollIntoViewIfNeeded();
    await capture(page, "billing-structure-preview", [VIEWPORTS[0]]);
    await page.locator("#creditos").scrollIntoViewIfNeeded();
    await capture(page, "billing-ai-credits");
  });

  test("teste gratuito: contagem e bloqueio ao terminar", async ({ page, context }) => {
    await loginCookie(context);
    await mockAll(page, { status: "trial", trialDaysRemaining: 2, paymentMethod: undefined });
    await page.goto(`/workspaces/${WORKSPACE_ID}/settings/plano`);
    await expect(page.getByText("Faltam 2 dias de teste")).toBeVisible();
    await capture(page, "trial-countdown", [VIEWPORTS[0]]);
    await mockAll(page, { status: "trial_expired", trialDaysRemaining: 0, paymentMethod: undefined });
    await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
    await expect(page.getByRole("dialog", { name: "Seu teste gratuito terminou" })).toBeVisible();
    await capture(page, "trial-expired-gate");
  });

  test("relatórios: modelo pronto, análise com IA e criação de modelo com IA", async ({ page, context }) => {
    await loginCookie(context);
    await mockAll(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/reports`);
    await expect(page.getByRole("heading", { name: "Resumo executivo" })).toBeVisible();
    await expect(page.getByText("66%", { exact: true }).first()).toBeVisible();
    await capture(page, "reports");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Analisar com IA" }).click();
    await expect(page.getByText("Análise do relatório")).toBeVisible();
    await capture(page, "reports-ai-analysis", [VIEWPORTS[0]]);
    await page.getByRole("button", { name: "Criar modelo com IA" }).click();
    await page.getByLabel("O que você quer acompanhar").fill("Um relatório para a reunião mensal de atendimento");
    await page.getByRole("button", { name: "Gerar modelo" }).click();
    await expect(page.getByText("Revise o modelo criado pela IA")).toBeVisible();
    await capture(page, "reports-ai-template", [VIEWPORTS[0]]);
  });
});
