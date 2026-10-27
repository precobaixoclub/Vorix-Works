import {test,expect,type BrowserContext,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";

/**
 * Vorix Commerce, Fase 1 — QA em navegador real com o servidor de fixture (`--site-commerce`):
 * banco efêmero, dados .invalid, WhatsApp simulado pelo endpoint de fixture (mesmo código de conversão).
 */
const api="http://127.0.0.1:3390";
const evidence=path.resolve(process.cwd(),"../tmp/site-commerce-browser/evidence");
type Scope={fixtureOnly:boolean;siteCommerceFixture?:boolean;email:string;password:string;workspaceId:string;slug:string};
let scope:Scope;
const VIEWPORTS=[{name:"360",width:360,height:780},{name:"390",width:390,height:844},{name:"430",width:430,height:932},{name:"768",width:768,height:1024},{name:"1024",width:1024,height:768},{name:"1440",width:1440,height:900}];
test.beforeAll(async({request})=>{scope=await(await request.get(api+"/fixture-only/scope")).json();expect(scope.fixtureOnly).toBe(true);expect(scope.siteCommerceFixture).toBe(true);await mkdir(evidence,{recursive:true});});
test.beforeEach(async({context})=>{await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//,route=>route.fulfill({status:200,contentType:"text/html",body:"<title>WhatsApp (simulado)</title><p>WhatsApp simulado</p>"}));});
const noHorizontalScroll=async(page:Page)=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
/** Captura o destino do WhatsApp (o /i/:ref redireciona para wa.me) sem depender da página externa carregar. */
async function whatsappText(context:BrowserContext,trigger:()=>Promise<unknown>){
 const [request]=await Promise.all([context.waitForEvent("request",{predicate:item=>/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(item.url()),timeout:20000}),trigger()]);
 return decodeURIComponent(new URL(request.url()).searchParams.get("text")??"").replace(/\+/g," ");
}
async function chooseVariant(page:Page){await page.getByLabel("Tamanho",{exact:true}).selectOption("M");await page.getByLabel("Cor",{exact:true}).selectOption("Preto");}

test("carrinho com variação é confortável em 360–1440px: CTA, CTA fixo no celular, gaveta acessível e sem rolagem lateral",async({page})=>{
 for(const viewport of VIEWPORTS){
  await page.setViewportSize(viewport);
  await page.goto(`/s/${scope.slug}/produto/camiseta-fixture?utm_source=instagram&utm_campaign=verao`);
  await expect(page.getByRole("heading",{name:"Camiseta de fixture",level:1})).toBeVisible();
  await expect(page.getByText(/Escolha tamanho e cor para continuar/)).toBeVisible();
  await expect(page.getByRole("button",{name:/Adicionar ao carrinho/})).toHaveCount(0);
  await chooseVariant(page);
  const add=page.getByRole("button",{name:"Adicionar ao carrinho"}).first();
  await expect(add).toBeEnabled();
  const box=await add.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
  await noHorizontalScroll(page);
  await page.screenshot({path:path.join(evidence,`produto-${viewport.name}.png`),fullPage:false});
  if(viewport.width<=700){
   // Rolar até a descrição: o CTA fixo aparece e continua a um toque.
   await page.locator("footer.ts-footer").scrollIntoViewIfNeeded();
   await expect(page.locator(".sc-sticky-cta.is-visible")).toBeVisible();
   await page.screenshot({path:path.join(evidence,`produto-cta-fixo-${viewport.name}.png`)});
   await page.locator(".sc-sticky-cta.is-visible").getByRole("button",{name:"Adicionar ao carrinho"}).click();
  }else await add.click();
  const drawer=page.getByRole("dialog",{name:"Seu carrinho"});
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Tamanho: M, Cor: Preto")).toBeVisible();
  await expect(drawer.getByRole("button",{name:"Finalizar pelo WhatsApp"})).toBeVisible();
  const drawerBox=await drawer.boundingBox();expect(drawerBox!.width).toBeLessThanOrEqual(viewport.width+1);
  await noHorizontalScroll(page);
  await page.screenshot({path:path.join(evidence,`carrinho-${viewport.name}.png`)});
  // Teclado: Esc fecha e devolve o foco; o carrinho persiste ao trocar de página.
  await page.keyboard.press("Escape");await expect(drawer).toBeHidden();
  await page.goto(`/s/${scope.slug}`);
  await expect(page.getByRole("button",{name:/Abrir carrinho, \d+ ite/})).toBeVisible();
  await page.getByRole("button",{name:/Abrir carrinho/}).click();
  await drawer.getByRole("button",{name:"Remover Camiseta de fixture"}).click();
  await expect(drawer.getByText("Seu carrinho está vazio.")).toBeVisible();
  await page.keyboard.press("Escape");
 }
});

test("E2E carrinho → WhatsApp → oportunidade com os itens, sem duplicar; clique sem mensagem não cria nada",async({page,request})=>{
 await page.setViewportSize({width:390,height:844});
 const before=await(await request.get(api+"/fixture-only/crm-counts")).json();
 await page.goto(`/s/${scope.slug}/produto/pulverizador-fixture?utm_source=google&utm_medium=cpc&utm_campaign=busca`);
 await page.getByRole("button",{name:"Aumentar quantidade"}).first().click();
 await page.getByRole("button",{name:"Adicionar ao carrinho"}).first().click();
 const drawer=page.getByRole("dialog",{name:"Seu carrinho"});await expect(drawer).toBeVisible();
 await page.keyboard.press("Escape");
 await page.goto(`/s/${scope.slug}/produto/camiseta-fixture`);await chooseVariant(page);
 await page.getByRole("button",{name:"Adicionar ao carrinho"}).first().click();
 await expect(drawer.getByRole("listitem")).toHaveCount(2);
 await expect(drawer.getByText(/Total estimado/)).toBeVisible();
 const text=await whatsappText(page.context(),()=>drawer.getByRole("button",{name:"Finalizar pelo WhatsApp"}).click());
 expect(text).toMatch(/2x Pulverizador de fixture/);expect(text).toMatch(/1x Camiseta de fixture \(Tamanho: M, Cor: Preto\)/);
 const reference=/Ref: (VX-[A-Z0-9]{6})/.exec(text)?.[1];expect(reference).toBeTruthy();
 // Só o clique: nada de contato/oportunidade ainda (E2E 53).
 const afterClick=await(await request.get(api+"/fixture-only/crm-counts")).json();
 expect(afterClick.deals).toBe(before.deals);expect(afterClick.contacts).toBe(before.contacts);expect(afterClick.intents).toBe(before.intents+1);
 // O cliente manda a mensagem pronta: vira contato, atendimento e oportunidade com os dois itens.
 const inbound=await(await request.post(api+"/fixture-only/whatsapp-inbound",{data:{body:text}})).json();
 expect(inbound.result.status).toBe("converted");expect(inbound.deal.origin).toBe("site");
 expect(inbound.items.map((item:{name:string;quantity:number})=>`${item.quantity}x ${item.name}`).sort()).toEqual(["1x Camiseta de fixture — Tamanho: M / Cor: Preto","2x Pulverizador de fixture"]);
 const again=await(await request.post(api+"/fixture-only/whatsapp-inbound",{data:{body:`Oi, ${reference}`}})).json();
 expect(again.result.status).toBe("already_converted");expect(again.counts.deals).toBe(inbound.counts.deals);
 // Depois de finalizar, o carrinho do visitante recomeça vazio.
 await page.goto(`/s/${scope.slug}`);await expect(page.getByRole("button",{name:/Abrir carrinho/})).toHaveCount(0);
});

test("veículo vai para conversa (sem carrinho) e o WhatsApp de produto passa pela referência",async({page,request})=>{
 await page.setViewportSize({width:360,height:780});
 await page.goto(`/s/${scope.slug}/produto/suv-fixture`);
 await expect(page.getByRole("button",{name:/Adicionar ao carrinho/})).toHaveCount(0);
 const talk=page.getByRole("button",{name:"Falar no WhatsApp"}).first();await expect(talk).toBeVisible();
 await page.screenshot({path:path.join(evidence,"veiculo-360.png")});
 const text=await whatsappText(page.context(),()=>talk.click());
 expect(text).toMatch(/Tenho interesse em SUV de fixture/);expect(text).toMatch(/Ref: VX-[A-Z0-9]{6}$/);
 const inbound=await(await request.post(api+"/fixture-only/whatsapp-inbound",{data:{body:text,phone:"+5511912340000"}})).json();
 expect(inbound.result.status).toBe("converted");expect(inbound.items).toEqual([expect.objectContaining({name:"SUV de fixture",quantity:1})]);
});

test("admin: \"Como vender pelo site\" com perguntas simples e checkout ainda em preparação",async({page})=>{
 await page.goto("/login");await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:/Entrar/}).click();
 await page.waitForURL(/workspaces/);
 for(const viewport of [{name:"390",width:390,height:844},{name:"1440",width:1440,height:900}]){
  await page.setViewportSize(viewport);
  await page.goto(`/workspaces/${scope.workspaceId}/site?section=loja`);
  await expect(page.getByRole("heading",{name:"Como você quer vender pelo seu site?"})).toBeVisible();
  await expect(page.getByLabel(/Configurar individualmente por produto/)).toBeChecked();
  await expect(page.getByLabel(/Vender diretamente pelo site/)).toBeDisabled();
  await expect(page.getByText("Para qual equipe os novos clientes devem ir?")).toBeVisible();
  await expect(page.getByText(/HYBRID|WHATSAPP_CART|SHOWCASE/)).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.screenshot({path:path.join(evidence,`admin-como-vender-${viewport.name}.png`),fullPage:true});
 }
 await page.getByLabel(/Receber clientes pelo WhatsApp/).check();
 await page.getByRole("button",{name:"Salvar como vender"}).click();
 await expect(page.getByText("Pronto! Já vale para os visitantes do site.")).toBeVisible();
 await page.getByLabel(/Configurar individualmente por produto/).check();
 await page.getByRole("button",{name:"Salvar como vender"}).click();
});
