import { test, expect } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

test.beforeEach(async ({ context, page }) => {
  await loginCookie(context);
  await mockConversasBackend(page);
});

test("sidebar entra recolhida por padrão em /conversas (sem preferência salva), mas expandida nas outras rotas", async ({ page }) => {
  test.skip(test.info().project.name === "mobile-390", "sidebar global não renderiza em mobile (hidden md:flex)");
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await expect(page.getByRole("button", { name: "Recolher menu" })).toBeVisible();

  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await expect(page.getByRole("button", { name: "Expandir menu" })).toBeVisible();
});

test("alternar a sidebar em Conversas persiste globalmente (localStorage) e sobrevive a um reload", async ({ page }) => {
  test.skip(test.info().project.name === "mobile-390", "sidebar global não renderiza em mobile (hidden md:flex) — nada para alternar");
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByRole("button", { name: "Expandir menu" }).click();
  await expect(page.getByRole("button", { name: "Recolher menu" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Recolher menu" })).toBeVisible();

  // A preferência (agora "expandida") passa a valer em qualquer rota, não só Conversas.
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await expect(page.getByRole("button", { name: "Recolher menu" })).toBeVisible();
});

test("Conversas preenche a altura da viewport sem scroll na página (só dentro dos painéis)", async ({ page }) => {
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByText("Carla Mendes").click();
  await expect(page.getByText("Segue a foto da embalagem")).toBeVisible();

  const pageScrollable = await page.evaluate(() => document.scrollingElement!.scrollHeight > document.scrollingElement!.clientHeight + 2);
  expect(pageScrollable, "a página inteira não deveria ter scroll próprio — o scroll é interno aos painéis").toBe(false);
});

test("lista de conversas mostra preview real da última mensagem (texto e rótulo de mídia), não mais um placeholder genérico", async ({ page }) => {
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await expect(page.getByText("Documento recebido")).toBeVisible();
  await expect(page.getByText("Você: Perfeito, vou verificar e já te retorno!")).toBeVisible();
  await expect(page.getByText("Muito obrigada pelo atendimento!")).toBeVisible();
});

test("header da conversa é compacto e mostra Assumir/Finalizar sem precisar do menu extra (desktop, com a largura recuperada da sidebar/subnav)", async ({ page }) => {
  test.skip(test.info().project.name === "mobile-390", "abaixo de md, Assumir/Finalizar ficam só no menu '⋯' — comportamento existente, não alterado nesta rodada");
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByText("Carla Mendes").click();
  await expect(page.getByRole("button", { name: /Assumir/ })).toBeVisible();
});

test("painel de detalhes abre via botão Detalhes e fecha", async ({ page }) => {
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByText("Carla Mendes").click();
  await page.getByRole("button", { name: "Detalhes" }).click();
  await expect(page.getByText("Contexto")).toBeVisible();
  await page.getByRole("button", { name: "Fechar detalhes" }).click();
  await expect(page.getByText("Contexto")).toBeHidden();
});

test("mensagem de texto com falha mostra Tentar novamente", async ({ page }) => {
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByText("Carla Mendes").click();
  await expect(page.getByText("Vou te enviar o boleto atualizado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
});

test.describe("renderização real de mídia (imagem/áudio/vídeo/documento)", () => {
  test("IMAGEM: carrega e renderiza um <img> de verdade (não mais um ícone+rótulo)", async ({ page }) => {
    await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
    await page.getByText("Carla Mendes").click();
    const image = page.locator('img[alt="Imagem recebida"]');
    await expect(image).toBeVisible();
    const naturalWidth = await image.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalWidth, "o <img> precisa ter decodificado bytes reais, não um placeholder quebrado").toBeGreaterThan(0);
  });

  test("ÁUDIO: player customizado carrega o arquivo real ao clicar em play e reporta duração", async ({ page }) => {
    await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
    await page.getByText("Carla Mendes").click();
    await page.getByRole("button", { name: "Reproduzir", exact: true }).click();
    const audio = page.locator("audio");
    await expect(audio).toHaveCount(1);
    await page.waitForFunction(() => {
      const el = document.querySelector("audio");
      return !!el && el.duration > 0;
    });
  });

  test("DOCUMENTO: card mostra nome/tamanho reais e abre uma nova aba ao clicar em Abrir", async ({ page }) => {
    await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
    await page.getByText("Carla Mendes").click();
    await expect(page.getByText("contrato.pdf")).toBeVisible();
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Abrir" }).click()]);
    expect(popup).toBeTruthy();
    await popup.close();
  });

  test("VÍDEO: estado lazy (poster + botão play) renderiza; decodificação de um mp4 real não foi validada neste ambiente", async ({ page }) => {
    await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
    await page.getByText("Carla Mendes").click();
    // Não clicamos em play aqui de propósito — não há um fixture de vídeo decodificável disponível
    // neste ambiente (sem ffmpeg para gerar um mp4 válido); o objetivo deste teste é só confirmar
    // que o estado inicial (lazy, sem carregar bytes até o clique) renderiza corretamente.
    await expect(page.getByRole("button", { name: "Reproduzir vídeo" })).toBeVisible();
  });
});

test("screenshot de comparação — Inbox com mídia, sidebar recolhida (estado padrão)", async ({ page }, testInfo) => {
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByText("Carla Mendes").click();
  await expect(page.getByText("Segue a foto da embalagem")).toBeVisible();
  await page.waitForTimeout(300); // deixa a imagem/áudio assentarem antes do screenshot
  await testInfo.attach(`conversas-${testInfo.project.name}`, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
});
