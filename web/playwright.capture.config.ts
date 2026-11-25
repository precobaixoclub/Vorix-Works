import { defineConfig, devices } from "@playwright/test";

/**
 * Capturas das telas reais da Vorix para a Biblioteca da marca (motor criativo). Não é suíte de
 * testes: só navega com API simulada e salva imagens em `scripts/editorial/library/vorix-works/`.
 * Exige o front já rodando (`npx next build && npx next start -p 3001`).
 */
export default defineConfig({
  testDir: "./e2e-capture",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001",
    deviceScaleFactor: 2,
    locale: "pt-BR",
  },
});
