import {test,expect,type Page} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import templates from "../features/sites/template-registry.generated.json";
const api="http://127.0.0.1:3390",evidence=path.resolve("../docs/qa/commercial-rules-20261104");
type Scope={fixtureOnly:boolean;commercialRulesFixture:boolean;email:string;password:string;workspaceId:string;siteId:string;slug:string;generalId:string;productId:string;variantId:string;commercialRuleId:string;initialRule:Record<string,unknown>};
let scope:Scope,token:string;
test.beforeAll(async({request})=>{scope=await(await request.get(api+"/fixture-only/scope")).json();expect(scope.fixtureOnly).toBe(true);expect(scope.commercialRulesFixture).toBe(true);expect(scope.email).toMatch(/\.invalid$/);const login=await(await request.post(api+"/v1/auth/login",{data:{email:scope.email,password:scope.password}})).json();token=login.data.accessToken;await mkdir(evidence,{recursive:true});});
const headers=()=>({authorization:`Bearer ${token}`});
const rules=()=>`${api}/v1/sites/${scope.siteId}/commercial-rules?workspaceId=${scope.workspaceId}`;
async function proof(page:Page,name:string){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(name.startsWith("cart-")){await page.getByRole("dialog",{name:"Seu carrinho",exact:true}).screenshot({path:path.join(evidence,name+".png")});}else{await page.screenshot({path:path.join(evidence,name+".png"),fullPage:true});}}
async function login(page:Page){await page.goto("/login");await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);await page.goto(`/workspaces/${scope.workspaceId}/site?section=regras`);await expect(page.getByRole("heading",{name:"Regras Comerciais",exact:true})).toBeVisible();}

test("administração real: listar, criar, editar, ativar, desativar, excluir e validar escopo",async({page,request})=>{
 await page.setViewportSize({width:1440,height:1000});await login(page);const panel=page.getByTestId("commercial-rules-panel");await expect(panel.getByText("Preço progressivo por quantidade",{exact:true})).toBeVisible();await proof(page,"admin-1440");
 await page.setViewportSize({width:390,height:844});await proof(page,"admin-390");await page.setViewportSize({width:1440,height:1000});
 await panel.getByTestId("commercial-rule-row").first().getByRole("button",{name:"Editar",exact:true}).click();const initialDialog=page.getByRole("dialog");await expect(initialDialog.getByLabel("Faixa 2: preço unitário (R$)",{exact:true})).toHaveValue("55");await proof(page,"initial-rule-1440");await page.setViewportSize({width:390,height:844});await proof(page,"initial-rule-390");await initialDialog.getByRole("button",{name:"Cancelar",exact:true}).click();await page.setViewportSize({width:1440,height:1000});
 await panel.getByRole("button",{name:"Criar regra",exact:true}).click();const dialog=page.getByRole("dialog");await dialog.getByLabel("Nome da regra",{exact:true}).fill("Regra de validação");await dialog.getByLabel("Gatilho",{exact:true}).selectOption("SUBTOTAL");await dialog.getByLabel("Subtotal mínimo (R$)",{exact:true}).fill("500");await dialog.getByLabel("Prioridade",{exact:true}).fill("2");await dialog.getByLabel("Fim da validade",{exact:true}).fill("2030-12-31T23:59");
 await proof(page,"form-1440");await page.setViewportSize({width:390,height:844});await proof(page,"form-390");await dialog.getByRole("button",{name:"Salvar regra",exact:true}).click();await expect(dialog).toHaveCount(0);
 let row=panel.getByTestId("commercial-rule-row").filter({hasText:"Regra de validação"});await expect(row.getByText("Inativa",{exact:true})).toBeVisible();await row.getByRole("button",{name:"Ativar Regra de validação",exact:true}).click();await expect(row.getByText("Ativa",{exact:true})).toBeVisible();
 await row.getByRole("button",{name:"Editar",exact:true}).click();await dialog.getByLabel("Nome da regra",{exact:true}).fill("Regra editada");await dialog.getByLabel("Prioridade",{exact:true}).fill("3");await dialog.getByLabel("Aplicar em",{exact:true}).selectOption("CATEGORIES");await dialog.getByRole("group",{name:"Itens elegíveis",exact:true}).getByRole("checkbox",{name:"Vestuário",exact:true}).check();await dialog.getByRole("button",{name:"Salvar regra",exact:true}).click();await expect(dialog).toHaveCount(0);
 row=panel.getByTestId("commercial-rule-row").filter({hasText:"Regra editada"});await expect(row).toContainText("Prioridade 3");await row.getByRole("button",{name:"Desativar Regra editada",exact:true}).click();await expect(row.getByText("Inativa",{exact:true})).toBeVisible();await row.getByRole("button",{name:"Excluir Regra editada",exact:true}).click();await page.getByRole("alertdialog").getByRole("button",{name:"Excluir regra",exact:true}).click();await expect(row).toHaveCount(0);
 expect((await request.get(rules())).status()).toBe(401);
 const invalid=await request.post(rules(),{headers:headers(),data:{definition:{...scope.initialRule,scope:{type:"PRODUCTS",ids:["product-outside-workspace"]}}}});expect(invalid.status()).toBe(400);
});

