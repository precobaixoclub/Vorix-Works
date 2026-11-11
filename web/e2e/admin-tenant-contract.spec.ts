import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend } from "./fixtures/mock-backend";

const target = "tenant-managed-client";
async function fixture(page: Page, { paid = false, failWrite = false } = {}) {
  await loginCookie(page.context()); await mockConversasBackend(page);
  await page.route("**/v1/auth/me", route => route.fulfill({ json: { ok: true, data: { user: { id: "root", email: "root@fixture.test", name: "Platform owner", isPlatformAdmin: true }, tenantId: "tenant-admin-own", role: "owner", permissions: [], teams: [], isAccountOwner: true } } }));
  const stamp = "2026-11-02T12:00:00Z";
  const capabilities = { crm: true, proposals: true, automation: true, ai_auto_reply: true, advanced_analytics: true };
  const limits = { users: 2, workspaces: 1, messaging_connections: 1, contacts: null, ai_credits: 50, automations: 10, storage_mb: 100 };
  const entitlements = { tenantId: target, planCode: "START", planVersionId: "start-v1", virtual: !paid, readOnly: false, capabilities, limits };
  const snapshot = { planCode: "START", currency: "BRL", includedUsers: 2, additionalUsers: 0, totalUsers: 2, includedWhatsappConnections: 1, additionalWhatsappConnections: 0, totalWhatsappConnections: 1, includedWorkspaces: 1, additionalWorkspaces: 0, totalWorkspaces: 1, concurrentRecordings: 0, baseMonthlyAmount: 99, addonsMonthlyAmount: 0, totalMonthlyAmount: 99 };
  let controls = { tenantId: target, displayName: "Cliente gerenciado", accessMode: "inherit", capabilities: {} as Record<string, boolean>, limits: {} as Record<string, number | null>, version: 0 };
  const history: unknown[] = []; const writes: { path: string; body: Record<string, unknown> }[] = [];
  const solutions = [{ key: "marketing", name: "Vorix Marketing", enabled: false, commercialAvailability: "public", internal: false }, { key: "meetings", name: "Vorix Meetings", enabled: true, commercialAvailability: "public", internal: false, entitlement: { enabled: true, source: "manual", updatedAt: stamp, limits: { maxConcurrentRecordings: 3, monthlyRecordingMinutes: 1200, meetingRetentionDays: 45, maxStorageBytes: 21474836480 } } }];
  const usage = { tenantId: target, period: "2026-11", inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, creditsConsumed: 0, providerCostUsd: 0, customerPriceUsd: 0, requestsCount: 0, updatedAt: stamp };
  await page.route("**/v1/admin/**", async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; const method = request.method();
    const reply = (data: unknown, status = 200) => route.fulfill({ status, json: { ok: true, data } });
    if (method === "GET" && path.endsWith("/contract")) return reply({ contract: entitlements, effective: { ...entitlements, capabilities: { ...capabilities, ...controls.capabilities }, limits: { ...limits, ...controls.limits } }, controls, usage: { users: 1, workspaces: 1, messaging_connections: 1, contacts: 3, ai_credits: 0, automations: 0, storage_mb: 0 }, planName: "Start", capacity: { current: snapshot, canChangeNow: paid, meetingsSellable: true, pending: [], adjustableAddons: [], nextCharge: paid ? { at: stamp, amount: 99, currency: "BRL" } : undefined }, subscription: paid ? { status: "active", interval: "monthly", provider: "fixture", currentPeriodEnd: stamp, cancelAtPeriodEnd: false, linkedToProvider: true } : null, addons: [], plans: [{ code: "START", name: "Start", monthlyPrice: 99, yearlyPrice: 999, currency: "BRL" }, { code: "PRO", name: "Pro", monthlyPrice: 199, yearlyPrice: 1999, currency: "BRL" }], history });
    if (method === "GET" && path.endsWith("/solutions")) return reply({ solutions });
    if (method === "GET") return reply({ overview: { tenantId: target, displayName: controls.displayName, billing: { tenantId: target, planCode: "START", subscriptionStatus: "active", monthlyCreditsQuota: 50, creditsExtra: 0, priceMultiplier: 2 }, currentUsage: usage, currentProfitUsd: 0, totalCreditsUsedThisMonth: 0, quotaUsagePercent: 0 }, planName: "Start", workspaces: [{ id: "ws-client", name: "Espaço preservado", status: "active" }, { id: "ws-centro", name: "Loja Centro", status: "active" }], members: [{ userId: "client-owner", name: "Dono cliente", email: "client@fixture.test", role: "owner", isAccountOwner: true, workspaceIds: null }, { userId: "seller", name: "Vendedora", email: "seller@fixture.test", role: "editor", isAccountOwner: false, workspaceIds: null }], recentCreditEntries: [], usageHistory: [] });
    const body = request.postDataJSON(); writes.push({ path, body });
    if (path.endsWith("/controls")) {
      if (failWrite) { failWrite = false; return route.fulfill({ status: 409, json: { ok: false, error: { code: "CONFLICT", message: "A conta foi alterada. Recarregue antes de salvar.", recoverable: true } } }); }
      const before = structuredClone(controls); controls = { ...controls, ...body, version: controls.version + 1 };
      history.unshift({ id: "change-1", actorUserId: "root", reason: body.reason, occurredAt: stamp, before, after: controls }); return reply(controls);
    }
    if (path.endsWith("/preview")) return reply({ current: snapshot, requestedOnCurrentPlan: { ...snapshot, totalMonthlyAmount: 177, feasible: true }, recommendation: { options: [] } });
    if (path.includes("/solutions/")) return reply({ enabled: body.enabled });
    return reply({ outcomes: [] });
  });
  return { writes };
}

