import {test,expect,type Page,type Locator} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";

const evidence=path.resolve("../docs/qa/product-media-20261104");
const widths=[360,390,430,768,1024,1440];
const models=["catalog","studio","showcase","nexus","aura","pulse"];
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
async function contained(page:Page){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const images=page.locator(".sp-photo,[data-product-hero]");
 for(const img of await images.all()){
  await expect(img).toHaveCSS("object-fit","contain");await expect(img).toHaveCSS("transform","none");
  const box=await img.boundingBox();expect(box?.height).toBeGreaterThan(0);expect(box?.width).toBeGreaterThan(0);
 }
}
async function swipe(page:Page,gallery:Locator,direction:"left"|"right"){
 const box=(await gallery.locator(".sp-stage").boundingBox())!,x=box.x+box.width*.5,y=box.y+box.height*.65;
 // CDP produces native touch events and pointer events (including pointer capture).
 const client=await page.context().newCDPSession(page);
 await client.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
 await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+(direction==="left"?-65:65),y}]});
 await client.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await client.detach();
}
async function screenshot(page:Page,name:string){
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll<HTMLImageElement>(".sp-photo")].filter(img=>img.getBoundingClientRect().top<innerHeight).map(img=>img.decode().catch(()=>{})));});
 await page.screenshot({path:path.join(evidence,name+".png"),fullPage:true});
}

for(const model of models){
 test(`${model}: catálogo, busca, categoria, relacionados e galeria em seis larguras`,async({page})=>{
  const errors:string[]=[],mutations:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("request",req=>{if(req.method()!=="GET"&&!req.url().includes("/events")&&!req.url().includes("__nextjs")&&!req.url().includes("/auth/refresh"))mutations.push(`${req.method()} ${req.url()}`);});
  const base=`/s/media-${model}`;
  await page.goto(base);const card=page.locator('[data-product-card="shirt"]'),gallery=card.locator('[data-product-gallery="card"]');
  await expect(card.getByText("7 cores disponíveis")).toBeVisible();await expect(card.getByText("+2",{exact:true})).toBeVisible();await expect(card.getByText(/Tamanho: P · M · G · GG \+2/)).toBeVisible();
  const first=gallery.locator(".sp-photo");await expect(first).toHaveAttribute("src",/color-0/);await card.hover();await gallery.getByRole("button",{name:"Próxima foto",exact:true}).click();await expect(first).toHaveAttribute("src",/color-1/);await expect(page).toHaveURL(new RegExp(base+"$"));
  await gallery.locator(".sp-stage").focus();await page.keyboard.press("ArrowLeft");await expect(first).toHaveAttribute("src",/color-0/);await page.keyboard.press("ArrowLeft");await expect(first).toHaveAttribute("src",/combination/);
  await card.getByRole("button",{name:"Prévia: Cor Preto",exact:true}).hover();await expect(first).toHaveAttribute("src",/color-1/);await expect(gallery.locator(".sp-counter")).toHaveText("1 / 2");await card.getByRole("button",{name:"Prévia: Cor Verde",exact:true}).click();await expect(first).toHaveAttribute("src",/color-2/);await expect(page).toHaveURL(new RegExp(base+"$"));
  const single=page.locator('[data-product-card="single"]');await expect(single.locator(".sp-arrow,.sp-counter")).toHaveCount(0);await expect(single.getByText("1 cor disponível")).toBeVisible();await expect(page.locator('[data-product-card="landscape"] .sp-variants')).toHaveCount(0);
  const metrics=[];
  for(const width of widths){
   await page.setViewportSize({width,height:1000});await card.scrollIntoViewIfNeeded();await contained(page);
   if(width===390){await swipe(page,gallery,"left");await expect(gallery.locator(".sp-counter")).toHaveText("2 / 2");await expect(page).toHaveURL(new RegExp(base+"$"));}
   metrics.push({surface:"catalog",width,overflow:false});
   if(width===390||width===1440)await screenshot(page,`${model}-catalog-${width}`);
  }
  await page.getByRole("textbox",{name:"Buscar produtos",exact:true}).fill("horizontal");await expect(page.locator("[data-product-card]")).toHaveCount(1);await contained(page);
  await page.goto(base+"/categoria/vestuario");await expect(page.locator('[data-product-card="shirt"]')).toBeVisible();await contained(page);
  await card.locator(".sp-card-title").click();await expect(page).toHaveURL(new RegExp(base+"/produto/camisa$"));
  const detail=page.locator('[data-product-gallery="detail"]');await expect(detail.locator(".sp-counter")).toHaveText("1 / 9");
  await page.getByLabel("Tamanho",{exact:true}).selectOption("P");await page.getByRole("radio",{name:"Cinza",exact:true}).click();await expect(detail.locator(".sp-photo")).toHaveAttribute("src",/combination/);await expect(detail.locator(".sp-counter")).toHaveText("1 / 3");
  await detail.getByRole("button",{name:"Próxima foto",exact:true}).click();await expect(detail.locator(".sp-photo")).toHaveAttribute("src",/color-0/);
  await detail.getByRole("button",{name:"Ver foto 3",exact:true}).click();await expect(detail.locator(".sp-photo")).toHaveAttribute("src",/general/);await expect(detail.locator(".sp-photo")).toHaveAttribute("alt","Vista geral do acabamento da camisa");
  await page.getByRole("radio",{name:"Preto",exact:true}).click();await expect(detail.locator(".sp-photo")).toHaveAttribute("src",/color-1/);await expect(detail.locator(".sp-counter")).toHaveText("1 / 2");
  for(const width of widths){
   await page.setViewportSize({width,height:1000});await detail.scrollIntoViewIfNeeded();await contained(page);metrics.push({surface:"detail",width,overflow:false});
   if(width===390){await swipe(page,detail,"left");await expect(detail.locator(".sp-counter")).toHaveText("2 / 2");}
   if(width===390||width===1440)await screenshot(page,`${model}-detail-${width}`);
  }
  await expect(page.locator(".ts-related-products [data-product-card]")).toHaveCount(3);
  await page.goto(base+"/produto/camisa-verde");await expect(page.locator('[data-product-gallery="detail"] .sp-arrow,[data-product-gallery="detail"] .sp-counter,.sp-thumbnails')).toHaveCount(0);
  await page.goto(base+"/produto/horizontal");await expect(page.locator(".ts-options")).toBeEmpty();await contained(page);
  await page.goto(base+"/produto/quadrado");await contained(page);
  expect(errors).toEqual([]);expect(mutations).toEqual([]);
  await writeFile(path.join(evidence,`${model}-metrics.json`),JSON.stringify({model,metrics,pageErrors:errors,commercialMutations:mutations},null,2));
 });
}

