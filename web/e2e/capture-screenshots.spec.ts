import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Captura de screenshots para o relatório (`docs/conversas-redesign-operacional-media.md`) — sem
 * asserções, só navegação + captura. As asserções de verdade estão em `conversas-layout.spec.ts`.
 */
const OUT_DIR = "../docs/screenshots";
mkdirSync(OUT_DIR, { recursive: true });

test.beforeEach(async ({ context, page }) => {
  await loginCookie(context);
  await mockConversasBackend(page);
});

test("captura: inbox com mídia (sidebar recolhida, estado padrão)", async ({ page }, testInfo) => {
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByText("Carla Mendes").click();
  await page.locator('img[alt="Imagem recebida"]').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/conversas-depois-${testInfo.project.name}.png` });
});

test("captura: sidebar expandida", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-390", "sidebar global não existe em mobile");
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByRole("button", { name: "Expandir menu" }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/conversas-sidebar-expandida-${testInfo.project.name}.png` });
});

test("captura: painel de detalhes aberto", async ({ page }, testInfo) => {
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByText("Carla Mendes").click();
  await page.getByRole("button", { name: "Detalhes" }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/conversas-detalhes-abertos-${testInfo.project.name}.png` });
});