test("admin altera recursos, limites e soluções com um único motivo e um único botão", async ({ page }, info) => {
  const state = await fixture(page); await page.goto(`/admin/tenants/${target}`);
  await expect(page.getByRole("heading", { name: "Cliente gerenciado", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Acessos e limites", exact: true }).click();
  const save = page.getByRole("button", { name: "Salvar alterações" }); await expect(save).toBeDisabled();
  await expect(page.getByText("Motivo da alteração do produto")).toHaveCount(0); await expect(page.getByRole("button", { name: /^Salvar/ })).toHaveCount(1);
  await page.getByLabel("Propostas comerciais", { exact: false }).selectOption("blocked");
  await page.locator("#limit-mode-workspaces").selectOption("custom"); await page.getByLabel("Limite de Espaços ativos").fill("3");
  await page.getByRole("switch", { name: "Vorix Marketing" }).click(); await page.getByLabel("Minutos de gravação por mês").fill("1500");
  await expect(page.getByText("Dono da conta: acessa todos os espaços.")).toBeVisible();
  await page.getByLabel("Espaços de Vendedora").selectOption("some"); await page.getByRole("checkbox", { name: "Loja Centro" }).uncheck();
  await expect(page.getByText("5 alterações pendentes")).toBeVisible();
  await page.getByLabel("Motivo da alteração", { exact: true }).fill("Negociação comercial autorizada"); await save.click();
  await expect(page.getByText("Alterações salvas", { exact: true })).toBeVisible();
  expect(state.writes[0].path).toBe(`/v1/admin/tenants/${target}/controls`); expect(state.writes[0].body.capabilities).toEqual({ proposals: false }); expect(state.writes[0].body.limits).toEqual({ workspaces: 3 });
  expect(state.writes.slice(1).map(write => write.path)).toEqual([`/v1/admin/tenants/${target}/solutions/marketing`, `/v1/admin/tenants/${target}/solutions/meetings`]);
  expect(state.writes[1].body).toMatchObject({ enabled: true, source: "manual", reason: "Negociação comercial autorizada" });
  expect(state.writes[2].body).toMatchObject({ enabled: true, reason: "Negociação comercial autorizada", limits: { maxConcurrentRecordings: 3, monthlyRecordingMinutes: 1500, meetingRetentionDays: 45, maxStorageBytes: 21474836480 } });
  expect(state.writes[3]).toEqual({ path: `/v1/admin/tenants/${target}/members/seller/workspaces`, body: { workspaceIds: ["ws-client"], reason: "Negociação comercial autorizada" } });
  await expect(page.getByText("Nenhuma alteração pendente.")).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "Acessos e limites", exact: true }).click();
  await expect(page.locator("#feature-proposals")).toHaveValue("blocked"); await expect(page.getByLabel("Limite de Espaços ativos")).toHaveValue("3");
    await page.getByRole("button", { name: "Histórico de alterações" }).click(); await expect(page.getByText("Negociação comercial autorizada", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("admin-history.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("quantidades pagas exibem prévia e exigem confirmação no tenant selecionado", async ({ page }, info) => {
  const state = await fixture(page, { paid: true }); await page.goto(`/admin/tenants/${target}`);
  await expect(page.getByRole("heading", { name: "Capacidade e adicionais pagos" })).toBeVisible();
  const capacity = page.getByRole("heading", { name: "Capacidade e adicionais pagos" }).locator("..").locator("..");
  await capacity.getByRole("spinbutton", { name: "Usuários", exact: true }).fill("4");
  await page.getByRole("button", { name: "Calcular nova cobrança" }).click();
  await expect(page.getByText("Novo valor recorrente:")).toContainText("177,00");
  expect(state.writes.filter(write => write.path.endsWith("/apply"))).toHaveLength(0);
  await page.getByRole("button", { name: "Revisar e aplicar quantidades" }).click();
  const dialog = page.getByRole("alertdialog"); await expect(dialog).toContainText("177,00");
  await dialog.getByRole("button", { name: "Confirmar quantidades e cobrança" }).click();
  await expect.poll(() => state.writes.filter(write => write.path.endsWith("/apply")).length).toBe(1);
  const write = state.writes.find(write => write.path.endsWith("/apply")); expect(write?.path).toBe(`/v1/admin/tenants/${target}/capacity/apply`); expect(write?.body).toMatchObject({ users: 4, confirmed: true });
  await page.screenshot({ path: info.outputPath("admin-contract.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("falha ao salvar mantém o rascunho e apresenta o conflito", async ({ page }) => {
  await fixture(page, { failWrite: true }); await page.goto(`/admin/tenants/${target}`);
  await page.getByRole("button", { name: "Acessos e limites", exact: true }).click(); await page.locator("#feature-crm").selectOption("blocked");
  await page.getByLabel("Motivo da alteração", { exact: true }).fill("Bloqueio temporário de teste"); await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A conta foi alterada" })).toBeVisible();
  await expect(page.locator("#feature-crm")).toHaveValue("blocked"); await expect(page.getByLabel("Motivo da alteração", { exact: true })).toHaveValue("Bloqueio temporário de teste");
});