test("site e carrinho: faixas recalculam todas as unidades e oferecem a próxima faixa",async({page,request})=>{
 const response=await request.put(`${api}/v1/public/sites/${scope.slug}/cart/items`,{data:{productId:scope.generalId,quantity:2}});expect(response.ok()).toBe(true);const cart=(await response.json()).data;
 await page.addInitScript(({slug,token})=>localStorage.setItem(`vx_cart:${slug}`,token),{slug:scope.slug,token:cart.token});
 await page.setViewportSize({width:1440,height:1000});await page.goto(`/s/${scope.slug}`);await expect(page.locator(".sc-quantity-offer").first()).toContainText("55,00");await proof(page,"site-1440");await page.setViewportSize({width:390,height:844});await proof(page,"site-390");
 await page.getByRole("button",{name:"Abrir carrinho, 2 itens",exact:true}).click();const drawer=page.getByRole("dialog",{name:"Seu carrinho",exact:true});await expect(drawer).toContainText("Adicione mais 1 item elegível");await expect(drawer.locator(".sc-subtotal")).toContainText("120,00");await proof(page,"cart-2-390");
 await drawer.getByRole("button",{name:"Aumentar quantidade",exact:true}).click();await expect(drawer.locator(".sc-subtotal")).toContainText("165,00");await expect(drawer).toContainText("Preço especial aplicado: R$ 55,00 por unidade.");await proof(page,"cart-3-390");
 await drawer.getByRole("button",{name:"Aumentar quantidade",exact:true}).click();await expect(drawer.locator(".sc-subtotal")).toContainText("220,00");await expect(drawer).toContainText("Adicione mais 1 item elegível");
 await drawer.getByRole("button",{name:"Aumentar quantidade",exact:true}).click();await expect(drawer.locator(".sc-subtotal")).toContainText("250,00");await expect(drawer).toContainText("Preço especial aplicado: R$ 50,00 por unidade.");await proof(page,"cart-5-390");await page.setViewportSize({width:1440,height:1000});await proof(page,"cart-5-1440");
 await drawer.getByRole("button",{name:"Diminuir quantidade",exact:true}).click();await expect(drawer.locator(".sc-subtotal")).toContainText("220,00");await drawer.getByRole("button",{name:/Remover Pulverizador/}).click();await expect(drawer).toContainText("Seu carrinho está vazio.");
});

