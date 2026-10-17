import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  loginCookie,
  mockConversasBackend,
  WORKSPACE_ID,
} from "./fixtures/mock-backend";

test.use({ channel: "chrome" });
const screenshots = join(process.cwd(), "..", "tmp", "settings-usability");
mkdirSync(screenshots, { recursive: true });

test("exemplos são salvos desativados e ativação exige confirmação", async ({
  page,
  context,
}) => {
  await loginCookie(context);
  await mockConversasBackend(page);
  const rules: any[] = [];
  const creations: any[] = [];
  const activations: any[] = [];
  await page.route("**/v1/pipelines**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/stages")
      ? path.includes("/pipeline-second/")
        ? [
            {
              id: "stage-second",
              pipelineId: "pipeline-second",
              name: "Negociação especial",
              position: 0,
            },
          ]
        : [
            {
              id: "stage-first",
              pipelineId: "pipeline-first",
              name: "Entrada",
              position: 0,
            },
          ]
      : [
          { id: "pipeline-first", name: "Funil principal" },
          { id: "pipeline-second", name: "Outro funil" },
        ];
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.route("**/v1/automation-rules**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = (data: unknown, status = 200) =>
      route.fulfill({ status, json: { ok: true, data } });
    if (path.endsWith("/run-logs")) return ok([]);
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      creations.push(body);
      const rule = {
        ...body,
        id: `example-${rules.length}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      rules.push(rule);
      return ok(rule, 201);
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON();
      activations.push(body);
      const rule = rules.find((rule) => path.endsWith("/" + rule.id));
      Object.assign(rule, body);
      return ok(rule);
    }
    return ok(rules);
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings/automations`);
  await expect(
    page.getByRole("heading", { name: "Comece com estes 3 exemplos" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Adicionar exemplos desativados" })
    .click();
  await expect(
    page.getByRole("button", { name: "Exemplos já adicionados" }),
  ).toBeDisabled();
  expect(creations).toHaveLength(3);
  expect(creations.every((rule) => rule.active === false)).toBeTruthy();
  expect(activations).toHaveLength(0);
  await page.screenshot({
    path: join(screenshots, `automations-${test.info().project.name}.png`),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ativar", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("alertdialog", { name: "Ativar esta automação?" }),
  ).toBeVisible();
  expect(activations).toHaveLength(0);
  await page.getByRole("button", { name: "Sim, ativar automação" }).click();
  await expect(page.getByText("Ativada", { exact: true })).toBeVisible();
  expect(activations).toHaveLength(1);
  await page
    .getByRole("button", { name: "Criar automação", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Criar automação" });
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(
    dialog.getByRole("button", { name: "Continuar" }),
  ).toBeDisabled();
  await dialog.getByLabel("Qual tarefa deve ser criada?").fill("Ligar amanhã");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await dialog.getByRole("button", { name: "Adicionar uma condição" }).click();
  await expect(
    dialog.getByRole("button", { name: "Continuar" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Remover condição 1" }).click();
  await dialog.getByRole("button", { name: "Adicionar uma condição" }).click();
  await dialog.getByRole("combobox", { name: "Campo da condição 1" }).click();
  await page.getByRole("option", { name: "Etapa da oportunidade" }).click();
  await dialog.getByRole("combobox", { name: "Funil da etapa" }).click();
  await page.getByRole("option", { name: "Outro funil" }).click();
  await dialog.getByRole("combobox", { name: "Etapa da condição" }).click();
  await page.getByRole("option", { name: "Negociação especial" }).click();
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await dialog
    .getByLabel("Dê um nome fácil de reconhecer")
    .fill("Meu lembrete");
  await page.screenshot({
    path: join(screenshots, `wizard-${test.info().project.name}.png`),
  });
  await dialog.getByRole("button", { name: "Salvar desativada" }).click();
  await expect(dialog).not.toBeVisible();
  expect(creations[3].active).toBe(false);
  expect(creations[3].conditions).toEqual([
    { field: "stageId", equals: "stage-second" },
  ]);
  await page
    .getByRole("button", { name: "Revisar e ver histórico" })
    .last()
    .click();
  const details = page.getByRole("dialog", { name: "Meu lembrete" });
  await expect(
    details.getByText("Etapa da oportunidade: Negociação especial"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await page
      .locator("body")
      .evaluate((body) => body.scrollWidth > innerWidth),
  ).toBe(false);
});

test("comercial separa assuntos, salva acessos explicitamente e explica desconto", async ({
  page,
  context,
}) => {
  await loginCookie(context);
  await mockConversasBackend(page);
  let settings = {
    workspaceId: WORKSPACE_ID,
    sellersCanViewCost: false,
    sellersCanViewMargin: true,
    proposalAcceptAutoWin: false,
    rankingEnabled: false,
    dealVisibility: "all",
    visibility: { isManager: true },
  };
  const writes: any[] = [];
  const policies: any[] = [];
  await page.route("**/v1/commercial-settings**", async (route) => {
    if (route.request().method() !== "GET") {
      const body = route.request().postDataJSON();
      writes.push(body);
      settings = { ...settings, ...body };
    }
    return route.fulfill({ json: { ok: true, data: settings } });
  });
  await page.route("**/v1/commercial-policies**", async (route) => {
    if (route.request().method() !== "GET") {
      policies.push(route.request().postDataJSON());
    }
    return route.fulfill({
      json: { ok: true, data: route.request().method() === "GET" ? [] : {} },
    });
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings/commercial`);
  await expect(page.getByText("Configure no seu ritmo")).toBeVisible();
  await page.screenshot({
    path: join(screenshots, `commercial-${test.info().project.name}.png`),
    fullPage: true,
  });
  await page
    .getByRole("switch", { name: "Vendedores podem ver o custo dos produtos?" })
    .click();
  expect(writes).toHaveLength(0);
  await page
    .getByRole("button", { name: "Salvar acessos e fechamento" })
    .click();
  await expect(page.getByText("Alterações salvas com sucesso.")).toBeVisible();
  expect(writes[0].sellersCanViewCost).toBe(true);
  await page
    .locator("summary")
    .filter({ hasText: "2. Descontos e aprovação" })
    .click();
  await expect(
    page.getByLabel("2. Quanto desconto pode dar sem pedir aprovação?"),
  ).toBeVisible();
  await page
    .getByLabel("2. Quanto desconto pode dar sem pedir aprovação?")
    .fill("abc");
  await page.getByRole("button", { name: "Salvar regra de desconto" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "O desconto deve ser um número de 0 a 100." }),
  ).toBeVisible();
  expect(policies).toHaveLength(0);
  await page
    .getByLabel("2. Quanto desconto pode dar sem pedir aprovação?")
    .fill("10");
  await expect(
    page.getByText("Descontos acima de 10% precisarão de aprovação."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Salvar regra de desconto" }).click();
  await expect(page.getByText("Regra salva com sucesso.")).toBeVisible();
  expect(policies[0]).toMatchObject({
    scopeType: "workspace",
    maxDiscountBp: 1000,
    allowBelowMinimum: false,
  });
  await page.screenshot({
    path: join(screenshots, `discount-${test.info().project.name}.png`),
    fullPage: true,
  });
  expect(
    await page
      .locator("body")
      .evaluate((body) => body.scrollWidth > innerWidth),
  ).toBe(false);
});
