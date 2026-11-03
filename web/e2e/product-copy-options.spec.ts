import {test,expect} from "@playwright/test";
import {loginCookie,mockConversasBackend,WORKSPACE_ID} from "./fixtures/mock-backend";
import {newProductDetails} from "../features/product-engine/types";

test("duplicar preserva conteúdo e fotos, renova código e endereço e permite escolher variações",async({page,context,baseURL})=>{
 await loginCookie(context,baseURL);await mockConversasBackend(page);
 const source={id:"product-copy-fixture",workspaceId:WORKSPACE_ID,name:"Camiseta para duplicar",code:"000018",priceCents:9500,listPriceCents:9500,description:"Descrição completa da camiseta",itemType:"product",billingType:"one_time",active:true,trackStock:true,stockQuantity:12,imageUrls:["https://example.invalid/camiseta.png"],details:{...newProductDetails(),type:"APPAREL",slug:"camiseta-original",options:[{key:"size",name:"Tamanho",values:["P"]},{key:"color",name:"Cor",values:["Preto"]}]}};
 let payload:Record<string,any>|undefined;
 await page.route("**/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname;
  const reply=(data:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  if(path.endsWith("/catalog-bulk/products"))return reply({items:[source],total:1});
  if(path==="/v1/product-metadata")return reply({categories:[],brands:[],attributes:[]});
  if(path==="/v1/commercial-settings")return reply({visibility:{canViewCost:true,isManager:true}});
  if(path==="/v1/products"&&route.request().method()==="POST"){payload=route.request().postDataJSON();return reply({...source,...payload,id:"new-copy",code:"000019"});}
  if(path.includes(`/products/${source.id}/`))return reply([]);
  return route.fallback();
 });
 await page.goto(`/workspaces/${WORKSPACE_ID}/products`);
 await page.getByText(source.name,{exact:true}).first().click();
 await page.getByRole("button",{name:"Duplicar produto",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"Duplicar produto"});
 await expect(dialog.getByLabel("Nome",{exact:true})).toHaveValue(`${source.name} (cópia)`);
 await expect(dialog.getByLabel("Código do produto",{exact:true})).toHaveValue("");
 const section=(name:string)=>dialog.getByRole("navigation",{name:"Navegação da seção"}).getByRole("button",{name,exact:true}).click();
 await section("Variações");
 await expect(dialog.getByRole("button",{name:"P",exact:true})).toHaveAttribute("aria-pressed","true");
 await dialog.getByRole("button",{name:"M",exact:true}).click();
 await dialog.getByRole("button",{name:"Azul",exact:true}).click();
 await dialog.getByLabel("Adicionar outro valor de Cor",{exact:true}).fill("Verde-musgo");
 await dialog.getByLabel("Adicionar outro valor de Cor",{exact:true}).press("Enter");
 await expect(dialog.getByRole("button",{name:"Remover Verde-musgo",exact:true})).toBeVisible();
 await section("Fotos");await expect(dialog.getByRole("button",{name:"Remover foto",exact:true})).toHaveCount(1);
 await dialog.getByRole("button",{name:"Cadastrar produto",exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(payload).toMatchObject({name:`${source.name} (cópia)`,description:source.description,imageUrls:source.imageUrls,details:{options:[{key:"size",values:["P","M"]},{key:"color",values:["Preto","Azul","Verde-musgo"]}]}});
 expect(payload?.code??null).toBeNull();expect(payload?.details.slug).toBeUndefined();expect(payload?.stockQuantity).toBeUndefined();
});
