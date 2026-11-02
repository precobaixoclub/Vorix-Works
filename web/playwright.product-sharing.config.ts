import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "public-product.spec.ts", workers: 2, retries: 0,
  use: { baseURL: "http://127.0.0.1:3397", channel: "chrome", trace: "retain-on-failure" },
  webServer: [
    { command: "node ../tests/fixtures/public-product-browser-server.mjs", url: "http://127.0.0.1:3396/health", reuseExistingServer: false },
    { command: "npx next dev -p 3397 -H 127.0.0.1", url: "http://127.0.0.1:3397", reuseExistingServer: false, timeout: 120000, env: { NEXT_PUBLIC_API_URL: "http://127.0.0.1:3396", API_INTERNAL_URL: "http://127.0.0.1:3396", PLAYWRIGHT_TEST: "1" } },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});
