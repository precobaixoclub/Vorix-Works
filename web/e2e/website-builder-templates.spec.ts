import {test,expect,type Page} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import path from "node:path";
import type {SiteSnapshot} from "../features/sites/types";
const api="http://127.0.0.1:3390",evidence=path.resolve("../tmp/website-builder/evidence");
let scope:{fixtureOnly:boolean;siteBuilderFixture:boolean;initialSiteSnapshot:SiteSnapshot;email:string;password:string;workspaceId:string;siteId:string;slug:string;productId:string};
let token:string;
test.beforeAll(async({request})=>{
 scope=await(await request.get(api+"/fixture-only/scope")).json();expect(scope.fixtureOnly&&scope.siteBuilderFixture).toBe(true);expect(scope.email).toMatch(/\.invalid$/);
 token=(await(await request.post(api+"/v1/auth/login",{data:{email:scope.email,password:scope.password}})).json()).data.accessToken;
 await mkdir(evidence,{recursive:true});
 for(const route of[`/s/${scope.slug}`,`/workspaces/${scope.workspaceId}/site`,`/modelos/nexus`])expect((await request.get("http://127.0.0.1:3391"+route)).ok()).toBe(true);
});
test.beforeEach(async({request})=>{
 const headers={authorization:`Bearer ${token}`},url=`${api}/v1/sites/${scope.siteId}?workspaceId=${scope.workspaceId}`;
 const site=(await(await request.get(url,{headers})).json()).data;
 const saved=await request.put(url,{headers,data:{revision:site.revision,draft:scope.initialSiteSnapshot}});expect(saved.ok()).toBe(true);
 expect((await request.post(`${api}/v1/sites/${scope.siteId}/publish?workspaceId=${scope.workspaceId}`,{headers,data:{revision:(await saved.json()).data.revision}})).ok()).toBe(true);
});
async function login(page:Page,section="modelos"){
 await page.goto("/login");await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);await page.goto(`/workspaces/${scope.workspaceId}/site?section=${section}`);await expect(page.getByRole("heading",{name:"Meu site",exact:true})).toBeVisible();
}
async function section(page:Page,name:string){await page.getByRole("navigation",{name:"Navegação da seção"}).getByRole("button",{name,exact:true}).click();}
async function save(page:Page){await page.getByRole("button",{name:"Salvar rascunho",exact:true}).click();await expect(page.getByText("Alterações não publicadas",{exact:true})).toBeVisible();}
async function imagesReady(page:Page){await page.evaluate(async()=>{await Promise.race([document.fonts.ready,new Promise(ok=>setTimeout(ok,3000))]);for(let y=0;y<document.documentElement.scrollHeight;y+=innerHeight){scrollTo(0,y);await new Promise(ok=>setTimeout(ok,45));}const images=[...document.images].filter(image=>image.getClientRects().length>0);for(const image of images)image.loading="eager";await Promise.race([Promise.all(images.map(image=>image.decode().catch(()=>{}))),new Promise(ok=>setTimeout(ok,5000))]);scrollTo(0,0);});const missing=await page.locator(".tenant-site img").evaluateAll(images=>images.filter(image=>image.getClientRects().length>0&&!(image as HTMLImageElement).naturalWidth).map(image=>(image as HTMLImageElement).src));expect(missing).toEqual([]);}
async function proof(page:Page,name:string){await imagesReady(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(evidence,`${name}.png`),fullPage:true});}
async function useModel(page:Page,id:string){await section(page,"Modelos");await page.getByTestId(`template-card-${id}`).getByRole("button",{name:"Usar este modelo",exact:true}).click();const confirm=page.getByRole("alertdialog");await expect(confirm).toContainText("Seu conteúdo será mantido");await confirm.getByRole("button",{name:"Publicar este modelo",exact:true}).click();await expect(confirm).toHaveCount(0);}

