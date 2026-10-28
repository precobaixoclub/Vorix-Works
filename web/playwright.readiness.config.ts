import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
export default defineConfig({
  testDir: "./e2e", fullyParallel: false, workers: 1, retries: 0, timeout: 120_000,
  expect: { timeout: 15_000 }, reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3391", channel: "chrome", trace: "retain-on-failure", acceptDownloads: true },
  webServer: [
    { command: "node tests/fixtures/product-site-browser-server.mjs --site-commerce", cwd: root, url: "http://127.0.0.1:3390/fixture-only/scope", reuseExistingServer: true, timeout: 120_000 },
    { command: "node node_modules/next/dist/bin/next dev --webpack -p 3391 -H 127.0.0.1", url: "http://127.0.0.1:3391", reuseExistingServer: false, timeout: 180_000,
      env: { NEXT_PUBLIC_API_URL: "http://127.0.0.1:3390", API_INTERNAL_URL: "http://127.0.0.1:3390", PLAYWRIGHT_TEST: "1" } },
  ],
  projects: [
    // This spec itself exercises all six viewport widths with the real ephemeral backend.
    { name: "commerce-360-to-1440", testMatch: "site-commerce.spec.ts", use: { viewport: { width: 390, height: 844 } } },
    ...[360, 390, 430, 768, 1024, 1440].map(width => ({ name: String(width), testMatch: ["catalog-bulk.spec.ts", "marketplace-phase1.spec.ts", "commerce-multichannel.spec.ts"], use: { viewport: { width, height: 1000 } } })),
  ],
});
