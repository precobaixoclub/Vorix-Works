import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import type {PublicSelection} from "../features/sites/selection";
const token="a".repeat(64);
test.beforeEach(async({context})=>{await context.route(/^https:\/\/wa\.me\//,route=>route.fulfill({contentType:"text/html",body:"<title>WhatsApp simulado</title>"}));});
function fixture():PublicSelection{return {reference:"VX-A8F2KM",revision:1,siteName:"CMKV Wears",siteSlug:"cmkv-wears",createdAt:"2026-11-08T15:00:00Z",expiresAt:"2026-11-22T15:00:00Z",editable:true,syncPending:false,snapshot:{items:[{productId:"bag",variantId:"white-p",name:"Bolsa essencial",variantLabel:"Cor: Areia",imageUrl:"/site-assets/templates/bag.webp",quantity:1,unitPriceCents:18990,currency:"BRL",sku:"ESS-AREIA"}],subtotalCents:18990,currency:"BRL"},products:[{id:"bag",slug:"bolsa",type:"GENERAL",name:"Bolsa essencial",priceCents:18990,currency:"BRL",imageUrls:["/site-assets/templates/bag.webp"],media:[],attributes:{},seo:{},canPurchaseOnline:false,options:[{key:"color",name:"Cor",values:["Areia","Preto"]}],variants:[{id:"white-p",name:"Areia",optionValues:{color:"Areia"},priceCents:18990},{id:"black-p",name:"Preto",optionValues:{color:"Preto"},priceCents:19990}],commerce:{saleMode:"WHATSAPP_DIRECT",requestedSaleMode:"WHATSAPP_DIRECT",checkoutAvailable:false,allowedActions:["whatsapp"],ctaLabel:"Falar no WhatsApp",availability:"untracked"}}],history:[],whatsappUrl:"https://wa.me/5511988887777?text=Selecao"};}
test("seleção pública confirma, edita a mesma seleção e cabe no celular e desktop",async({page})=>{
 let state=fixture();const submissions:Record<string,any>[]=[];const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await page.route(`**/api/tenant-site/selections/${token}`,async route=>{
  if(route.request().method()==="POST"){
   const input=route.request().postDataJSON();submissions.push(input);
   const variant=state.products[0].variants.find(item=>item.id===input.items[0].variantId)!;
   const quantity=input.items[0].quantity;
   state={...state,revision:state.revision+1,submittedAt:"2026-11-08T15:01:00Z",snapshot:{...state.snapshot,subtotalCents:variant.priceCents*quantity,items:[{...state.snapshot.items[0],variantId:variant.id,variantLabel:`Cor: ${variant.optionValues.color}`,unitPriceCents:variant.priceCents,quantity}]},history:[...state.history,{revision:state.revision,at:"2026-11-08T15:01:00Z"}]};
  }
  await route.fulfill({json:{data:state}});
 });
 await page.goto(`/selecao/${token}`);
 await expect(page.getByRole("heading",{name:"Bolsa essencial"})).toBeVisible();
 await mkdir("../tmp/site-selection-qa",{recursive:true});
 for(const width of [360,390,768,1440]){
  await page.setViewportSize({width,height:950});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  if(width===390||width===1440)await page.screenshot({path:`../tmp/site-selection-qa/selection-${width}.png`,fullPage:true});
 }
 await expect(page.getByLabel("Seu nome",{exact:true})).toHaveCount(0);
 await expect(page.getByLabel("Seu WhatsApp com DDD")).toHaveCount(0);
 const sent=page.context().waitForEvent("request",{predicate:request=>request.url().startsWith("https://wa.me/")});
 await page.getByRole("button",{name:"Finalizar pelo WhatsApp"}).click();
 expect((await sent).url()).toContain("wa.me/5511988887777");
 await expect(page.getByRole("link",{name:/Continuar pelo WhatsApp/})).toBeVisible();
 expect(submissions[0]).toEqual({revision:1,items:[{productId:"bag",variantId:"white-p",quantity:1}]});
 await page.getByRole("button",{name:"Editar seleção"}).click();
 await page.getByRole("combobox",{name:"Opção de Bolsa essencial"}).selectOption("black-p");
 await page.getByRole("button",{name:"Aumentar quantidade de Bolsa essencial"}).click();
 await page.getByRole("button",{name:"Salvar e atualizar pedido"}).click();
 await expect(page.getByText("Alterações salvas e enviadas à equipe.")).toBeVisible();
 expect(submissions[1]).toEqual({revision:2,items:[{productId:"bag",variantId:"black-p",quantity:2}]});
 await page.reload();await expect(page.getByText("2 unidades")).toBeVisible();
 await expect(page.getByRole("button",{name:"Salvar PDF"})).toBeVisible();
 await page.emulateMedia({media:"print"});await expect(page.getByRole("button",{name:"Salvar PDF"})).toBeHidden();
 await expect(page.getByRole("heading",{name:"Bolsa essencial"})).toBeVisible();
 await page.pdf({path:"../tmp/site-selection-qa/exemplo-selecao.pdf",format:"A4",printBackground:true});
 await page.emulateMedia({media:"screen"});
 expect(errors).toEqual([]);
});

test("seleção preservada com integração pendente permite reenvio e não abre WhatsApp antes do registro",async({page})=>{
 let state={...fixture(),submittedAt:"2026-11-08T15:01:00Z",syncPending:true};
 await page.route(`**/api/tenant-site/selections/${token}`,async route=>{
  if(route.request().method()==="POST")state={...state,revision:2,syncPending:false};
  await route.fulfill({json:{data:state}});
 });
 await page.goto(`/selecao/${token}`);
 await expect(page.getByText("Envio à equipe pendente")).toBeVisible();
 await expect(page.getByRole("link",{name:/Continuar pelo WhatsApp/})).toHaveCount(0);
 await page.getByRole("button",{name:"Tentar envio novamente"}).click();
 await expect(page.getByRole("link",{name:/Continuar pelo WhatsApp/})).toBeVisible();
});
