import {test,expect} from "@playwright/test";
import {loginCookie,mockConversasBackend,WORKSPACE_ID} from "./fixtures/mock-backend";
import {newProductDetails} from "../features/product-engine/types";

test("grade salva disponibilidade e fotos e mantém os ajustes individuais coerentes",async({page,context,baseURL})=>{
 await loginCookie(context,baseURL);await mockConversasBackend(page);
 const product={id:"matrix-product",workspaceId:WORKSPACE_ID,name:"Camiseta da grade",priceCents:9500,active:true,imageUrls:["https://example.invalid/front.png","https://example.invalid/back.png"],details:{...newProductDetails(),type:"APPAREL",options:[{key:"size",name:"Tamanho",values:["P","M"]},{key:"color",name:"Cor",values:["Preto","Azul"]}]}};
 const variants=["P","M"].flatMap(size=>["Preto","Azul"].map(color=>({id:`${size}-${color}`,productId:product.id,name:`Tamanho: ${size} / Cor: ${color}`,optionValues:{size,color},active:true,listPriceCents:9500,stockQuantity:2,imageUrl:undefined as string|undefined})));
 const writes:{id:string;active?:boolean;imageUrl?:string|null}[]=[];
 await page.route("**/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname;
  const reply=(data:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  if(path==="/v1/catalog-bulk/products")return reply({items:[product],total:1});
  if(path==="/v1/product-metadata")return reply({categories:[],brands:[],attributes:[]});
  if(path==="/v1/commercial-settings")return reply({visibility:{canViewCost:true,isManager:true}});
  if(path===`/v1/products/${product.id}/variants`)return reply(variants);
  if(path.startsWith(`/v1/products/${product.id}/variants/`)&&route.request().method()==="PATCH"){
   const id=path.split("/").pop()!,body=route.request().postDataJSON();writes.push({id,...body});const variant=variants.find(item=>item.id===id)!;Object.assign(variant,body,{imageUrl:body.imageUrl??undefined});return reply(variant);
  }
  return route.fallback();
 });
 await page.goto(`/workspaces/${WORKSPACE_ID}/products`);await page.getByText(product.name,{exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"Editar produto"});await dialog.getByRole("navigation",{name:"Navegação da seção"}).getByRole("button",{name:"Variações",exact:true}).click();
 await dialog.getByRole("button",{name:"Tamanho M, Cor Preto",exact:true}).click();await dialog.getByRole("button",{name:"Preto: foto 2",exact:true}).click();
 await dialog.getByRole("button",{name:"Salvar combinações",exact:true}).click();await expect(dialog.getByRole("button",{name:"Salvar combinações",exact:true})).toBeDisabled();
 await expect.poll(()=>writes).toEqual(expect.arrayContaining([expect.objectContaining({id:"M-Preto",active:false,imageUrl:product.imageUrls[1]}),expect.objectContaining({id:"P-Preto",active:true,imageUrl:product.imageUrls[1]})]));
 const row=dialog.locator("details").filter({has:page.locator("summary",{hasText:"Tamanho: M / Cor: Preto"})});await row.locator("summary").click();
 await expect(row.getByRole("switch",{name:"Combinação ativa",exact:true})).not.toBeChecked();
 await row.getByRole("button",{name:"Salvar combinação",exact:true}).click();await expect.poll(()=>writes.at(-1)?.active).toBe(false);
 await dialog.getByRole("button",{name:"Adicionar variação",exact:true}).click();await dialog.getByRole("button",{name:/^Voltagem/}).click();
 await dialog.getByRole("button",{name:"220V",exact:true}).click();await expect(dialog.getByRole("button",{name:"220V",exact:true})).toHaveAttribute("aria-pressed","true");
});
