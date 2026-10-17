import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Vorix Design System 2.0 — prova visual em browser real (rede mockada). Gera screenshots das telas
 * principais em várias larguras para revisão (superfícies brancas legadas, overflow, contraste) e
 * falha se houver rolagem horizontal da página. Saída: docs/design-system-2/screenshots/.
 */
test.use({ channel: "chrome", timezoneId: "America/Sao_Paulo", colorScheme: "dark" });

const OUT = join(process.cwd(), "..", "docs", "design-system-2", "screenshots");
mkdirSync(OUT, { recursive: true });
const now = new Date();
const iso = (offsetMinutes = 0) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString();

const meetings = [
  { id: "m-1", workspaceId: WORKSPACE_ID, ownerUserId: "user-qa", ownerName: "QA Reviewer", createdByUserId: "user-qa", title: "Demo Plano Enterprise — Empresa ABC", source: "calendar", status: "completed", timezone: "America/Sao_Paulo", meetingUrl: "https://meet.google.com/abc-defg-hij", scheduledStartAt: iso(-180), scheduledEndAt: iso(-120), durationSeconds: 3120, statusChangedAt: iso(-100), createdAt: iso(-2000), updatedAt: iso(-100), participantCount: 3, participants: [{ name: "Ana Souza" }, { name: "Bruno Lima" }], hasRecording: true, recordingBytes: 180_000_000, recordingDurationSeconds: 3120, transcriptStatus: "completed", hasAnalysis: true },
  { id: "m-2", workspaceId: WORKSPACE_ID, ownerUserId: "user-qa", ownerName: "QA Reviewer", createdByUserId: "user-qa", title: "Kickoff de implantação", source: "calendar", status: "recording", timezone: "America/Sao_Paulo", meetingUrl: "https://meet.google.com/xyz", scheduledStartAt: iso(-20), scheduledEndAt: iso(40), recordingStartedAt: iso(-18), statusChangedAt: iso(-18), createdAt: iso(-3000), updatedAt: iso(-18), participantCount: 4, participants: [{ name: "Carla Mendes" }], hasRecording: false, recordingBytes: 0, hasAnalysis: false },
  { id: "m-3", workspaceId: WORKSPACE_ID, ownerUserId: "user-qa", ownerName: "QA Reviewer", createdByUserId: "user-qa", title: "Revisão comercial semanal", source: "calendar", status: "scheduled", timezone: "America/Sao_Paulo", meetingUrl: "https://meet.google.com/qwe", scheduledStartAt: iso(120), scheduledEndAt: iso(180), statusChangedAt: iso(-60), createdAt: iso(-60), updatedAt: iso(-60), participantCount: 6, participants: [], hasRecording: false, recordingBytes: 0, hasAnalysis: false },
];
const detail = {
  ...meetings[0],
  participants: [{ id: "p1", name: "Ana Souza", email: "ana@abc.com", role: "attendee" }, { id: "p2", name: "QA Reviewer", email: "qa@vorix.dev", role: "organizer" }],
  recordings: [{ id: "r1", kind: "processed", mimeType: "video/mp4", bytes: 180_000_000, durationSeconds: 3120, checksumSha256: "x", status: "available", createdAt: iso(-110) }],
  transcript: { id: "t1", status: "completed", language: "pt", engine: "whisper", segmentCount: 3, attempts: 1, completedAt: iso(-105) },
  latestAnalysis: {
    id: "a1", status: "completed", creditsCharged: 1, createdAt: iso(-100),
    result: { executiveSummary: "Cliente quer o plano Enterprise para 40 usuários, com objeção de preço e decisão prevista para sexta.", topics: ["Preço", "Implantação"], decisions: ["Enviar proposta revisada até quarta"], actionItems: [{ description: "Enviar proposta v2", owner: "QA Reviewer" }], nextSteps: ["Agendar call com o financeiro"], risks: ["Concorrente citado com 15% menos"], objections: ["Preço"], openQuestions: [] },
    actionItems: [{ id: "ai1", type: "task", description: "Enviar proposta v2", assigneeName: "QA Reviewer", status: "suggested" }, { id: "ai2", type: "decision", description: "Proposta revisada até quarta", status: "confirmed" }],
  },
};
const segments = [
  { seq: 1, startMs: 0, endMs: 9000, speaker: "QA Reviewer", text: "Obrigado por participar. Vamos revisar o escopo do plano Enterprise." },
  { seq: 2, startMs: 9000, endMs: 21000, speaker: "Ana Souza", text: "Perfeito. Precisamos de 40 usuários e a implantação até o fim do mês." },
  { seq: 3, startMs: 21000, endMs: 33000, speaker: "Ana Souza", text: "O concorrente ofereceu 15% menos, então o preço ainda é uma preocupação." },
];

