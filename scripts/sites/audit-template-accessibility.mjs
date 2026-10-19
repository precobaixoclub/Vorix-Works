import {createRequire} from 'node:module';
import {writeFile,mkdir,readdir,stat} from 'node:fs/promises';
const require=createRequire(new URL('../../web/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const scope=await(await fetch('http://127.0.0.1:3390/fixture-only/scope')).json();if(!scope.fixtureOnly||!scope.siteBuilderFixture)throw Error('Execute somente com a fixture do Website Builder.');
const browser=await chromium.launch({headless:true});
const results=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 for(const id of ['nexus','aura','pulse']){
  await page.goto(`http://127.0.0.1:3391/modelos/${id}`,{waitUntil:'networkidle'});
  const result=await page.evaluate(()=>{
   const visible=e=>!!e.getClientRects().length;
   const name=e=>e.getAttribute('aria-label')||e.textContent?.trim()||e.getAttribute('title')||e.querySelector('img')?.alt;
   const inputs=[...document.querySelectorAll('.tenant-site input,.tenant-site textarea,.tenant-site select')].filter(visible);
   const missingInputLabels=inputs.filter(e=>!e.getAttribute('aria-label')&&!e.labels?.length).map(e=>e.outerHTML);
   const unnamedControls=[...document.querySelectorAll('.tenant-site button,.tenant-site a')].filter(visible).filter(e=>!name(e)).map(e=>e.outerHTML);
   const missingAlt=[...document.querySelectorAll('.tenant-site img')].filter(e=>!e.hasAttribute('alt')).map(e=>e.src);
   const c=document.querySelector('[class$="hero-copy"] .ts-button');
   function lum(color){const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];}
   const css=getComputedStyle(c);let bg=css.backgroundColor,node=c;
   while((bg==='rgba(0, 0, 0, 0)'||bg==='transparent')&&node.parentElement){node=node.parentElement;bg=getComputedStyle(node).backgroundColor;}
   const fgLum=lum(css.color),bgLum=lum(bg),heroButtonContrast=(Math.max(fgLum,bgLum)+.05)/(Math.min(fgLum,bgLum)+.05);
   return {h1:document.querySelectorAll('.tenant-site h1').length,missingInputLabels,unnamedControls,missingAlt,heroButtonContrast};
  });
  if(result.h1!==1||result.missingInputLabels.length||result.unnamedControls.length||result.missingAlt.length||result.heroButtonContrast<4.5)throw Error(id+': '+JSON.stringify(result));
  await page.setViewportSize({width:390,height:844});
  const menu=page.getByRole('button',{name:'Abrir menu',exact:true});await menu.focus();await page.keyboard.press('Enter');
  if(!await page.getByRole('navigation',{name:'Menu do celular'}).isVisible())throw Error('Menu não abriu pelo teclado');
  await page.getByRole('button',{name:'Fechar menu',exact:true}).focus();await page.keyboard.press('Enter');
  results.push({id,...result,keyboardMenu:'PASS'});await page.setViewportSize({width:1440,height:1000});
 }
 const assets=[];for(const name of await readdir('web/public/site-assets/templates'))assets.push({file:name,bytes:(await stat('web/public/site-assets/templates/'+name)).size});
 await mkdir('tmp/website-builder/evidence',{recursive:true});await writeFile('tmp/website-builder/evidence/accessibility-performance.json',JSON.stringify({automatedReview:'Controle de nomes acessíveis, labels, alt, h1, teclado e contraste do CTA. Não substitui auditoria WCAG completa nem Lighthouse.',results,assets},null,2));console.log('ACCESSIBILITY_REVIEW_PASS',JSON.stringify(results));
}finally{await browser.close();}
