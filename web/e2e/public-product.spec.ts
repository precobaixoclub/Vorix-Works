import { test, expect } from "@playwright/test";

test("cliente abre sem login, lê descrição inteira e vê foto sem recorte", async ({ page, request }, info) => {
  const { token, description } = await (await request.get("http://127.0.0.1:3396/fixture/scope")).json();
  const response = await page.goto(`/produto/${token}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Lâmpada vintage", exact: true })).toBeVisible();
  await expect(page.getByText("Loja de iluminação", { exact: true })).toBeVisible();
  await expect(page.getByText(/R\$\s*95,00/)).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toHaveText(description);
  const photo = page.getByRole("img", { name: "Lâmpada vintage", exact: true });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(400);
  expect(await photo.evaluate(img => getComputedStyle(img).objectFit)).toBe("contain");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /lampada.jpg/);
  await page.screenshot({ path: info.outputPath("produto-compartilhado.png"), fullPage: true });
});

test("link inválido mostra produto indisponível sem pedir login", async ({ page }) => {
  const response = await page.goto(`/produto/${"x".repeat(64)}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Produto indisponível" })).toBeVisible();
  await expect(page).toHaveURL(/\/produto\//);
});
