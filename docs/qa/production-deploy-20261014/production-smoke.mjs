import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base='https://vorixworks.com',api='https://api.vorixworks.com';
const directory='docs/qa/production-deploy-20261014';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[],results={};
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const plansResponse=await context.request.get(api+'/v1/platform/plans');
 assert.equal(plansResponse.status(),200);
 const catalog=(await plansResponse.json()).data;
 assert.equal(catalog.priceSource,'plan_versions');
 assert.equal(catalog.solutions.find(s=>s.key==='meetings').contractable,false);
 assert.equal(catalog.solutions.find(s=>s.key==='conversations').contractable,true);
 const starting=catalog.plans.filter(p=>p.monthlyPriceUsd>0).sort((a,b)=>a.monthlyPriceUsd-b.monthlyPriceUsd)[0];
 const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
 for(const route of ['/','/produtos/conversas','/produtos/meetings','/precos','/login','/signup']){
  const response=await page.goto(base+route,{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200,route);assert.equal(new URL(page.url()).pathname,route);
  assert.equal(await page.locator('body').evaluate(b=>b.scrollWidth>innerWidth),false,route);
 }
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{level:1}).waitFor(); await page.evaluate(()=>document.fonts.ready);
 assert.match(await page.title(),/Conversas e Meetings/);
 assert.equal(await page.locator('.public-price-card.conversations a').getAttribute('href'),'/signup?plan='+starting.code);
 assert.equal(await page.locator('.public-price-card.meetings a').getAttribute('href'),'/produtos/meetings');
 assert.match(await page.locator('.public-price-card.suite a').getAttribute('href'),/^mailto:/);
 assert.ok((await page.locator('.public-price-card.conversations .public-price').innerText()).includes(starting.monthlyPriceUsd.toLocaleString('pt-BR')));
 await page.getByRole('tab',{name:'Vorix Meetings',exact:true}).click();
 await page.locator('.public-showcase-panel').getByText('Transcrição',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Produtos',exact:true}).click(); await page.locator('.public-product-menu').waitFor(); await page.keyboard.press('Escape');
 await page.screenshot({path:directory+'/production-desktop.png',fullPage:true});
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 const mp=await mobile.newPage();mp.on('pageerror',e=>errors.push(e.message));
 await mp.goto(base,{waitUntil:'domcontentloaded'});await mp.evaluate(()=>document.fonts.ready);
 assert.equal(await mp.locator('body').evaluate(b=>b.scrollWidth>innerWidth),false);
 await mp.screenshot({path:directory+'/production-mobile.png',fullPage:true});
 await mp.getByRole('button',{name:'Abrir menu',exact:true}).click();await mp.getByRole('dialog').waitFor();
 await mp.getByRole('dialog').getByRole('link',{name:'Vorix Meetings Reuniões inteligentes'}).click();await mp.waitForURL('**/produtos/meetings');
 assert.equal(new URL((await context.request.get(base+'/pricing')).url()).pathname,'/precos');
 assert.equal(new URL((await context.request.get(base+'/workspaces')).url()).pathname,'/login');
 const og=await context.request.get(base+'/public-og');assert.equal(og.status(),200);assert.match(og.headers()['content-type'],/image\/png/);
 const protectedResponse=await context.request.get(api+'/v1/meetings/recorder-accounts?workspaceId=nonexistent-deploy-smoke');assert.equal(protectedResponse.status(),401);
 assert.deepEqual(errors,[]);
 Object.assign(results,{checkedAt:new Date().toISOString(),base,api,routes:'PASS',desktop:'PASS',mobile:'PASS',menusAndSelector:'PASS',pricingParity:'PASS',meetingsContractable:false,suiteCheckout:false,privateRoutes:'PASS',openGraph:'PASS',pageErrors:errors,officialStartingPrice:starting.monthlyPriceUsd});
 await writeFile(directory+'/production-smoke.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
