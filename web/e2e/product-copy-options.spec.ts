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
 const dialog=page.getByRole("dialog");
 await expect(dialog.getByRole("heading").filter({hasText:"Duplicar produto"})).toBeVisible();
 await expect(dialog.getByLabel("Nome do produto",{exact:true})).toHaveValue(`${source.name} (cópia)`);
 await expect(dialog.getByLabel("Código do produto",{exact:true})).toHaveValue("");
 const advance=()=>dialog.getByRole("button",{name:"Avançar"}).click();
 await advance();await advance();
 await expect(dialog.getByLabel("Nome do valor P",{exact:true})).toBeVisible();
 for(const [option,value] of [["Tamanho","M"],["Cor","Azul"],["Cor","Verde-musgo"]]){await dialog.getByLabel(`Novo valor de ${option}`,{exact:true}).fill(value);await dialog.getByLabel(`Novo valor de ${option}`,{exact:true}).press("Enter");}
 await expect(dialog.getByRole("button",{name:"Remover Verde-musgo",exact:true})).toBeVisible();
 await advance();await expect(dialog.getByRole("button",{name:"Excluir foto",exact:true})).toHaveCount(1);
 await advance();await advance();
 await dialog.getByRole("button",{name:/^(Salvar|Publicar) produto$/}).click();await expect(dialog).toHaveCount(0);
 expect(payload).toMatchObject({name:`${source.name} (cópia)`,description:source.description,imageUrls:source.imageUrls,details:{options:[{key:"size",values:["P","M"]},{key:"color",values:["Preto","Azul","Verde-musgo"]}]}});
 expect(payload?.variants).toHaveLength(6);expect(payload?.variants.every((variant:{id?:string})=>!variant.id)).toBe(true);
 expect(payload?.code??null).toBeNull();expect(payload?.details.slug).toBeUndefined();expect(payload?.stockQuantity).toBeUndefined();
});
