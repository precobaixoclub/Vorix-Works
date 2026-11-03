import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

// Cadastro de produto em etapas com o backend de fixture real (PGlite efêmero, dados .invalid).
const root = resolve(__dirname, "..");
export default defineConfig({
  testDir: "./e2e", testMatch: "product-wizard.spec.ts", fullyParallel: false, workers: 1, retries: 0, timeout: 180_000,
  expect: { timeout: 15_000 }, reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3391", trace: "retain-on-failure" },
  webServer: [
    { command: "node tests/fixtures/product-site-browser-server.mjs --site-commerce", cwd: root, url: "http://127.0.0.1:3390/fixture-only/scope", reuseExistingServer: true, timeout: 120_000 },
    { command: "node node_modules/next/dist/bin/next dev --webpack -p 3391 -H 127.0.0.1", url: "http://127.0.0.1:3391", reuseExistingServer: true, timeout: 180_000,
      env: { NEXT_PUBLIC_API_URL: "http://127.0.0.1:3390", API_INTERNAL_URL: "http://127.0.0.1:3390", PLAYWRIGHT_TEST: "1" } },
  ],
  projects: [
    { name: "390px", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "1440px", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
