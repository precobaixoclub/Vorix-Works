import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base=process.env.VORIX_PUBLIC_BASE_URL ?? 'http://localhost:3003';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('LOCAL_PREVIEW_REQUIRED');
const directory=process.env.VORIX_PUBLIC_EVIDENCE_DIR ?? 'docs/qa/public-multiproduct-20261014';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>{
    window.__publicMetrics={cls:0,lcpMs:null};
    new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)window.__publicMetrics.cls+=entry.value;}).observe({type:'layout-shift',buffered:true});
    new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__publicMetrics.lcpMs=entry.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
  });
  await page.goto(base,{waitUntil:'load'});
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(800);
  const results=await page.evaluate(()=>{
    const resources=performance.getEntriesByType('resource');
    const root=document.querySelector('.public-site');
    const styles=getComputedStyle(root);
    const colors=Object.fromEntries(['--public-bg','--public-text','--public-muted','--public-green','--public-violet'].map(key=>[key,styles.getPropertyValue(key).trim()]));
    return {scope:'LOCAL_OPTIMIZED_BUILD_SINGLE_RUN',...window.__publicMetrics,scriptEncodedBytes:resources.filter(r=>r.initiatorType==='script').reduce((sum,r)=>sum+r.encodedBodySize,0),fontRequests:resources.filter(r=>r.name.includes('.woff')).length,heroImageElements:document.querySelectorAll('.public-hero img').length,heroVideoElements:document.querySelectorAll('.public-hero video').length,colors};
  });
  const luminance=hex=>{const values=hex.replace('#','').match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return .2126*values[0]+.7152*values[1]+.0722*values[2];};
  const background=luminance(results.colors['--public-bg']);
  results.textContrast=Object.fromEntries(['--public-text','--public-muted','--public-green','--public-violet'].map(key=>{const foreground=luminance(results.colors[key]);return [key,Number(((Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)).toFixed(2))];}));
  assert.ok(Object.values(results.textContrast).every(contrast=>contrast>=4.5));
  assert.equal(results.heroImageElements,0);
  assert.equal(results.heroVideoElements,0);
  await page.goto(base+'/precos',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Calcular',exact:true}).click();
  await page.getByText('Para sua estrutura, recomendamos',{exact:true}).waitFor();
  results.capacitySimulator='PASS';
  await writeFile(directory+'/performance-smoke.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
} finally {await browser.close();}