test("checkout e pedido: produto misto, snapshots e alteração durante a finalização",async({page,request})=>{
 const first=await(await request.put(`${api}/v1/public/sites/${scope.slug}/cart/items`,{data:{productId:scope.generalId,quantity:2}})).json();let cart=first.data;
 cart=(await(await request.put(`${api}/v1/public/sites/${scope.slug}/cart/items`,{data:{token:cart.token,productId:scope.productId,variantId:scope.variantId,quantity:3}})).json()).data;expect(cart.subtotalCents).toBe(25000);
 await page.addInitScript(({slug,token})=>localStorage.setItem(`vx_cart:${slug}`,token),{slug:scope.slug,token:cart.token});await page.setViewportSize({width:1440,height:1000});await page.goto(`/s/${scope.slug}/checkout`);await expect(page.locator(".ck-totals")).toContainText("300,00");await expect(page.locator(".ck-totals")).toContainText("50,00");await proof(page,"checkout-1440");await page.setViewportSize({width:390,height:844});await proof(page,"checkout-390");
 await page.getByLabel("Nome completo",{exact:true}).fill("Cliente das regras");await page.getByLabel("E-mail",{exact:true}).fill("cliente@commercial-rules.invalid");await page.getByLabel("Celular (WhatsApp)",{exact:true}).fill("11999990000");
 // Change the real rule after the quote: the first submit must request a new review.
 const listing=(await(await request.get(rules(),{headers:headers()})).json()).data;const original=listing.find((r:{id:string})=>r.id===scope.commercialRuleId);
 const {id,revision,tenantId,workspaceId,siteId,createdAt,updatedAt,...definition}=original;
 const changed=(await(await request.put(`${api}/v1/sites/${scope.siteId}/commercial-rules/${id}?workspaceId=${scope.workspaceId}`,{headers:headers(),data:{revision,definition:{...definition,name:definition.name+" (revisada)"}}})).json()).data;
 await page.getByRole("button",{name:"Finalizar compra",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:/mudaram/})).toBeVisible();await expect(page).toHaveURL(/\/checkout$/);
 await page.getByRole("button",{name:"Finalizar compra",exact:true}).click();await page.waitForURL(/\/pedido\//);await expect(page.locator(".ck-totals")).toContainText("250,00");await proof(page,"order-390");
 const publicToken=page.url().split("/").at(-1)!;const order=(await(await request.get(`${api}/v1/public/orders/${publicToken}`)).json()).data;expect(order.totalCents).toBe(25000);expect(order.discountCents).toBe(5000);expect(order.items.every((i:{pricingSnapshot:{appliedRules:{revision:number}[]}})=>i.pricingSnapshot.appliedRules[0].revision===changed.revision)).toBe(true);
 await writeFile(path.join(evidence,"order-pricing.json"),JSON.stringify({number:order.number,subtotalCents:order.subtotalCents,discountCents:order.discountCents,totalCents:order.totalCents,items:order.items.map((i:{name:string;quantity:number;totalCents:number;pricingSnapshot:unknown})=>({name:i.name,quantity:i.quantity,totalCents:i.totalCents,pricingSnapshot:i.pricingSnapshot}))},null,2));
});

test("informação comercial compartilhada nos seis templates e seis larguras",async({page,request})=>{
 test.setTimeout(180000);const metrics=[];
 const endpoint=`${api}/v1/sites/${scope.siteId}?workspaceId=${scope.workspaceId}`;
 let site=(await(await request.get(endpoint,{headers:headers()})).json()).data;
 for(const template of templates){
  const draft={...site.draft,theme:template.defaultTheme,activeTemplateId:template.id,templateConfigs:undefined};
  const saved=await request.put(endpoint,{headers:headers(),data:{revision:site.revision,draft}});expect(saved.ok()).toBe(true);site=(await saved.json()).data;
  const published=await request.post(`${api}/v1/sites/${scope.siteId}/publish?workspaceId=${scope.workspaceId}`,{headers:headers(),data:{revision:site.revision}});expect(published.ok()).toBe(true);site=(await published.json()).data;
  await page.goto(`/s/${scope.slug}`);await expect(page.locator(".sc-quantity-offer").first()).toContainText("55,00");
  for(const width of [360,390,430,768,1024,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);metrics.push({template:template.id,width,overflow:false});}
  await page.goto(`/s/${scope.slug}/produto/camiseta-fixture`);await expect(page.locator(".ts-detail-copy .sc-quantity-offer")).toContainText("50,00");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await writeFile(path.join(evidence,"templates-responsive.json"),JSON.stringify(metrics,null,2));
});
