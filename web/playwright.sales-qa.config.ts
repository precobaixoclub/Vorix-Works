import { defineConfig, devices } from "@playwright/test";

/** QA local do Sales Engine em porta própria (3011) — evita reutilizar outro `next dev` já aberto
 * na 3001 (ex.: um servidor antigo dentro do WSL). Mesmos projetos de viewport do config padrão. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3011", trace: "retain-on-failure" },
  webServer: {
    command: "npx next dev -p 3011",
    url: "http://localhost:3011",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PLAYWRIGHT_TEST: "1" },
  },
  projects: [
    { name: "desktop-1366", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});