test("24 fotos: miniaturas sob demanda, imagem estável e navegação em dispositivo touch",async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
 const requested=new Set<string>();page.on("request",req=>{if(req.url().includes("/photos/album-"))requested.add(req.url());});
 await page.goto("/s/media-nexus/produto/album");const gallery=page.locator('[data-product-gallery="detail"]');await expect(gallery.locator(".sp-counter")).toHaveText("1 / 24");
 await expect.poll(()=>requested.size).toBeGreaterThan(0);await expect(gallery.locator(".sp-thumbnails img[src]")).not.toHaveCount(24);expect(requested.size).toBeLessThan(16);
 const height=await gallery.locator(".sp-stage").evaluate(el=>el.clientHeight);
 await swipe(page,gallery,"left");await expect(gallery.locator(".sp-counter")).toHaveText("2 / 24");expect(await gallery.locator(".sp-stage").evaluate(el=>el.clientHeight)).toBe(height);
 await gallery.locator(".sp-thumbnails").evaluate(el=>{el.scrollLeft=el.scrollWidth;});await expect(gallery.getByRole("button",{name:"Ver foto 24",exact:true}).locator("img")).toHaveAttribute("src",/album-23/);
 await gallery.getByRole("button",{name:"Ver foto 24",exact:true}).click();await expect(gallery.locator(".sp-counter")).toHaveText("24 / 24");await gallery.getByRole("button",{name:"Próxima foto",exact:true}).click();await expect(gallery.locator(".sp-counter")).toHaveText("1 / 24");
 await contained(page);await context.close();
});
