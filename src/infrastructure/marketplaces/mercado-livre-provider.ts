import type { CategoryRequirements, ListingWrite, MarketplaceProvider, MarketplaceTokens } from "../../application/ports/marketplace-provider.port.js";
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

/** All network calls are confined to the official API origin. Provider errors never include response bodies. */
export class MercadoLivreProvider implements MarketplaceProvider {
 readonly id="MERCADO_LIVRE" as const;
 private nextCallAt=0;
 constructor(private readonly config:MercadoLivreConfig,private readonly fetcher:typeof fetch=fetch){}
 authorizationUrl(state:string,challenge:string):string{
  const url=new URL("https://auth.mercadolivre.com.br/authorization");
  url.search=new URLSearchParams({response_type:"code",client_id:this.config.clientId,redirect_uri:this.config.redirectUri,state,code_challenge:challenge,code_challenge_method:"S256"}).toString();return url.href;
 }
 private async request(path:string,token?:string,method="GET",body?:unknown,headers:Record<string,string>={}):Promise<{data:Json;headers:Headers}>{
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
  try{return {data:await response.json() as Json,headers:response.headers};}catch{throw new MarketplaceError("ML_INVALID_RESPONSE",true);}
 }
 private async token(fields:Record<string,string>):Promise<MarketplaceTokens>{
  const {data}=await this.request("/oauth/token",undefined,"POST",new URLSearchParams({...fields,client_id:this.config.clientId,client_secret:this.config.clientSecret}),{"Content-Type":"application/x-www-form-urlencoded"});
  if(!data.access_token||!data.refresh_token||!data.user_id||!(Number(data.expires_in)>0))throw new MarketplaceError("ML_INVALID_TOKEN_RESPONSE");
  const scopes=String(data.scope??"").split(" ");if(!["read","write","offline_access"].every(s=>scopes.includes(s)))throw new MarketplaceError("ML_REQUIRED_SCOPES_MISSING");
  return {accessToken:String(data.access_token),refreshToken:String(data.refresh_token),expiresAt:new Date(Date.now()+Number(data.expires_in)*1000).toISOString(),userId:String(data.user_id)};
 }
 connect(code:string,verifier:string){return this.token({grant_type:"authorization_code",code,redirect_uri:this.config.redirectUri,code_verifier:verifier});}
 refreshConnection(refreshToken:string){return this.token({grant_type:"refresh_token",refresh_token:refreshToken});}
 async disconnect(token:string,userId:string){await this.request("/users/"+identifier(userId)+"/applications/"+identifier(this.config.clientId),token,"DELETE");}
 async account(token:string){
  const {data}=await this.request("/users/me",token);
  if(!data.id||data.site_id!=="MLB")throw new MarketplaceError("ML_ACCOUNT_SITE_UNSUPPORTED");
  return {id:String(data.id),name:String(data.nickname??data.id),siteId:String(data.site_id),userProducts:Array.isArray(data.tags)&&data.tags.includes("user_product_seller")};
 }
 async listExternalProducts(token:string,userId:string,cursor?:string){
  const q=new URLSearchParams({search_type:"scan",limit:"50",...(cursor?{scroll_id:cursor}:{})});
  const {data}=await this.request("/users/"+identifier(userId)+"/items/search?"+q,token);
  return {ids:(data.results??[]).map(String),cursor:data.results?.length?data.scroll_id as string|undefined:undefined,total:Number(data.paging?.total??0)};
 }
 async getListing(token:string,id:string):Promise<ExternalListing>{
  const {data}=await this.request("/items/"+identifier(id,/^MLB\d+$/),token);
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
  let stockWritable=data.shipping?.logistic_type!=="fulfillment"&&!data.inventory_id;
  const userProductIds=[...new Set([data.user_product_id,...(data.variations??[]).map((v:Json)=>v.user_product_id)].filter(Boolean).map(String))];
  for(const userProductId of userProductIds){
   const stock=await this.request("/user-products/"+identifier(userProductId,/^MLBU\d+$/)+"/stock",token);
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
 async category(token:string,id:string):Promise<CategoryRequirements>{
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
  const allowed=new Set(["shipping","sale_terms","warranty","video_id","catalog_product_id","catalog_listing"]);
  if(Object.keys(draft.settings).some(k=>!allowed.has(k)))throw new MarketplaceError("ML_UNSUPPORTED_LISTING_SETTING");
  return {...draft.settings,category_id:draft.categoryId,...(input.userProducts?{family_name:draft.title}:{title:draft.title}),
   price:input.priceCents/100,currency_id:input.currency,available_quantity:input.quantity,buying_mode:draft.buyingMode,
   listing_type_id:draft.listingTypeId,condition:draft.condition,attributes:[...draft.attributes,...(draft.variantAttributes??[]),
    ...(input.sku&&!draft.attributes.some(a=>a.id==="SELLER_SKU")?[{id:"SELLER_SKU",value_name:input.sku}]:[])],
   pictures:draft.pictures.map(source=>({source})),seller_custom_field:input.correlation,
   ...(input.variants?.length?{variations:input.variants.map(v=>({price:v.priceCents/100,available_quantity:v.quantity,
    seller_custom_field:v.sku,attribute_combinations:v.attributes,picture_ids:draft.pictures,
    attributes:v.sku?[{id:"SELLER_SKU",value_name:v.sku}]:[]}))}:{})};
 }
 async validateListing(token:string,input:ListingWrite):Promise<string[]>{
  const category=await this.category(token,input.draft.categoryId);const errors:string[]=[];
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
 async createListing(token:string,input:ListingWrite):Promise<ExternalListing>{
  const {data}=await this.request("/items",token,"POST",this.payload(input));
  // Persist the returned ID BEFORE optional description/read; caller performs those as recoverable updates.
  return {id:String(data.id),sellerId:String(data.seller_id),title:String(data.title??data.family_name??input.draft.title),
   categoryId:input.draft.categoryId,priceCents:input.priceCents,quantity:input.quantity,status:String(data.status),
   url:image(data.permalink),currency:input.currency,pictures:input.draft.pictures,attributes:input.draft.attributes,variants:[],
   userProductId:data.user_product_id??undefined,model:input.userProducts?"USER_PRODUCT":"LEGACY",stockWritable:true,priceWritable:true};
 }
 async updateListing(token:string,id:string,input:Partial<PublishDraft>,userProducts:boolean):Promise<void>{
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
 async setStatus(token:string,id:string,status:"paused"|"active"|"closed"){await this.request("/items/"+identifier(id),token,"PUT",{status});}
 async syncPrice(token:string,id:string,priceCents:number){await this.request("/items/"+identifier(id),token,"PUT",{price:priceCents/100});}
 async syncStock(token:string,id:string,quantity:number,variants?:{id:string;quantity:number}[]){
  await this.request("/items/"+identifier(id),token,"PUT",variants?.length?{variations:variants.map(v=>({id:v.id,available_quantity:v.quantity}))}:{available_quantity:quantity});
 }
}

export function mercadoLivreConfig(env:NodeJS.ProcessEnv):MercadoLivreConfig|undefined{
 const {ML_CLIENT_ID:clientId,ML_CLIENT_SECRET:clientSecret,ML_REDIRECT_URI:redirectUri}=env;
 if(!clientId||!clientSecret||!redirectUri)return;
 try{const url=new URL(redirectUri);if(url.protocol!=="https:"||url.search||url.hash||url.username||url.pathname!=="/v1/marketplaces/mercado-livre/callback")return;}catch{return;}
 return {clientId,clientSecret,redirectUri};
}