async function mockEverything(page: Page) {
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/solutions") return ok({ solutions: [{ key: "conversations", name: "Conversas", internal: false }, { key: "meetings", name: "Meetings", internal: false }] });
    if (path === "/v1/workspaces/credits") return ok({ monthlyCreditsQuota: 500, creditsConsumedThisMonth: 120, creditsExtra: 0, remainingCredits: 380 });
    if (path === "/v1/meetings/dashboard") return ok({ meetingsToday: 3, meetingsThisWeek: 11, recordingNow: 1, processing: 0, recordedSeconds: 41_400, transcriptsAvailable: 9, limits: { maxConcurrentRecordings: 2, monthlyRecordingMinutes: 1200, meetingRetentionDays: 365, maxStorageBytes: 50_000_000_000 }, realRecordingEnabled: true });
    if (path === "/v1/meetings") return ok({ items: meetings, total: meetings.length });
    if (path === "/v1/inbox/metrics") return ok({ receivedCount: 48, openCount: 9, pendingCount: 4, resolvedCount: 35, backlogCount: 13, avgFirstResponseSeconds: 162, avgHandleTimeSeconds: 1260, aiResolvedMessageCount: 21, humanResolvedMessageCount: 27, volumeByAgent: [] });
    if (path === "/v1/meetings/m-1") return ok(detail);
    if (path === "/v1/onboarding") return ok({ id: "onb-1", tenantId: "t", workspaceId: WORKSPACE_ID, status: "in_progress", currentStep: "channel", completedSteps: ["company"], companySegment: "Software", primaryGoal: "sales", startedAt: iso(-60), updatedAt: iso(-5), channelModuleEnabled: true });
    if (path === "/v1/billing/overview") return ok({ planCode: "PRO", planName: "Pro", virtual: false, readOnly: false, billingInterval: "monthly", status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: iso(43_200), trialEnd: null, trialDaysRemaining: null, allowedAddonCodes: [], addons: [], availableAddons: [], consumption: [{ resource: "users", used: 4, max: 5 }, { resource: "messaging_connections", used: 1, max: 2 }], paymentMethod: undefined, recentInvoices: [{ id: "inv-1", providerInvoiceId: "in_1", amountCents: 29700, currency: "BRL", status: "paid", createdAt: iso(-43_200) }] });
    if (path === "/v1/billing/capacity") return ok({ current: { planCode: "PRO", currency: "BRL", includedUsers: 5, additionalUsers: 0, totalUsers: 5, includedWhatsappConnections: 2, additionalWhatsappConnections: 0, totalWhatsappConnections: 2, baseMonthlyAmount: 297, addonsMonthlyAmount: 0, totalMonthlyAmount: 297 }, pending: [] });
    if (path === "/v1/platform/plans") return ok({ plans: [{ code: "START", name: "Start", tagline: "Para começar", monthlyPriceUsd: 97, yearlyPriceUsd: 970, currency: "BRL", includedUsers: 2, includedWhatsappConnections: 1, monthlyCreditsQuota: 200, trialDays: 7 }, { code: "PRO", name: "Pro", tagline: "Para times em crescimento", monthlyPriceUsd: 297, yearlyPriceUsd: 2970, currency: "BRL", includedUsers: 5, includedWhatsappConnections: 2, monthlyCreditsQuota: 1000, highlighted: true, trialDays: 7 }], addons: [], solutions: [], priceSource: "plan_versions" });
    if (path === "/v1/meetings/m-1/insights") return ok({ summaryTemplate: "sales", templates: [{ key: "general", label: "Geral", description: "Resumo padrão" }, { key: "sales", label: "Vendas", description: "Dores, objeções e próximos passos" }], speakers: [{ key: "S1", displayName: "Ana (Vorix)", renamed: true }, { key: "S2", displayName: "Carlos (Cliente)", renamed: true }], talk: { hasSpeakers: true, totalTalkMs: 1_800_000, speakers: [{ speaker: "S1", displayName: "Ana (Vorix)", talkMs: 820_000, share: 0.46, turns: 31, longestMonologueMs: 95_000, questions: 9, wordsPerMinute: 142 }, { speaker: "S2", displayName: "Carlos (Cliente)", talkMs: 980_000, share: 0.54, turns: 29, longestMonologueMs: 120_000, questions: 4, wordsPerMinute: 131 }], speakerSwitches: 58, questions: 13 }, keywordHits: [], clips: [], comments: [], shares: [], crm: { available: true, suggestions: [] }, crmTasks: {}, questions: [], whatsAppAvailable: true, aiAvailable: true });
    if (path === "/v1/meetings/m-1/transcript") return ok({ segments, status: "completed" });
    if (path.endsWith("/playback")) return ok({ url: "data:video/mp4;base64,", mimeType: "video/mp4", expiresInSeconds: 600 });
    if (path === "/v1/meetings/agenda/events") return ok(meetings.map((meeting) => ({ id: `ev-${meeting.id}`, meetingId: meeting.id, title: meeting.title, startAt: meeting.scheduledStartAt, endAt: meeting.scheduledEndAt, status: meeting.status === "scheduled" ? "scheduled" : "completed", source: "google", autoRecord: true, timezone: "America/Sao_Paulo" })));
    if (path === "/v1/meetings/google/status") return ok({ connected: true, email: "qa@vorix.dev", calendarConnected: true });
    if (path === "/v1/meetings/recorder-accounts") return ok([]);
    if (path === "/v1/meetings/recording-capacity") return ok({ limit: 2, active: 1, connectedAccounts: 2 });
    if (path.startsWith("/v1/meetings/")) return ok([]);
    if (path === "/v1/commercial-metrics") return ok({ dealsCreatedCount: 14, openPipelineValueCents: 48_500_000, wonCount: 6, wonValueCents: 21_300_000, lostCount: 3, conversionRate: 0.66, avgTicketCents: 3_550_000, avgCycleDays: 12.4, proposalsSentCount: 9, proposalsAcceptedCount: 4, proposalAcceptRate: 0.44, dealsWithoutNextActionCount: 2, stageAging: [], lossReasons: [], revenueByOrigin: [] });
    if (path === "/v1/deals") return ok([cockpitDeal]);
    if (path === "/v1/deals/deal-ds2/commercial") return ok(cockpitCommercial);
    if (path === "/v1/deals/deal-ds2/insights") return ok({ dealId: "deal-ds2", risks: [{ code: "competitor_mentioned", title: "Cliente mencionou concorrente", evidence: "O concorrente ofereceu 15% menos" }, { code: "no_next_action", title: "Sem próxima ação definida" }], explanations: ["Há até R$ 1.500,00 de espaço comercial antes do preço mínimo.", "Margem atual de 57,9% (mínima da política: 50%)."], goalImpact: { available: true, ownerUserId: "user-qa", targetCents: 10000000, realizedCents: 6845000, attainmentBp: 6845, remainingCents: 3155000, dealValueCents: 950000, dealShareOfGoalBp: 950, afterCloseCents: 7795000, afterCloseAttainmentBp: 7795, afterCloseRemainingCents: 2205000 }, aiAvailable: true, hasConversation: true, marginVisible: true });
    if (path === "/v1/deals/deal-ds2/timeline") return ok([]);
    if (path === "/v1/pipelines") return ok([{ id: "pipe-ds2", name: "Comercial", isDefault: true }]);
    if (path.endsWith("/stages")) return ok([{ id: "st-1", pipelineId: "pipe-ds2", name: "Qualificação", position: 0, isWon: false, isLost: false }, { id: "st-2", pipelineId: "pipe-ds2", name: "Negociação", position: 1, isWon: false, isLost: false }, { id: "st-won", pipelineId: "pipe-ds2", name: "Ganho", position: 2, isWon: true, isLost: false }]);
    if (path === "/v1/products") return ok([
      { id: "p1", tenantId: "t", workspaceId: WORKSPACE_ID, name: "Licença Enterprise", code: "ENT-01", category: "Software", itemType: "service", billingType: "monthly", priceCents: 9500, listPriceCents: 9500, minimumPriceCents: 8000, currency: "BRL", active: true, createdAt: iso(), updatedAt: iso() },
      { id: "p2", tenantId: "t", workspaceId: WORKSPACE_ID, name: "Implantação", code: "IMP", category: "Serviço", itemType: "service", billingType: "one_time", priceCents: 150000, listPriceCents: 150000, currency: "BRL", active: true, createdAt: iso(), updatedAt: iso() },
    ]);
    if (path === "/v1/commercial-settings") return ok({ workspaceId: WORKSPACE_ID, sellersCanViewCost: false, sellersCanViewMargin: true, dealVisibility: "all", proposalAcceptAutoWin: false, rankingEnabled: true, visibility: { canViewCost: true, canViewMargin: true, isManager: true } });
    if (path === "/v1/sales-performance") return ok({ subject: {}, period: { type: "monthly", start: "2026-10-01", from: iso(), to: iso() }, goals: [{ id: "g1", scopeType: "user", scopeId: "user-qa", metric: "sales_revenue", periodType: "monthly", periodStart: "2026-10-01", targetValue: 10_000_000, currency: "BRL", progress: { targetValue: 10_000_000, realizedValue: 6_845_000, attainmentBp: 6845, remainingValue: 3_155_000, reached: false } }], won: { count: 5, revenueCents: 6_845_000, averageTicketCents: 1_369_000, averageMarginBp: 5420, mrrCents: 120_000, arrCents: 1_440_000 }, lost: { count: 2, valueCents: 900_000 }, conversionBp: 7142, averageCycleDays: 11.2, pipeline: { openCount: 12, openValueCents: 22_000_000, weightedValueCents: 9_800_000 }, forecast: { wonCents: 6_845_000, commitCents: 2_200_000, bestCaseCents: 3_100_000, pipelineCents: 11_000_000, weightedCents: 4_300_000 }, dataQuality: { withoutNextActivity: 3, stale: 1, overdueExpectedClose: 2, withoutValue: 0, withoutOwner: 0 }, comparison: { previousRevenueCents: 5_900_000, previousWonCount: 4, available: true } });
    if (path === "/v1/sales-reasons" || path === "/v1/sales-competitors" || path === "/v1/deal-custom-fields" || path === "/v1/commercial-policies" || path === "/v1/price-books" || path === "/v1/proposals" || path === "/v1/proposal-templates" || path === "/v1/tasks" || path === "/v1/contacts") return ok([]);
    return route.fallback();
  });
}

