import type { CategoryRequirements, ExternalOrder, ExternalOrderItem, ExternalOrderState, ExternalReturn, ExternalReturnState, ExternalShipmentState, ListingWrite, MarketplaceProvider, MarketplaceTokens, ProviderAuth, ProviderCapabilities, ProviderNotification, ShippingLabel } from "../../application/ports/marketplace-provider.port.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { MarketplaceError, type ExternalAttribute, type ExternalListing, type ExternalVariant, type PublishDraft } from "../../domain/marketplaces/marketplace.model.js";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Shopee Open Platform API v2 (https://open.shopee.com/documents).
 * Rede confinada ao host oficial configurado; o único download externo é a imagem https do rascunho
 * (exigido pela Shopee: a imagem precisa ser enviada ao media_space antes do add_item), com bloqueio de
 * hosts privados, sem redirecionamento e com limite de tamanho. Erros nunca carregam corpo de resposta nem token.
 */
export type ShopeeConfig = { partnerId:string; partnerKey:string; redirectUri:string; apiBaseUrl:string };
export type ShopeeOptions = { minIntervalMs?:number; labelPollMs?:number; now?:()=>number };
type Json = Record<string,any>;

const API_HOSTS=new Set(["partner.shopeemobile.com","openplatform.shopee.com.br","partner.test-stable.shopeemobile.com"]);
const DEFAULT_BASE="https://partner.shopeemobile.com";
const DAY=86400,ORDER_WINDOW=15*DAY,RETURN_LOOKBACK=60*DAY,MAX_IMAGE_BYTES=10*1024*1024;
const ALLOWED_SETTINGS=new Set(["logistic_info","brand","pre_order"]);

const id64=(value:unknown,code="INVALID_EXTERNAL_IDENTIFIER",allowZero=false):number=>{
 const s=String(value??"");const n=Number(s);
 if(!/^\d{1,16}$/.test(s)||!Number.isSafeInteger(n)||(!allowZero&&n<=0))throw new MarketplaceError(code);return n;
};
const orderSn=(value:unknown):string=>{const s=String(value??"");if(!/^[A-Z0-9]{6,40}$/i.test(s))throw new MarketplaceError("INVALID_EXTERNAL_IDENTIFIER");return s;};
const cents=(value:unknown):number=>{
 const amount=Number(value);if(value===null||value===""||!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(Math.round(amount*100)))throw new MarketplaceError("INVALID_EXTERNAL_PRICE");
 return Math.round(amount*100);
};
const optionalCents=(value:unknown):number|undefined=>value===undefined||value===null||value===""?undefined:cents(value);
const iso=(seconds:unknown):string|undefined=>{const n=Number(seconds);return Number.isFinite(n)&&n>0?new Date(n*1000).toISOString():undefined;};
const safeCode=(value:unknown):string|undefined=>typeof value==="string"&&/^[A-Za-z0-9_.:-]{1,80}$/.test(value)?value:undefined;
const text=(value:unknown,max:number):string|undefined=>typeof value==="string"&&value.trim()?value.slice(0,max):undefined;
const image=(value:unknown):string|undefined=>{
 if(typeof value!=="string")return;try{const u=new URL(value);if(u.protocol==="https:"&&!u.username&&!u.password)return u.href;}catch{}return;
};
/** Só hosts públicos por nome: IP literal, localhost e domínios internos nunca são baixados. */
const privateHost=(host:string):boolean=>{
 const h=host.toLowerCase().replace(/\.$/,"");
 if(!h||h.startsWith("[")||h.includes(":")||h==="localhost"||/\.(localhost|local|internal|lan|home|corp)$/.test(h))return true;
 return /^\d{1,3}(\.\d{1,3}){3}$/.test(h)||/^\d+$/.test(h)||/^0x/i.test(h);
};
const sumStock=(stock:Json|undefined):number=>((stock?.seller_stock??[]) as Json[]).reduce((sum,s)=>sum+Math.max(0,Number(s.stock??0)||0),0);
/** Estoque gravável: um único local do vendedor e nada armazenado pela Shopee (FBS). */
const stockLocked=(stock:Json|undefined):boolean=>((stock?.seller_stock??[]) as Json[]).length>1||((stock?.shopee_stock??[]) as Json[]).some(s=>Number(s.stock??0)>0);
const priceOf=(priceInfo:unknown):Json|undefined=>Array.isArray(priceInfo)?priceInfo[0]:undefined;
const promoted=(row:Json):boolean=>{
 const p=priceOf(row.price_info);
 return Number(row.promotion_id??0)>0||(p!==undefined&&p.current_price!==undefined&&p.original_price!==undefined&&Number(p.current_price)!==Number(p.original_price));
};

const ITEM_STATUS:Record<string,string>={NORMAL:"active",UNLIST:"paused",REVIEWING:"under_review",BANNED:"closed",DELETED:"closed",SELLER_DELETE:"closed",SHOPEE_DELETE:"closed"};
const SHIPMENT:Record<ExternalOrderState,ExternalShipmentState>={PENDING_PAYMENT:"PENDING",PAID:"PENDING",READY_TO_SHIP:"READY_TO_SHIP",SHIPPED:"SHIPPED",DELIVERED:"DELIVERED",CANCELLED:"CANCELLED"};
// Pedido: a Shopee é a autoridade. IN_CANCEL = cancelamento pedido e ainda pendente (segue pago).
const ORDER_STATUS:Record<string,ExternalOrderState>={UNPAID:"PENDING_PAYMENT",READY_TO_SHIP:"PAID",INVOICE_PENDING:"PAID",IN_CANCEL:"PAID",PROCESSED:"READY_TO_SHIP",RETRY_SHIP:"READY_TO_SHIP",
 SHIPPED:"SHIPPED",TO_CONFIRM_RECEIVE:"SHIPPED",COMPLETED:"DELIVERED",TO_RETURN:"DELIVERED",CANCELLED:"CANCELLED"};
const RETURN_STATUS:Record<string,ExternalReturnState>={REQUESTED:"REQUESTED",JUDGING:"REQUESTED",SELLER_DISPUTE:"REQUESTED",ACCEPTED:"APPROVED",PROCESSING:"APPROVED",CLOSED:"COMPLETED",CANCELLED:"CANCELLED"};
const CANCEL_REASONS=["OUT_OF_STOCK","CUSTOMER_REQUEST","UNDELIVERABLE_AREA","COD_NOT_SUPPORTED"] as const;
const PUSH_CODES:Record<number,string>={3:"order_status_push",4:"order_trackingno_push"};
const LABEL_STATUSES=new Set(["READY_TO_SHIP","PROCESSED","RETRY_SHIP"]);