test("demonstrações premium: oito larguras, categorias, produto e evidências reais",async({page},info)=>{
 test.skip(info.project.name!=="desktop","A mesma rodada já percorre todos os breakpoints.");test.setTimeout(180000);
 const metrics:unknown[]=[];const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 for(const id of["nexus","aura","pulse"]){
  await page.goto(`/modelos/${id}`);await expect(page.getByTestId("template-demo-notice")).toContainText("fictícios");
  for(const width of[320,360,375,390,430,768,1024,1440]){
   await page.setViewportSize({width,height:width>=768?1000:844});await expect(page.locator(`.${id}-hero`)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   if([390,768,1440].includes(width)){await imagesReady(page);await page.locator(".tenant-site").screenshot({path:path.join(evidence,`${id}-${width===390?"mobile":width===768?"tablet":"desktop"}.png`)});if(width!==768)await page.screenshot({path:path.join(evidence,`${id}-hero-${width===390?"mobile":"desktop"}.png`)});}
   metrics.push({template:id,width,overflow:false});
  }
  await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:"Abrir menu",exact:true}).click();await expect(page.getByRole("navigation",{name:"Menu do celular"})).toBeVisible();await page.getByRole("navigation",{name:"Menu do celular"}).getByRole("link",{name:"Nossa história",exact:true}).click();await expect(page.getByRole("heading",{name:"Uma nova maneira de escolher.",exact:true})).toBeVisible();
  await page.goto(`/modelos/${id}/categoria/estilo`);await expect(page.getByRole("heading",{name:"Estilo",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Headphone Orbit",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Bolsa Arco",exact:true})).toBeVisible();
  await page.getByRole("link").filter({has:page.getByRole("heading",{name:"Bolsa Arco",exact:true})}).click();await expect(page.getByRole("heading",{name:"Bolsa Arco",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Envio desabilitado na prévia",exact:true})).toBeDisabled();await proof(page,`${id}-product-mobile`);
  await page.setViewportSize({width:1440,height:1000});await proof(page,`${id}-product`);
  await page.emulateMedia({reducedMotion:"reduce"});await expect(page.locator(".premium-product-image img").first()).toHaveCSS("transition-duration","0s");await page.emulateMedia({reducedMotion:"no-preference"});
 }
 expect(errors).toEqual([]);await writeFile(path.join(evidence,"responsive-metrics.json"),JSON.stringify({metrics,pageErrors:errors},null,2));
 await promisify(execFile)(process.execPath,[path.resolve("../scripts/sites/build-template-thumbnails.mjs")]);
});

test("galeria abre demos e dados próprios sem alterar rascunho ou publicação",async({page,request},info)=>{
 await login(page);const headers={authorization:`Bearer ${token}`},endpoint=`${api}/v1/sites/${scope.siteId}?workspaceId=${scope.workspaceId}`;
 const before=(await(await request.get(endpoint,{headers})).json()).data;
 await expect(page.getByTestId("template-gallery")).toBeVisible();for(const id of["nexus","aura","pulse"]){const card=page.getByTestId(`template-card-${id}`);await card.scrollIntoViewIfNeeded();await expect(card.getByRole("img")).toBeVisible();await expect.poll(()=>card.getByRole("img").evaluate(element=>(element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);}
 await proof(page,`${info.project.name}-gallery`);
 await page.getByTestId("template-card-aura").getByRole("button",{name:"Ver demonstração",exact:true}).click();let dialog=page.getByRole("dialog");const frame=dialog.frameLocator("iframe");await expect(frame.getByRole("link",{name:"aura. — início",exact:true})).toBeVisible();await expect(frame.getByRole("heading",{name:"Camiseta de fixture",exact:true})).toHaveCount(0);await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
 await page.getByTestId("template-card-nexus").getByRole("button",{name:"Visualizar com meus dados",exact:true}).click();dialog=page.getByRole("dialog");await expect(dialog.frameLocator("iframe").getByRole("heading",{name:"Camiseta de fixture",exact:true})).toBeVisible();await dialog.getByRole("button",{name:"Prévia em tablet",exact:true}).click();await expect(dialog.locator("iframe")).toHaveCSS("width","768px");await proof(page,`${info.project.name}-customer-preview`);await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
 const after=(await(await request.get(endpoint,{headers})).json()).data;expect(after.revision).toBe(before.revision);expect(after.published).toEqual(before.published);
});

test("configurar os três modelos, publicar Aura e retornar a Nexus preserva tudo",async({page,request},info)=>{
 test.setTimeout(120000);await login(page);const original=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;const productIds=original.products.map((p:{id:string})=>p.id).sort();
 await page.getByTestId("template-card-nexus").getByRole("button",{name:"Personalizar Nexus",exact:true}).click();await page.getByLabel("Cor principal",{exact:true}).fill("#88CCAA");await page.getByLabel("Composição do banner",{exact:true}).selectOption("compact");await section(page,"Seções da página inicial");await page.getByRole("button",{name:"Mover seção para baixo",exact:true}).click();const firstRow=await page.getByTestId("site-section-row").first().textContent();await save(page);
 for(const [id,name,color] of[["aura","Aura","#9B6C4A"],["pulse","Pulse","#DDDD44"]]){await section(page,"Modelos");await page.getByTestId(`template-card-${id}`).getByRole("button",{name:`Personalizar ${name}`,exact:true}).click();await page.getByLabel("Cor principal",{exact:true}).fill(color);await save(page);}
 expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.theme.template).toBe(original.theme.template);
 await useModel(page,"aura");expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.theme.template).toBe("aura");
 await page.getByTestId("template-card-nexus").getByRole("button",{name:"Personalizar Nexus",exact:true}).click();await expect(page.getByLabel("Cor principal",{exact:true})).toHaveValue("#88CCAA");await expect(page.getByLabel("Composição do banner",{exact:true})).toHaveValue("compact");await section(page,"Seções da página inicial");await expect(page.getByTestId("site-section-row").first()).toHaveText(firstRow!);await save(page);
 await useModel(page,"nexus");const current=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;expect(current.products.map((p:{id:string})=>p.id).sort()).toEqual(productIds);expect(current.content.seo).toEqual(original.content.seo);expect(current.theme.primary).toBe("#88CCAA");expect(current.templateConfigs).toBeUndefined();await page.reload();await expect(page.getByTestId("template-card-nexus")).toContainText("Em uso");await proof(page,`${info.project.name}-template-switch`);
 await page.getByTestId("template-card-pulse").getByRole("button",{name:"Personalizar Pulse",exact:true}).click();await expect(page.getByLabel("Cor principal",{exact:true})).toHaveValue("#DDDD44");await proof(page,`${info.project.name}-editor`);
});

test("catálogo é fonte única; SEO, URLs e recuperação permanecem consistentes",async({page,request},info)=>{
 test.setTimeout(120000);const headers={authorization:`Bearer ${token}`},productUrl=`${api}/v1/products/${scope.productId}`;
 const original=(await(await request.get(`${productUrl}?workspaceId=${scope.workspaceId}`,{headers})).json()).data;
 try{
  const updated=await request.patch(productUrl,{headers,data:{workspaceId:scope.workspaceId,name:"Produto atualizado na fonte",priceCents:14900}});expect(updated.ok()).toBe(true);
  await login(page);
  for(const id of["nexus","aura","pulse"]){await useModel(page,id);const publicSite=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;expect(publicSite.products.find((p:{id:string})=>p.id===scope.productId).name).toBe("Produto atualizado na fonte");const visitor=await page.context().newPage();await visitor.goto(`/s/${scope.slug}/produto/camiseta-fixture`);await expect(visitor.getByRole("heading",{name:"Produto atualizado na fonte",exact:true})).toBeVisible();await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute("href",`https://vorixworks.com/s/${scope.slug}/produto/camiseta-fixture`);expect(await visitor.locator('script[type="application/ld+json"]').first().textContent()).toContain("149");await visitor.close();}
  const sitemap=await request.get(`http://127.0.0.1:3391/s/${scope.slug}/sitemap.xml`);expect(sitemap.ok()).toBe(true);expect(await sitemap.text()).toContain("camiseta-fixture");expect(await sitemap.text()).not.toContain("PRODUTO PRIVADO");const robots=await request.get(`http://127.0.0.1:3391/s/${scope.slug}/robots.txt`);expect(await robots.text()).toContain("sitemap.xml");
  await section(page,"Cores, fontes e composição");await page.getByRole("button",{name:"Recuperar publicação anterior",exact:true}).click();await page.getByRole("alertdialog").getByRole("button",{name:"Recuperar como rascunho",exact:true}).click();await expect(page.getByText("Você tem alterações não salvas",{exact:true})).toBeVisible();const published=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;expect(published.theme.template).toBe("pulse");await proof(page,`${info.project.name}-recovery-draft`);
 }finally{expect((await request.patch(productUrl,{headers,data:{workspaceId:scope.workspaceId,name:original.name,priceCents:original.priceCents}})).ok()).toBe(true);}
});
