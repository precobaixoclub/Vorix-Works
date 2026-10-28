import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "https://vorixworks.com", api = "https://api.vorixworks.com";
const out = resolve(process.env.READINESS_SMOKE_OUTPUT ?? "tmp/readiness-production-smoke");
await mkdir(out, { recursive: true });
const result = { at: new Date().toISOString(), api: {}, viewports: [], pageErrors: [], providerValidation: "NOT_PERFORMED_NO_CREDENTIALS" };
const ready = await fetch(`${api}/readyz`), health = await ready.json();
assert.equal(ready.status, 200); assert.equal(health.data?.ready, true); result.api.readiness = health.data.status;
for (const path of ["/v1/commerce/orders?workspaceId=unknown-qa", "/v1/marketplaces?workspaceId=unknown-qa"]) {
  const response = await fetch(api + path); assert.equal(response.status, 401); result.api[path.split("?")[0]] = 401;
}
const invalid = await fetch(api + "/v1/public/orders/readiness-invalid-token"); assert.equal(invalid.status, 404); result.api.invalidOrder = 404;
const siteResponse = await fetch(`${api}/v1/public/sites/qa-commerce-fase1`); assert.equal(siteResponse.status, 200);
const site = (await siteResponse.json()).data;
const product = site.products.find(p => p.commerce?.allowedActions?.includes("buy_now")) ?? site.products[0];
assert.ok(product?.slug);
result.api.site = { status: 200, productCount: site.products.length, checkoutAvailable: site.commerce?.checkoutAvailable, sandbox: site.commerce?.sandbox };
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [360, 390, 430, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", error => result.pageErrors.push({ width, message: error.message.slice(0, 200) }));
    for (const [name, path] of [["home", "/"], ["login", "/login"], ["site", `/s/${site.slug}`], ["product", `/s/${site.slug}/produto/${product.slug}`]]) {
      const response = await page.goto(origin + path, { waitUntil: "domcontentloaded" });
      assert.equal(response.status(), 200, `${name}:${width}`);
      // A site with the hero intentionally hidden can start directly at the catalog heading.
      await page.locator(name==="site"?"h1,h2":"h1").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, `${name}:${width} overflow=${overflow}`);
      await page.screenshot({ path: resolve(out, `${name}-${width}.png`), fullPage: true });
      result.viewports.push({ width, page: name, status: 200, overflow });
    }
    await context.close();
  }
  assert.deepEqual(result.pageErrors, []);
} finally {
  await browser.close();
  await writeFile(resolve(out, "result.json"), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify({ productionSmoke: "PASS", checks: result.viewports.length, viewports: [360, 390, 430, 768, 1024, 1440], pageErrors: result.pageErrors.length, api: result.api }));