const cockpitDeal = { id: "deal-ds2", tenantId: "t", workspaceId: WORKSPACE_ID, pipelineId: "pipe-ds2", stageId: "st-2", contactId: "contact-ds2", title: "Plano Enterprise — Empresa ABC", valueCents: 950000, currency: "BRL", ownerUserId: "user-qa", expectedCloseDate: new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10), createdAt: iso(-9000), updatedAt: iso(-60), lastStageChangedAt: iso(-1500), status: "open", valueMode: "calculated", forecastCategory: "commit", discountCents: 0, customFields: {} };
const cockpitCommercial = {
  dealId: "deal-ds2", status: "open", valueMode: "calculated", currency: "BRL", valueCents: 950000,
  items: [{ id: "i1", dealId: "deal-ds2", productId: "p1", position: 0, productNameSnapshot: "Licença Enterprise", billingTypeSnapshot: "one_time", quantity: 10, listPriceCentsSnapshot: 100000, minimumPriceCentsSnapshot: 80000, unitCostCentsSnapshot: 40000, proposedUnitPriceCents: 95000, subtotalListCents: 1000000, subtotalProposedCents: 950000, subtotalCostCents: 400000, discountCents: 50000, grossProfitCents: 550000, grossMarginBp: 5789 }],
  totals: { itemCount: 1, listTotalCents: 1000000, subtotalProposedCents: 950000, globalDiscountCents: 0, totalCents: 950000, discountCents: 50000, discountBp: 500, costCents: 400000, grossProfitCents: 550000, grossMarginBp: 5789, minimumTotalCents: 800000, negotiationRoomCents: 150000, belowMinimum: false, mrrCents: 0, arrCents: 0, oneTimeCents: 950000, tcvCents: 950000 },
  visibility: { canViewCost: true, canViewMargin: true, isManager: true },
  policy: { minMarginBp: 5000, maxDiscountBp: 1000, allowBelowMinimum: false, source: "workspace" },
  evaluation: { reasons: [], requiresApproval: false, health: "near_limit" },
  approval: { required: false, status: "not_required" },
  probability: { value: 75, source: "stage" }, weightedValueCents: 712500, forecastCategory: "commit",
  aging: { daysOpen: 6, daysInStage: 1, daysWithoutActivity: 2, stale: false, expectedCloseOverdue: false },
};

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1024", width: 1024, height: 768 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
];

