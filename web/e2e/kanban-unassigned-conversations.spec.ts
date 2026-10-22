import { expect, test, type Page } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

async function boardFixture(page: Page) {
  const now = new Date().toISOString();
  const teams = [{ id: "team-attendance", name: "Atendimento" }, { id: "team-support", name: "Suporte" }];
  const phase = (teamId: string) => ({ id: `phase-${teamId}`, tenantId: "tenant-qa", teamId, name: "Novos", orderIndex: 0, isDefaultFirst: true, phaseType: "RUNNING", createdAt: now, updatedAt: now });
  const common = { workspaceId: WORKSPACE_ID, tenantId: "tenant-qa", connectionId: "conn-1", chatType: "direct", status: "open", unreadCount: 0, isUrgent: false, isPinned: false, aiEnabled: false, automationEnabled: false, lastMessageAt: now, lastMessagePreview: { type: "text", body: "Preciso de atendimento", direction: "inbound" } };
  const conversations = [
    { ...common, id: "with-team", contactName: "Cliente em atendimento", currentTeamId: teams[0].id, currentPhaseId: phase(teams[0].id).id },
    { ...common, id: "without-team", contactName: "Cliente sem equipe", unreadCount: 1 },
    { ...common, id: "other-team", contactName: "Cliente do suporte", currentTeamId: teams[1].id, currentPhaseId: phase(teams[1].id).id },
    { ...common, id: "closed", contactName: "Cliente finalizado", status: "resolved" },
  ];
  const phaseMutations: string[] = [];
  await page.route("**/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === "/v1/teams") data = teams;
    else if (path === "/v1/inbox/conversations") data = { conversations };
    else if (path.endsWith("/kanban-phases")) data = { phases: [phase(path.split("/")[4])] };
    else if (path.endsWith("/service-time")) data = { serviceTime: [] };
    else if (path.endsWith("/ensure-phase-states") || path.endsWith("/team") || path.endsWith("/phase")) {
      phaseMutations.push(route.request().postData() ?? "");
      data = {};
    } else return route.fallback();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  return { phaseMutations };
}

test.beforeEach(async ({ context, page }) => { await loginCookie(context); await mockConversasBackend(page); });

test("conversas sem equipe aparecem e abrem no quadro sem atribuição automática", async ({ page }, testInfo) => {
  const fixture = await boardFixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/kanban`);
  const queue = page.getByRole("region", { name: "Sem equipe", exact: true });
  await expect(queue.getByText("Cliente sem equipe", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Novos", exact: true }).getByText("Cliente em atendimento", { exact: true })).toBeVisible();
  await expect(page.getByText("2 conversas em atendimento · 1 sem equipe", { exact: true })).toBeVisible();
  await expect(page.getByText("Cliente finalizado", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Cliente do suporte", { exact: true })).toHaveCount(0);
  expect(fixture.phaseMutations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("kanban-unassigned.png"), fullPage: true });
  await queue.getByText("Cliente sem equipe", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(fixture.phaseMutations).toEqual([]);
});

test("parâmetros herdados e troca de equipe mantêm a fila sem equipe visível", async ({ page }) => {
  await boardFixture(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/kanban?team=team-attendance&status=resolved`);
  await expect(page.getByText("Cliente sem equipe", { exact: true })).toBeVisible();
  await expect(page.getByText("Cliente em atendimento", { exact: true })).toBeVisible();
  await page.getByRole("combobox").filter({ hasText: "Atendimento" }).click();
  await page.getByRole("option", { name: "Suporte", exact: true }).click();
  await expect(page.getByText("Cliente do suporte", { exact: true })).toBeVisible();
  await expect(page.getByText("Cliente em atendimento", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Cliente sem equipe", { exact: true })).toBeVisible();
  await page.goto(`/workspaces/${WORKSPACE_ID}/kanban?team=team-attendance&read=unread`);
  await expect(page.getByText("Cliente sem equipe", { exact: true })).toBeVisible();
  await expect(page.getByText("Cliente em atendimento", { exact: true })).toHaveCount(0);
});
