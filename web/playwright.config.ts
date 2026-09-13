import { defineConfig, devices } from "@playwright/test";

/**
 * Redesign operacional (Conversas) — QA obrigatório em browser real (item 38 do pedido), nunca só
 * JSX. `webServer` sobe o próprio `next dev` (porta 3001, mesma do script `dev`); os specs mockam
 * a rede (`page.route`) em vez de depender de um backend real — o backend em `AUTH_MODE=noop` não
 * tem fluxo de login real (`identity` só existe com `AUTH_MODE=jwt`, ver `container.ts`), então
 * mockar é o único jeito de exercitar a UI de verdade (App Shell, sidebar, Inbox) num Chromium
 * real sem precisar de Postgres/JWT configurados. Projects por viewport cobrem as resoluções
 * pedidas: 1366/1440/1920 desktop e 390 mobile.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 60_000,
    env: { PLAYWRIGHT_TEST: "1" },
  },
  projects: [
    { name: "desktop-1366", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "desktop-1920", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});