async function capture(page: Page, slug: string, sizes = VIEWPORTS) {
  for (const viewport of sizes) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(OUT, `${slug}-${viewport.name}.png`), fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${slug} @${viewport.name} sem rolagem horizontal`).toBeLessThanOrEqual(1);
  }
}

test.describe("prova visual DS 2.0", () => {
  test("login e signup", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Entrar no Vorix" })).toBeVisible();
    await capture(page, "login");
    await page.goto("/signup");
    await capture(page, "signup", [VIEWPORTS[0], VIEWPORTS[4]]);
  });

  test("Conversas: home, inbox, desempenho, produtos e regras", async ({ page, context }) => {
    test.setTimeout(90_000); // percorre 9 telas em várias larguras
    await loginCookie(context);
    await mockEverything(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}`);
    await page.waitForLoadState("networkidle");
    await capture(page, "conversas-home");
    await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
    await expect(page.getByText("Carla Mendes").first()).toBeVisible();
    await capture(page, "conversas-inbox", [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4]]);
    await page.getByText("Carla Mendes").first().click();
    await page.waitForTimeout(500);
    await capture(page, "conversas-inbox-thread", [VIEWPORTS[0], VIEWPORTS[4]]);
    await page.goto(`/workspaces/${WORKSPACE_ID}/performance`);
    await expect(page.getByText("Desempenho comercial")).toBeVisible();
    await capture(page, "sales-performance", [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4]]);
    await page.goto(`/workspaces/${WORKSPACE_ID}/products`);
    await expect(page.getByText("Licença Enterprise").first()).toBeVisible();
    await capture(page, "products", [VIEWPORTS[0], VIEWPORTS[4]]);
    await page.goto(`/workspaces/${WORKSPACE_ID}/settings/commercial`);
    await page.waitForLoadState("networkidle");
    await capture(page, "settings-commercial", [VIEWPORTS[0], VIEWPORTS[4]]);
    await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
    await page.waitForLoadState("networkidle");
    await capture(page, "deals-kanban", [VIEWPORTS[0], VIEWPORTS[4]]);
    await page.goto(`/workspaces/${WORKSPACE_ID}/deals?dealId=deal-ds2`);
    await expect(page.getByRole("dialog").getByText("Visão comercial")).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, "opportunity-cockpit", [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4]]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
    await page.getByRole("button", { name: /Nova oportunidade/ }).first().click();
    await expect(page.getByRole("dialog", { name: "Criar oportunidade" })).toBeVisible();
    await capture(page, "opportunity-create", [VIEWPORTS[0], VIEWPORTS[4]]);
  });

  test("Meetings: home, agenda e detalhe", async ({ page, context }) => {
    await loginCookie(context);
    await mockEverything(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/meetings`);
    await page.waitForLoadState("networkidle");
    await capture(page, "meetings-home");
    await page.goto(`/workspaces/${WORKSPACE_ID}/meetings/agenda`);
    await page.waitForLoadState("networkidle");
    await capture(page, "meetings-agenda", [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4]]);
    await page.goto(`/workspaces/${WORKSPACE_ID}/meetings/central/m-1`);
    await page.waitForLoadState("networkidle");
    await capture(page, "meetings-detail", [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4]]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Resumo IA" }).first().click();
    await capture(page, "meetings-summary", [VIEWPORTS[0], VIEWPORTS[4]]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Transcrição" }).first().click();
    await capture(page, "meetings-transcript", [VIEWPORTS[0], VIEWPORTS[4]]);
    await page.goto(`/workspaces/${WORKSPACE_ID}/meetings/recordings`);
    await page.waitForLoadState("networkidle");
    await capture(page, "meetings-recordings", [VIEWPORTS[0], VIEWPORTS[4]]);
  });

  test("Núcleo: configurações, usuários e plano", async ({ page, context }) => {
    await loginCookie(context);
    await mockEverything(page);
    for (const [slug, path] of [["settings", "settings"], ["settings-users", "settings/users"], ["settings-plan", "settings/plano"], ["onboarding", "onboarding"]] as const) {
      await page.goto(`/workspaces/${WORKSPACE_ID}/${path}`);
      await page.waitForLoadState("networkidle");
      await capture(page, slug, [VIEWPORTS[0], VIEWPORTS[4]]);
    }
  });
});