export class ShopeeProvider implements MarketplaceProvider {
 readonly id="SHOPEE" as const;
 readonly pkce=false;
 readonly capabilities:ProviderCapabilities={listings:"SUPPORTED",publish:"SUPPORTED",priceSync:"SUPPORTED",stockSync:"SUPPORTED",orders:"SUPPORTED",shipments:"SUPPORTED",labels:"SUPPORTED",cancelOrder:"SUPPORTED",returns:"SUPPORTED",webhooks:"SUPPORTED"};
 private nextCallAt=0;
 private readonly minInterval:number;private readonly labelPoll:number;private readonly now:()=>number;
 private readonly categoryCache=new Map<string,{at:number;list:Promise<Json[]>}>();
 private readonly returnCache=new Map<string,{at:number;list:Promise<Json[]>}>();
 constructor(private readonly config:ShopeeConfig,private readonly fetcher:typeof fetch=fetch,options:ShopeeOptions={}){
  this.minInterval=options.minIntervalMs??200;this.labelPoll=options.labelPollMs??1500;this.now=options.now??Date.now;
 }
 get applicationId(){return this.config.partnerId;}
 private sign(base:string){return createHmac("sha256",this.config.partnerKey).update(base).digest("hex");}
 private shopId(auth:{accountId:string;metadata?:Record<string,string>}):string{
  const shop=auth.metadata?.shopId??auth.accountId;
  if(auth.metadata?.shopId&&auth.metadata.shopId!==auth.accountId)throw new MarketplaceError("SHOPEE_SHOP_MISMATCH");
  return String(id64(shop));
 }
 authorizationUrl(state:string):string{
  // A Shopee não devolve `state`: ele viaja dentro do redirect e volta junto com code e shop_id.
  const path="/api/v2/shop/auth_partner",timestamp=Math.floor(this.now()/1000),redirect=new URL(this.config.redirectUri);
  redirect.searchParams.set("state",state);
  const url=new URL(this.config.apiBaseUrl+path);
  url.search=new URLSearchParams({partner_id:this.config.partnerId,timestamp:String(timestamp),sign:this.sign(this.config.partnerId+path+timestamp),redirect:redirect.href}).toString();
  return url.href;
 }
 private reject(errorCode:unknown,status:number):MarketplaceError{
  const code=safeCode(errorCode)??"";
  if(/invalid_acc?e+ss?_token|error_auth|invalid_token|token_expired|access_token_expired/i.test(code))return new MarketplaceError("REAUTH_REQUIRED");
  if(/too_many|rate_?limit|frequen/i.test(code))return new MarketplaceError("SHOPEE_RATE_LIMIT",true,60000);
  if(/error_server|inner|system|busy|timeout|unavailable/i.test(code))return new MarketplaceError("SHOPEE_UNAVAILABLE",true);
  if(/sign/i.test(code))return new MarketplaceError("SHOPEE_SIGNATURE_REJECTED");
  if(/permission|forbidden/i.test(code))return new MarketplaceError("SHOPEE_PERMISSION_DENIED");
  if(/not_?found|not_?exist/i.test(code)||status===404)return new MarketplaceError("SHOPEE_NOT_FOUND");
  const error=new MarketplaceError("SHOPEE_REQUEST_REJECTED");
  if(code)error.issues=["Regra Shopee: "+code];
  return error;
 }
 /** Assina (HMAC-SHA256 do partner_key) e chama o host oficial. API de loja inclui access_token e shop_id na base. */
 private async call(path:string,o:{auth?:ProviderAuth;method?:"GET"|"POST";query?:Record<string,string|number|string[]>;body?:unknown;form?:FormData;binary?:boolean}={}):Promise<{data:Json;bytes?:Uint8Array;headers:Headers}>{
  if(!/^\/api\/v2\/[a-z_]+\/[a-z_]+(\/[a-z_]+)?$/.test(path))throw new MarketplaceError("INVALID_EXTERNAL_RESOURCE");
  const start=Math.max(Date.now(),this.nextCallAt);this.nextCallAt=start+this.minInterval;
  if(start>Date.now())await sleep(start-Date.now());
  const timestamp=Math.floor(this.now()/1000),shop=o.auth?this.shopId(o.auth):undefined;
  const q=new URLSearchParams();
  for(const [key,value] of Object.entries(o.query??{}))for(const v of Array.isArray(value)?value:[value])q.append(key,String(v));
  q.set("partner_id",this.config.partnerId);q.set("timestamp",String(timestamp));
  if(o.auth){q.set("access_token",o.auth.accessToken);q.set("shop_id",shop!);}
  q.set("sign",this.sign(this.config.partnerId+path+timestamp+(o.auth?o.auth.accessToken+shop:"")));
  const method=o.method??(o.body||o.form?"POST":"GET");
  let response:Response;
  try{response=await this.fetcher(this.config.apiBaseUrl+path+"?"+q,{method,redirect:"error",signal:AbortSignal.timeout(30000),
   headers:o.body?{"Content-Type":"application/json"}:{},...(o.form?{body:o.form}:o.body?{body:JSON.stringify(o.body)}:{})});
  }catch{throw new MarketplaceError("SHOPEE_NETWORK_UNCERTAIN",true);}
  if(response.status===429){const seconds=Number(response.headers.get("retry-after"));throw new MarketplaceError("SHOPEE_RATE_LIMIT",true,Math.min(3600000,Math.max(1000,Number.isFinite(seconds)&&seconds>0?seconds*1000:60000)));}
  if(response.status===401)throw new MarketplaceError("REAUTH_REQUIRED");
  if(response.status>=500)throw new MarketplaceError("SHOPEE_UNAVAILABLE",true);
  const type=response.headers.get("content-type")??"";
  if(o.binary&&response.ok&&!type.includes("json"))return {data:{},headers:response.headers,bytes:new Uint8Array(await response.arrayBuffer())};
  let data:Json;
  try{data=await response.json() as Json;}catch{throw response.ok?new MarketplaceError("SHOPEE_INVALID_RESPONSE",true):this.reject(undefined,response.status);}
  if(!response.ok||(typeof data.error==="string"&&data.error))throw this.reject(data?.error,response.status);
  return {data,headers:response.headers};
 }
 private async token(path:string,body:Json,shopId:string):Promise<MarketplaceTokens>{
  const {data}=await this.call(path,{body:{...body,shop_id:id64(shopId),partner_id:id64(this.config.partnerId)}});
  const d=data.response??data;
  if(typeof d.access_token!=="string"||!d.access_token||typeof d.refresh_token!=="string"||!d.refresh_token||!(Number(d.expire_in)>0))throw new MarketplaceError("SHOPEE_INVALID_TOKEN_RESPONSE");
  if(d.shop_id!==undefined&&String(d.shop_id)!==shopId)throw new MarketplaceError("SHOPEE_SHOP_MISMATCH");
  return {accessToken:d.access_token,refreshToken:d.refresh_token,expiresAt:new Date(this.now()+Number(d.expire_in)*1000).toISOString(),userId:shopId,metadata:{shopId}};
 }
 async connect(input:{code:string;params:Record<string,string>}){
  // Autorização de conta principal (main_account_id) devolve várias lojas: fora do escopo desta integração.
  if(!input.params.shop_id||input.params.main_account_id)throw new MarketplaceError("SHOPEE_SHOP_AUTHORIZATION_REQUIRED");
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(input.code))throw new MarketplaceError("OAUTH_AUTHORIZATION_DENIED");
  const shopId=String(id64(input.params.shop_id));
  try{return await this.token("/api/v2/auth/token/get",{code:input.code},shopId);}
  catch(error){if(error instanceof MarketplaceError&&!error.retryable&&error.code!=="SHOPEE_INVALID_TOKEN_RESPONSE")throw new MarketplaceError("SHOPEE_AUTHORIZATION_REJECTED");throw error;}
 }
 /** O refresh token da Shopee gira a cada uso: o novo par substitui o anterior. */
 async refreshConnection(refreshToken:string,auth:{accountId:string;metadata:Record<string,string>}){
  const shopId=this.shopId(auth);
  try{return await this.token("/api/v2/auth/access_token/get",{refresh_token:refreshToken},shopId);}
  catch(error){if(error instanceof MarketplaceError&&!error.retryable)throw new MarketplaceError("REAUTH_REQUIRED");throw error;}
 }
 /**
  * Sem revogação por loja na API v2 (cancel_auth_partner é um fluxo de navegador do lojista).
  * As credenciais são apagadas pelo serviço; o token expira sozinho (4h) e o refresh deixa de ser usado.
  */
 async disconnect(_auth:ProviderAuth):Promise<void>{}
 async account(auth:ProviderAuth){
  const {data}=await this.call("/api/v2/shop/get_shop_info",{auth});
  const d=data.response??data;
  if(d.region!=="BR")throw new MarketplaceError("SHOPEE_ACCOUNT_REGION_UNSUPPORTED");
  const shopId=this.shopId(auth);
  return {id:shopId,name:String(text(d.shop_name,160)??"Loja Shopee "+shopId),siteId:"BR",userProducts:false,metadata:{shopId}};
 }
 // ---------------------------------------------------------------- anúncios
 async listExternalProducts(auth:ProviderAuth,cursor?:string){
  const offset=cursor===undefined?0:Number(cursor);if(!Number.isSafeInteger(offset)||offset<0)throw new MarketplaceError("INVALID_EXTERNAL_CURSOR");
  const {data}=await this.call("/api/v2/product/get_item_list",{auth,query:{offset,page_size:100,item_status:["NORMAL","UNLIST"]}});
  const d=data.response??{};const ids=((d.item??[]) as Json[]).map(i=>String(id64(i.item_id)));
  const next=Number(d.next_offset);
  return {ids,cursor:d.has_next_page&&ids.length&&Number.isSafeInteger(next)&&next>offset?String(next):undefined,total:Number(d.total_count??ids.length)};
 }
 private async baseInfo(auth:ProviderAuth,id:string):Promise<Json>{
  const {data}=await this.call("/api/v2/product/get_item_base_info",{auth,query:{item_id_list:String(id64(id))}});
  const item=((data.response?.item_list??[]) as Json[]).find(i=>String(i.item_id)===String(id64(id)));
  if(!item)throw new MarketplaceError("SHOPEE_LISTING_NOT_FOUND");return item;
 }
 private async models(auth:ProviderAuth,id:string):Promise<{tiers:Json[];models:Json[]}>{
  const {data}=await this.call("/api/v2/product/get_model_list",{auth,query:{item_id:String(id64(id))}});
  return {tiers:data.response?.tier_variation??[],models:data.response?.model??[]};
 }
 async getListing(auth:ProviderAuth,id:string):Promise<ExternalListing>{
  const item=await this.baseInfo(auth,id),shop=this.shopId(auth);
  let variants:ExternalVariant[]=[],priceWritable=!promoted(item),stockWritable=!stockLocked(item.stock_info_v2);
  let priceCents:number,quantity:number;
  if(item.has_model){
   const {tiers,models}=await this.models(auth,id);
   variants=models.map(m=>{
    const p=priceOf(m.price_info);if(promoted(m))priceWritable=false;if(stockLocked(m.stock_info_v2))stockWritable=false;
    const options:Record<string,string>={};
    (Array.isArray(m.tier_index)?m.tier_index:[]).forEach((index:number,tier:number)=>{const t=tiers[tier];const option=t?.option_list?.[index]?.option;if(t?.name&&option!==undefined)options[String(t.name)]=String(option);});
    return {id:String(id64(m.model_id)),sku:text(m.model_sku,120),priceCents:cents(p?.original_price??p?.current_price),quantity:sumStock(m.stock_info_v2),options};
   });
   if(!variants.length)throw new MarketplaceError("SHOPEE_MODEL_LIST_EMPTY");
   priceCents=Math.min(...variants.map(v=>v.priceCents));quantity=variants.reduce((sum,v)=>sum+v.quantity,0);
  }else{
   const p=priceOf(item.price_info);if(!p)throw new MarketplaceError("SHOPEE_PRICE_UNAVAILABLE");
   priceCents=cents(p.original_price??p.current_price);quantity=sumStock(item.stock_info_v2);
  }
  const attributes:ExternalAttribute[]=((item.attribute_list??[]) as Json[]).flatMap(a=>((a.attribute_value_list??[]) as Json[]).map(v=>({id:String(a.attribute_id),
   ...(Number(v.value_id)>0?{value_id:String(v.value_id)}:{}),...(v.original_value_name?{value_name:String(v.original_value_name)}:{})})));
  if(item.brand?.brand_id!==undefined)attributes.push({id:"BRAND",value_id:String(item.brand.brand_id),...(item.brand.original_brand_name?{value_name:String(item.brand.original_brand_name)}:{})});
  return {id:String(item.item_id),sellerId:shop,title:String(item.item_name??""),description:text(item.description,50000),sku:text(item.item_sku,120),ean:text(item.gtin_code,40),
   categoryId:String(item.category_id??""),priceCents,quantity,status:ITEM_STATUS[String(item.item_status)]??String(item.item_status).toLowerCase(),
   url:`https://shopee.com.br/product/${shop}/${id64(item.item_id)}`,currency:String(priceOf(item.price_info)?.currency??"BRL"),
   pictures:((item.image?.image_url_list??[]) as unknown[]).map(image).filter((u):u is string=>!!u),attributes,variants,model:"LEGACY",stockWritable,priceWritable,updatedAt:iso(item.update_time)};
 }
 private categories(auth:ProviderAuth):Promise<Json[]>{
  const key=this.shopId(auth),hit=this.categoryCache.get(key);
  if(hit&&this.now()-hit.at<3600000)return hit.list;
  const list=this.call("/api/v2/product/get_category",{auth,query:{language:"pt-br"}}).then(r=>(r.data.response?.category_list??[]) as Json[]);
  this.categoryCache.set(key,{at:this.now(),list});list.catch(()=>this.categoryCache.delete(key));return list;
 }
 async category(auth:ProviderAuth,id:string):Promise<CategoryRequirements>{
  const categoryId=id64(id),category=(await this.categories(auth)).find(c=>Number(c.category_id)===categoryId);
  if(!category)throw new MarketplaceError("SHOPEE_CATEGORY_NOT_FOUND");
  const {data}=await this.call("/api/v2/product/get_attribute_tree",{auth,query:{category_id_list:String(categoryId),language:"pt-br"}});
  const tree=((data.response?.list??[]) as Json[]).find(l=>Number(l.category_id)===categoryId)?.attribute_tree??[];
  const name=(row:Json)=>String(row.name??row.display_attribute_name??row.display_value_name??row.original_attribute_name??row.original_value_name??"");
  return {id:String(categoryId),name:String(category.display_category_name??category.original_category_name??categoryId),leaf:!category.has_children,allowed:true,
   attributes:(tree as Json[]).map(a=>({id:String(a.attribute_id),name:name(a),required:!!(a.mandatory??a.is_mandatory),variation:false,
    values:((a.attribute_value_list??[]) as Json[]).map(v=>({id:String(v.value_id),name:name(v)}))}))};
 }
 private settings(settings:Record<string,unknown>):Json{
  // Nenhuma configuração livre pode substituir preço, estoque, identidade ou categoria.
  if(Object.keys(settings).some(k=>!ALLOWED_SETTINGS.has(k)))throw new MarketplaceError("SHOPEE_UNSUPPORTED_LISTING_SETTING");
  const out:Json={};
  if(settings.logistic_info!==undefined){
   if(!Array.isArray(settings.logistic_info)||!settings.logistic_info.length)throw new MarketplaceError("SHOPEE_INVALID_LOGISTIC_INFO");
   out.logistic_info=(settings.logistic_info as Json[]).map(l=>{
    if(!l||typeof l!=="object"||typeof l.enabled!=="boolean")throw new MarketplaceError("SHOPEE_INVALID_LOGISTIC_INFO");
    return {logistic_id:id64(l.logistic_id,"SHOPEE_INVALID_LOGISTIC_INFO"),enabled:l.enabled,...(l.shipping_fee!==undefined?{shipping_fee:cents(l.shipping_fee)/100}:{}),
     ...(l.size_id!==undefined?{size_id:id64(l.size_id,"SHOPEE_INVALID_LOGISTIC_INFO",true)}:{}),...(typeof l.is_free==="boolean"?{is_free:l.is_free}:{})};
   });
  }
  if(settings.brand!==undefined){
   const b=settings.brand as Json;if(!b||typeof b!=="object")throw new MarketplaceError("SHOPEE_INVALID_BRAND");
   out.brand={brand_id:id64(b.brand_id,"SHOPEE_INVALID_BRAND",true),...(text(b.original_brand_name,120)?{original_brand_name:text(b.original_brand_name,120)}:{})};
  }
  if(settings.pre_order!==undefined){
   const p=settings.pre_order as Json;if(!p||typeof p!=="object"||typeof p.is_pre_order!=="boolean")throw new MarketplaceError("SHOPEE_INVALID_PRE_ORDER");
   out.pre_order={is_pre_order:p.is_pre_order,...(p.days_to_ship!==undefined?{days_to_ship:id64(p.days_to_ship,"SHOPEE_INVALID_PRE_ORDER")}:{})};
  }
  return out;
 }
 /** Canais habilitados na loja quando o rascunho não escolhe: canais mascarados filhos e por tamanho ficam de fora. */
 private async logistics(auth:ProviderAuth,chosen?:Json[]):Promise<Json[]>{
  if(chosen)return chosen;
  const {data}=await this.call("/api/v2/logistics/get_channel_list",{auth});
  return ((data.response?.logistics_channel_list??[]) as Json[]).filter(c=>c.enabled===true&&!Number(c.mask_channel_id)&&c.fee_type!=="SIZE_SELECTION")
   .map(c=>({logistic_id:id64(c.logistics_channel_id),enabled:true}));
 }
 private attributeList(attributes:ExternalAttribute[]):Json[]{
  const grouped=new Map<number,Json[]>();
  for(const a of attributes){
   if(a.id==="BRAND"||a.id==="GTIN")continue;
   const list=grouped.get(id64(a.id,"SHOPEE_INVALID_ATTRIBUTE"))??[];
   list.push({value_id:a.value_id?id64(a.value_id,"SHOPEE_INVALID_ATTRIBUTE",true):0,...(a.value_name?{original_value_name:a.value_name}:{})});
   grouped.set(id64(a.id),list);
  }
  return [...grouped].map(([attribute_id,attribute_value_list])=>({attribute_id,attribute_value_list}));
 }
 /** Variações viram até 2 níveis (tier) na ordem dos atributos; toda combinação precisa ser única e completa. */
 private tiers(variants:NonNullable<ListingWrite["variants"]>){
  const names=[...new Set(variants.flatMap(v=>v.attributes.map(a=>a.id)))];
  if(!names.length||names.length>2)throw new MarketplaceError("SHOPEE_VARIANTS_REQUIRE_ONE_OR_TWO_TIERS");
  const options=names.map(()=>[] as string[]);
  const indexes=variants.map(v=>names.map((n,t)=>{
   const value=v.attributes.find(a=>a.id===n)?.value_name?.trim();if(!value)throw new MarketplaceError("SHOPEE_VARIANT_OPTION_MISSING");
   if(!options[t].includes(value))options[t].push(value);return options[t].indexOf(value);
  }));
  if(new Set(indexes.map(i=>i.join(":"))).size!==indexes.length)throw new MarketplaceError("SHOPEE_VARIANT_COMBINATION_DUPLICATED");
  return {tier_variation:names.map((name,t)=>({name,option_list:options[t].map(option=>({option}))})),indexes};
 }
 async validateListing(auth:ProviderAuth,input:ListingWrite):Promise<string[]>{
  const errors:string[]=[];
  try{this.settings(input.draft.settings);}catch(error){if(error instanceof MarketplaceError)errors.push("Configuração Shopee inválida: "+error.code+".");else throw error;}
  if(input.currency!=="BRL")errors.push("A Shopee Brasil aceita apenas BRL.");
  if(!input.draft.title.trim())errors.push("Falta título.");
  if(!input.draft.description.trim())errors.push("Falta descrição.");
  if(!input.draft.pictures.length||input.draft.pictures.length>9)errors.push("Envie de 1 a 9 imagens.");
  else if(input.draft.pictures.some(p=>{const u=image(p);return !u||privateHost(new URL(u).hostname);}))errors.push("Imagens precisam de URL https pública.");
  if(input.priceCents<=0||!Number.isSafeInteger(input.priceCents))errors.push("Preço deve ser positivo.");
  if(input.quantity<0||!Number.isSafeInteger(input.quantity))errors.push("Quantidade inválida.");
  const pkg=input.package;
  if(!pkg?.weightGrams||pkg.weightGrams<=0)errors.push("Falta o peso do pacote.");
  const dims=[pkg?.heightCm,pkg?.widthCm,pkg?.lengthCm];
  if(dims.some(d=>d!==undefined)&&!dims.every(d=>d!==undefined&&d>0))errors.push("Informe altura, largura e comprimento do pacote.");
  if(input.variants?.length){
   try{this.tiers(input.variants);}catch(error){if(error instanceof MarketplaceError)errors.push("Variações inválidas para a Shopee: "+error.code+".");else throw error;}
   if(input.variants.some(v=>v.priceCents<=0||v.quantity<0))errors.push("Preço/quantidade de variação inválidos.");
  }
  let categoryId:number|undefined;try{categoryId=id64(input.draft.categoryId);}catch{errors.push("Categoria Shopee inválida.");}
  if(categoryId){
   try{
    const category=await this.category(auth,String(categoryId));
    if(!category.leaf)errors.push("Categoria não permite publicação (escolha a última subcategoria).");
    for(const a of category.attributes.filter(a=>a.required))if(!input.draft.attributes.some(x=>x.id===a.id&&(x.value_id||x.value_name)))errors.push("Falta atributo: "+a.name+" ("+a.id+").");
   }catch(error){if(error instanceof MarketplaceError&&error.code==="SHOPEE_CATEGORY_NOT_FOUND")errors.push("Categoria Shopee não encontrada.");else throw error;}
  }
  if(!errors.length&&!input.draft.settings.logistic_info&&!(await this.logistics(auth)).length)errors.push("Nenhum canal logístico habilitado na loja Shopee.");
  return errors;
 }
 private async fetchImage(source:string):Promise<Blob>{
  const url=image(source);if(!url||privateHost(new URL(url).hostname))throw new MarketplaceError("SHOPEE_IMAGE_URL_INVALID");
  let response:Response;
  try{response=await this.fetcher(url,{redirect:"error",signal:AbortSignal.timeout(20000)});}catch{throw new MarketplaceError("SHOPEE_IMAGE_DOWNLOAD_FAILED",true);}
  if(!response.ok)throw new MarketplaceError("SHOPEE_IMAGE_DOWNLOAD_FAILED",response.status>=500);
  const type=(response.headers.get("content-type")??"").split(";")[0].trim().toLowerCase();
  if(type!=="image/jpeg"&&type!=="image/png")throw new MarketplaceError("SHOPEE_IMAGE_TYPE_UNSUPPORTED");
  if(Number(response.headers.get("content-length")??0)>MAX_IMAGE_BYTES)throw new MarketplaceError("SHOPEE_IMAGE_TOO_LARGE");
  const chunks:Uint8Array[]=[];let size=0;
  const reader=response.body?.getReader();if(!reader)throw new MarketplaceError("SHOPEE_IMAGE_DOWNLOAD_FAILED",true);
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_IMAGE_BYTES){await reader.cancel();throw new MarketplaceError("SHOPEE_IMAGE_TOO_LARGE");}chunks.push(value);}
  if(!size)throw new MarketplaceError("SHOPEE_IMAGE_DOWNLOAD_FAILED");
  return new Blob(chunks as unknown as ConstructorParameters<typeof Blob>[0],{type});
 }
 /** media_space é API pública (assinatura sem token de loja). */
 private async uploadImages(pictures:string[]):Promise<string[]>{
  const ids:string[]=[];
  for(const picture of pictures){
   const blob=await this.fetchImage(picture),form=new FormData();
   form.append("image",blob,blob.type==="image/png"?"image.png":"image.jpg");
   const {data}=await this.call("/api/v2/media_space/upload_image",{form});
   const info=data.response?.image_info??data.response?.image_info_list?.[0]?.image_info;
   const imageId=typeof info?.image_id==="string"&&/^[A-Za-z0-9_-]{1,200}$/.test(info.image_id)?info.image_id:undefined;
   if(!imageId)throw new MarketplaceError("SHOPEE_IMAGE_UPLOAD_FAILED",true);ids.push(imageId);
  }
  return ids;
 }
 private failures(data:Json,code:string){
  const failed=(data.response?.failure_list??[]) as Json[];
  if(failed.length){const error=new MarketplaceError(code);error.issues=failed.slice(0,20).map(f=>"Falha Shopee"+(f.model_id!==undefined?" no modelo "+id64(f.model_id,"INVALID_EXTERNAL_IDENTIFIER",true):f.item_id!==undefined?" no item "+id64(f.item_id):""));throw error;}
 }
 async createListing(auth:ProviderAuth,input:ListingWrite):Promise<ExternalListing>{
  const settings=this.settings(input.draft.settings),pkg=input.package;
  if(!pkg?.weightGrams||pkg.weightGrams<=0)throw new MarketplaceError("SHOPEE_PACKAGE_WEIGHT_REQUIRED");
  if(input.currency!=="BRL")throw new MarketplaceError("SHOPEE_CURRENCY_UNSUPPORTED");
  const tiers=input.variants?.length?this.tiers(input.variants):undefined;
  const logistic_info=await this.logistics(auth,settings.logistic_info);if(!logistic_info.length)throw new MarketplaceError("SHOPEE_LOGISTICS_NOT_CONFIGURED");
  const image_id_list=await this.uploadImages(input.draft.pictures);
  const gtin=input.draft.attributes.find(a=>a.id==="GTIN")?.value_name;
  const body:Json={item_name:input.draft.title,description:input.draft.description,category_id:id64(input.draft.categoryId),original_price:input.priceCents/100,
   seller_stock:[{stock:input.quantity}],weight:pkg.weightGrams/1000,image:{image_id_list},attribute_list:this.attributeList(input.draft.attributes),logistic_info,
   ...(pkg.heightCm&&pkg.widthCm&&pkg.lengthCm?{dimension:{package_height:Math.ceil(pkg.heightCm),package_width:Math.ceil(pkg.widthCm),package_length:Math.ceil(pkg.lengthCm)}}:{}),
   ...(input.draft.condition==="new"?{condition:"NEW"}:input.draft.condition==="used"?{condition:"USED"}:{}),
   ...(input.sku?{item_sku:input.sku}:{}),...(gtin?{gtin_code:gtin}:{}),...(settings.brand?{brand:settings.brand}:{}),...(settings.pre_order?{pre_order:settings.pre_order}:{}),item_status:"NORMAL"};
  const {data}=await this.call("/api/v2/product/add_item",{auth,body});
  const itemId=String(id64(data.response?.item_id,"SHOPEE_INVALID_RESPONSE"));
  const variants:ExternalVariant[]=[];
  if(tiers&&input.variants){
   // O item já existe: falha aqui deixa o anúncio sem variações e é reportada (o serviço trata como resultado incerto).
   const {data:created}=await this.call("/api/v2/product/init_tier_variation",{auth,body:{item_id:Number(itemId),tier_variation:tiers.tier_variation,
    model:input.variants.map((v,i)=>({tier_index:tiers.indexes[i],original_price:v.priceCents/100,seller_stock:[{stock:v.quantity}],...(v.sku?{model_sku:v.sku}:{})}))}});
   for(const m of (created.response?.model??[]) as Json[]){
    const i=tiers.indexes.findIndex(x=>JSON.stringify(x)===JSON.stringify(m.tier_index));const v=input.variants[i];if(!v||!m.model_id)continue;
    variants.push({id:String(id64(m.model_id)),sku:v.sku,priceCents:v.priceCents,quantity:v.quantity,options:Object.fromEntries(v.attributes.map(a=>[a.id,String(a.value_name??"")]))});
   }
  }
  return {id:itemId,sellerId:this.shopId(auth),title:input.draft.title,categoryId:input.draft.categoryId,priceCents:input.priceCents,quantity:input.quantity,
   status:ITEM_STATUS[String(data.response?.item_status??"NORMAL")]??"active",url:`https://shopee.com.br/product/${this.shopId(auth)}/${itemId}`,currency:"BRL",
   pictures:input.draft.pictures,attributes:input.draft.attributes,variants,model:"LEGACY",stockWritable:true,priceWritable:true};
 }
 async updateListing(auth:ProviderAuth,id:string,input:Partial<PublishDraft>):Promise<void>{
  const body:Json={};
  if(input.title)body.item_name=input.title;
  if(input.description!==undefined&&input.description.trim())body.description=input.description;
  if(input.attributes){body.attribute_list=this.attributeList(input.attributes);const gtin=input.attributes.find(a=>a.id==="GTIN")?.value_name;if(gtin)body.gtin_code=gtin;}
  if(input.condition==="new"||input.condition==="used")body.condition=input.condition.toUpperCase();
  if(input.settings)Object.assign(body,this.settings(input.settings));
  if(input.pictures){if(!input.pictures.length||input.pictures.length>9)throw new MarketplaceError("SHOPEE_INVALID_PICTURES");body.image={image_id_list:await this.uploadImages(input.pictures)};}
  if(Object.keys(body).length)await this.call("/api/v2/product/update_item",{auth,body:{item_id:id64(id),...body}});
 }
 /** paused/active = unlist_item; closed = delete_item (definitivo, como "closed" no Mercado Livre — o serviço exige confirmação). */
 async setStatus(auth:ProviderAuth,id:string,status:"paused"|"active"|"closed"){
  if(status==="closed"){await this.call("/api/v2/product/delete_item",{auth,body:{item_id:id64(id)}});return;}
  if(status!=="paused"&&status!=="active")throw new MarketplaceError("INVALID_LISTING_STATUS");
  const {data}=await this.call("/api/v2/product/unlist_item",{auth,body:{item_list:[{item_id:id64(id),unlist:status==="paused"}]}});
  this.failures(data,"SHOPEE_STATUS_UPDATE_REJECTED");
 }
 async syncPrice(auth:ProviderAuth,id:string,priceCents:number,variants?:{id:string;priceCents:number}[]){
  const prices=[priceCents,...(variants??[]).map(v=>v.priceCents)];
  if(prices.some(p=>!Number.isSafeInteger(p)||p<=0))throw new MarketplaceError("INVALID_EXTERNAL_PRICE");
  let price_list:Json[];
  if(variants?.length)price_list=variants.map(v=>({model_id:id64(v.id),original_price:v.priceCents/100}));
  else{
   const item=await this.baseInfo(auth,id);
   price_list=item.has_model?(await this.models(auth,id)).models.map(m=>({model_id:id64(m.model_id),original_price:priceCents/100})):[{model_id:0,original_price:priceCents/100}];
  }
  const {data}=await this.call("/api/v2/product/update_price",{auth,body:{item_id:id64(id),price_list}});
  this.failures(data,"SHOPEE_PRICE_UPDATE_REJECTED");
 }
 async syncStock(auth:ProviderAuth,id:string,quantity:number,variants?:{id:string;quantity:number}[]){
  if([quantity,...(variants??[]).map(v=>v.quantity)].some(q=>!Number.isSafeInteger(q)||q<0))throw new MarketplaceError("MARKETPLACE_INVALID_QUANTITY");
  const stock_list=variants?.length?variants.map(v=>({model_id:id64(v.id),seller_stock:[{stock:v.quantity}]})):[{model_id:0,seller_stock:[{stock:quantity}]}];
  const {data}=await this.call("/api/v2/product/update_stock",{auth,body:{item_id:id64(id),stock_list}});
  this.failures(data,"SHOPEE_STOCK_UPDATE_REJECTED");
 }
 // ---------------------------------------------------------------- pedidos, logística e devoluções
 /** Cursor opaco: janela atual (≤15 dias, limite da Shopee) + cursor da Shopee dentro dela. */
 async listOrders(auth:ProviderAuth,input:{updatedFrom:string;updatedTo:string;cursor?:string}){
  const from=Math.floor(Date.parse(input.updatedFrom)/1000),to=Math.floor(Date.parse(input.updatedTo)/1000);
  if(!Number.isFinite(from)||!Number.isFinite(to)||from>to)throw new MarketplaceError("INVALID_ORDER_WINDOW");
  let start=from,inner="";
  if(input.cursor){
   let parsed:Json;try{parsed=JSON.parse(Buffer.from(input.cursor,"base64url").toString("utf8"));}catch{throw new MarketplaceError("INVALID_EXTERNAL_CURSOR");}
   if(!Number.isSafeInteger(parsed.s)||parsed.s<from||parsed.s>to||typeof parsed.c!=="string"||parsed.c.length>512||/[\u0000-\u001f]/.test(parsed.c))throw new MarketplaceError("INVALID_EXTERNAL_CURSOR");
   start=parsed.s;inner=parsed.c;
  }
  const end=Math.min(to,start+ORDER_WINDOW);
  const {data}=await this.call("/api/v2/order/get_order_list",{auth,query:{time_range_field:"update_time",time_from:start,time_to:end,page_size:100,cursor:inner,response_optional_fields:"order_status"}});
  const d=data.response??{};const ids=((d.order_list??[]) as Json[]).map(o=>orderSn(o.order_sn));
  const encode=(s:number,c:string)=>Buffer.from(JSON.stringify({s,c})).toString("base64url");
  const next=typeof d.next_cursor==="string"?d.next_cursor:"";
  return {ids,cursor:d.more&&next?encode(start,next):end<to?encode(end,""):undefined};
 }
 private async optional<T>(work:Promise<T>):Promise<T|undefined>{
  try{return await work;}catch(error){if(error instanceof MarketplaceError&&!error.retryable&&error.code!=="REAUTH_REQUIRED")return undefined;throw error;}
 }
 async getOrder(auth:ProviderAuth,id:string):Promise<ExternalOrder>{
  const sn=orderSn(id);
  const {data}=await this.call("/api/v2/order/get_order_detail",{auth,query:{order_sn_list:sn,response_optional_fields:
   "buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,item_list,pay_time,cancel_by,cancel_reason,buyer_cancel_reason,fulfillment_flag,package_list,shipping_carrier,total_amount"}});
  const o=((data.response?.order_list??[]) as Json[]).find(x=>x.order_sn===sn);if(!o)throw new MarketplaceError("SHOPEE_ORDER_NOT_FOUND");
  const status=String(o.order_status),packages=(o.package_list??[]) as Json[];
  let state:ExternalOrderState=ORDER_STATUS[status]??"PENDING_PAYMENT";
  // READY_TO_SHIP só vira "pronto para despachar" quando o envio já foi solicitado (tracking gerado).
  if(status==="READY_TO_SHIP"&&packages.some(p=>p.logistics_status==="LOGISTICS_REQUEST_CREATED"))state="READY_TO_SHIP";
  const items:ExternalOrderItem[]=((o.item_list??[]) as Json[]).map(line=>({externalItemId:String(id64(line.item_id)),
   ...(Number(line.model_id)>0?{externalVariationId:String(id64(line.model_id))}:{}),sku:text(line.model_sku,120)??text(line.item_sku,120),
   title:String(line.item_name??"Item Shopee").slice(0,300),variantLabel:text(line.model_name,200),quantity:Number(line.model_quantity_purchased),
   unitPriceCents:cents(line.model_discounted_price??line.model_original_price)}));
  if(items.some(i=>!Number.isSafeInteger(i.quantity)||i.quantity<=0))throw new MarketplaceError("SHOPEE_INVALID_RESPONSE");
  const subtotalCents=items.reduce((sum,i)=>sum+i.unitPriceCents*i.quantity,0);
  // O total pago vem da Shopee; frete e desconto são a diferença (a taxa estimada fica só no snapshot).
  const totalCents=optionalCents(o.total_amount)??subtotalCents;
  const shippingCents=Math.max(0,totalCents-subtotalCents),discountCents=Math.max(0,subtotalCents-totalCents);
  const single=packages.length===1?packages[0]:undefined;
  const fbs=o.fulfillment_flag==="fulfilled_by_shopee";
  let trackingNumber:string|undefined,shippedAt:string|undefined,deliveredAt:string|undefined;
  if(!fbs&&["READY_TO_SHIP","SHIPPED","DELIVERED"].includes(state)){
   const pkg:Record<string,string>=single?.package_number?{package_number:String(single.package_number)}:{};
   const tracking=await this.optional(this.call("/api/v2/logistics/get_tracking_number",{auth,query:{order_sn:sn,...pkg}}));
   trackingNumber=text(tracking?.data.response?.tracking_number,80);
   if(state!=="READY_TO_SHIP"){
    const info=await this.optional(this.call("/api/v2/logistics/get_tracking_info",{auth,query:{order_sn:sn,...pkg}}));
    const events=((info?.data.response?.tracking_info??[]) as Json[]).filter(e=>Number(e.update_time)>0).sort((a,b)=>Number(a.update_time)-Number(b.update_time));
    shippedAt=iso(events.find(e=>/PICKUP_DONE|PICKED_UP|SHIPPED/i.test(String(e.logistics_status)))?.update_time);
    deliveredAt=iso(events.find(e=>/DELIVERY_DONE|DELIVERED/i.test(String(e.logistics_status)))?.update_time);
   }
  }
  const lost=packages.some(p=>["LOGISTICS_DELIVERY_FAILED","LOGISTICS_LOST","LOGISTICS_INVALID"].includes(String(p.logistics_status)));
  const address=o.recipient_address as Json|undefined;
  const createdAt=iso(o.create_time);if(!createdAt)throw new MarketplaceError("SHOPEE_INVALID_RESPONSE");
  const updatedAt=iso(o.update_time)??createdAt;
  return {id:sn,accountId:this.shopId(auth),state,externalStatus:status,createdAt,updatedAt,paidAt:iso(o.pay_time),
   cancelledAt:state==="CANCELLED"?updatedAt:undefined,cancelReason:text(o.cancel_reason,200)??text(o.buyer_cancel_reason,200),
   currency:String(o.currency??"BRL"),items,subtotalCents,discountCents,shippingCents,totalCents,
   // A Shopee mascara nome/telefone/endereço do destinatário: só id e usuário do comprador.
   buyer:{id:Number(o.buyer_user_id)>0?String(o.buyer_user_id):undefined,nickname:text(o.buyer_username,120)},
   shippingAddress:address?{city:text(address.city,120),state:text(address.state,60),postalCode:text(address.zipcode,20)}:undefined,
   shipment:state==="PENDING_PAYMENT"?undefined:{externalId:single?.package_number?String(single.package_number):undefined,state:lost&&state==="SHIPPED"?"NOT_DELIVERED":SHIPMENT[state],
    externalStatus:String(single?.logistics_status??status),logisticType:fbs?"fulfilled_by_shopee":text(o.fulfillment_flag,60),carrier:text(single?.shipping_carrier??o.shipping_carrier,120),trackingNumber,
    labelAvailable:!fbs&&LABEL_STATUSES.has(status)&&!!trackingNumber&&packages.length<=1,fulfilledByMarketplace:fbs,shippedAt,deliveredAt},
   data:{orderStatus:status,fulfillmentFlag:safeCode(o.fulfillment_flag),packageCount:packages.length,packageNumber:single?.package_number?String(single.package_number):undefined,
    cancelBy:safeCode(o.cancel_by),estimatedShippingFeeCents:optionalCents(o.estimated_shipping_fee),actualShippingFeeCents:optionalCents(o.actual_shipping_fee)}};
 }
 /** A Shopee não filtra devoluções por pedido: varre 60 dias (janelas de 15) com cache curto por loja. */
 private returnList(auth:ProviderAuth):Promise<Json[]>{
  const key=this.shopId(auth),hit=this.returnCache.get(key);
  if(hit&&this.now()-hit.at<60000)return hit.list;
  const list=(async()=>{
   const rows:Json[]=[],now=Math.floor(this.now()/1000);
   for(let start=now-RETURN_LOOKBACK;start<now;start+=ORDER_WINDOW){
    const end=Math.min(now,start+ORDER_WINDOW);
    for(let page=0;page<50;page++){
     const {data}=await this.call("/api/v2/returns/get_return_list",{auth,query:{page_no:page,page_size:100,create_time_from:start,create_time_to:end}});
     const d=data.response??{};
     // Só campos operacionais: o bloco `user` (dados do comprador) não é guardado.
     for(const r of (d.return??[]) as Json[])rows.push({return_sn:r.return_sn,order_sn:r.order_sn,status:r.status,reason:r.reason,refund_amount:r.refund_amount,logistics_status:r.logistics_status,
      create_time:r.create_time,update_time:r.update_time,item:((r.item??[]) as Json[]).map(i=>({item_id:i.item_id,model_id:i.model_id,amount:i.amount}))});
     if(!d.more)break;
    }
   }
   return rows;
  })();
  this.returnCache.set(key,{at:this.now(),list});list.catch(()=>this.returnCache.delete(key));return list;
 }
 async getReturns(auth:ProviderAuth,orderId:string):Promise<ExternalReturn[]>{
  const sn=orderSn(orderId);
  return (await this.returnList(auth)).filter(r=>r.order_sn===sn&&r.return_sn).map(r=>{
   const status=String(r.status),logistics=String(r.logistics_status??"");
   let state:ExternalReturnState=RETURN_STATUS[status]??"REQUESTED";
   if(state==="APPROVED"&&/PICKUP_DONE/.test(logistics))state="IN_TRANSIT";
   if(state==="APPROVED"&&/DELIVERY_DONE/.test(logistics))state="RECEIVED";
   return {id:String(r.return_sn).slice(0,60),orderId:sn,state,externalStatus:status,reason:safeCode(r.reason),refundCents:optionalCents(r.refund_amount),
    items:(r.item as Json[]).filter(i=>Number(i.item_id)>0).map(i=>({externalItemId:String(id64(i.item_id)),...(Number(i.model_id)>0?{externalVariationId:String(id64(i.model_id))}:{}),quantity:Math.max(1,Number(i.amount)||1)})),
    createdAt:iso(r.create_time)??new Date(this.now()).toISOString(),updatedAt:iso(r.update_time)??iso(r.create_time)??new Date(this.now()).toISOString()};
  });
 }
 /** Etiqueta (AWB) só para pedido pronto para envio com tracking: create → result (poll) → download. */
 async shippingLabel(auth:ProviderAuth,order:ExternalOrder):Promise<ShippingLabel>{
  const tracking=order.shipment?.trackingNumber;
  if(!order.shipment?.labelAvailable||!tracking||!LABEL_STATUSES.has(order.externalStatus)||order.shipment.fulfilledByMarketplace)throw new MarketplaceError("SHOPEE_LABEL_NOT_AVAILABLE");
  const sn=orderSn(order.id),pkg=order.shipment.externalId?{package_number:order.shipment.externalId}:{};
  const param=await this.call("/api/v2/logistics/get_shipping_document_parameter",{auth,body:{order_list:[{order_sn:sn,...pkg}]}});
  const suggested=param.data.response?.result_list?.[0]?.suggest_shipping_document_type;
  const type=typeof suggested==="string"&&/^[A-Z_]{1,60}$/.test(suggested)?suggested:"NORMAL_AIR_WAYBILL";
  const created=await this.call("/api/v2/logistics/create_shipping_document",{auth,body:{order_list:[{order_sn:sn,...pkg,tracking_number:tracking,shipping_document_type:type}]}});
  if(created.data.response?.result_list?.[0]?.fail_error)throw new MarketplaceError("SHOPEE_LABEL_NOT_AVAILABLE");
  let ready=false;
  for(let attempt=0;attempt<5&&!ready;attempt++){
   if(attempt)await sleep(this.labelPoll);
   const {data}=await this.call("/api/v2/logistics/get_shipping_document_result",{auth,body:{order_list:[{order_sn:sn,...pkg,shipping_document_type:type}]}});
   const result=data.response?.result_list?.[0];
   if(result?.status==="FAILED"||result?.fail_error)throw new MarketplaceError("SHOPEE_LABEL_NOT_AVAILABLE");
   ready=result?.status==="READY";
  }
  if(!ready)throw new MarketplaceError("SHOPEE_LABEL_PROCESSING",true,5000);
  const {bytes,headers}=await this.call("/api/v2/logistics/download_shipping_document",{auth,binary:true,body:{shipping_document_type:type,order_list:[{order_sn:sn,...pkg}]}});
  if(!bytes?.length)throw new MarketplaceError("SHOPEE_LABEL_NOT_AVAILABLE");
  return {contentType:headers.get("content-type")?.includes("zip")?"application/zip":"application/pdf",base64:Buffer.from(bytes).toString("base64"),filename:`etiqueta-shopee-${sn}.pdf`};
 }
 /** Cancelamento pelo vendedor antes do envio. Motivo livre é traduzido para os motivos oficiais; OUT_OF_STOCK exige os itens. */
 async cancelOrder(auth:ProviderAuth,order:ExternalOrder,reason:string):Promise<void>{
  if(["SHIPPED","DELIVERED","CANCELLED"].includes(order.state)||order.shipment?.fulfilledByMarketplace||!["UNPAID","READY_TO_SHIP","INVOICE_PENDING","PROCESSED","RETRY_SHIP"].includes(order.externalStatus))
   throw new MarketplaceError("SHOPEE_ORDER_NOT_CANCELLABLE");
  const raw=reason.trim(),upper=raw.toUpperCase();
  const cancel_reason=(CANCEL_REASONS as readonly string[]).includes(upper)?upper:/estoque|stock|falta/i.test(raw)?"OUT_OF_STOCK":/cliente|comprador|customer|buyer/i.test(raw)?"CUSTOMER_REQUEST":/área|area|entrega|deliver/i.test(raw)?"UNDELIVERABLE_AREA":undefined;
  if(!cancel_reason)throw new MarketplaceError("SHOPEE_CANCEL_REASON_UNSUPPORTED");
  const body:Json={order_sn:orderSn(order.id),cancel_reason};
  if(cancel_reason==="OUT_OF_STOCK"){
   if(!order.items.length)throw new MarketplaceError("SHOPEE_CANCEL_ITEMS_REQUIRED");
   body.item_list=order.items.map(i=>({item_id:id64(i.externalItemId),model_id:i.externalVariationId?id64(i.externalVariationId):0}));
  }
  await this.call("/api/v2/order/cancel_order",{auth,body});
 }
 /**
  * Push assinado: Authorization = HMAC-SHA256(partner_key, url_de_push + "|" + corpo_bruto).
  * A URL esperada vem da configuração (nunca da requisição). Só pedidos (códigos 3 e 4) viram job;
  * devoluções são relidas na sincronização do pedido.
  */
 parseNotification(input:{headers:Record<string,string|undefined>;rawBody:string;url:string}):ProviderNotification|undefined{
  const header=Object.entries(input.headers).find(([k])=>k.toLowerCase()==="authorization")?.[1]?.trim();
  if(!header||!/^[0-9a-f]{64}$/i.test(header))return undefined;
  const pushUrl=new URL(this.config.redirectUri).origin+"/v1/marketplaces/shopee/notifications";
  const expected=Buffer.from(this.sign(pushUrl+"|"+input.rawBody),"hex"),given=Buffer.from(header.toLowerCase(),"hex");
  if(given.length!==expected.length||!timingSafeEqual(given,expected))return undefined;
  let body:Json;try{body=JSON.parse(input.rawBody);}catch{return undefined;}
  if(!body||typeof body!=="object")return undefined;
  if(body.partner_id!==undefined&&String(body.partner_id)!==this.config.partnerId)return undefined;
  const code=Number(body.code),topic=PUSH_CODES[code];
  if(!topic||!/^\d{1,16}$/.test(String(body.shop_id??""))||!Number.isSafeInteger(Number(body.timestamp)))return undefined;
  if(body.data?.shop_id!==undefined&&String(body.data.shop_id)!==String(body.shop_id))return undefined;
  const sn=String(body.data?.ordersn??body.data?.order_sn??"");if(!/^[A-Z0-9]{6,40}$/i.test(sn))return undefined;
  const bodyHash=createHash("sha256").update(input.rawBody).digest("hex");
  const eventId=createHash("sha256").update([body.shop_id,code,body.timestamp,bodyHash].join(":")).digest("hex");
  return {accountId:String(body.shop_id),eventId,topic,kind:"ORDER",resource:"/orders/"+sn,externalOrderId:sn};
 }
}

export function shopeeConfig(env:NodeJS.ProcessEnv):ShopeeConfig|undefined{
 const {SHOPEE_PARTNER_ID:partnerId,SHOPEE_PARTNER_KEY:partnerKey,SHOPEE_REDIRECT_URI:redirectUri,SHOPEE_API_BASE_URL:base}=env;
 if(!partnerId||!/^\d{1,16}$/.test(partnerId)||!partnerKey||!redirectUri)return;
 try{const url=new URL(redirectUri);if(url.protocol!=="https:"||url.search||url.hash||url.username||url.password||url.pathname!=="/v1/marketplaces/shopee/callback")return;}catch{return;}
 let apiBaseUrl=DEFAULT_BASE;
 if(base){
  try{const url=new URL(base);if(url.protocol!=="https:"||!API_HOSTS.has(url.hostname)||url.port||url.username||url.password||url.search||url.hash||(url.pathname!=="/"&&url.pathname!==""))return;apiBaseUrl=url.origin;}catch{return;}
 }
 return {partnerId,partnerKey,redirectUri,apiBaseUrl};
}
