import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'https://vorixworks.com';
const api = 'https://api.vorixworks.com';
const directory = 'docs/qa/production-plans-20261018';
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const response = await context.request.get(api + '/v1/platform/plans');
  assert.equal(response.status(), 200);
  const catalog = (await response.json()).data;
  assert.equal(catalog.priceSource, 'plan_versions');
  assert.equal(catalog.solutions.find(s => s.key === 'meetings').contractable, false);
  assert.equal(catalog.meetingsOffer.baseMonthlyPrice, 147);
  assert.equal(catalog.meetingsOffer.additionalRecordingMonthlyPrice, 67);
  const start = catalog.plans.filter(p => p.monthlyPriceUsd > 0).sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd)[0];
  assert.ok(start);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const route of ['/', '/precos', '/produtos/conversas', '/produtos/meetings', '/login', '/signup']) {
    const result = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    assert.equal(result.status(), 200, route);
    assert.equal(new URL(page.url()).pathname, route);
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false, route);
    if (route === '/login' || route === '/signup') {
      await page.locator('.public-auth-card').waitFor(); assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), true, 'dark default theme');
      await page.screenshot({ path: directory + '/desktop-' + route.slice(1) + '.png' });
    }
  }
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: directory + '/desktop-home.png' });
  await page.locator('#monte').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.public-config-total strong').innerText(), money(start.monthlyPriceUsd));
  await page.getByRole('button', { name: 'Aumentar usuários', exact: true }).click();
  const users = (start.includedUsers ?? 2) + 1;
  const numbers = start.includedWhatsappConnections ?? 1;
  const simulation = await context.request.post(api + '/v1/platform/plans/simulate', { data: { users, whatsappConnections: numbers } });
  assert.equal(simulation.status(), 200);
  const recommended = (await simulation.json()).data.recommended;
  assert.ok(recommended);
  await page.waitForFunction(expected => document.querySelector('.public-config-total strong')?.textContent === expected, money(recommended.totalMonthlyAmount));
  const signupHref = await page.locator('.public-config-actions').getByRole('link', { name: 'Contratar agora', exact: true }).getAttribute('href');
  const target = new URL(signupHref, base);
  assert.equal(target.pathname, '/signup');
  assert.equal(target.searchParams.get('plan'), recommended.planCode);
  assert.equal(target.searchParams.get('users'), String(users));
  assert.equal(target.searchParams.get('numbers'), String(numbers));
  assert.equal(target.searchParams.has('recordings'), false);
  await page.locator('#monte').screenshot({ path: directory + '/config-conversas.png' });
  await page.getByRole('checkbox', { name: /Vorix Meetings/ }).check();
  await page.getByRole('button', { name: 'Aumentar gravações simultâneas', exact: true }).click();
  const expectedSuiteTotal = recommended.totalMonthlyAmount + catalog.meetingsOffer.baseMonthlyPrice + catalog.meetingsOffer.additionalRecordingMonthlyPrice;
  await page.waitForFunction(expected => document.querySelector('.public-config-total strong')?.textContent === expected, money(expectedSuiteTotal));
  assert.equal(await page.locator('.public-config-actions').getByRole('button', { name: 'Meetings disponível em breve', exact: true }).isDisabled(), true);
  const secondary = new URL(await page.locator('.public-config-actions').getByRole('link', { name: 'Contratar só Conversas agora', exact: true }).getAttribute('href'), base);
  assert.equal(secondary.searchParams.has('recordings'), false);
  assert.equal(await page.locator('.public-config-actions a[href^="mailto:"]').count(), 0);
  await page.locator('#monte').screenshot({ path: directory + '/config-suite-blocked.png' });
  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Criar conta e ir para o pagamento', exact: true }).waitFor();
  assert.match(await page.locator('.public-auth-card').innerText(), new RegExp(users + ' usuários'));
  assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), '');
  await page.screenshot({ path: directory + '/configured-signup.png' });
  // Navigation stops at signup. No account, card, checkout session or payment is created.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', error => errors.push(error.message));
  for (const route of ['/', '/precos', '/login', '/signup']) {
    const result = await mobilePage.goto(base + route, { waitUntil: 'domcontentloaded' });
    assert.equal(result.status(), 200);
    await mobilePage.evaluate(() => document.fonts.ready);
    assert.equal(await mobilePage.locator('body').evaluate(body => body.scrollWidth > innerWidth), false, route);
    await mobilePage.screenshot({ path: directory + '/mobile-' + (route.slice(1) || 'home') + '.png' });
  }
  assert.equal(new URL((await context.request.get(base + '/workspaces')).url()).pathname, '/login');
  assert.equal((await context.request.post(api + '/v1/billing/checkout', { data: { planCode: 'START', billingInterval: 'monthly', capacity: { users, whatsappConnections: numbers } } })).status(), 401);
  for (const route of ['/inbox/service-settings', '/inbox/quick-replies', '/meetings/usage', '/meetings/zoom/status']) {
    const protectedResponse = await context.request.get(api + '/v1' + route + '?workspaceId=nonexistent-deploy-smoke');
    assert.equal(protectedResponse.status(), 401, route);
  }
  const invalidShare = 'production-deploy-invalid-token-20261018';
  const shareResponse = await context.request.get(api + '/v1/public/meetings/' + invalidShare);
  assert.equal(shareResponse.status(), 404);
  const sharePage = await page.goto(base + '/r/' + invalidShare, { waitUntil: 'domcontentloaded' });
  assert.equal(sharePage.status(), 200);
  assert.equal(new URL(page.url()).pathname, '/r/' + invalidShare);
  await page.getByText('Este link não existe mais ou expirou.', { exact: false }).waitFor();
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
  assert.equal(await page.locator('audio,video').count(), 0);
  await page.screenshot({ path: directory + '/invalid-share.png' });

  for (const route of ['/commercial-settings', '/price-books', '/sales-goals', '/deals/nonexistent-deploy-smoke/commercial', '/deals/nonexistent-deploy-smoke/insights']) {
    const response = await context.request.get(api + '/v1' + route + '?workspaceId=nonexistent-deploy-smoke');
    assert.equal(response.status(), 401, route);
  }
  const proposalToken = 'production-deploy-invalid-proposal-20261018';
  assert.equal((await context.request.get(api + '/v1/public/proposals/' + proposalToken)).status(), 404);
  const proposalPage = await page.goto(base + '/p/' + proposalToken, { waitUntil: 'domcontentloaded' });
  assert.equal(proposalPage.status(), 200);
  assert.equal(new URL(page.url()).pathname, '/p/' + proposalToken);
  await page.getByRole('button', { name: 'Tentar de novo', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /aceitar|recusar/i }).count(), 0);
  await page.screenshot({ path: directory + '/invalid-proposal.png' });

  for (const route of ['/billing/credits', '/report-templates', '/automation-rules', '/products', '/products/stock-risk', '/contacts/lid-cleanup']) {
    assert.equal((await context.request.get(api + '/v1' + route + '?workspaceId=nonexistent-deploy-smoke')).status(), 401, route);
  }
  assert.equal((await context.request.post(api + '/v1/billing/credits/purchase', { data: { credits: 100, returnPath: '/' } })).status(), 401);
  assert.equal((await context.request.post(api + '/v1/products/images?workspaceId=nonexistent-deploy-smoke')).status(), 401);
  assert.equal((await context.request.get(api + '/v1/contacts/phones?workspaceId=nonexistent-deploy-smoke&ids=nonexistent')).status(), 401);
  assert.equal((await context.request.post(api + '/v1/contacts/lid-cleanup', { data: { workspaceId: 'nonexistent-deploy-smoke', confirm: true } })).status(), 401);
  assert.deepEqual(errors, []);


  const result = { checkedAt: new Date().toISOString(), base, api, applicationRevision: 'e7ac21615465e22d01d1cc4b6e8070702617f69d', newBillingReportsAndAutomationsAuth: 'PASS', productEndpointsAnonymousDenied: 'PASS', contactCleanupAnonymousDenied: 'PASS', darkDefaultTheme: 'PASS', salesEndpointsAnonymousDenied: 'PASS', invalidPublicProposal: 'PASS', publicRoutes: 'PASS', authScreens: 'PASS', mobile: 'PASS', configurator: 'PASS', capacityHandoff: 'PASS', protectedNewEndpoints: 'PASS', invalidPublicShare: 'PASS', publicShareNoindex: 'PASS', configuredTotal: recommended.totalMonthlyAmount, suiteTotalForTwoRecordings: expectedSuiteTotal, meetingsContractable: false, anonymousCheckoutDenied: true, realCheckoutCreated: false, realPaymentExecuted: false, realMessageSent: false, realRecordingExecuted: false, pageErrors: errors };
  await writeFile(directory + '/production-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
