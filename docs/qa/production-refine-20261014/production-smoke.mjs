import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'https://vorixworks.com';
const api = 'https://api.vorixworks.com';
const directory = 'docs/qa/production-refine-20261014';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
const money = amount => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const catalogResponse = await context.request.get(api + '/v1/platform/plans');
  assert.equal(catalogResponse.status(), 200);
  const catalog = (await catalogResponse.json()).data;
  assert.equal(catalog.priceSource, 'plan_versions');
  assert.equal(catalog.solutions.find(s => s.key === 'meetings').contractable, false);
  const start = catalog.plans.filter(p => p.monthlyPriceUsd > 0).sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd)[0];
  assert.ok(start);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const route of ['/', '/precos', '/produtos/conversas', '/produtos/meetings', '/login', '/signup']) {
    const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200, route);
    assert.equal(new URL(page.url()).pathname, route);
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false, route);
  }
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  assert.match(await page.title(), /Conversas e Meetings/);
  await page.getByRole('tab', { name: 'Vorix Meetings', exact: true }).click();
  await page.locator('.public-showcase-panel').getByText('Transcrição', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Vorix Meetings', exact: true }).press('ArrowLeft');
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  await page.locator('.public-product-menu').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.public-price-card.conversations a').getAttribute('href'), '/signup?plan=' + start.code);
  assert.equal(await page.locator('.public-price-card.meetings a').getAttribute('href'), '/produtos/meetings');
  assert.equal(await page.locator('.public-price-card.suite a').getAttribute('href'), '#monte');
  await page.getByRole('button', { name: 'Anual', exact: true }).click();
  assert.ok((await page.locator('.public-price-card.conversations .public-price').innerText()).includes(start.yearlyPriceUsd.toLocaleString('pt-BR')));
  await page.getByRole('button', { name: 'Mensal', exact: true }).click();
  const total = page.locator('.public-config-total strong');
  await page.locator('#monte').scrollIntoViewIfNeeded();
  assert.equal(await total.innerText(), money(start.monthlyPriceUsd));
  await page.getByRole('button', { name: 'Aumentar usuários', exact: true }).click();
  const simulation = await context.request.post(api + '/v1/platform/plans/simulate', {
    data: { users: (start.includedUsers ?? 2) + 1, whatsappConnections: start.includedWhatsappConnections ?? 1 },
  });
  assert.equal(simulation.status(), 200);
  const recommended = (await simulation.json()).data.recommended;
  assert.ok(recommended);
  await page.waitForFunction(expected => document.querySelector('.public-config-total strong')?.textContent === expected, money(recommended.totalMonthlyAmount));
  await page.locator('#monte').screenshot({ path: directory + '/production-config-conversas.png' });
  await page.getByRole('checkbox', { name: /Vorix Meetings/ }).check();
  assert.equal(await page.locator('#config-summary-title').innerText(), 'Suite Vorix');
  assert.match(await page.locator('.public-config-actions a').first().getAttribute('href'), /^mailto:/);
  await page.getByRole('button', { name: 'Aumentar gravações simultâneas', exact: true }).click();
  assert.match(await page.locator('.public-config-total').innerText(), /valores a definir/);
  assert.match(await page.locator('.public-config-actions a').first().getAttribute('href'), /^mailto:/);
  await page.locator('#monte').screenshot({ path: directory + '/production-config-suite.png' });
  await page.screenshot({ path: directory + '/production-desktop.png', fullPage: true });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', error => errors.push(error.message));
  await mobilePage.goto(base, { waitUntil: 'domcontentloaded' });
  await mobilePage.evaluate(() => document.fonts.ready);
  assert.equal(await mobilePage.locator('body').evaluate(body => body.scrollWidth > innerWidth), false);
  await mobilePage.screenshot({ path: directory + '/production-mobile.png', fullPage: true });
  await mobilePage.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await mobilePage.getByRole('dialog').getByRole('link', { name: 'Vorix Meetings Reuniões inteligentes' }).click();
  await mobilePage.waitForURL('**/produtos/meetings');
  assert.equal(new URL((await context.request.get(base + '/pricing')).url()).pathname, '/precos');
  assert.equal(new URL((await context.request.get(base + '/workspaces')).url()).pathname, '/login');
  const protectedResponse = await context.request.get(api + '/v1/meetings/recorder-accounts?workspaceId=nonexistent-deploy-smoke');
  assert.equal(protectedResponse.status(), 401);
  const og = await context.request.get(base + '/public-og');
  assert.equal(og.status(), 200);
  assert.match(og.headers()['content-type'], /image\/png/);
  assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), base, api, routes: 'PASS', desktop: 'PASS', mobile: 'PASS', pricingParity: 'PASS', configurator: 'PASS', officialConfiguredTotal: recommended.totalMonthlyAmount, additionalRecordingsPrice: 'UNDEFINED', meetingsContractable: false, suiteCheckout: false, privateRoutes: 'PASS', openGraph: 'PASS', pageErrors: errors };
  await writeFile(directory + '/production-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
