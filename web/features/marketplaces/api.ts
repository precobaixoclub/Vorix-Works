import { apiClient } from "@/lib/api-client";
export type Connection={id:string;provider?:string;externalAccountName:string;externalAccountId:string;status:string;safetyStock:number;settings?:{createContacts?:boolean};lastSyncAt?:string;ordersSyncedAt?:string;lastError?:string;userProducts?:boolean};
export type Provider={id:string;capabilities?:Partial<Record<string,"SUPPORTED"|"BLOCKED_EXTERNAL_CAPABILITY">>;closeListingEffect?:"END"|"DELETE"};
export type ExternalVariant={id:string;sku?:string;ean?:string;quantity:number;options:Record<string,string>};
export type External={id:string;title:string;sku?:string;ean?:string;categoryId:string;priceCents:number;quantity:number;status:string;pictures:string[];variants:ExternalVariant[];stockWritable?:boolean};
export type Identity={productId:string;variantId?:string;name:string;sku?:string;ean?:string};
export type Match={kind:string;candidates:Identity[]};
export type Listing={id:string;connectionId:string;productId:string;productName?:string;variantId?:string;externalListingId?:string;externalUrl?:string;status:string;syncStatus:string;externalPrice?:number;externalQuantity?:number;lastError?:string;lastSyncAt?:string;snapshot?:External;draft?:Draft};
export type Job={id:string;connectionId:string;kind:string;status:string;progress:number;total:number;lastError?:string;items?:{externalId:string;status:string;result:{external?:External;match?:Match;variantMatches?:{externalVariantId:string;match:Match}[];code?:string}}[]};
export type Category={id:string;name:string;leaf:boolean;allowed:boolean;attributes:{id:string;name:string;required:boolean;variation:boolean;values?:{id:string;name:string}[]}[];saleTerms?:{id:string;name:string;required:boolean;values?:{id:string;name:string}[]}[]};
export type Draft={categoryId:string;title:string;description:string;condition:string;listingTypeId:string;buyingMode:"buy_it_now";attributes:{id:string;value_name?:string;value_id?:string}[];pictures:string[];settings:Record<string,unknown>};
export type Dashboard={configured:boolean;providers?:Provider[];connections:Connection[];listings:Listing[];jobs:Job[];mappings:{connection_id:string;category_id:string;external_category_id:string;attributes:Draft["attributes"]}[]};
export type Decision={externalId:string;action:"LINK"|"CREATE"|"IGNORE";productId?:string;variantId?:string;variantLinks:{externalVariantId:string;variantId:string}[];useExternalInitialStock:boolean};
export function marketplaceApi(workspaceId:string){
 const q="?workspaceId="+encodeURIComponent(workspaceId);
 return {
  dashboard:(productId?:string)=>apiClient.get<Dashboard>("/v1/marketplaces"+q+(productId?"&productId="+encodeURIComponent(productId):"")),
  catalog:()=>apiClient.get<Identity[]>("/v1/marketplaces/catalog"+q),
  // `include`: the API answers with the OAuth browser-binding cookie that the callback requires.
  connect:(slug="mercado-livre")=>apiClient.post<{url:string}>("/v1/marketplaces/"+encodeURIComponent(slug)+"/connect"+q,undefined,{credentials:"include"}),
  settings:(id:string,settings:{createContacts:boolean})=>apiClient.patch("/v1/marketplaces/connections/"+encodeURIComponent(id)+"/settings"+q,settings),
  disconnect:(id:string)=>apiClient.post("/v1/marketplaces/connections/"+encodeURIComponent(id)+"/disconnect"+q,{confirm:true}),
  safetyStock:(id:string,safetyStock:number)=>apiClient.patch("/v1/marketplaces/connections/"+encodeURIComponent(id)+q,{safetyStock}),
  enqueue:(connectionId:string,operation:Record<string,unknown>,operationKey=crypto.randomUUID())=>apiClient.post<Job>("/v1/marketplaces/jobs"+q,{connectionId,operation,operationKey}),
  job:(id:string)=>apiClient.get<Job>("/v1/marketplaces/jobs/"+encodeURIComponent(id)+q),
  category:(connectionId:string,id:string)=>apiClient.get<Category>("/v1/marketplaces/categories/"+encodeURIComponent(id)+q+"&connectionId="+encodeURIComponent(connectionId)),
  metadata:()=>apiClient.get<{categories:{id:string;name:string}[]}>("/v1/product-metadata"+q),
  mapping:(body:Record<string,unknown>)=>apiClient.post("/v1/marketplaces/mappings"+q,body),
  validate:(body:Record<string,unknown>)=>apiClient.post<{errors:string[]}>("/v1/marketplaces/validate"+q,body),
 };
}
const messages:Record<string,string>={
 ML_APPLICATION_NOT_CONFIGURED:"A aplicação Mercado Livre ainda precisa ser configurada no servidor.",
 ENCRYPTED_SECRET_MANAGER_REQUIRED:"Configure o armazenamento cifrado de credenciais antes de conectar.",
 REAUTH_REQUIRED:"Autorize novamente a conta Mercado Livre.",
 ML_EXTERNAL_CONFLICT:"O anúncio mudou no Mercado Livre. Confira os valores antes de sincronizar.",
 ML_PUBLICATION_OUTCOME_UNCERTAIN:"O resultado da publicação é incerto. Confira a conta Mercado Livre antes de tentar publicar novamente.",
 ML_PUBLICATION_NOT_LOCATED_REVIEW_REQUIRED:"A busca não localizou o anúncio. Confira a conta Mercado Livre; uma nova publicação exige revisão para evitar duplicidade.",
 ML_PUBLICATION_MULTIPLE_MATCHES_REVIEW_REQUIRED:"Há mais de um anúncio com a mesma referência. Revise os anúncios na conta Mercado Livre.",
 ML_VARIANT_MAPPING_CHANGED:"As variações mudaram no Mercado Livre. Revise os vínculos antes de sincronizar.",
 ML_STOCK_LOCATION_REQUIRES_CONFIGURATION:"Este anúncio usa estoque Full ou múltiplos depósitos e exige configuração específica.",
 ML_PRICE_AUTOMATION_OR_PROMOTION_ACTIVE:"O preço é controlado por automação ou promoção no Mercado Livre.",
 IMPORT_MAP_ALL_VARIANTS:"Relacione todas as variações do anúncio, sem repetir uma variação Vorix.",
 IMPORT_IDENTITY_EXISTS_USE_LINK:"Já existe produto com este SKU ou EAN. Use o vínculo com o catálogo.",
 ML_SELECT_ONE_VARIANT_FOR_PUBLICATION:"Selecione uma variação. Cada variação será publicada como anúncio próprio.",
 ML_TRACKED_STOCK_REQUIRED:"Ative o controle de estoque do produto antes de publicar.",
 CLOSE_CONFIRMATION_REQUIRED:"Confirme explicitamente o encerramento do anúncio.",
 BLOCKED_EXTERNAL_CAPABILITY:"O canal não permite esta operação pela API oficial — faça no painel do marketplace.",
};
export const marketplaceMessage=(value:unknown):string=>{
 const text=value instanceof Error?value.message:String(value??"");
 for(const [code,message] of Object.entries(messages))if(text.includes(code))return message;
 if(text.startsWith("ML_VALIDATION:"))return text.slice(14);
 return /^[A-Z_0-9]+$/.test(text)?"Não foi possível concluir a operação. Confira a conta, os vínculos e a configuração do anúncio.":text||"Não foi possível concluir a operação.";
};
