import {test,expect,type BrowserContext,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";

/**
 * Vorix Commerce, Fases 1 e 2 — QA em navegador real com o servidor de fixture (`--site-commerce`):
 * banco efêmero, dados .invalid, pagamento em modo de teste e WhatsApp simulado pelo endpoint de
 * fixture (mesmo código de conversão do worker).
 */
const api="http://127.0.0.1:3390";
const evidence=path.resolve(process.cwd(),"../tmp/site-commerce-browser/evidence");
type Scope={fixtureOnly:boolean;siteCommerceFixture?:boolean;email:string;password:string;workspaceId:string;slug:string};
let scope:Scope;
const VIEWPORTS=[{name:"360",width:360,height:780},{name:"390",width:390,height:844},{name:"430",width:430,height:932},{name:"768",width:768,height:1024},{name:"1024",width:1024,height:768},{name:"1440",width:1440,height:900}];
test.beforeAll(async({request})=>{scope=await(await request.get(api+"/fixture-only/scope")).json();expect(scope.fixtureOnly).toBe(true);expect(scope.siteCommerceFixture).toBe(true);await mkdir(evidence,{recursive:true});});
test.beforeEach(async({context})=>{
 await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//,route=>route.fulfill({status:200,contentType:"text/html",body:"<title>WhatsApp (simulado)</title>"}));
 // Endereço sugerido pelo CEP: resposta controlada (sem rede externa no teste).
 await context.route(/^https:\/\/viacep\.com\.br\//,route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({logradouro:"Avenida Paulista",bairro:"Bela Vista",localidade:"São Paulo",uf:"SP"})}));
});
const noHorizontalScroll=async(page:Page)=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
async function chooseVariant(page:Page){await page.getByLabel("Tamanho",{exact:true}).selectOption("M");await page.getByLabel("Cor",{exact:true}).selectOption("Preto");}
async function whatsappText(context:BrowserContext,trigger:()=>Promise<unknown>){
 const [request]=await Promise.all([context.waitForEvent("request",{predicate:item=>/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(item.url()),timeout:20000}),trigger()]);
 return decodeURIComponent(new URL(request.url()).searchParams.get("text")??"").replace(/\+/g," ");
}
/** Auditoria básica (mesmo critério de scripts/sites/audit-template-accessibility.mjs): rótulos, nomes acessíveis e alt. */
async function a11y(page:Page,root:string){
 const result=await page.evaluate(selector=>{
  const scope=[...document.querySelectorAll(selector)];const all=(query:string)=>scope.flatMap(node=>[...node.querySelectorAll(query)]).filter(e=>(e as HTMLElement).getClientRects().length);
  const named=(e:Element)=>e.getAttribute("aria-label")||e.getAttribute("aria-labelledby")||e.textContent?.trim()||e.getAttribute("title")||e.querySelector("img")?.getAttribute("alt");
  return {inputs:all("input:not([type=hidden]):not([tabindex='-1']),textarea,select").filter(e=>!e.getAttribute("aria-label")&&!(e as HTMLInputElement).labels?.length&&!e.closest("label")).map(e=>e.outerHTML.slice(0,120)),
   controls:all("button,a[href]").filter(e=>!named(e)).map(e=>e.outerHTML.slice(0,120)),images:all("img").filter(e=>!e.hasAttribute("alt")).map(e=>e.outerHTML.slice(0,120))};
 },root);
 expect(result,`acessibilidade em ${root}`).toEqual({inputs:[],controls:[],images:[]});
}
async function login(page:Page){await page.goto("/login");await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:/Entrar/}).click();await page.waitForURL(/workspaces/);}

