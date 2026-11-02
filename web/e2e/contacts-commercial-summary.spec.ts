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

test("novo contato exige telefone e envia o número no mesmo cadastro", async ({ page }) => {
  const fixture = await contactsFixture(page);
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/v1/contacts", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    await route.fulfill({ status: 201, json: { ok: true, data: { id: "new-phone-contact", ...payload } } });
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/contacts`);
  await page.getByRole("button", { name: "Novo contato", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Cliente com telefone");
  await expect(dialog.getByRole("button", { name: "Criar", exact: true })).toBeDisabled();
  await dialog.getByLabel("Telefone (obrigatório)").fill("+5511987654321");
  await dialog.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toMatchObject({ name: "Cliente com telefone", customFields: { phone: "+5511987654321" } });
  expect(fixture.mutations).toEqual([]);
});

test("telefone rejeitado pelo backend mantém o formulário aberto e mostra o erro", async ({ page }) => {
  await contactsFixture(page);
  await page.route("**/v1/contacts", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 400, json: { ok: false, error: { code: "VALIDATION_ERROR", message: "Informe um telefone válido com DDD." } } });
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/contacts`);
  await page.getByRole("button", { name: "Novo contato", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Contato inválido");
  await dialog.getByLabel("Telefone (obrigatório)").fill("+210656032780390");
  await dialog.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByText("Informe um telefone válido com DDD.", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
});
