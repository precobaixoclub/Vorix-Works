import type { CategoryRequirements, ExternalOrder, ExternalOrderState, ExternalReturn, ExternalReturnState, ExternalShipmentState, ListingWrite, MarketplaceProvider, MarketplaceTokens, ProviderAuth, ProviderCapabilities, ProviderNotification, ShippingLabel } from "../../application/ports/marketplace-provider.port.js";
import { createHash } from "node:crypto";
import { MarketplaceError, type ExternalAttribute, type ExternalListing, type PublishDraft } from "../../domain/marketplaces/marketplace.model.js";
import { setTimeout as sleep } from "node:timers/promises";

export type MercadoLivreConfig = { clientId:string; clientSecret:string; redirectUri:string };
type Json = Record<string,any>;
const identifier=(value:string,pattern=/^[A-Za-z0-9_-]{1,100}$/):string=>{
 if(!pattern.test(value))throw new MarketplaceError("INVALID_EXTERNAL_IDENTIFIER");return encodeURIComponent(value);
};
const cents=(value:unknown):number=>{
 const amount=Number(value);if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(Math.round(amount*100)))throw new MarketplaceError("INVALID_EXTERNAL_PRICE");
 return Math.round(amount*100);
};
const attrs=(data:Json[]):ExternalAttribute[]=>data.filter(a=>a.id).map(a=>({id:String(a.id),...(a.value_id?{value_id:String(a.value_id)}:{}),...(a.value_name?{value_name:String(a.value_name)}:{})}));
const attribute=(data:Json[],id:string):string|undefined=>data.find(a=>a.id===id)?.value_name??undefined;
const image=(value:unknown):string|undefined=>{
 if(typeof value!=="string")return;try{const u=new URL(value);if(u.protocol==="https:"&&!u.username&&!u.password)return u.href;}catch{}return;
};

// Docs oficiais pt_br (out/2026): gerenciamento-de-envios, gerenciamento-de-vendas, gerenciar-devolucoes, produto-receba-notificacoes.
const ML_SHIPMENT:Record<string,ExternalShipmentState>={pending:"PENDING",handling:"READY_TO_SHIP",ready_to_ship:"READY_TO_SHIP",shipped:"SHIPPED",delivered:"DELIVERED",not_delivered:"NOT_DELIVERED",cancelled:"CANCELLED"};
// Status de /orders: pending_cancel = cancelada com reembolso pendente; invalid = comprador malicioso (nunca vira venda).
const ML_ORDER_CANCELLED=new Set(["cancelled","pending_cancel","invalid"]),ML_ORDER_PAID=new Set(["paid","partially_refunded"]);
// Devolução física (post-purchase v2, enum oficial): "delivered" = chegou ao vendedor — a reposição ainda é decisão manual no Vorix.
// return_to_buyer = o produto volta ao comprador (nada retorna ao estoque).
const ML_RETURN:Record<string,ExternalReturnState>={pending:"APPROVED",label_generated:"APPROVED",scheduled:"APPROVED",pending_cancel:"APPROVED",pending_expiration:"APPROVED",pending_failure:"APPROVED",
 shipped:"IN_TRANSIT",pending_delivered:"IN_TRANSIT",delivered:"RECEIVED",not_delivered:"CANCELLED",return_to_buyer:"CANCELLED",cancelled:"CANCELLED",failed:"CANCELLED",expired:"CANCELLED"};
const CLAIM=/^\/post-purchase\/v1\/claims\/\d{1,20}$/;
/** Tópicos aceitos. Reclamações chegam em "post_purchase" (actions claims/claims_actions); "claims" fica para assinaturas antigas.
 * items_prices: a doc manda reler /prices, mas o formato exato do resource não é confirmado — aceita o item ou o subrecurso. */
export const ML_TOPICS:Record<string,RegExp>={items:/^\/items\/MLB\d+$/,items_prices:/^\/items\/MLB\d+(\/prices)?$/,user_products:/^\/user-products\/MLBU\d+$/,"stock-location":/^\/user-products\/MLBU\d+\/stock$/,
 orders_v2:/^\/orders\/\d{1,20}$/,shipments:/^\/shipments\/\d{1,20}$/,post_purchase:CLAIM,claims:CLAIM};