test("Fase 2 — produto com variação: Comprar agora e checkout confortáveis de 360 a 1440px",async({page})=>{
 for(const viewport of VIEWPORTS){
  await page.setViewportSize(viewport);
  await page.goto(`/s/${scope.slug}/produto/camiseta-fixture?utm_source=instagram&utm_campaign=verao`);
  await expect(page.getByRole("heading",{name:"Camiseta de fixture",level:1})).toBeVisible();
  await expect(page.getByText(/Escolha tamanho e cor para continuar/)).toBeVisible();
  await chooseVariant(page);
  const buy=page.getByRole("button",{name:"Comprar agora"}).first();
  await expect(buy).toBeEnabled();expect((await buy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await noHorizontalScroll(page);
  await page.screenshot({path:path.join(evidence,`produto-${viewport.name}.png`)});
  if(viewport.width<=700){await page.locator("footer.ts-footer").scrollIntoViewIfNeeded();await expect(page.locator(".sc-sticky-cta.is-visible")).toBeVisible();await page.screenshot({path:path.join(evidence,`produto-cta-fixo-${viewport.name}.png`)});}
  await buy.click();
  await page.waitForURL(/\/checkout$/);
  await expect(page.getByRole("heading",{name:"Finalizar compra"})).toBeVisible();
  await expect(page.getByText("Loja em modo de teste: nenhum valor será cobrado.")).toBeVisible();
  await expect(page.getByLabel("Resumo do pedido").getByText("Camiseta de fixture")).toBeVisible();
  await page.getByLabel("CEP para calcular o frete").fill("01310100");
  await expect(page.getByRole("radio",{name:/Expresso capital/})).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({path:path.join(evidence,`checkout-${viewport.name}.png`),fullPage:true});
  if(viewport.width===390)await a11y(page,".ck");
  // Esvazia para a próxima largura.
  await page.goto(`/s/${scope.slug}`);await page.getByRole("button",{name:/Abrir carrinho/}).click();
  const drawer=page.getByRole("dialog",{name:"Seu carrinho"});
  await drawer.getByRole("button",{name:"Remover Camiseta de fixture"}).click();await expect(drawer.getByText("Seu carrinho está vazio.")).toBeVisible();await page.keyboard.press("Escape");
 }
});

test("Fase 2 E2E — visitante compra: CEP, entrega, pagamento de teste, pedido, estoque reservado → vendido, cancelamento devolve",async({page,request,context})=>{
 const variant=await(await request.get(`${api}/fixture-only/variant?size=M&color=Preto`)).json();
 const before=await(await request.get(`${api}/fixture-only/stock/${variant.id}`)).json();
 await page.setViewportSize({width:390,height:844});
 await page.goto(`/s/${scope.slug}/produto/camiseta-fixture?utm_source=google&utm_campaign=busca`);
 await chooseVariant(page);await page.getByRole("button",{name:"Aumentar quantidade"}).first().click();
 await page.getByRole("button",{name:"Comprar agora"}).first().click();await page.waitForURL(/\/checkout$/);
 // Erros claros sem dados.
 await page.locator(".ck-sticky").getByRole("button",{name:"Finalizar compra"}).click();
 await expect(page.getByText("Revise os campos destacados.")).toBeVisible();
 await page.getByLabel("Nome completo").fill("Comprador de Fixture");
 await page.getByLabel("E-mail").fill("comprador@fixture.invalid");
 await page.getByLabel("Celular (WhatsApp)").fill("(11) 98888-0000");
 await page.getByLabel("CEP para calcular o frete").fill("01310100");
 await page.getByRole("radio",{name:/Expresso capital/}).check();
 await expect(page.getByLabel("Rua",{exact:true})).toHaveValue("Avenida Paulista");
 await page.getByLabel("Número").fill("1000");
 const summary=page.getByLabel("Resumo do pedido");
 await expect(summary.getByText("R$ 29,90")).toBeVisible();await expect(summary.locator(".ck-total").getByText("R$ 229,90")).toBeVisible();
 await page.screenshot({path:path.join(evidence,"checkout-preenchido-390.png"),fullPage:true});
 await page.locator(".ck-sticky").getByRole("button",{name:"Finalizar compra"}).click();
 await page.waitForURL(/\/pedido\//);
 await expect(page.getByText("Pedido de teste: nenhum valor será cobrado.")).toBeVisible();
 await expect(page.getByRole("status")).toContainText("Aguardando pagamento");
 const orderUrl=page.url();const number=(await page.locator(".ck-eyebrow").textContent())!.replace(/\D/g,"");
 await page.screenshot({path:path.join(evidence,"pedido-aguardando-390.png"),fullPage:true});await a11y(page,".ck");
 expect(await(await request.get(`${api}/fixture-only/stock/${variant.id}`)).json()).toEqual({stock:before.stock,reserved:before.reserved+2});
 // Lojista: Central de pedidos → simula a aprovação do provedor.
 const admin=await context.newPage();await admin.setViewportSize({width:1440,height:900});await login(admin);
 await admin.goto(`/workspaces/${scope.workspaceId}/site/pedidos`);
 await admin.getByRole("button",{name:`#${number}`}).click();
 const modal=admin.getByRole("dialog",{name:new RegExp(`Pedido #${number}`)});
 await expect(modal.getByText("Comprador de Fixture").first()).toBeVisible();
 await admin.screenshot({path:path.join(evidence,"admin-pedido-1440.png")});await a11y(admin,"[role=dialog]");
 await modal.getByRole("button",{name:"Simular pagamento aprovado"}).click();
 await expect(admin.getByText("Pagamento de teste aprovado.")).toBeVisible();
 expect(await(await request.get(`${api}/fixture-only/stock/${variant.id}`)).json()).toEqual({stock:before.stock-2,reserved:before.reserved});
 await page.goto(orderUrl);await expect(page.getByRole("heading",{name:/Pagamento confirmado/})).toBeVisible();
 await page.screenshot({path:path.join(evidence,"pedido-pago-390.png"),fullPage:true});
 await modal.getByRole("button",{name:"Histórico"}).click();await expect(modal.getByText("Pagamento aprovado")).toBeVisible();
 await modal.getByRole("button",{name:"Cancelar pedido"}).click();
 await admin.getByRole("alertdialog").getByRole("button",{name:"Cancelar pedido"}).click();
 await expect(admin.getByText("Pedido cancelado.")).toBeVisible();
 expect(await(await request.get(`${api}/fixture-only/stock/${variant.id}`)).json()).toEqual(before);
 await admin.setViewportSize({width:390,height:844});await admin.goto(`/workspaces/${scope.workspaceId}/site/pedidos`);
 await expect(admin.getByRole("button",{name:new RegExp(`#${number}`)})).toBeVisible();await noHorizontalScroll(admin);
 await admin.screenshot({path:path.join(evidence,"admin-pedidos-390.png"),fullPage:true});
});

test("Fase 1 no modo híbrido: carrinho do WhatsApp → oportunidade com itens, sem duplicar; clique sem mensagem não cria nada",async({page,request})=>{
 await page.setViewportSize({width:390,height:844});
 const before=await(await request.get(api+"/fixture-only/crm-counts")).json();
 await page.goto(`/s/${scope.slug}/produto/pulverizador-fixture?utm_source=google&utm_medium=cpc&utm_campaign=busca`);
 await page.getByRole("button",{name:"Aumentar quantidade"}).first().click();
 await page.getByRole("button",{name:"Adicionar ao carrinho"}).first().click();
 const drawer=page.getByRole("dialog",{name:"Seu carrinho"});await expect(drawer).toBeVisible();
 const text=await whatsappText(page.context(),()=>drawer.getByRole("button",{name:"Finalizar pelo WhatsApp"}).click());
 expect(text).toMatch(/2x Pulverizador de fixture/);
 const reference=/Ref: (VX-[A-Z0-9]{6})/.exec(text)?.[1];expect(reference).toBeTruthy();
 const afterClick=await(await request.get(api+"/fixture-only/crm-counts")).json();
 expect(afterClick.deals).toBe(before.deals);expect(afterClick.intents).toBe(before.intents+1);
 const inbound=await(await request.post(api+"/fixture-only/whatsapp-inbound",{data:{body:text}})).json();
 expect(inbound.result.status).toBe("converted");expect(inbound.deal.origin).toBe("site");
 expect(inbound.items.map((item:{name:string;quantity:number})=>`${item.quantity}x ${item.name}`)).toEqual(["2x Pulverizador de fixture"]);
 const again=await(await request.post(api+"/fixture-only/whatsapp-inbound",{data:{body:`Oi, ${reference}`}})).json();
 expect(again.result.status).toBe("already_converted");expect(again.counts.deals).toBe(inbound.counts.deals);
});

test("veículo continua em conversa no modo híbrido (sem compra online) e passa pela referência",async({page,request})=>{
 await page.setViewportSize({width:360,height:780});
 await page.goto(`/s/${scope.slug}/produto/suv-fixture`);
 await expect(page.getByRole("button",{name:/Comprar agora|Adicionar ao carrinho/})).toHaveCount(0);
 const talk=page.getByRole("button",{name:"Falar no WhatsApp"}).first();await expect(talk).toBeVisible();
 const text=await whatsappText(page.context(),()=>talk.click());
 expect(text).toMatch(/Tenho interesse em SUV de fixture/);
 const inbound=await(await request.post(api+"/fixture-only/whatsapp-inbound",{data:{body:text,phone:"+5511912340000"}})).json();
 expect(inbound.result.status).toBe("converted");
});

test("admin: como vender + compra pelo site prontos, em perguntas simples",async({page})=>{
 await login(page);
 for(const viewport of [{name:"390",width:390,height:844},{name:"1440",width:1440,height:900}]){
  await page.setViewportSize(viewport);
  await page.goto(`/workspaces/${scope.workspaceId}/site?section=loja`);
  await expect(page.getByRole("heading",{name:"Como você quer vender pelo seu site?"})).toBeVisible();
  await expect(page.getByLabel(/Configurar individualmente por produto/)).toBeChecked();
  await expect(page.getByLabel(/Vender diretamente pelo site/)).toBeEnabled();
  await expect(page.getByRole("heading",{name:"Compra pelo site"})).toBeVisible();
  await expect(page.getByText("Pronta para vender online.")).toBeVisible();
  await expect(page.getByText(/HYBRID|ONLINE_CHECKOUT|SANDBOX/)).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.screenshot({path:path.join(evidence,`admin-como-vender-${viewport.name}.png`),fullPage:true});
 }
});

test("Conversas → Produtos: busca, variação, foto e preço, envio ao cliente com link e oportunidade",async({page,request})=>{
 await request.post(api+"/fixture-only/whatsapp-inbound",{data:{body:"Oi, vocês têm camiseta preta?",phone:"+5511977770000"}});
 await login(page);
 for(const viewport of [{name:"1440",width:1440,height:900},{name:"390",width:390,height:844}]){
  await page.setViewportSize(viewport);
  await page.goto(`/workspaces/${scope.workspaceId}/conversas`);
  await page.getByText("Cliente de fixture").first().click();
  await page.getByRole("button",{name:"Produtos",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Produtos"});
  await dialog.getByLabel("Buscar por nome, SKU ou categoria").fill("camiseta");
  await expect(dialog.getByRole("button",{name:/Camiseta de fixture/})).toBeVisible();
  await page.screenshot({path:path.join(evidence,`conversa-produtos-busca-${viewport.name}.png`)});
  await dialog.getByRole("button",{name:/Camiseta de fixture/}).click();
  await expect(dialog.locator("img").first()).toBeVisible();
  await expect(dialog.getByText("R$ 100,00")).toBeVisible();
  await expect(dialog.getByText("O link do produto no site vai junto.")).toBeVisible();
  await dialog.getByRole("button",{name:"M / Preto",exact:true}).click();
  await noHorizontalScroll(page);
  await page.screenshot({path:path.join(evidence,`conversa-produtos-selecao-${viewport.name}.png`)});await a11y(page,"[role=dialog]");
  if(viewport.width===1440){
   await dialog.getByRole("button",{name:"Enviar ao cliente"}).click();
   await expect(page.getByText("Produto enviado ao cliente.")).toBeVisible();
   await expect(page.getByText(/Veja mais: .*\/produto\/camiseta-fixture/).first()).toBeVisible();
   await page.screenshot({path:path.join(evidence,`conversa-produto-enviado-${viewport.name}.png`)});
   await page.getByRole("button",{name:"Produtos",exact:true}).click();
   await dialog.getByRole("button",{name:/Pulverizador de fixture/}).click();
   await dialog.getByRole("button",{name:/Adicionar à oportunidade/}).click();
   const confirm=page.getByRole("alertdialog");
   await expect(confirm.or(page.getByText(/Produto adicionado em/))).toBeVisible();
   if(await confirm.isVisible())await confirm.getByRole("button",{name:"Criar oportunidade"}).click();
   await expect(page.getByText(/Oportunidade criada com o produto|Produto adicionado em/)).toBeVisible();
   await page.screenshot({path:path.join(evidence,`conversa-produto-oportunidade-${viewport.name}.png`)});
  }
  await page.keyboard.press("Escape");
 }
});
