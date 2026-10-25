import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";
import type { AutomationRule, PipelineStage } from "../features/crm/types";

async function fixture(page: Page) {
  let stages: PipelineStage[] = ["Novo", "Negociação", "Ganho", "Perdido"].map((name, position) => ({ id: `stage-${position}`, pipelineId: "pipeline-1", name, position, isWon: position === 2, isLost: position === 3, createdAt: new Date().toISOString() }));
  let rules: AutomationRule[] = [];
  await page.route("**/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    let data: unknown;
    if (path === "/v1/pipelines") data = [{ id: "pipeline-1", name: "Comercial", isDefault: true }];
    else if (path === "/v1/pipelines/pipeline-1/stages/reorder") {
      const { stageIds } = request.postDataJSON();
      stages = (stageIds as string[]).map((id, position) => ({ ...stages.find(stage => stage.id === id)!, position }));
      return route.fulfill({ status: 204 });
    } else if (path === "/v1/pipelines/pipeline-1/stages") {
      if (method === "POST") {
        const stage = { ...request.postDataJSON(), id: "custom-stage", pipelineId: "pipeline-1", createdAt: new Date().toISOString() };
        stages.splice(stages.filter(s => !s.isWon && !s.isLost).length, 0, stage);
        stages = stages.map((s, position) => ({ ...s, position }));
        data = stage;
      } else data = stages;
    } else if (path.startsWith("/v1/pipelines/pipeline-1/stages/")) {
      const id = path.split("/").at(-1);
      if (method === "DELETE") { stages = stages.filter(stage => stage.id !== id); return route.fulfill({ status: 204 }); }
      stages = stages.map(stage => stage.id === id ? { ...stage, ...request.postDataJSON() } : stage);
      data = stages.find(stage => stage.id === id);
    } else if (path === "/v1/automation-rules") {
      if (method === "POST") {
        const rule = { ...request.postDataJSON(), id: `rule-${rules.length}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        rules.push(rule); data = rule;
      } else data = rules;
    } else if (path.startsWith("/v1/automation-rules/")) {
      const id = path.split("/").at(-1);
      rules = rules.map(rule => rule.id === id ? { ...rule, ...request.postDataJSON() } : rule);
      data = rules.find(rule => rule.id === id);
    } else if (path === "/v1/products/stock-risk") data = { products: [], deals: [] };
    else return route.fallback();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  return { get rules() { return rules; }, get stages() { return stages; } };
}

test.beforeEach(async ({ context, page }) => { await loginCookie(context); await mockConversasBackend(page); });

test("personaliza fases no quadro de oportunidades", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
  await page.getByRole("button", { name: "Fases", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("textbox", { name: "Nome da fase Novo", exact: true }).fill("Primeiro contato");
  await modal.getByRole("button", { name: "Salvar", exact: true }).first().click();
  await expect(modal.getByRole("textbox", { name: "Nome da fase Primeiro contato", exact: true })).toBeVisible();
  await modal.getByLabel("Nova fase", { exact: true }).fill("Aguardando retorno");
  await modal.getByRole("button", { name: "Criar fase", exact: true }).click();
  await expect(modal.getByRole("textbox", { name: "Nome da fase Aguardando retorno", exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "Subir Aguardando retorno", exact: true }).click();
  await expect.poll(() => state.stages[1].name).toBe("Aguardando retorno");
  await expect(modal.getByRole("button", { name: "Subir Ganho", exact: true })).toBeDisabled();
  await expect(modal.getByRole("button", { name: "Descer Perdido", exact: true })).toBeDisabled();
  expect(state.stages.slice(-2).map(stage => stage.isWon ? "won" : "lost")).toEqual(["won", "lost"]);
});

test("configura recontato com prazo e movimentação automática restritos ao funil", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
  await page.getByRole("button", { name: "Automações", exact: true }).click();
  await page.getByRole("button", { name: "Criar automação", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Qual tarefa deve ser criada?").fill("Retomar negociação");
  await page.getByLabel("Prazo para recontato", { exact: false }).fill("24");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText("Esta automação se aplica somente ao funil Comercial.")).toBeVisible();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Dê um nome fácil de reconhecer").fill("Recontato comercial");
  await page.getByRole("button", { name: "Salvar desativada", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recontato comercial", exact: true })).toBeVisible();
  expect(state.rules[0].conditions).toEqual([{ field: "pipelineId", equals: "pipeline-1" }]);
  expect(state.rules[0].actionConfig.taskDelayHours).toBe(24);
  expect(state.rules[0].active).toBe(false);
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Ativar", exact: true }).click();
  await expect.poll(() => state.rules[0].active).toBe(true);
  await page.getByRole("button", { name: "Criar automação", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("O sistema deve…", { exact: true }).click();
  await page.getByRole("option", { name: "Mover a oportunidade para outra etapa", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Funil de destino", exact: true })).toBeDisabled();
  await page.getByRole("combobox", { name: "Etapa de destino", exact: true }).click();
  await expect(page.getByRole("option", { name: "Perdido", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Negociação", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Dê um nome fácil de reconhecer").fill("Avançar automaticamente");
  await page.getByRole("button", { name: "Salvar desativada", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Avançar automaticamente", exact: true })).toBeVisible();
  expect(state.rules[1].action).toBe("move_deal_stage");
  expect(state.rules[1].actionConfig.targetStageId).toBe("stage-1");
});