/** O exemplo oficial de post_purchase traz o resource sem a barra inicial: normaliza antes de validar. */
export const mercadoLivreResource=(topic:string,resource:string)=>(topic==="post_purchase"||topic==="claims")&&resource.startsWith("post-purchase/")?"/"+resource:resource;
export const mercadoLivreNotificationKind=(topic:string):"ORDER"|"RETURN"|"LISTING"=>topic==="orders_v2"||topic==="shipments"?"ORDER":topic==="post_purchase"||topic==="claims"?"RETURN":"LISTING";
const firstAt=(history:Json[],status:string)=>history.filter(h=>h?.status===status&&typeof h.date==="string").map(h=>String(h.date)).sort()[0];

/** All network calls are confined to the official API origin. Provider errors never include response bodies. */
export class MercadoLivreProvider implements MarketplaceProvider {
 readonly id="MERCADO_LIVRE" as const;
 readonly pkce=true;
 // Venda cancelada pelo vendedor não existe na API pública do Mercado Livre (só o comprador/mediação cancela).
 readonly capabilities:ProviderCapabilities={listings:"SUPPORTED",publish:"SUPPORTED",priceSync:"SUPPORTED",stockSync:"SUPPORTED",orders:"SUPPORTED",shipments:"SUPPORTED",labels:"SUPPORTED",cancelOrder:"BLOCKED_EXTERNAL_CAPABILITY",returns:"SUPPORTED",webhooks:"SUPPORTED"};
 private nextCallAt=0;
 constructor(private readonly config:MercadoLivreConfig,private readonly fetcher:typeof fetch=fetch){}
 get applicationId(){return this.config.clientId;}
 authorizationUrl(state:string,challenge:string):string{
  const url=new URL("https://auth.mercadolivre.com.br/authorization");
  url.search=new URLSearchParams({response_type:"code",client_id:this.config.clientId,redirect_uri:this.config.redirectUri,state,code_challenge:challenge,code_challenge_method:"S256"}).toString();return url.href;
 }
 private async request(path:string,token?:string,method="GET",body?:unknown,headers:Record<string,string>={},binary=false):Promise<{data:Json;headers:Headers;bytes?:Uint8Array}>{
  if(!path.startsWith("/")||path.startsWith("//")||path.includes("\\")||path.includes("#"))throw new MarketplaceError("INVALID_EXTERNAL_RESOURCE");
  let response:Response;
  const start=Math.max(Date.now(),this.nextCallAt);this.nextCallAt=start+500;
  if(start>Date.now())await sleep(start-Date.now());
  try{response=await this.fetcher("https://api.mercadolibre.com"+path,{method,redirect:"error",signal:AbortSignal.timeout(20000),
   headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body?{"Content-Type":"application/json"}:{}),...headers},
   ...(body?{body:body instanceof URLSearchParams?body.toString():JSON.stringify(body)}:{})});
  }catch{throw new MarketplaceError("ML_NETWORK_UNCERTAIN",true);}
  if(!response.ok){
   if(response.status===401)throw new MarketplaceError("REAUTH_REQUIRED");
   if(response.status===429){const retry=response.headers.get("retry-after");const seconds=Number(retry);throw new MarketplaceError("ML_RATE_LIMIT",true,Math.min(3600000,Math.max(1000,Number.isFinite(seconds)?seconds*1000:30000)));}
   if(response.status===404)throw new MarketplaceError("ML_LISTING_NOT_FOUND");
   if(response.status===409)throw new MarketplaceError("ML_EXTERNAL_CONFLICT");
   if(response.status>=500)throw new MarketplaceError("ML_UNAVAILABLE",true);
   const error=new MarketplaceError("ML_REQUEST_REJECTED_"+response.status);
   if(response.status===400)try{
    const body=await response.json() as Json;
    error.issues=(Array.isArray(body.cause)?body.cause:[]).slice(0,20).map((cause:Json)=>{
     const code=typeof cause.code==="string"&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(cause.code)?cause.code:"validation";
     const fields=String(cause.message??"").match(/\b[A-Z][A-Z0-9_]{2,60}\b/g)??[];
     return "Regra Mercado Livre: "+code+(fields.length?" · Campos: "+[...new Set(fields)].slice(0,15).join(", "):"");
    });
   }catch{}
   throw error;
  }
  if(response.status===204)return {data:{},headers:response.headers};
  if(binary)return {data:{},headers:response.headers,bytes:new Uint8Array(await response.arrayBuffer())};
  try{return {data:await response.json() as Json,headers:response.headers};}catch{throw new MarketplaceError("ML_INVALID_RESPONSE",true);}
 }
 private async token(fields:Record<string,string>):Promise<MarketplaceTokens>{
  const {data}=await this.request("/oauth/token",undefined,"POST",new URLSearchParams({...fields,client_id:this.config.clientId,client_secret:this.config.clientSecret}),{"Content-Type":"application/x-www-form-urlencoded"});
  if(!data.access_token||!data.refresh_token||!data.user_id||!(Number(data.expires_in)>0))throw new MarketplaceError("ML_INVALID_TOKEN_RESPONSE");
  const scopes=String(data.scope??"").split(" ");if(!["read","write","offline_access"].every(s=>scopes.includes(s)))throw new MarketplaceError("ML_REQUIRED_SCOPES_MISSING");
  return {accessToken:String(data.access_token),refreshToken:String(data.refresh_token),expiresAt:new Date(Date.now()+Number(data.expires_in)*1000).toISOString(),userId:String(data.user_id)};
 }
 connect(input:{code:string;verifier?:string}){return this.token({grant_type:"authorization_code",code:input.code,redirect_uri:this.config.redirectUri,...(input.verifier?{code_verifier:input.verifier}:{})});}
 refreshConnection(refreshToken:string){return this.token({grant_type:"refresh_token",refresh_token:refreshToken});}
 async disconnect(auth:ProviderAuth){await this.request("/users/"+identifier(auth.accountId)+"/applications/"+identifier(this.config.clientId),auth.accessToken,"DELETE");}
 async account(auth:ProviderAuth){
  const {data}=await this.request("/users/me",auth.accessToken);
  if(!data.id||data.site_id!=="MLB")throw new MarketplaceError("ML_ACCOUNT_SITE_UNSUPPORTED");
  return {id:String(data.id),name:String(data.nickname??data.id),siteId:String(data.site_id),userProducts:Array.isArray(data.tags)&&data.tags.includes("user_product_seller")};
 }
 async listExternalProducts(auth:ProviderAuth,cursor?:string){
  const token=auth.accessToken,userId=auth.accountId;
  const q=new URLSearchParams({search_type:"scan",limit:"50",...(cursor?{scroll_id:cursor}:{})});
  const {data}=await this.request("/users/"+identifier(userId)+"/items/search?"+q,token);
  return {ids:(data.results??[]).map(String),cursor:data.results?.length?data.scroll_id as string|undefined:undefined,total:Number(data.paging?.total??0)};
 }
 async getListing(auth:ProviderAuth,id:string):Promise<ExternalListing>{
  const token=auth.accessToken;
  // include_attributes=all: sem ele as variações não trazem attributes (SELLER_SKU/GTIN) nem seller_custom_field.
  const {data}=await this.request("/items/"+identifier(id,/^MLB\d+$/)+"?include_attributes=all",token);
  const prices=await this.request("/items/"+identifier(id)+"/prices",token);
  const standard=(prices.data.prices as Json[]|undefined)?.filter(p=>p.type==="standard"&&(!p.conditions?.context_restrictions?.length||p.conditions.context_restrictions.includes("channel_marketplace")));
  if(!standard?.length)throw new MarketplaceError("ML_STANDARD_PRICE_UNAVAILABLE");
  if(new Set(standard.map(p=>cents(p.amount))).size!==1)throw new MarketplaceError("ML_PRICE_CONTEXT_AMBIGUOUS");
  const priceCents=cents(standard[0].amount);
  let description:string|undefined;
  try{const result=await this.request("/items/"+identifier(id)+"/description",token);description=String(result.data.plain_text??"").slice(0,50000);}
  catch(error){if(!(error instanceof MarketplaceError&&error.code==="ML_LISTING_NOT_FOUND"))throw error;}
  const dataAttrs=Array.isArray(data.attributes)?data.attributes:[];
  const tags:Array<string>=data.tags??[];
  // Full: o estoque é do meli_facility (só entra por envio físico ao CD); inventory_id existe por item ou por variação.
  let stockWritable=data.shipping?.logistic_type!=="fulfillment"&&!data.inventory_id&&!(data.variations??[]).some((v:Json)=>v.inventory_id);
  const userProductIds=[...new Set([data.user_product_id,...(data.variations??[]).map((v:Json)=>v.user_product_id)].filter(Boolean).map(String))];
  for(const userProductId of userProductIds){
   // 404 = UP sem stock-locations inicializadas: não dá para afirmar onde o estoque vive, então não escrevemos (o anúncio continua existindo).
   const stock=await this.request("/user-products/"+identifier(userProductId,/^MLBU\d+$/)+"/stock",token).catch(error=>{if(error instanceof MarketplaceError&&error.code==="ML_LISTING_NOT_FOUND")return undefined;throw error;});
   if(!stock){stockWritable=false;continue;}
   if(String(stock.data.user_id)!==String(data.seller_id))throw new MarketplaceError("ML_STOCK_OWNER_MISMATCH");
   const locations=stock.data.locations;
   if(!Array.isArray(locations)||locations.length!==1||locations[0].type!=="selling_address")stockWritable=false;
  }
  const normalized:ExternalListing={
   id:String(data.id),sellerId:String(data.seller_id),title:String(data.title??data.family_name??""),description,
   sku:attribute(dataAttrs,"SELLER_SKU")??(String(data.seller_custom_field??"").startsWith("vorix:")?undefined:data.seller_custom_field??undefined),ean:attribute(dataAttrs,"GTIN"),
   categoryId:String(data.category_id),priceCents,quantity:Number(data.available_quantity??0),
   status:String(data.status),url:image(data.permalink),currency:String(standard[0].currency_id??data.currency_id??"BRL"),
   pictures:(data.pictures??[]).map((p:Json)=>image(p.secure_url??p.url)).filter(Boolean),
   attributes:attrs(dataAttrs),userProductId:data.user_product_id??undefined,familyName:data.family_name??undefined,
   correlation:typeof data.seller_custom_field==="string"&&data.seller_custom_field.startsWith("vorix:")?data.seller_custom_field:undefined,
   model:tags.includes("user_product_listing")||data.family_name?"USER_PRODUCT":"LEGACY",
   stockWritable,
   priceWritable:!tags.includes("dynamic_standard_price")&&!(prices.data.prices??[]).some((p:Json)=>p.type==="promotion"),
   updatedAt:data.last_updated,
   variants:(data.variations??[]).map((v:Json)=>({id:String(v.id),sku:attribute(v.attributes??[],"SELLER_SKU")??v.seller_custom_field??undefined,
    ean:attribute(v.attributes??[],"GTIN"),priceCents,quantity:Number(v.available_quantity??0),
    options:Object.fromEntries((v.attribute_combinations??[]).map((a:Json)=>[String(a.id),String(a.value_name??a.value_id??"")]))})),
  };
  return normalized;
 }
 async category(auth:ProviderAuth,id:string):Promise<CategoryRequirements>{
  const token=auth.accessToken;
  const category=await this.request("/categories/"+identifier(id,/^MLB\d+$/),token);
  const attributes=await this.request("/categories/"+identifier(id)+"/attributes",token);
  const terms=await this.request("/categories/"+identifier(id)+"/sale_terms",token);
  const definition=(a:Json)=>({id:String(a.id),name:String(a.name),required:!!a.tags?.required,variation:!!a.tags?.allow_variations,values:a.values?.map((v:Json)=>({id:String(v.id),name:String(v.name)}))});
  return {id,name:String(category.data.name),leaf:!(category.data.children_categories??[]).length,allowed:category.data.settings?.listing_allowed!==false,
   attributes:(attributes.data as unknown as Json[]).map(definition),saleTerms:(terms.data as unknown as Json[]).map(definition)};
 }
 private payload(input:ListingWrite):Json{
  if(input.userProducts&&input.variants?.length)throw new MarketplaceError("ML_UP_REQUIRES_ONE_LISTING_PER_VARIANT");
  if(input.variants?.some(v=>v.priceCents!==input.priceCents))throw new MarketplaceError("ML_LEGACY_VARIANTS_REQUIRE_SAME_PRICE");
  const draft=input.draft;
  // No arbitrary settings may replace stock, prices, catalog identity or seller correlation.
  // video_id (YouTube) foi desativado pelo ML em 09/2024: rascunhos antigos perdem o campo em vez de quebrar.
  const {video_id:_youtube,...settings}=draft.settings as Json;
  const allowed=new Set(["shipping","sale_terms","warranty","catalog_product_id","catalog_listing"]);
  if(Object.keys(settings).some(k=>!allowed.has(k)))throw new MarketplaceError("ML_UNSUPPORTED_LISTING_SETTING");
  return {...settings,category_id:draft.categoryId,...(input.userProducts?{family_name:draft.title}:{title:draft.title}),
   price:input.priceCents/100,currency_id:input.currency,available_quantity:input.quantity,buying_mode:draft.buyingMode,
   listing_type_id:draft.listingTypeId,condition:draft.condition,attributes:[...draft.attributes,...(draft.variantAttributes??[]),
    ...(input.sku&&!draft.attributes.some(a=>a.id==="SELLER_SKU")?[{id:"SELLER_SKU",value_name:input.sku}]:[])],
   pictures:draft.pictures.map(source=>({source})),seller_custom_field:input.correlation,
   ...(input.variants?.length?{variations:input.variants.map(v=>({price:v.priceCents/100,available_quantity:v.quantity,
    seller_custom_field:v.sku,attribute_combinations:v.attributes,picture_ids:draft.pictures,
    attributes:v.sku?[{id:"SELLER_SKU",value_name:v.sku}]:[]}))}:{})};
 }
 async validateListing(auth:ProviderAuth,input:ListingWrite):Promise<string[]>{
  const token=auth.accessToken,category=await this.category(auth,input.draft.categoryId);const errors:string[]=[];
  if(!category.leaf||!category.allowed)errors.push("Categoria não permite publicação.");
  const all=[...input.draft.attributes,...(input.draft.variantAttributes??[])];
  for(const attribute of category.attributes.filter(a=>a.required)){
   if(!all.some(a=>a.id===attribute.id&&(a.value_id||a.value_name))&&
    !(attribute.variation&&input.variants?.every(v=>v.attributes.some(a=>a.id===attribute.id&&(a.value_id||a.value_name)))))
    errors.push("Falta atributo: "+attribute.name+" ("+attribute.id+").");
  }
  const terms=Array.isArray(input.draft.settings.sale_terms)?input.draft.settings.sale_terms as ExternalAttribute[]:[];
  for(const term of category.saleTerms?.filter(a=>a.required)??[])if(!terms.some(a=>a.id===term.id&&(a.value_id||a.value_name)))errors.push("Falta condição de venda: "+term.name+".");
  if(!input.draft.pictures.length)errors.push("Falta imagem.");
  if(!input.draft.title.trim())errors.push("Falta título/nome da família.");
  if(input.priceCents<=0||!Number.isSafeInteger(input.priceCents))errors.push("Preço deve ser positivo.");
  if(input.quantity<0||!Number.isSafeInteger(input.quantity))errors.push("Quantidade inválida.");
  if(errors.length)return errors;
  try{await this.request("/items/validate",token,"POST",this.payload(input));}catch(error){
   if(error instanceof MarketplaceError&&error.code==="ML_REQUEST_REJECTED_400")return error.issues?.length?error.issues:["Mercado Livre rejeitou a configuração. Confira atributos, imagens, condição, tipo de anúncio e configurações da categoria."];
   throw error;
  }return [];
 }
 async createListing(auth:ProviderAuth,input:ListingWrite):Promise<ExternalListing>{
  const {data}=await this.request("/items",auth.accessToken,"POST",this.payload(input));
  // Persist the returned ID BEFORE optional description/read; caller performs those as recoverable updates.
  return {id:String(data.id),sellerId:String(data.seller_id),title:String(data.title??data.family_name??input.draft.title),
   categoryId:input.draft.categoryId,priceCents:input.priceCents,quantity:input.quantity,status:String(data.status),
   url:image(data.permalink),currency:input.currency,pictures:input.draft.pictures,attributes:input.draft.attributes,variants:[],
   userProductId:data.user_product_id??undefined,model:input.userProducts?"USER_PRODUCT":"LEGACY",stockWritable:true,priceWritable:true};
 }
 async updateListing(auth:ProviderAuth,id:string,input:Partial<PublishDraft>,userProducts:boolean):Promise<void>{
  const token=auth.accessToken;
  const body:Json={};
  if(input.title)body[userProducts?"family_name":"title"]=input.title;
  if(input.attributes)body.attributes=input.attributes;
  if(input.pictures)body.pictures=input.pictures.map(source=>({source}));
  if(input.settings?.sale_terms)body.sale_terms=input.settings.sale_terms;
  if(input.settings?.shipping)body.shipping=input.settings.shipping;
  if(Object.keys(body).length)await this.request("/items/"+identifier(id),token,"PUT",body);
  if(input.description!==undefined){
   const path="/items/"+identifier(id)+"/description";let exists=false,current:string|undefined;
   try{const result=await this.request(path,token);exists=true;current=String(result.data.plain_text??"");}
   catch(error){if(!(error instanceof MarketplaceError&&error.code==="ML_LISTING_NOT_FOUND"))throw error;}
   if(current!==input.description&&(exists||input.description.trim()))
    await this.request(path+(exists?"?api_version=2":""),token,exists?"PUT":"POST",{plain_text:input.description});
  }
 }
 async setStatus(auth:ProviderAuth,id:string,status:"paused"|"active"|"closed"){await this.request("/items/"+identifier(id),auth.accessToken,"PUT",{status});}
 /** Com variações o preço vai em TODAS (mesmo valor): variação omitida no PUT é apagada pelo ML. Item com automação de preço rejeita price (400). */
 async syncPrice(auth:ProviderAuth,id:string,priceCents:number,variants?:{id:string;priceCents:number}[]){
  if(variants?.some(v=>v.priceCents!==priceCents))throw new MarketplaceError("ML_LEGACY_VARIANTS_REQUIRE_SAME_PRICE");
  await this.request("/items/"+identifier(id),auth.accessToken,"PUT",variants?.length?{variations:variants.map(v=>({id:v.id,price:priceCents/100}))}:{price:priceCents/100});
 }
 async syncStock(auth:ProviderAuth,id:string,quantity:number,variants?:{id:string;quantity:number}[]){
  await this.request("/items/"+identifier(id),auth.accessToken,"PUT",variants?.length?{variations:variants.map(v=>({id:v.id,available_quantity:v.quantity}))}:{available_quantity:quantity});
 }
 // ---------------------------------------------------------------- pedidos, envios e devoluções (API oficial)
 async listOrders(auth:ProviderAuth,input:{updatedFrom:string;updatedTo:string;cursor?:string}){
  const offset=Number(input.cursor??0);
  const q=new URLSearchParams({seller:identifier(auth.accountId),"order.date_last_updated.from":input.updatedFrom,"order.date_last_updated.to":input.updatedTo,sort:"date_asc",offset:String(offset),limit:"50"});
  const {data}=await this.request("/orders/search?"+q,auth.accessToken);
  const ids=(data.results??[]).map((o:Json)=>String(o.id));const total=Number(data.paging?.total??0);
  return {ids,cursor:ids.length&&offset+ids.length<total?String(offset+ids.length):undefined};
 }
 private async shipment(token:string,id:string):Promise<Json>{
  return (await this.request("/shipments/"+identifier(id,/^\d{1,20}$/),token,"GET",undefined,{"x-format-new":"true"})).data;
 }
 /** O JSON novo de /shipments não tem status_history: as datas reais vêm de /history (lista {status,substatus,date}). */
 private async shipmentHistory(token:string,id:string):Promise<Json[]>{
  try{const {data}=await this.request("/shipments/"+identifier(id,/^\d{1,20}$/)+"/history",token,"GET",undefined,{"x-format-new":"true"});return Array.isArray(data)?data as Json[]:[];}
  catch(error){if(error instanceof MarketplaceError&&error.code==="ML_LISTING_NOT_FOUND")return [];throw error;}
 }
 /** order_id saiu de /shipments em 12/10/2025: envio→pedidos é /shipments/{id}/orders (X-New-Domain obrigatório; lista pode ter outros sellers). */
 private async shipmentOrderId(auth:ProviderAuth,id:string):Promise<string|undefined>{
  const {data}=await this.request("/shipments/"+identifier(id,/^\d{1,20}$/)+"/orders",auth.accessToken,"GET",undefined,{"X-New-Domain":"true"});
  const own=(Array.isArray(data)?data as Json[]:[]).find(o=>String(o.seller_id)===auth.accountId&&/^\d{1,20}$/.test(String(o.order_id)));
  return own?String(own.order_id):undefined;
 }
 async getOrder(auth:ProviderAuth,id:string):Promise<ExternalOrder>{
  const {data}=await this.request("/orders/"+identifier(id,/^\d{1,20}$/),auth.accessToken);
  if(String(data.seller?.id)!==auth.accountId)throw new MarketplaceError("ML_ORDER_OWNER_MISMATCH");
  const items=(data.order_items??[]).map((line:Json)=>({externalItemId:String(line.item?.id),externalVariationId:line.item?.variation_id?String(line.item.variation_id):undefined,
   sku:line.item?.seller_sku??undefined,title:String(line.item?.title??"Item Mercado Livre").slice(0,300),
   variantLabel:(line.item?.variation_attributes??[]).map((a:Json)=>`${a.name}: ${a.value_name}`).join(" · ")||undefined,
   quantity:Number(line.quantity),unitPriceCents:cents(line.unit_price)}));
  let shipmentData:Json|undefined;
  if(data.shipping?.id)shipmentData=await this.shipment(auth.accessToken,String(data.shipping.id)).catch(error=>{if(error instanceof MarketplaceError&&error.code==="ML_LISTING_NOT_FOUND")return undefined;throw error;});
  const shipmentState=shipmentData?ML_SHIPMENT[String(shipmentData.status)]??"PENDING":undefined;
  const logisticType=shipmentData?String(shipmentData.logistic?.type??""):undefined;
  const history=shipmentData&&["shipped","delivered","not_delivered"].includes(String(shipmentData.status))?await this.shipmentHistory(auth.accessToken,String(shipmentData.id)):[];
  const status=String(data.status);
  let state:ExternalOrderState=ML_ORDER_CANCELLED.has(status)?"CANCELLED":ML_ORDER_PAID.has(status)?"PAID":"PENDING_PAYMENT";
  if(state==="PAID"&&shipmentState&&shipmentState!=="PENDING"&&shipmentState!=="CANCELLED")state=shipmentState==="NOT_DELIVERED"?"SHIPPED":shipmentState as ExternalOrderState;
  const subtotalCents=items.reduce((sum:number,i:{unitPriceCents:number;quantity:number})=>sum+i.unitPriceCents*i.quantity,0);
  const discountCents=Math.min(subtotalCents,data.coupon?.amount?cents(data.coupon.amount):0);
  // Frete do comprador = lead_time.cost (fórmula oficial: total_amount + taxes.amount + lead_time.cost); o ML é a autoridade.
  const shippingCents=shipmentData?cents(shipmentData.lead_time?.cost??0):0;
  const address=shipmentData?.destination?.shipping_address;
  const paidAt=(data.payments??[]).filter((p:Json)=>p.status==="approved").map((p:Json)=>p.date_approved).filter(Boolean).sort()[0];
  return {id:String(data.id),accountId:String(data.seller.id),state,externalStatus:status,createdAt:String(data.date_created),updatedAt:String(data.last_updated??data.date_closed??data.date_created),
   paidAt:paidAt?String(paidAt):undefined,cancelledAt:state==="CANCELLED"?String(data.cancel_detail?.date??data.last_updated??data.date_closed):undefined,cancelReason:data.cancel_detail?.description?String(data.cancel_detail.description).slice(0,200):undefined,
   currency:String(data.currency_id??"BRL"),items,subtotalCents,discountCents,shippingCents,totalCents:subtotalCents-discountCents+shippingCents,
   buyer:{id:data.buyer?.id?String(data.buyer.id):undefined,nickname:data.buyer?.nickname??undefined,name:[data.buyer?.first_name,data.buyer?.last_name].filter(Boolean).join(" ")||undefined},
   shippingAddress:address?{city:address.city?.name??undefined,state:address.state?.id??address.state?.name??undefined,postalCode:address.zip_code??undefined}:undefined,
   shipment:shipmentData?{externalId:String(shipmentData.id),state:shipmentState!,externalStatus:String(shipmentData.status),substatus:shipmentData.substatus??undefined,logisticType:logisticType||undefined,
    carrier:shipmentData.tracking_method??undefined,trackingNumber:shipmentData.tracking_number??undefined,
    // Etiqueta só em Mercado Envios 2 pronto para despachar (ready_to_print; printed = reimpressão); nunca em Full (o ML imprime).
    labelAvailable:shipmentData.logistic?.mode==="me2"&&String(shipmentData.status)==="ready_to_ship"&&["ready_to_print","printed"].includes(String(shipmentData.substatus))&&logisticType!=="fulfillment",
    fulfilledByMarketplace:logisticType==="fulfillment",shippedAt:firstAt(history,"shipped"),deliveredAt:firstAt(history,"delivered"),
    estimatedDeliveryAt:shipmentData.lead_time?.estimated_delivery_time?.date??undefined}:undefined,
   data:{packId:data.pack_id??undefined,paidAmountCents:data.paid_amount!==undefined?cents(data.paid_amount):undefined,tags:Array.isArray(data.tags)?data.tags.slice(0,20):[],shippingId:data.shipping?.id?String(data.shipping.id):undefined}};
 }
 /** Reclamações do pedido (post-purchase) e, quando houver, a devolução física de cada uma. */
 async getReturns(auth:ProviderAuth,orderId:string):Promise<ExternalReturn[]>{
  // order_id traz todas as reclamações do pedido (inclusive as abertas sobre o envio ou o pagamento).
  const q=new URLSearchParams({order_id:identifier(orderId,/^\d{1,20}$/),limit:"100"});
  const {data}=await this.request("/post-purchase/v1/claims/search?"+q,auth.accessToken);
  const result:ExternalReturn[]=[];
  for(const claim of (data.data??[]) as Json[]){
   if(!claim.id)continue;
   let ret:Json|undefined;
   try{ret=(await this.request("/post-purchase/v2/claims/"+identifier(String(claim.id),/^\d{1,20}$/)+"/returns",auth.accessToken)).data;}
   catch(error){if(!(error instanceof MarketplaceError&&error.code==="ML_LISTING_NOT_FOUND"))throw error;}
   const claimClosed=String(claim.status)==="closed";
   const state:ExternalReturnState=ret?ML_RETURN[String(ret.status)]??"APPROVED":claimClosed?"CANCELLED":"REQUESTED";
   const lines=((ret?.orders??[]) as Json[]).filter(o=>String(o.order_id)===orderId&&o.item_id);
   result.push({id:String(claim.id),orderId,state,externalStatus:ret?String(ret.status):String(claim.status),reason:claim.reason_id?String(claim.reason_id):undefined,
    items:lines.map(o=>({externalItemId:String(o.item_id),externalVariationId:o.variation_id?String(o.variation_id):undefined,quantity:Number(o.return_quantity??o.total_quantity??1)})),
    createdAt:String(claim.date_created),updatedAt:String(ret?.last_updated??claim.last_updated??claim.date_created)});
  }
  return result;
 }
 async shippingLabel(auth:ProviderAuth,order:ExternalOrder):Promise<ShippingLabel>{
  if(!order.shipment?.externalId||!order.shipment.labelAvailable)throw new MarketplaceError("ML_LABEL_NOT_AVAILABLE");
  const {bytes,headers}=await this.request("/shipment_labels?"+new URLSearchParams({shipment_ids:identifier(order.shipment.externalId,/^\d{1,20}$/),response_type:"pdf"}),auth.accessToken,"GET",undefined,{},true);
  if(!bytes?.length)throw new MarketplaceError("ML_LABEL_NOT_AVAILABLE");
  return {contentType:headers.get("content-type")?.includes("zip")?"application/zip":"application/pdf",base64:Buffer.from(bytes).toString("base64"),filename:`etiqueta-ml-${order.id}.pdf`};
 }
 async cancelOrder():Promise<void>{throw new MarketplaceError("BLOCKED_EXTERNAL_CAPABILITY");}
 /** Envio/reclamação apontam para o pedido de origem. */
 async resolveOrderId(auth:ProviderAuth,resource:string):Promise<string|undefined>{
  const order=resource.match(/^\/orders\/(\d{1,20})$/);if(order)return order[1];
  const shipment=resource.match(/^\/shipments\/(\d{1,20})$/);if(shipment)return this.shipmentOrderId(auth,shipment[1]);
  const claim=mercadoLivreResource("post_purchase",resource).match(/^\/post-purchase\/v1\/claims\/(\d{1,20})$/);
  if(claim){
   const {data}=await this.request("/post-purchase/v1/claims/"+claim[1],auth.accessToken);const target=String(data.resource_id??"");
   if(!/^\d{1,20}$/.test(target))return undefined;
   if(data.resource==="order")return target;if(data.resource==="shipment")return this.shipmentOrderId(auth,target);
  }
  return undefined;
 }
 /** O Mercado Livre não assina notificações: só aceita o app certo, tópicos conhecidos e recursos no formato oficial. */
 parseNotification(input:{rawBody:string}):ProviderNotification|undefined{
  let body:Json;try{body=JSON.parse(input.rawBody);}catch{return undefined;}
  if(String(body.application_id)!==this.config.clientId||!body.user_id)return undefined;
  const topic=String(body.topic??""),resource=mercadoLivreResource(topic,String(body.resource??""));
  const pattern=Object.prototype.hasOwnProperty.call(ML_TOPICS,topic)?ML_TOPICS[topic]:undefined;if(!pattern||!pattern.test(resource))return undefined;
  // Fallback estável exige o timestamp: o recurso sozinho não pode suprimir mudanças futuras.
  const eventId=body._id??body.id??(body.sent?createHash("sha256").update([body.user_id,topic,resource,body.sent].join(":")).digest("hex"):undefined);
  if(!eventId||String(eventId).length>200)return undefined;
  const kind=mercadoLivreNotificationKind(topic);
  return {accountId:String(body.user_id),eventId:String(eventId),topic,kind,resource,externalOrderId:resource.match(/^\/orders\/(\d{1,20})$/)?.[1]};
 }
}

export function mercadoLivreConfig(env:NodeJS.ProcessEnv):MercadoLivreConfig|undefined{
 const {ML_CLIENT_ID:clientId,ML_CLIENT_SECRET:clientSecret,ML_REDIRECT_URI:redirectUri}=env;
 if(!clientId||!clientSecret||!redirectUri)return;
 try{const url=new URL(redirectUri);if(url.protocol!=="https:"||url.search||url.hash||url.username||url.pathname!=="/v1/marketplaces/mercado-livre/callback")return;}catch{return;}
 return {clientId,clientSecret,redirectUri};
}
