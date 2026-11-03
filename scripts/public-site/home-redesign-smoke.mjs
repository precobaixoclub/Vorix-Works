import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.VORIX_PUBLIC_BASE_URL ?? "http://localhost:3401";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Use a local review server",
);
const directory =
  process.env.VORIX_PUBLIC_EVIDENCE_DIR ?? "docs/qa/home-redesign-20261103";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const errors = [];
try {
  for (const width of [360, 390, 430, 768, 1024, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      errors.push({ width, message: error.message }),
    );
    const brokenResponses = [];
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().includes("/auth/"))
        brokenResponses.push({
          url: response.url(),
          status: response.status(),
        });
    });
    await page.addInitScript(() => {
      window.__homeLayoutShifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (!entry.hadRecentInput)
            window.__homeLayoutShifts.push(entry.value);
      }).observe({ type: "layout-shift", buffered: true });
    });
    assert.equal(
      (await page.goto(base, { waitUntil: "networkidle" })).status(),
      200,
    );
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("h1").count(), 1);
    assert.match(await page.title(), /Da conversa à venda/);
    assert.equal(
      new URL(await page.locator('link[rel="canonical"]').getAttribute("href"))
        .href,
      "https://vorixworks.com/",
    );
    assert.match(
      await page
        .locator('meta[property="og:image"]')
        .first()
        .getAttribute("content"),
      /social-card.webp$/,
    );
    assert.equal(
      await page
        .locator('script[type="application/ld+json"]')
        .evaluateAll((nodes) =>
          nodes.every(
            (node) => JSON.parse(node.textContent)["@graph"].length === 2,
          ),
        ),
      true,
    );
    assert.equal(await page.locator(".vh-product-card").count(), 4);
    assert.equal(await page.locator(".vh-journey>li").count(), 8);
    assert.match(
      await page.locator(".vh-hero-copy a").first().getAttribute("href"),
      /^\/signup\?plan=/,
    );
    assert.match(
      await page.locator("#contato a").first().getAttribute("href"),
      /^mailto:comercial@vorixworks.com/,
    );
    const links = await page
      .locator("a[href]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    for (const href of links.filter(
      (href) => href.startsWith("#") || href.startsWith("/#"),
    )) {
      const id = href.split("#")[1];
      assert.ok(
        await page.locator(`[id="${id}"]`).count(),
        `Missing fragment ${href}`,
      );
    }
    if (width === 1440) {
      const privatePage = await context.request.get(base + "/workspaces");
      assert.equal(
        new URL(privatePage.url()).pathname,
        "/login",
        "Private areas must retain their session gate",
      );
      const privateMarketing = await context.request.get(
        base + "/marketing/private",
      );
      assert.equal(
        new URL(privateMarketing.url()).pathname,
        "/login",
        "Only the new asset prefix is public",
      );
      await page.getByRole("button", { name: "Produtos", exact: true }).click();
      assert.equal(await page.locator(".vh-product-menu a").count(), 4);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".vh-product-menu").count(), 0);
      await page.waitForFunction(
        () => document.activeElement?.textContent?.trim() === "Produtos",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Produtos", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      for (const route of [
        ...new Set(
          links
            .filter((href) => href.startsWith("/") && !href.startsWith("/#"))
            .map((href) => href.split("#")[0]),
        ),
      ]) {
        const response = await context.request.get(base + route);
        assert.equal(response.status(), 200, route);
        assert.equal(
          new URL(response.url()).pathname,
          route.split("?")[0],
          `Unexpected redirect ${route}`,
        );
      }
    } else if (width <= 768) {
      const trigger = page.getByRole("button", {
        name: "Abrir menu",
        exact: true,
      });
      await trigger.click();
      assert.equal(
        (await page
          .getByRole("dialog")
          .getByRole("link", { name: /Vorix/ })
          .count()) >= 4,
        true,
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") === "Abrir menu",
      );
      assert.equal(
        await trigger.evaluate((node) => node === document.activeElement),
        true,
      );
      await trigger.click();
      await page
        .getByRole("dialog")
        .getByRole("link", { name: "Recursos", exact: true })
        .click();
      await page.waitForURL("**/#recursos");
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(new URL(page.url()).hash, "#recursos");
      await page.evaluate(() => scrollTo(0, 0));
    }
    const demo = page.getByRole("button", {
      name: "Ver demonstração",
      exact: true,
    });
    await demo.click();
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.getByRole("tab").count(), 4);
    await dialog.getByRole("tab").first().focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await dialog
        .getByRole("tab", { name: "Meetings", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    for (const tab of await dialog.getByRole("tab").all()) {
      await tab.click();
      await dialog.locator("img").evaluate((image) => image.decode());
    }
    assert.equal(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      true,
      "Demo overflows horizontally",
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.waitForFunction(
      () => document.activeElement?.textContent?.trim() === "Ver demonstração",
    );
    assert.equal(
      await demo.evaluate((node) => node === document.activeElement),
      true,
    );
    await page.locator(".vh-faq summary").first().click();
    assert.notEqual(
      await page.locator(".vh-faq details").first().getAttribute("open"),
      null,
    );
    await page.locator(".vh-faq summary").first().click();
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await Promise.all([...document.images].map((image) => image.decode()));
      scrollTo(0, 0);
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `Horizontal scroll at ${width}`,
    );
    assert.equal(
      await page
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0),
        ),
      true,
    );
    assert.equal(
      await page.locator('main img:not([loading="lazy"])').count(),
      1,
      "Only hero eagerly loads",
    );
    assert.equal(
      await page
        .locator(".vh-hero-orbit")
        .evaluate((node) => getComputedStyle(node).animationName),
      "none",
    );
    assert.equal(brokenResponses.length, 0, JSON.stringify(brokenResponses));
    const metrics = await page.evaluate(() => ({
      height: document.body.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      cls: window.__homeLayoutShifts.reduce((sum, value) => sum + value, 0),
      images: [...document.images].map((image) => ({
        src: image.currentSrc,
        width: image.naturalWidth,
        loading: image.loading,
      })),
    }));
    assert.ok(metrics.cls < 0.1, `Unexpected layout shift ${metrics.cls}`);
    if ([390, 768, 1440].includes(width)) {
      await page.screenshot({
        path: `${directory}/home-${width}.png`,
        fullPage: true,
      });
      await page.screenshot({ path: `${directory}/hero-${width}.png` });
      await page.locator("#produtos").screenshot({
        path: `${directory}/products-${width}.png`,
        style: ".public-header { visibility: hidden !important; }",
      });
    }
    results.push({ width, status: "PASS", ...metrics });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${directory}/browser-smoke.json`,
    JSON.stringify({ base, results, errors }, null, 2),
  );
  console.log(
    JSON.stringify(
      results.map(({ width, status, cls, height }) => ({
        width,
        status,
        cls,
        height,
      })),
    ),
  );
} finally {
  await browser.close();
}
