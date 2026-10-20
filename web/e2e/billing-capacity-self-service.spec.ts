import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

type Counts = { users: number; whatsappConnections: number; workspaces: number };
const initial: Counts = { users: 5, whatsappConnections: 3, workspaces: 3 };
const amount = (counts: Counts) => 149 + (counts.users - 2) * 39 + (counts.whatsappConnections - 1) * 79 + (counts.workspaces - 1) * 29;
const snapshot = (counts: Counts) => ({ planCode: "START", currency: "BRL", includedUsers: 2, additionalUsers: counts.users - 2, totalUsers: counts.users, includedWhatsappConnections: 1, additionalWhatsappConnections: counts.whatsappConnections - 1, totalWhatsappConnections: counts.whatsappConnections, includedWorkspaces: 1, additionalWorkspaces: counts.workspaces - 1, totalWorkspaces: counts.workspaces, concurrentRecordings: 0, baseMonthlyAmount: 149, addonsMonthlyAmount: amount(counts) - 149, totalMonthlyAmount: amount(counts) });

async function billingFixture(page: Page, options: { canChangeNow?: boolean; unlimited?: boolean } = {}) {
  let current = { ...initial }, next = { ...initial };
  let saves = 0;
  const pending: { id: string; resource: string; addonCode: string; targetQuantity: number; effectiveAt: string }[] = [];
  const currentSnapshot = () => ({ ...snapshot(current), ...(options.unlimited ? { includedWorkspaces: null, totalWorkspaces: null } : {}) });
  const nextSnapshot = () => ({ ...snapshot(next), ...(options.unlimited ? { includedWorkspaces: null, totalWorkspaces: null } : {}) });
  const resources = [{ key: "users", resource: "users", included: 2 }, { key: "whatsappConnections", resource: "messaging_connections", included: 1 }, { key: "workspaces", resource: "workspaces", included: 1 }] as const;
  await page.route("**/v1/billing/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path.endsWith("/credits")) data = { remainingCredits: 50, monthlyQuota: 50, consumedThisMonth: 0, extraCredits: 0, subscriptionStatus: "active", pricing: { unitPriceCents: 10, currency: "BRL", minPurchase: 100, maxPurchase: 100000, presets: [100, 1000] }, chargesSavedCard: false, canPurchase: true, purchases: [] };
    else if (path.endsWith("/overview")) data = { planCode: "START", planName: "Start", virtual: false, readOnly: false, billingInterval: "monthly", status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: "2026-11-19T12:00:00Z", trialEnd: null, trialDaysRemaining: null, allowedAddonCodes: [], addons: [], availableAddons: [], recentInvoices: [], consumption: resources.map(item => ({ resource: item.resource, used: item.resource === "users" ? 2 : 1, max: options.unlimited && item.resource === "workspaces" ? null : current[item.key] })) };
    else if (path.endsWith("/preview")) {
      const desired = route.request().postDataJSON() as Counts;
      data = { current: currentSnapshot(), requestedOnCurrentPlan: { ...snapshot(desired), feasible: true }, recommendation: { options: [] } };
    } else if (path.endsWith("/apply")) {
      saves++;
      next = { ...route.request().postDataJSON() };
      pending.length = 0;
      for (const item of resources) {
        if (next[item.key] < current[item.key]) pending.push({ id: item.resource, resource: item.resource, addonCode: `extra_${item.resource}`, targetQuantity: next[item.key] - item.included, effectiveAt: "2026-11-19T12:00:00Z" });
        else current[item.key] = next[item.key];
      }
      data = { outcomes: [], nextCharge: { at: "2026-11-19T12:00:00Z", amount: amount(next), currency: "BRL" } };
    } else if (path.endsWith("/cancel")) {
      const id = path.split("/").at(-2);
      const item = resources.find(item => item.resource === id)!;
      next[item.key] = current[item.key];
      pending.splice(pending.findIndex(change => change.id === id), 1);
      data = { cancelled: true };
    } else data = { current: currentSnapshot(), next: nextSnapshot(), pending, adjustableAddons: [], nextCharge: { at: "2026-11-19T12:00:00Z", amount: amount(next), currency: "BRL" }, canChangeNow: options.canChangeNow ?? true, meetingsSellable: false, unitPrices: { interval: "monthly", user: { amount: 39, increment: 1 }, whatsappConnection: { amount: 79, increment: 1 }, workspace: { amount: 29, increment: 1, canIncrease: true } } };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  return { get saves() { return saves; } };
}

test.beforeEach(async ({ context, page }) => { await loginCookie(context); await mockConversasBackend(page); });

test("uso do plano: simula os três recursos, salva somente ao confirmar e mantém quantidades após recarregar", async ({ page }) => {
  const fixture = await billingFixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings/plano`);
  await page.getByRole("button", { name: "Aumentar Usuários de atendimento", exact: true }).click();
  await page.getByRole("button", { name: "Aumentar Números de WhatsApp", exact: true }).click();
  await page.getByRole("button", { name: "Aumentar Workspaces", exact: true }).click();
  await expect(page.getByText(/aumenta R\$\s147,00/)).toBeVisible();
  expect(fixture.saves).toBe(0);
  await page.getByRole("button", { name: "Salvar quantidades", exact: true }).click();
  await expect(page.getByRole("button", { name: "Salvar quantidades", exact: true })).toHaveCount(0);
  expect(fixture.saves).toBe(1);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Quantidade de Usuários de atendimento", exact: true })).toHaveValue("6");
  await expect(page.getByRole("textbox", { name: "Quantidade de Números de WhatsApp", exact: true })).toHaveValue("4");
  await expect(page.getByRole("textbox", { name: "Quantidade de Workspaces", exact: true })).toHaveValue("4");
  await expect(page.getByText("R$ 629,00", { exact: true }).first()).toBeVisible();
});

test("redução: mostra o preço futuro salvo e permite cancelar a redução de workspaces", async ({ page }) => {
  await billingFixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings/plano`);
  await page.getByRole("textbox", { name: "Quantidade de Workspaces", exact: true }).fill("2");
  await expect(page.getByText(/diminui R\$\s29,00/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar quantidades", exact: true }).click();
  await expect(page.getByRole("button", { name: "Salvar quantidades", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Quantidade de Workspaces", exact: true })).toHaveValue("2");
  await expect(page.getByText("R$ 453,00", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Cancelar alteração", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Quantidade de Workspaces", exact: true })).toHaveValue("3");
  await expect(page.getByRole("button", { name: "Cancelar alteração", exact: true })).toHaveCount(0);
});

test("quantidades respeitam uso e workspaces ilimitados aparecem como incluídos", async ({ page }) => {
  await billingFixture(page, { unlimited: true });
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings/plano`);
  await expect(page.getByRole("textbox", { name: "Quantidade de Workspaces", exact: true })).toHaveValue("Ilimitado");
  await expect(page.getByRole("button", { name: "Aumentar Workspaces", exact: true })).toBeDisabled();
  const users = page.getByRole("textbox", { name: "Quantidade de Usuários de atendimento", exact: true });
  await users.fill("0");
  await users.blur();
  await expect(users).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Diminuir Usuários de atendimento", exact: true })).toBeDisabled();
});

test("sem cobrança ativa, encaminha ao checkout com as quantidades escolhidas", async ({ page }) => {
  await billingFixture(page, { canChangeNow: false });
  let capacity: unknown;
  await page.route("**/v1/billing/checkout", async (route) => {
    capacity = route.request().postDataJSON().capacity;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { checkoutUrl: `http://localhost:3001/workspaces/${WORKSPACE_ID}/settings/plano?checkout=sucesso` } }) });
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings/plano`);
  await page.getByRole("textbox", { name: "Quantidade de Workspaces", exact: true }).fill("4");
  await page.getByRole("button", { name: "Cadastrar forma de pagamento", exact: true }).click();
  await expect.poll(() => capacity).toEqual({ users: 5, whatsappConnections: 3, workspaces: 4, concurrentRecordings: 0 });
});
