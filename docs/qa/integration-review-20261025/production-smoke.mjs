import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'https://vorixworks.com';
const api = 'https://api.vorixworks.com';
const directory = '.qa/production-integration-20261025';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 }, reducedMotion: 'reduce',
      ...(width === 390 ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const route of ['/', '/precos', '/login', '/signup']) {
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, route);
      assert.equal(new URL(page.url()).pathname, route);
      assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false, `${route} overflow ${width}`);
      checks.push({ route, width, status: 'PASS' });
    }
    const token = 'integration-review-invalid-proposal-20261025';
    assert.equal((await context.request.get(`${api}/v1/public/proposals/${token}`)).status(), 404);
    await page.goto(`${base}/p/${token}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /aceitar|recusar/i }).count(), 0);
    assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${directory}/invalid-proposal-${width}.png` });
    checks.push({ route: '/p/invalid', width, status: 'PASS' });
    assert.equal(new URL((await context.request.get(base + '/workspaces')).url()).pathname, '/login');
    for (const route of ['/dashboard', '/deals', '/proposals', '/contacts', '/tasks', '/teams', '/inbox/conversations', '/inbox/service-settings']) {
      const response = await context.request.get(`${api}/v1${route}?workspaceId=integration-review-nonexistent`);
      assert.equal(response.status(), 401, route);
      checks.push({ route, width, anonymousAccess: 'DENIED' });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), applicationRevision: process.env.DEPLOY_SHA,
    base, api, checks, pageErrors: errors, status: 'PASS' };
  await writeFile(`${directory}/production-smoke.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
