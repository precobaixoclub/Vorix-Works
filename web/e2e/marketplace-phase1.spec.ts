import {test,expect,type Page} from "@playwright/test";
import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {loginCookie,mockConversasBackend,WORKSPACE_ID} from "./fixtures/mock-backend";
import {OWNER_PERMISSIONS} from "./fixtures/access-fixture";
const output=join(process.cwd(),"..","docs","marketplace-evidence");mkdirSync(output,{recursive:true});
const connection={id:"conn-qa",externalAccountName:"Loja Vorix de homologação",externalAccountId:"123456",status:"CONNECTED",safetyStock:2,userProducts:true};
const catalog=[{productId:"product-qa",name:"Camiseta Vorix",sku:"VORIX-01"},{productId:"variant-product",variantId:"variant-m",name:"Camiseta com tamanho / M",sku:"VORIX-M"},{productId:"variant-product",variantId:"variant-g",name:"Camiseta com tamanho / G",sku:"VORIX-G"}];
const external={id:"MLB123456789",title:"Camiseta Vorix para homologação de importação com título extenso",sku:"VORIX-01",ean:"7891234567890",categoryId:"MLB123",priceCents:12990,quantity:12,status:"active",pictures:[],variants:[]};
const listing={id:"listing-qa",connectionId:connection.id,productId:"product-qa",productName:"Camiseta Vorix",externalListingId:"MLB123456789",status:"active",syncStatus:"DIVERGED",externalPrice:12990,externalQuantity:12,lastError:"ML_EXTERNAL_CONFLICT"};
async function fixture(page:Page,manage=true){
 await mockConversasBackend(page);const operations:Record<string,any>[]=[];
 await page.route("**/v1/**",async route=>{
  const url=new URL(route.request().url()),path=url.pathname;let data:unknown;
  if(path==="/v1/auth/me")data={user:{id:"user-qa",email:"qa@vorix.dev",name:"QA"},tenantId:"tenant-qa",role:manage?"owner":"viewer",permissions:[...OWNER_PERMISSIONS.filter(p=>p!=="marketplace:manage"),"marketplace:read",...(manage?["marketplace:manage"]:[])],teams:[],isAccountOwner:manage};
  else if(path==="/v1/marketplaces")data={configured:true,connections:[connection],listings:[listing],jobs:[],mappings:[{connection_id:connection.id,category_id:"category-qa",external_category_id:"MLB123",attributes:[{id:"BRAND",value_name:"Vorix"}]}]};
  else if(path==="/v1/marketplaces/catalog")data=catalog;
  else if(path==="/v1/product-metadata")data={categories:[{id:"category-qa",name:"Roupas"}],brands:[],attributes:[]};
  else if(path==="/v1/products/product-qa")data={name:"Camiseta Vorix",description:"Descrição da camiseta do catálogo",imageUrls:["https://images.example.test/qa.jpg"],categoryId:"category-qa"};
  else if(path.startsWith("/v1/marketplaces/categories/"))data={id:"MLB123",name:"Camisetas",leaf:true,allowed:true,attributes:[{id:"BRAND",name:"Marca",required:true,variation:false},{id:"GTIN",name:"EAN / GTIN",required:true,variation:false}],saleTerms:[{id:"WARRANTY_TYPE",name:"Tipo de garantia",required:true,values:[{id:"2230279",name:"Garantia de fábrica"}]}]};
  else if(path==="/v1/marketplaces/validate")data={errors:[]};
  else if(path==="/v1/marketplaces/jobs"&&route.request().method()==="POST"){
   const body=route.request().postDataJSON();operations.push(body.operation);data={id:"job-"+body.operation.kind,connectionId:connection.id,kind:body.operation.kind,status:"PENDING",progress:0,total:1};
  }else if(path==="/v1/marketplaces/jobs/job-PREVIEW")data={id:"job-PREVIEW",connectionId:connection.id,kind:"PREVIEW",status:"COMPLETED",progress:1,total:1,items:[{externalId:external.id,status:"PREVIEW",result:{external,match:{kind:"SKU",candidates:[catalog[0]]},variantMatches:[]}}]};
  else if(path.startsWith("/v1/marketplaces/jobs/"))data={id:path.split("/").pop(),connectionId:connection.id,kind:"SYNC",status:"COMPLETED",progress:1,total:1};
  else return route.fallback();
  return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,data})});
 });
 return operations;
}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);}
test.beforeEach(async({context,baseURL})=>{await loginCookie(context,baseURL);});
test("conexão, divergência, importação, mapeamento e publicação em todas as larguras",async({page},info)=>{
 const operations=await fixture(page);
 await page.goto("/workspaces/"+WORKSPACE_ID+"/settings/marketplaces");
 await expect(page.getByRole("heading",{name:"Marketplaces",exact:true})).toBeVisible();
 await expect(page.getByText("Conectado · User Products")).toBeVisible();await expect(page.getByText("Divergência",{exact:true})).toBeVisible();
 await noOverflow(page);await page.screenshot({path:join(output,"connection-"+info.project.name+".png"),fullPage:true});
 await page.getByRole("button",{name:"Importar anúncios",exact:true}).click();
 const preview=page.getByLabel("Progresso da importação");await expect(preview.getByText("Prévia dos anúncios · 1")).toBeVisible();
 await expect(preview.getByText(/Mercado Livre informa 12 unidades/)).toBeVisible();
 await expect(preview.getByRole("checkbox")).not.toBeChecked();await noOverflow(page);
 await page.screenshot({path:join(output,"import-"+info.project.name+".png"),fullPage:true});
 await preview.getByRole("button",{name:"Confirmar importação em lote"}).click();
 expect(operations.find(o=>o.kind==="IMPORT")?.decisions[0]).toMatchObject({action:"LINK",productId:"product-qa",useExternalInitialStock:false});
 await page.getByRole("button",{name:"Publicar produto",exact:true}).click();
 const form=page.getByLabel("Publicação no Mercado Livre");await form.getByLabel("Produto / variação Vorix",{exact:true}).selectOption("product-qa:");
 await expect(form.getByLabel("Código da categoria Mercado Livre")).toHaveValue("MLB123");await form.getByRole("button",{name:"Consultar",exact:true}).click();
 await form.getByLabel("Marca *",{exact:true}).fill("Vorix");await form.getByLabel("EAN / GTIN *",{exact:true}).fill("7891234567890");
 await form.getByLabel("Tipo de garantia *",{exact:true}).selectOption("2230279");await form.getByLabel("Modalidade de envio do anúncio").selectOption("me2");
 await noOverflow(page);await page.screenshot({path:join(output,"mapping-"+info.project.name+".png"),fullPage:true});
 await expect(form.getByRole("button",{name:"Publicar anúncio",exact:true})).toBeDisabled();
 await form.getByRole("button",{name:"Validar no Mercado Livre"}).click();await expect(form.getByText(/Pronto para publicar/)).toBeVisible();
 await form.getByRole("button",{name:"Publicar anúncio",exact:true}).click();await expect.poll(()=>operations.filter(o=>o.kind==="PUBLISH").length).toBe(1);
 const close=page.getByRole("button",{name:"Finalizar",exact:true});page.once("dialog",dialog=>dialog.dismiss());await close.click();expect(operations.filter(o=>o.kind==="STATUS")).toHaveLength(0);
 page.once("dialog",dialog=>dialog.accept());await close.click();await expect.poll(()=>operations.filter(o=>o.kind==="STATUS").length).toBe(1);
 expect(operations.find(o=>o.kind==="STATUS")).toMatchObject({status:"closed",confirm:true});
});
test("somente leitura não pode importar, publicar ou finalizar anúncios",async({page})=>{
 await fixture(page,false);await page.goto("/workspaces/"+WORKSPACE_ID+"/settings/marketplaces");await expect(page.getByRole("heading",{name:"Marketplaces",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Conectar Mercado Livre"})).toBeDisabled();await expect(page.getByRole("button",{name:"Importar anúncios",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"Finalizar",exact:true})).toHaveCount(0);await noOverflow(page);
});
