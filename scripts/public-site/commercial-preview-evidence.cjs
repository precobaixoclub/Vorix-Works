const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("../../web/node_modules/@playwright/test");

const base = new URL(process.env.VORIX_PUBLIC_QA_BASE_URL ?? "http://localhost:3402");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Use a local commercial preview.");

const output = path.resolve("artifacts/vorix-comercial-local");
const views = [
  { name: "desktop", width: 1440, height: 960, dpr: 1 },
  { name: "tablet", width: 768, height: 1024, dpr: 1 },
  { name: "celular", width: 390, height: 844, dpr: 2 },
];
const pages = [
  ["home", "/"], ["precos", "/precos"], ["conversas", "/produtos/conversas"],
  ["marketing", "/produtos/marketing"], ["site", "/produtos/site"], ["meetings", "/produtos/meetings"],
];

async function evidence(browser, view, name, route) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.dpr,
    colorScheme: "dark", reducedMotion: "reduce",
  });
  try {
    await context.route("**/*", request => {
      const { hostname } = new URL(request.request().url());
      return ["localhost", "127.0.0.1"].includes(hostname) ? request.continue() : request.abort();
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.commercialQA = { lcp: null, cls: 0, events: [] };
      new PerformanceObserver(list => {
        const last = list.getEntries().at(-1);
        if (last) window.commercialQA.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.commercialQA.cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
      if (PerformanceObserver.supportedEntryTypes.includes("event")) {
        new PerformanceObserver(list => {
          window.commercialQA.events.push(...list.getEntries().filter(event => event.interactionId).map(event => event.duration));
        }).observe({ type: "event", buffered: true, durationThreshold: 16 });
      }
    });
    const response = await page.goto(new URL(route, base).href, { waitUntil: "networkidle" });
    if (!response.ok()) throw new Error(`${route}: ${response.status()}`);
    await page.evaluate(() => document.fonts.ready);
    const initial = await page.evaluate(() => {
      const resources = performance.getEntriesByType("resource");
      const assets = resources.filter(entry => entry.name.includes("/marketing/comercial/"));
      const scripts = resources.filter(entry => new URL(entry.name).pathname.endsWith(".js"));
      return {
        lcpMs: window.commercialQA.lcp, cls: window.commercialQA.cls,
        heroSrc: document.querySelector(".vc-hero-main img")?.currentSrc,
        commercialRequests: assets.length, commercialEncodedBytes: assets.reduce((bytes, entry) => bytes + entry.encodedBodySize, 0),
        jsRequests: scripts.length, jsEncodedBytes: scripts.reduce((bytes, entry) => bytes + entry.encodedBodySize, 0),
        requests: resources.length, horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      };
    });
    if (initial.horizontalOverflowPx > 1) throw new Error(`${route} at ${view.width}px overflows horizontally`);
    await page.screenshot({ path: path.join(output, `depois-${name}-${view.name}-primeira-dobra.png`) });
    const faq = page.locator("main details > summary").last();
    if (await faq.count()) {
      await faq.click();
      await faq.click();
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const observedInteractionMs = await page.evaluate(() => window.commercialQA.events.length ? Math.max(...window.commercialQA.events) : null);
    await page.evaluate(async () => {
      const shots = [...document.querySelectorAll("img[src*='/marketing/comercial/']")];
      for (const img of shots) img.loading = "eager";
      await Promise.all(shots.map(img => img.decode()));
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, `depois-${name}-${view.name}.png`), fullPage: true });
    return { route, width: view.width, devicePixelRatio: view.dpr, ...initial, observedInteractionMs };
  } finally {
    await context.close();
  }
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  const metrics = [];
  try {
    for (const [name, route] of pages) {
      for (const view of name === "home" || name === "precos" ? views : [views[0]]) {
        metrics.push(await evidence(browser, view, name, route));
      }
    }
    await fs.writeFile(path.join(output, "metricas-locais.json"), JSON.stringify(metrics, null, 2) + "\n");
    console.log(JSON.stringify(metrics.slice(0, 6)));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
