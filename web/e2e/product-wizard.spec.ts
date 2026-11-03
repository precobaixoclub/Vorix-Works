import { expect, test, type Locator, type Page } from "@playwright/test";
import { TINY_JPEG_BASE64 } from "./fixtures/media-fixtures";

/**
 * Cadastro em etapas, ponta a ponta com backend real: vestuário com tamanho e cor (incluindo duas
 * cores com o mesmo tom e nomes diferentes), fotos enviadas e vinculadas às cores ANTES de salvar,
 * estoque e preço por combinação em massa, e edição que renomeia um valor sem perder nada.
 */
let scope: { email: string; password: string; workspaceId: string };
test.beforeAll(async ({ request }) => { scope = await (await request.get("http://127.0.0.1:3390/fixture-only/scope")).json(); });
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(scope.email);
  await page.getByLabel("Senha", { exact: true }).fill(scope.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/workspaces(?:\/|$)/);
});

const photo = (name: string) => ({ name, mimeType: "image/jpeg", buffer: Buffer.from(TINY_JPEG_BASE64, "base64") });
const advance = (dialog: Locator) => dialog.getByRole("button", { name: "Avançar" }).click();
const shot = (page: Page, project: string, name: string) => page.screenshot({ path: `test-results/product-wizard/${project}/${name}.png` });
async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}
async function addValues(dialog: Locator, option: string, values: string[]) {
  for (const value of values) { await dialog.getByLabel(`Novo valor de ${option}`).fill(value); await dialog.getByLabel(`Novo valor de ${option}`).press("Enter"); }
}

