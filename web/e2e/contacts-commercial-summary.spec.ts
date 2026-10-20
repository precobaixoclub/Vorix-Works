import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

async function contactsFixture(page: Page, summaryUnavailable = false) {
  const now = new Date().toISOString();
  const contacts = [
    { id: "crm-summary", name: "Ana Comercial", company: "Empresa Horizonte" },
    { id: "crm-zero", name: "Bruno sem oportunidade" },
  ].map(contact => ({ ...contact, tenantId: "tenant-qa", workspaceId: WORKSPACE_ID, tags: [], customFields: {}, createdAt: now, updatedAt: now }));
  const mutations: string[] = [];
  const detailedDealContacts: (string | null)[] = [];
  await page.route("**/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() !== "GET" && path.startsWith("/v1/contacts")) mutations.push(path);
    let data: unknown;
    if (path === "/v1/contacts") data = contacts;
    else if (path === "/v1/contacts/phones") data = { "crm-summary": { kind: "phone", phone: "+5511999990001" }, "crm-zero": { kind: "none" } };
    else if (path === "/v1/deals/open-by-contact") {
      if (summaryUnavailable) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "UNAVAILABLE", message: "Tente novamente" } }) });
      // O total vem de todas as oportunidades; não depende das primeiras 200 da listagem.
      data = [
        { contactId: "crm-summary", count: 250, valueCentsSum: 1234567, currency: "BRL" },
        { contactId: "crm-summary", count: 2, valueCentsSum: 5000, currency: "USD" },
      ];
    } else if (path === "/v1/deals") {
      detailedDealContacts.push(url.searchParams.get("contactId"));
      data = [];
    } else if (path.endsWith("/lead-score")) data = { score: 70, temperature: "warm", factors: [] };
    else if (path === "/v1/inbox/conversations") data = { conversations: [] };
    else return route.fallback();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  return { mutations, detailedDealContacts };
}

test.beforeEach(async ({ context, page }) => { await loginCookie(context); await mockConversasBackend(page); });

test("contatos mostram totais completos com nomes claros e dispensam limpeza manual", async ({ page }, testInfo) => {
  const fixture = await contactsFixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/contacts`);
  const ana = page.getByRole("button").filter({ has: page.getByText("Ana Comercial", { exact: true }) });
  await expect(ana).toBeVisible();
  await expect(ana.getByText("Valor em negociação", { exact: true })).toBeVisible();
  await expect(ana).toContainText(/R\$\s*12\.345,67/);
  await expect(ana).toContainText(/US\$\s*50,00/);
  await expect(ana.getByText("Em andamento", { exact: true }).locator("..")).toContainText("252");
  await expect(ana.getByText("Propostas", { exact: true })).toBeVisible();
  const bruno = page.getByRole("button").filter({ has: page.getByText("Bruno sem oportunidade", { exact: true }) });
  await expect(bruno).toContainText(/R\$\s*0,00/);
  await expect(page.getByRole("button", { name: "Remover contatos sem número" })).toHaveCount(0);
  await expect(page.getByText(/pipeline/i)).toHaveCount(0);
  expect(fixture.detailedDealContacts).toEqual([]);
  expect(fixture.mutations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("contacts.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await ana.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Oportunidades em andamento", { exact: true }).locator("..")).toContainText("252");
  await expect(dialog.getByText("Valor em negociação", { exact: true }).locator("..")).toContainText(/R\$\s*12\.345,67/);
  await expect.poll(() => fixture.detailedDealContacts).toEqual(["crm-summary"]);
});

test("falha na consulta dos valores não aparece como oportunidade zerada", async ({ page }) => {
  await contactsFixture(page, true);
  await page.goto(`/workspaces/${WORKSPACE_ID}/contacts`);
  const ana = page.getByRole("button").filter({ has: page.getByText("Ana Comercial", { exact: true }) });
  await expect(ana.getByText("Indisponível", { exact: true })).toBeVisible();
  await expect(ana).not.toContainText(/R\$\s*0,00/);
});