test("vestuário completo sem salvar no meio, depois edição que renomeia uma cor", async ({ page }, testInfo) => {
  const name = `Camiseta Oversized ${testInfo.project.name}`;
  await page.goto(`/workspaces/${scope.workspaceId}/products`);
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  const dialog = page.getByRole("dialog");

  // 1. Tipo e informações
  await expect(dialog.getByText("O que você está cadastrando?").first()).toBeVisible();
  await advance(dialog);
  await expect(dialog.getByRole("alert")).toContainText("Escolha o que você está cadastrando");
  await dialog.getByRole("radio", { name: /Vestuário/ }).click();
  await dialog.getByLabel("Nome do produto").fill(name);
  await dialog.getByLabel("Descrição").fill("Algodão pesado, caimento amplo.");
  await shot(page, testInfo.project.name, "1-informacoes");
  await advance(dialog);

  // 2. Características do segmento
  await dialog.getByLabel("Modelagem").selectOption("Oversized");
  await dialog.getByLabel("Composição").fill("100% algodão");
  await shot(page, testInfo.project.name, "2-caracteristicas");
  await advance(dialog);

  // 3. Variações livres; duas cores com o mesmo tom continuam independentes
  await dialog.getByRole("radio", { name: /^Sim/ }).click();
  await dialog.getByRole("button", { name: "Tamanho", exact: true }).click();
  await addValues(dialog, "Tamanho", ["P, M, G"]);
  await dialog.getByRole("button", { name: "Cor", exact: true }).click();
  await addValues(dialog, "Cor", ["Preto", "Marrom — Logo Branca", "Marrom — Logo Preta"]);
  await dialog.getByLabel("Cor visual de Marrom — Logo Branca").fill("#6b4423");
  await dialog.getByLabel("Cor visual de Marrom — Logo Preta").fill("#6b4423");
  await expect(dialog.getByText(/9\s*combinações/)).toBeVisible();
  await dialog.getByRole("switch", { name: "G / Marrom — Logo Preta ativa" }).click();
  await shot(page, testInfo.project.name, "3-variacoes");
  if (testInfo.project.name === "390px") await noHorizontalScroll(page);
  await advance(dialog);

  // 4. Fotos enviadas e vinculadas às cores antes de qualquer salvamento
  await dialog.getByLabel("Escolher fotos do produto").setInputFiles([photo("preto.jpg"), photo("marrom-branca.jpg"), photo("marrom-preta.jpg")]);
  const tiles = dialog.getByRole("list", { name: "Fotos do produto" }).getByRole("listitem");
  await expect(tiles).toHaveCount(3);
  for (const [index, color] of [[0, "Preto"], [1, "Marrom — Logo Branca"], [2, "Marrom — Logo Preta"]] as const) {
    await tiles.nth(index).getByRole("button", { name: "Vincular" }).click();
    await page.locator("[data-radix-popper-content-wrapper] label").filter({ hasText: new RegExp(`^(✓ )?${color}$`) }).click();
    await page.keyboard.press("Escape");
    await expect(tiles.nth(index)).toContainText(`Usada em ${color}`);
  }
  await shot(page, testInfo.project.name, "4-fotos");
  if (testInfo.project.name === "390px") await noHorizontalScroll(page);
  await advance(dialog);

  // 5. Preço e estoque em massa
  await dialog.getByLabel("Preço de venda").fill("79,90");
  await dialog.getByLabel("Selecionar combinações por valor").getByRole("button", { name: "Preto", exact: true }).click();
  await dialog.getByLabel("Estoque para as selecionadas").fill("10");
  await dialog.getByLabel("Estoque para as selecionadas").locator("xpath=../following-sibling::button").click();
  await dialog.getByLabel("Preço de G / Preto").fill("89,90");
  await expect(dialog.getByLabel("Estoque de P / Preto")).toHaveValue("10");
  await shot(page, testInfo.project.name, "5-preco-estoque");
  if (testInfo.project.name === "390px") await noHorizontalScroll(page);
  await advance(dialog);

  // 6. Revisão e salvamento único
  await expect(dialog.getByText("8 de 9")).toBeVisible();
  await shot(page, testInfo.project.name, "6-revisao");
  await dialog.getByRole("button", { name: "Salvar produto" }).click();
  await expect(dialog).toHaveCount(0);

  // Reabrir: tudo voltou como foi preenchido
  await page.getByText(name).first().click();
  const edit = page.getByRole("dialog");
  for (let i = 0; i < 4; i++) await advance(edit);
  await expect(edit.getByLabel("Estoque de P / Preto")).toHaveValue("10");
  await expect(edit.getByLabel("Estoque de P / Marrom — Logo Branca")).toHaveValue("0");
  await expect(edit.getByLabel("Preço de G / Preto")).toHaveValue("89,90");
  await expect(edit.getByRole("switch", { name: "G / Marrom — Logo Preta ativa" })).toHaveAttribute("aria-checked", "false");
  await expect(edit.getByRole("button", { name: "Foto de P / Marrom — Logo Branca" }).locator("img")).toHaveCount(1);

  // Editar: renomear uma cor e mudar um preço, sem sair do cadastro
  await edit.getByRole("button", { name: "Voltar" }).click();
  await edit.getByRole("button", { name: "Voltar" }).click();
  await edit.getByLabel("Nome do valor Marrom — Logo Preta").fill("Marrom escuro");
  await edit.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(edit).toHaveCount(0);
  await page.getByText(name).first().click();
  const again = page.getByRole("dialog");
  for (let i = 0; i < 4; i++) await advance(again);
  await expect(again.getByLabel("Estoque de P / Preto")).toHaveValue("10");
  await expect(again.getByRole("switch", { name: "G / Marrom escuro ativa" })).toHaveAttribute("aria-checked", "false");
  await expect(again.getByText(/9\s*combinações/)).toBeVisible();
});

test("produto sem variação segue direto para fotos e preço", async ({ page }, testInfo) => {
  const name = `Consultoria ${testInfo.project.name}`;
  await page.goto(`/workspaces/${scope.workspaceId}/products`);
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Serviços/ }).click();
  await dialog.getByLabel("Nome do produto").fill(name);
  await advance(dialog);
  await dialog.getByLabel("Duração").fill("2 horas");
  await advance(dialog);
  await expect(dialog.getByText("Arraste as fotos aqui")).toBeVisible();
  await advance(dialog);
  await expect(dialog.getByText("Controlar estoque")).toHaveCount(0);
  await dialog.getByLabel("Preço de venda").fill("300,00");
  await dialog.getByLabel("Como é cobrado").selectOption("per_hour");
  await advance(dialog);
  await dialog.getByRole("button", { name: "Salvar produto" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(name).first()).toBeVisible();
});
