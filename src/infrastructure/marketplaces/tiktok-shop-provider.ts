import type { CategoryRequirements, ExternalOrder, ExternalOrderItem, ExternalOrderState, ExternalReturn, ExternalReturnState, ExternalShipmentState, ListingWrite, MarketplaceProvider, MarketplaceTokens, ProviderAuth, ProviderCapabilities, ProviderNotification, ShippingLabel } from "../../application/ports/marketplace-provider.port.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { MarketplaceError, type ExternalAttribute, type ExternalListing, type ExternalVariant, type PublishDraft } from "../../domain/marketplaces/marketplace.model.js";

/**
 * TikTok Shop (Partner API — https://partner.tiktokshop.com/docv2). Versão por endpoint, conforme a página de referência
 * (versão é atribuída por API; a anterior fica disponível ≥2 meses após a nova — docv2/page/64f1991064ed2e0295f3cd32):
 * 202309 (shops, categorias, produto, preço, estoque, ativar/desativar, imagens, armazéns, busca de pedidos, rastreio, etiqueta),
 * 202502 (busca de produtos), 202507 (detalhe de pedido), 202509 (edição parcial de produto),
 * 202602 (cancelamento, elegibilidade de pós-venda, busca de devoluções).
 * Rede confinada a open-api.tiktokglobalshop.com / auth.tiktok-shops.com (+ download de etiqueta em domínio TikTok).
 * Erros nunca carregam corpo de resposta, token, app_secret ou URL assinada.
 */
export type TikTokShopConfig = { appKey:string; appSecret:string; serviceId:string; apiBaseUrl:string };
type Json = Record<string,any>;
const API_ORIGIN="https://open-api.tiktokglobalshop.com";
const AUTH_ORIGIN="https://auth.tiktok-shops.com";
const AUTHORIZE_URL="https://services.tiktokshop.com/open/authorize";
/**
 * Domínios aceitos para o doc_url da etiqueta (download sem redirect). A doc só diz que o doc_url vale 24 h e não publica o host
 * (o exemplo usa um host fictício): allowlist NÃO confirmada — revisar na homologação real se o download for recusado.
 */
const LABEL_HOSTS=["tiktokshop.com","tiktokglobalshop.com","tiktok-shops.com","tiktokcdn.com","tiktokcdn-us.com"];
// Códigos do envelope (Common errors, docv2/page/678e3a45786253031531b942): 105002 = token expirado → reconectar;
// 36009002 = limite de requisições (mesmo tratamento do HTTP 429, docv2/page/64f1991d64ed2e0295f3d2c0).
const REAUTH_CODES=new Set([105002]);
const RATE_LIMIT_CODE=36009002;
// Estoque por armazém: faixa documentada em Update Inventory (docv2/page/6503068fc20ad60284b38858).
const MAX_STOCK=99999;
// Status em que o vendedor pode cancelar (Cancel reasons, docv2/page/67e61eee427345048595487d).
const CANCELLABLE=new Set(["UNPAID","ON_HOLD","AWAITING_SHIPMENT"]);
const ID=/^\d{1,30}$/;

const identifier=(value:string,pattern=ID):string=>{if(!pattern.test(value))throw new MarketplaceError("INVALID_EXTERNAL_IDENTIFIER");return encodeURIComponent(value);};
/** "12.34" → 1234 sem ponto flutuante; valores fora do formato decimal são rejeitados. */
export const tiktokCents=(value:unknown):number=>{
 if(value===undefined||value===null||value==="")return 0;
 const text=String(value).trim(),match=text.match(/^(\d{1,13})(?:\.(\d{1,2})0*)?$/);
 if(!match)throw new MarketplaceError("INVALID_EXTERNAL_PRICE");
 return Number(match[1])*100+Number((match[2]??"").padEnd(2,"0"));
};
const amount=(cents:number):string=>{if(!Number.isSafeInteger(cents)||cents<0)throw new MarketplaceError("INVALID_EXTERNAL_PRICE");return (cents/100).toFixed(2);};
const iso=(unix:unknown):string|undefined=>{const n=Number(unix);return Number.isFinite(n)&&n>0?new Date((n>1e12?n:n*1000)).toISOString():undefined;};
const https=(value:unknown):string|undefined=>{if(typeof value!=="string")return;try{const u=new URL(value);if(u.protocol==="https:"&&!u.username&&!u.password)return u.href;}catch{}return;};
const text=(html:unknown):string=>String(html??"").replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|li|div|h\d)>/gi,"\n").replace(/<[^>]*>/g,"")
 .replace(/&nbsp;/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,"\"").replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/\n{3,}/g,"\n\n").trim().slice(0,50000);
const html=(plain:string):string=>plain.split(/\n{2,}/).map(p=>"<p>"+p.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")+"</p>").join("");

/**
 * Assinatura oficial: HMAC-SHA256(app_secret, app_secret + path + params ordenados (chave+valor, sem sign/access_token) + corpo + app_secret), hex.
 * Corpo só entra quando não é multipart.
 */
export function tiktokShopSign(appSecret:string,path:string,query:Record<string,string>,body=""):string{
 const params=Object.keys(query).filter(k=>k!=="sign"&&k!=="access_token").sort().map(k=>k+query[k]).join("");
 return createHmac("sha256",appSecret).update(appSecret+path+params+body+appSecret).digest("hex");
}

const ORDER_STATE:Record<string,ExternalOrderState>={UNPAID:"PENDING_PAYMENT",ON_HOLD:"PENDING_PAYMENT",AWAITING_SHIPMENT:"PAID",AWAITING_COLLECTION:"READY_TO_SHIP",
 PARTIALLY_SHIPPING:"SHIPPED",IN_TRANSIT:"SHIPPED",DELIVERED:"DELIVERED",COMPLETED:"DELIVERED",CANCELLED:"CANCELLED"};
const SHIPMENT_STATE:Record<string,ExternalShipmentState>={UNPAID:"PENDING",ON_HOLD:"PENDING",AWAITING_SHIPMENT:"PENDING",AWAITING_COLLECTION:"READY_TO_SHIP",
 PARTIALLY_SHIPPING:"SHIPPED",IN_TRANSIT:"SHIPPED",DELIVERED:"DELIVERED",COMPLETED:"DELIVERED",CANCELLED:"CANCELLED"};
// return_status (Search Returns 202602, docv2/page/69c3070c441217049711fdea). Sem estado "recebido" próprio: o canal passa direto ao reembolso.
const RETURN_STATE:Record<string,ExternalReturnState>={RETURN_OR_REFUND_REQUEST_PENDING:"REQUESTED",AWAITING_BUYER_RESPONSE:"REQUESTED",REPLACEMENT_REQUEST_PENDING:"REQUESTED",EXCHANGE_REQUEST_PENDING:"REQUESTED",
 REFUND_OR_RETURN_REQUEST_REJECT:"REJECTED",REPLACEMENT_REQUEST_REJECT:"REJECTED",REJECT_RECEIVE_PACKAGE:"REJECTED",
 AWAITING_BUYER_SHIP:"APPROVED",BUYER_SHIPPED_ITEM:"IN_TRANSIT",
 RETURN_OR_REFUND_REQUEST_SUCCESS:"COMPLETED",RETURN_OR_REFUND_REQUEST_COMPLETE:"COMPLETED",REPLACEMENT_REQUEST_REFUND_SUCCESS:"COMPLETED",REPLACEMENT_REQUEST_COMPLETE:"COMPLETED",
 EXCHANGE_REQUEST_REFUND_SUCCESS:"COMPLETED",EXCHANGE_REQUEST_COMPLETE:"COMPLETED",
 RETURN_OR_REFUND_REQUEST_CANCEL:"CANCELLED",REPLACEMENT_REQUEST_CANCEL:"CANCELLED",EXCHANGE_REQUEST_CANCEL:"CANCELLED"};
// Product status (Get Product 202309): DRAFT, PENDING, FAILED, ACTIVATE, SELLER_DEACTIVATED, PLATFORM_DEACTIVATED, FREEZE, DELETED, SCHEDULED.
const LISTING_STATE:Record<string,string>={ACTIVATE:"active",PENDING:"under_review",SELLER_DEACTIVATED:"paused",PLATFORM_DEACTIVATED:"paused",FREEZE:"closed",DELETED:"closed"};
// Webhook `type` com página de tópico oficial (Webhooks > Order/Logistics/Return and Refund/Product): 1 pedido, 3 endereço, 4 pacote,
// 11 cancelamento → pedido; 12 devolução; 5 produto. O overview pede não confiar só no número: o payload de cada tópico também é validado.
const WEBHOOK:Record<number,{topic:string;kind:ProviderNotification["kind"]}>={1:{topic:"ORDER_STATUS_CHANGE",kind:"ORDER"},3:{topic:"RECIPIENT_ADDRESS_UPDATE",kind:"ORDER"},
 4:{topic:"PACKAGE_UPDATE",kind:"ORDER"},11:{topic:"CANCELLATION_STATUS_CHANGE",kind:"ORDER"},12:{topic:"RETURN_STATUS_CHANGE",kind:"RETURN"},5:{topic:"PRODUCT_STATUS_CHANGE",kind:"LISTING"}};
const SETTINGS=new Set(["brand_id","is_cod_allowed"]);

type RequestOptions={query?:Record<string,string>;body?:unknown;form?:FormData;auth?:ProviderAuth;shop?:boolean};

export class TikTokShopProvider implements MarketplaceProvider {
 readonly id="TIKTOK_SHOP" as const;
 readonly pkce=false;
 // Cancelamento: o motivo vem da API oficial de elegibilidade (available_reason_names), nunca de lista fixa — ver cancelOrder.
 readonly capabilities:ProviderCapabilities={listings:"SUPPORTED",publish:"SUPPORTED",priceSync:"SUPPORTED",stockSync:"SUPPORTED",orders:"SUPPORTED",shipments:"SUPPORTED",
  labels:"SUPPORTED",cancelOrder:"SUPPORTED",returns:"SUPPORTED",webhooks:"SUPPORTED"};
 private nextCallAt=0;
 constructor(private readonly config:TikTokShopConfig,private readonly fetcher:typeof fetch=fetch){}
 get applicationId(){return this.config.appKey;}
 authorizationUrl(state:string):string{
  const url=new URL(AUTHORIZE_URL);url.search=new URLSearchParams({service_id:this.config.serviceId,state}).toString();return url.href;
 }
 private async throttle(){const start=Math.max(Date.now(),this.nextCallAt);this.nextCallAt=start+200;if(start>Date.now())await sleep(start-Date.now());}
 private failure(response:Response):never{
  if(response.status===401)throw new MarketplaceError("REAUTH_REQUIRED");
  if(response.status===429)this.rateLimited(response.headers.get("retry-after"));
  if(response.status===404)throw new MarketplaceError("TIKTOK_NOT_FOUND");
  if(response.status>=500)throw new MarketplaceError("TIKTOK_UNAVAILABLE",true);
  throw new MarketplaceError("TIKTOK_REQUEST_REJECTED_"+response.status);
 }
 /** Retry-After pode vir em segundos ou como data HTTP (Rate limits §5.6); sem ele, 30 s. */
 private rateLimited(retryAfter:string|null):never{
  const raw=(retryAfter??"").trim(),seconds=Number(raw),date=raw&&!Number.isFinite(seconds)?Date.parse(raw)-Date.now():NaN;
  const ms=Number.isFinite(seconds)&&seconds>0?seconds*1000:Number.isFinite(date)&&date>0?date:30000;
  throw new MarketplaceError("TIKTOK_RATE_LIMIT",true,Math.min(3600000,Math.max(1000,ms)));
 }
 /** Envelope {code,message,data}: só o código numérico sai no erro. */
 private envelope(body:Json,retryAfter:string|null=null):Json{
  const code=Number(body?.code);
  if(code===0)return body.data??{};
  if(code===RATE_LIMIT_CODE)this.rateLimited(retryAfter);
  if(REAUTH_CODES.has(code))throw new MarketplaceError("REAUTH_REQUIRED");
  throw new MarketplaceError("TIKTOK_API_ERROR_"+(Number.isSafeInteger(code)?code:"UNKNOWN"));
 }
 private async request(method:string,path:string,options:RequestOptions={}):Promise<Json>{
  if(!/^\/[a-z_]+\/\d{6}\/[A-Za-z0-9_/]+$/.test(path))throw new MarketplaceError("INVALID_EXTERNAL_RESOURCE");
  const query:Record<string,string>={...options.query,app_key:this.config.appKey,timestamp:String(Math.floor(Date.now()/1000))};
  if(options.shop){const cipher=options.auth?.metadata.shopCipher;if(!cipher)throw new MarketplaceError("TIKTOK_SHOP_CIPHER_MISSING");query.shop_cipher=cipher;}
  const body=options.form?undefined:options.body===undefined?undefined:JSON.stringify(options.body);
  query.sign=tiktokShopSign(this.config.appSecret,path,query,body??"");
  await this.throttle();
  let response:Response;
  try{response=await this.fetcher(this.config.apiBaseUrl+path+"?"+new URLSearchParams(query),{method,redirect:"error",signal:AbortSignal.timeout(20000),
   headers:{...(options.auth?{"x-tts-access-token":options.auth.accessToken}:{}),...(body!==undefined?{"Content-Type":"application/json"}:{})},
   ...(options.form?{body:options.form}:body!==undefined?{body}:{})});
  }catch{throw new MarketplaceError("TIKTOK_NETWORK_UNCERTAIN",true);}
  if(!response.ok)this.failure(response);
  let json:Json;try{json=await response.json() as Json;}catch{throw new MarketplaceError("TIKTOK_INVALID_RESPONSE",true);}
  return this.envelope(json,response.headers.get("retry-after"));
 }
 /** Download binário só por https, sem redirect, com limite de tamanho. */
 private async download(url:string,limit:number,accept:RegExp,code:string):Promise<{bytes:Uint8Array;contentType:string}>{
  let response:Response;
  try{response=await this.fetcher(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(20000)});}catch{throw new MarketplaceError(code+"_NETWORK_UNCERTAIN",true);}
  if(!response.ok){if(response.status===429||response.status>=500)throw new MarketplaceError(code+"_UNAVAILABLE",true);throw new MarketplaceError(code+"_UNAVAILABLE");}
  const contentType=(response.headers.get("content-type")??"").split(";")[0]!.trim().toLowerCase();
  if(!accept.test(contentType))throw new MarketplaceError(code+"_INVALID_CONTENT");
  if(Number(response.headers.get("content-length")??0)>limit)throw new MarketplaceError(code+"_TOO_LARGE");
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(!bytes.length||bytes.length>limit)throw new MarketplaceError(code+"_INVALID_CONTENT");
  return {bytes,contentType};
 }
 // ---------------------------------------------------------------- conexão
 /** Get Access Token = /api/v2/token/get (grant_type=authorized_code); Get Refresh Token = /api/v2/token/refresh (docv2/page/678e3a3292b0f40314a92d75). */
 private async token(params:Record<string,string>,refresh:boolean):Promise<Json>{
  const url=AUTH_ORIGIN+"/api/v2/token/"+(refresh?"refresh":"get")+"?"+new URLSearchParams({app_key:this.config.appKey,app_secret:this.config.appSecret,...params});
  await this.throttle();
  let response:Response;
  try{response=await this.fetcher(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(20000)});}catch{throw new MarketplaceError("TIKTOK_NETWORK_UNCERTAIN",true);}
  if(!response.ok)this.failure(response);
  let json:Json;try{json=await response.json() as Json;}catch{throw new MarketplaceError("TIKTOK_INVALID_RESPONSE",true);}
  if(Number(json?.code)!==0)throw new MarketplaceError(refresh?"REAUTH_REQUIRED":"TIKTOK_TOKEN_REJECTED");
  const data=json.data??{};
  if(!data.access_token||!data.refresh_token||!iso(data.access_token_expire_in))throw new MarketplaceError("TIKTOK_INVALID_TOKEN_RESPONSE");
  return data;
 }
 private async shops(auth:ProviderAuth):Promise<Json[]>{
  const data=await this.request("GET","/authorization/202309/shops",{auth});
  return Array.isArray(data.shops)?data.shops:[];
 }
 async connect(input:{code:string;params:Record<string,string>}):Promise<MarketplaceTokens>{
  // Recusa do vendedor volta ao redirect como code=null&error=auth_denied.
  if(input.params?.error||input.code==="null")throw new MarketplaceError("TIKTOK_AUTHORIZATION_DENIED");
  if(!input.code||input.code.length>1000)throw new MarketplaceError("TIKTOK_TOKEN_REJECTED");
  const data=await this.token({auth_code:input.code,grant_type:"authorized_code"},false);
  const accessToken=String(data.access_token);
  const shops=(await this.shops({accessToken,accountId:"",metadata:{}})).filter(s=>s.id&&s.cipher);
  const brazil=shops.filter(s=>s.region==="BR");
  if(!brazil.length)throw new MarketplaceError("TIKTOK_ACCOUNT_REGION_UNSUPPORTED");
  // Uma conexão = uma loja; várias lojas BR no mesmo token não têm escolha segura aqui.
  if(brazil.length>1)throw new MarketplaceError("TIKTOK_MULTIPLE_SHOPS_AMBIGUOUS");
  const shop=brazil[0]!;
  return {accessToken,refreshToken:String(data.refresh_token),expiresAt:iso(data.access_token_expire_in)!,userId:String(shop.id),
   metadata:{shopCipher:String(shop.cipher),...(data.open_id?{openId:String(data.open_id)}:{})}};
 }
 async refreshConnection(refreshToken:string,auth:{accountId:string;metadata:Record<string,string>}):Promise<MarketplaceTokens>{
  const data=await this.token({refresh_token:refreshToken,grant_type:"refresh_token"},true);
  return {accessToken:String(data.access_token),refreshToken:String(data.refresh_token),expiresAt:iso(data.access_token_expire_in)!,userId:auth.accountId,
   metadata:{...auth.metadata,...(data.open_id?{openId:String(data.open_id)}:{})}};
 }
 /** A Partner API não documenta revogação pelo app: o vendedor desautoriza no Seller Center (webhook type 6). Nada a chamar. */
 async disconnect():Promise<void>{}
 async account(auth:ProviderAuth){
  const shop=(await this.shops(auth)).find(s=>String(s.id)===auth.accountId);
  if(!shop||!shop.cipher)throw new MarketplaceError("TIKTOK_SHOP_NOT_AUTHORIZED");
  if(shop.region!=="BR")throw new MarketplaceError("TIKTOK_ACCOUNT_REGION_UNSUPPORTED");
  return {id:String(shop.id),name:String(shop.name??shop.id),siteId:"BR",userProducts:false,metadata:{shopCipher:String(shop.cipher)}};
 }
 // ---------------------------------------------------------------- produtos
 async listExternalProducts(auth:ProviderAuth,cursor?:string){
  const data=await this.request("POST","/product/202502/products/search",{auth,shop:true,query:{page_size:"50",...(cursor?{page_token:cursor}:{})},body:{}});
  const products:Json[]=Array.isArray(data.products)?data.products:[];
  return {ids:products.filter(p=>p.id).map(p=>String(p.id)),cursor:products.length&&data.next_page_token?String(data.next_page_token):undefined,total:Number(data.total_count??0)};
 }
 private async product(auth:ProviderAuth,id:string):Promise<Json>{return this.request("GET","/product/202309/products/"+identifier(id),{auth,shop:true});}
 /** Único armazém de venda habilitado; mais de um torna o estoque ambíguo. */
 private async salesWarehouse(auth:ProviderAuth):Promise<string|undefined>{
  const data=await this.request("GET","/logistics/202309/warehouses",{auth,shop:true});
  const sales=(Array.isArray(data.warehouses)?data.warehouses:[]).filter((w:Json)=>w.type==="SALES_WAREHOUSE"&&(w.effect_status??"ENABLED")==="ENABLED"&&w.id);
  return sales.length===1?String(sales[0].id):undefined;
 }
 private static price(sku:Json):number{return tiktokCents(sku.price?.sale_price??sku.price?.tax_exclusive_price??sku.price?.amount);}
 private static stock(sku:Json):number{return (Array.isArray(sku.inventory)?sku.inventory:[]).reduce((sum:number,i:Json)=>sum+Math.max(0,Number(i.quantity)||0),0);}
 async getListing(auth:ProviderAuth,id:string):Promise<ExternalListing>{
  const data=await this.product(auth,id);
  if(!data.id)throw new MarketplaceError("TIKTOK_NOT_FOUND");
  const skus:Json[]=Array.isArray(data.skus)?data.skus:[];
  if(!skus.length)throw new MarketplaceError("TIKTOK_PRODUCT_WITHOUT_SKU");
  const warehouse=await this.salesWarehouse(auth);
  const stockWritable=!!warehouse&&skus.every(s=>(s.inventory??[]).every((i:Json)=>String(i.warehouse_id)===warehouse));
  const ean=(sku:Json)=>["EAN","GTIN"].includes(String(sku.identifier_code?.type))?String(sku.identifier_code.code):undefined;
  const single=skus.length===1&&!(skus[0]!.sales_attributes??[]).length;
  const variants:ExternalVariant[]=single?[]:skus.map(s=>({id:String(s.id),sku:s.seller_sku||undefined,ean:ean(s),priceCents:TikTokShopProvider.price(s),quantity:TikTokShopProvider.stock(s),
   options:Object.fromEntries((s.sales_attributes??[]).map((a:Json)=>[String(a.name??a.id),String(a.value_name??a.value_id??"")]))}));
  const attributes:ExternalAttribute[]=(Array.isArray(data.product_attributes)?data.product_attributes:[]).flatMap((a:Json)=>(a.values??[]).map((v:Json)=>({id:String(a.id),
   ...(v.id?{value_id:String(v.id)}:{}),...(v.name?{value_name:String(v.name)}:{})})));
  const category=(data.category_chains??[]).find((c:Json)=>c.is_leaf)??(data.category_chains??[]).at(-1);
  return {id:String(data.id),sellerId:auth.accountId,title:String(data.title??""),description:text(data.description),
   sku:single?skus[0]!.seller_sku||undefined:undefined,ean:single?ean(skus[0]!):undefined,categoryId:String(category?.id??""),
   priceCents:Math.min(...skus.map(TikTokShopProvider.price)),quantity:skus.reduce((sum,s)=>sum+TikTokShopProvider.stock(s),0),
   status:LISTING_STATE[String(data.status)]??String(data.status??"").toLowerCase(),currency:String(skus[0]!.price?.currency??"BRL"),
   pictures:(data.main_images??[]).map((i:Json)=>https(i.urls?.[0])).filter(Boolean),attributes,variants,model:"LEGACY",stockWritable,
   // A API de produto não informa trava de preço por campanha: preço é gravável; rejeição do canal vira erro tratado.
   priceWritable:true,updatedAt:iso(data.update_time)};
 }
 async category(auth:ProviderAuth,id:string):Promise<CategoryRequirements>{
  const list=await this.request("GET","/product/202309/categories",{auth,shop:true});
  const category=(Array.isArray(list.categories)?list.categories:[]).find((c:Json)=>String(c.id)===id);
  if(!category)throw new MarketplaceError("TIKTOK_CATEGORY_NOT_FOUND");
  const data=await this.request("GET","/product/202309/categories/"+identifier(id)+"/attributes",{auth,shop:true});
  const statuses:string[]=Array.isArray(category.permission_statuses)?category.permission_statuses:["AVAILABLE"];
  return {id,name:String(category.local_name??id),leaf:!!category.is_leaf,allowed:statuses.includes("AVAILABLE"),
   attributes:(Array.isArray(data.attributes)?data.attributes:[]).map((a:Json)=>({id:String(a.id),name:String(a.name),
    // A documentação grafa "is_requried"; aceitamos as duas grafias.
    required:!!(a.is_requried??a.is_required),variation:a.type==="SALES_PROPERTY",values:a.values?.map((v:Json)=>({id:String(v.id),name:String(v.name)}))}))};
 }
 private settings(draft:Partial<PublishDraft>):Json{
  const settings=draft.settings??{};
  if(Object.keys(settings).some(k=>!SETTINGS.has(k)))throw new MarketplaceError("TIKTOK_UNSUPPORTED_LISTING_SETTING");
  return settings;
 }
 private static productAttributes(list:ExternalAttribute[]):Json[]{
  const grouped=new Map<string,Json[]>();
  for(const a of list){if(!a.value_id&&!a.value_name)continue;grouped.set(a.id,[...(grouped.get(a.id)??[]),a.value_id?{id:a.value_id}:{name:a.value_name}]);}
  return [...grouped].map(([id,values])=>({id,values}));
 }
 private static packageFields(input:ListingWrite["package"]):Json{
  if(!input?.weightGrams||input.weightGrams<=0)throw new MarketplaceError("TIKTOK_PACKAGE_WEIGHT_REQUIRED");
  const dims=[input.lengthCm,input.widthCm,input.heightCm];
  return {package_weight:{value:String(input.weightGrams/1000),unit:"KILOGRAM"},
   ...(dims.every(d=>d&&d>0)?{package_dimensions:{length:String(input.lengthCm),width:String(input.widthCm),height:String(input.heightCm),unit:"CENTIMETER"}}:{})};
 }
 /** Baixa a imagem (https público) e envia ao TikTok; devolve o uri usado em main_images. */
 private async uploadImage(auth:ProviderAuth,source:string):Promise<string>{
  const url=https(source);if(!url)throw new MarketplaceError("TIKTOK_IMAGE_INVALID_URL");
  const host=new URL(url).hostname.replace(/^\[|\]$/g,"");
  if(isIP(host)||host==="localhost"||/\.(local|internal|localhost)$/i.test(host)||!host.includes("."))throw new MarketplaceError("TIKTOK_IMAGE_INVALID_URL");
  const {bytes,contentType}=await this.download(url,5*1024*1024,/^image\/(jpeg|png|webp)$/,"TIKTOK_IMAGE");
  const form=new FormData();form.append("data",new Blob([bytes],{type:contentType}),"image");form.append("use_case","MAIN_IMAGE");
  const data=await this.request("POST","/product/202309/images/upload",{auth,form});
  if(!data.uri)throw new MarketplaceError("TIKTOK_IMAGE_UPLOAD_FAILED");
  return String(data.uri);
 }
 async validateListing(auth:ProviderAuth,input:ListingWrite):Promise<string[]>{
  const errors:string[]=[];
  try{this.settings(input.draft);}catch{errors.push("Configuração não suportada pelo TikTok Shop (permitidas: brand_id, is_cod_allowed).");}
  if(!input.package?.weightGrams||input.package.weightGrams<=0)errors.push("Falta peso do pacote.");
  if(!input.draft.pictures.length)errors.push("Falta imagem.");
  if(!input.draft.title.trim())errors.push("Falta título.");
  if(!input.draft.description.trim())errors.push("Falta descrição.");
  if(input.priceCents<=0||!Number.isSafeInteger(input.priceCents))errors.push("Preço deve ser positivo.");
  if(input.quantity<0||!Number.isSafeInteger(input.quantity))errors.push("Quantidade inválida.");
  if(input.currency!=="BRL")errors.push("TikTok Shop Brasil aceita apenas BRL.");
  if(!ID.test(input.draft.categoryId))errors.push("Categoria inválida.");
  else{
   const category=await this.category(auth,input.draft.categoryId);
   if(!category.leaf||!category.allowed)errors.push("Categoria não permite publicação.");
   for(const attribute of category.attributes.filter(a=>a.required&&!a.variation))
    if(!input.draft.attributes.some(a=>a.id===attribute.id&&(a.value_id||a.value_name)))errors.push("Falta atributo: "+attribute.name+" ("+attribute.id+").");
  }
  if(!await this.salesWarehouse(auth))errors.push("A loja precisa de exatamente um armazém de vendas ativo.");
  return errors;
 }
 async createListing(auth:ProviderAuth,input:ListingWrite):Promise<ExternalListing>{
  const settings=this.settings(input.draft),warehouse=await this.salesWarehouse(auth);
  if(!warehouse)throw new MarketplaceError("TIKTOK_STOCK_WAREHOUSE_AMBIGUOUS");
  const sku=(priceCents:number,quantity:number,seller?:string,attributes:ExternalAttribute[]=[])=>({...(seller?{seller_sku:seller}:{}),
   sales_attributes:attributes.map(a=>({id:a.id,...(a.value_id?{value_id:a.value_id}:{value_name:a.value_name})})),
   price:{amount:amount(priceCents),currency:input.currency},inventory:[{warehouse_id:warehouse,quantity}]});
  const skus=input.variants?.length?input.variants.map(v=>sku(v.priceCents,v.quantity,v.sku,v.attributes)):[sku(input.priceCents,input.quantity,input.sku)];
  const images:string[]=[];for(const picture of input.draft.pictures.slice(0,9))images.push(await this.uploadImage(auth,picture));
  const body={...settings,title:input.draft.title,description:html(input.draft.description),category_id:input.draft.categoryId,main_images:images.map(uri=>({uri})),
   product_attributes:TikTokShopProvider.productAttributes(input.draft.attributes),...TikTokShopProvider.packageFields(input.package),skus};
  const data=await this.request("POST","/product/202309/products",{auth,shop:true,body});
  if(!data.product_id)throw new MarketplaceError("TIKTOK_INVALID_RESPONSE");
  const created:Json[]=Array.isArray(data.skus)?data.skus:[];
  const createdId=(i:number,seller?:string)=>String((seller?created.find(s=>s.seller_sku===seller):undefined)?.id??created[i]?.id??"");
  return {id:String(data.product_id),sellerId:auth.accountId,title:input.draft.title,description:input.draft.description,sku:input.variants?.length?undefined:input.sku,
   categoryId:input.draft.categoryId,priceCents:input.priceCents,quantity:input.quantity,status:"under_review",currency:input.currency,pictures:input.draft.pictures,
   attributes:input.draft.attributes,variants:(input.variants??[]).map((v,i)=>({id:createdId(i,v.sku),sku:v.sku,priceCents:v.priceCents,quantity:v.quantity,
    options:Object.fromEntries(v.attributes.map(a=>[a.id,String(a.value_name??a.value_id??"")]))})),model:"LEGACY",stockWritable:true,priceWritable:true};
 }
 /**
  * Partial Edit Product (POST /product/202509/products/{id}/partial_edit, docv2/page/68f597ee1e45470499ff10f0): só as propriedades de topo
  * enviadas mudam — o PUT de edição completa sobrescreve com vazio tudo que não for reenviado (certificações, size chart, vídeo, códigos de SKU…)
  * e reenviaria preço/estoque lidos antes (corrida com syncStock). A edição parcial não aceita category_id: troca de categoria é recusada.
  */
 async updateListing(auth:ProviderAuth,id:string,input:Partial<PublishDraft>):Promise<void>{
  const settings=this.settings(input);
  if(!input.title&&!input.attributes&&!input.pictures&&input.description===undefined&&!input.categoryId&&!Object.keys(settings).length)return;
  if(input.categoryId){
   const current=await this.product(auth,id),category=(current.category_chains??[]).find((c:Json)=>c.is_leaf)??(current.category_chains??[]).at(-1);
   if(String(category?.id??"")!==input.categoryId)throw new MarketplaceError("TIKTOK_CATEGORY_CHANGE_UNSUPPORTED");
  }
  const body:Json={...settings,...(input.title?{title:input.title}:{}),...(input.description!==undefined?{description:html(input.description)}:{}),
   ...(input.attributes?{product_attributes:TikTokShopProvider.productAttributes(input.attributes)}:{})};
  if(input.pictures){const uris:string[]=[];for(const p of input.pictures.slice(0,9))uris.push(await this.uploadImage(auth,p));body.main_images=uris.map(uri=>({uri}));}
  if(!Object.keys(body).length)return;
  await this.request("POST","/product/202509/products/"+identifier(id)+"/partial_edit",{auth,shop:true,body});
 }
 /** "closed" desativa (reversível): excluir no TikTok é irreversível e não é necessário para parar a venda. */
 async setStatus(auth:ProviderAuth,id:string,status:"paused"|"active"|"closed"){
  await this.request("POST","/product/202309/products/"+(status==="active"?"activate":"deactivate"),{auth,shop:true,body:{product_ids:[identifier(id)]}});
 }
 private async skuIds(auth:ProviderAuth,id:string):Promise<string[]>{return ((await this.product(auth,id)).skus??[]).filter((s:Json)=>s.id).map((s:Json)=>String(s.id));}
 async syncPrice(auth:ProviderAuth,id:string,priceCents:number,variants?:{id:string;priceCents:number}[]){
  const targets=variants?.length?variants:(await this.skuIds(auth,id)).map(sku=>({id:sku,priceCents}));
  if(!targets.length)throw new MarketplaceError("TIKTOK_PRODUCT_WITHOUT_SKU");
  await this.request("POST","/product/202309/products/"+identifier(id)+"/prices/update",{auth,shop:true,
   body:{skus:targets.map(t=>({id:identifier(t.id),price:{amount:amount(t.priceCents),currency:"BRL"}}))}});
 }
 async syncStock(auth:ProviderAuth,id:string,quantity:number,variants?:{id:string;quantity:number}[]){
  const warehouse=await this.salesWarehouse(auth);if(!warehouse)throw new MarketplaceError("TIKTOK_STOCK_WAREHOUSE_AMBIGUOUS");
  let targets=variants;
  if(!targets?.length){const ids=await this.skuIds(auth,id);if(ids.length!==1)throw new MarketplaceError("TIKTOK_VARIANTS_REQUIRED");targets=[{id:ids[0]!,quantity}];}
  if(targets.some(t=>!Number.isSafeInteger(t.quantity)||t.quantity<0||t.quantity>MAX_STOCK))throw new MarketplaceError("INVALID_EXTERNAL_QUANTITY");
  await this.request("POST","/product/202309/products/"+identifier(id)+"/inventory/update",{auth,shop:true,
   body:{skus:targets.map(t=>({id:identifier(t.id),inventory:[{warehouse_id:warehouse,quantity:t.quantity}]}))}});
 }
 // ---------------------------------------------------------------- pedidos, envios e devoluções
 async listOrders(auth:ProviderAuth,input:{updatedFrom:string;updatedTo:string;cursor?:string}){
  const from=Math.floor(Date.parse(input.updatedFrom)/1000),to=Math.floor(Date.parse(input.updatedTo)/1000);
  if(!Number.isFinite(from)||!Number.isFinite(to))throw new MarketplaceError("INVALID_ORDER_WINDOW");
  const data=await this.request("POST","/order/202309/orders/search",{auth,shop:true,query:{page_size:"50",...(input.cursor?{page_token:input.cursor}:{})},body:{update_time_ge:from,update_time_lt:to}});
  const orders:Json[]=Array.isArray(data.orders)?data.orders:[];
  return {ids:orders.filter(o=>o.id).map(o=>String(o.id)),cursor:orders.length&&data.next_page_token?String(data.next_page_token):undefined};
 }
 private async rawOrder(auth:ProviderAuth,id:string):Promise<Json>{
  const data=await this.request("GET","/order/202507/orders",{auth,shop:true,query:{ids:identifier(id)}});
  const order=(Array.isArray(data.orders)?data.orders:[]).find((o:Json)=>String(o.id)===id);
  if(!order)throw new MarketplaceError("TIKTOK_NOT_FOUND");
  return order;
 }
 async getOrder(auth:ProviderAuth,id:string):Promise<ExternalOrder>{
  const data=await this.rawOrder(auth,id);
  const status=String(data.status??"");
  const state=ORDER_STATE[status];if(!state)throw new MarketplaceError("TIKTOK_ORDER_STATUS_UNKNOWN");
  // TikTok devolve uma linha por unidade: agrega por produto+SKU (+preço, para não distorcer totais).
  const grouped=new Map<string,ExternalOrderItem>();
  for(const line of (Array.isArray(data.line_items)?data.line_items:[]) as Json[]){
   const unitPriceCents=tiktokCents(line.sale_price??line.original_price),key=[line.product_id,line.sku_id,unitPriceCents].join("|");
   const existing=grouped.get(key);
   if(existing){existing.quantity++;continue;}
   grouped.set(key,{externalItemId:String(line.product_id),externalVariationId:line.sku_id?String(line.sku_id):undefined,sku:line.seller_sku||undefined,
    title:String(line.product_name??"Item TikTok Shop").slice(0,300),variantLabel:line.sku_name?String(line.sku_name).slice(0,200):undefined,quantity:1,unitPriceCents});
  }
  const items=[...grouped.values()],payment:Json=data.payment??{};
  const lineSubtotal=items.reduce((sum,i)=>sum+i.unitPriceCents*i.quantity,0);
  const subtotalCents=payment.original_total_product_price!==undefined?tiktokCents(payment.original_total_product_price):payment.sub_total!==undefined?tiktokCents(payment.sub_total):lineSubtotal;
  const discountCents=tiktokCents(payment.seller_discount)+tiktokCents(payment.platform_discount);
  const shippingCents=tiktokCents(payment.shipping_fee);
  const totalCents=payment.total_amount!==undefined?tiktokCents(payment.total_amount):Math.max(0,subtotalCents-discountCents+shippingCents);
  const packages:string[]=(Array.isArray(data.packages)?data.packages:[]).filter((p:Json)=>p.id).map((p:Json)=>String(p.id));
  const byTikTok=data.fulfillment_type==="FULFILLMENT_BY_TIKTOK";
  // Etiqueta só existe para TikTok Shipping (shipping_type=TIKTOK); no BR a NF-e precisa estar enviada antes de despachar (need_upload_invoice).
  const invoicePending=["NEED_INVOICE","INVOICE_PROCESSING"].includes(String(data.need_upload_invoice??""));
  const tiktokShipping=data.shipping_type==="TIKTOK";
  const shipmentState=SHIPMENT_STATE[status]??"PENDING";
  let substatus:string|undefined;
  if(shipmentState==="SHIPPED"||shipmentState==="DELIVERED")substatus=await this.lastTrackingEvent(auth,id);
  const district:Json[]=Array.isArray(data.recipient_address?.district_info)?data.recipient_address.district_info:[];
  const level=(pattern:RegExp)=>district.find(d=>pattern.test(String(d.address_level_name??"")))?.address_name;
  const address=data.recipient_address?{city:level(/city|cidade|munic/i),state:level(/state|estado/i),postalCode:data.recipient_address.postal_code??undefined}:undefined;
  const createdAt=iso(data.create_time)??new Date(0).toISOString();
  return {id:String(data.id),accountId:auth.accountId,state,externalStatus:status,createdAt,updatedAt:iso(data.update_time)??createdAt,paidAt:iso(data.paid_time),
   cancelledAt:state==="CANCELLED"?iso(data.cancel_time)??iso(data.update_time):undefined,cancelReason:data.cancel_reason?String(data.cancel_reason).slice(0,200):undefined,
   currency:String(payment.currency??"BRL"),items,subtotalCents,discountCents,shippingCents,totalCents,
   buyer:{id:data.user_id?String(data.user_id):undefined},shippingAddress:address&&(address.city||address.state||address.postalCode)?address:undefined,
   shipment:{externalId:packages[0],state:shipmentState,externalStatus:status,substatus,logisticType:data.delivery_type?String(data.delivery_type):undefined,
    carrier:data.shipping_provider?String(data.shipping_provider):undefined,trackingNumber:data.tracking_number?String(data.tracking_number):undefined,
    labelAvailable:status==="AWAITING_COLLECTION"&&!!packages.length&&!byTikTok&&tiktokShipping&&!invoicePending,fulfilledByMarketplace:byTikTok,
    shippedAt:iso(data.collection_time)??iso(data.rts_time),deliveredAt:iso(data.delivery_time)},
   data:{packageIds:packages.slice(0,20),fulfillmentType:data.fulfillment_type??undefined,deliveryType:data.delivery_type??undefined,shippingType:data.shipping_type??undefined,
    needUploadInvoice:data.need_upload_invoice??undefined,isCod:data.is_cod===true}};
 }
 /** Último evento de rastreio (texto curto do canal); ausência de rastreio não bloqueia o pedido. */
 private async lastTrackingEvent(auth:ProviderAuth,orderId:string):Promise<string|undefined>{
  try{
   const data=await this.request("GET","/fulfillment/202309/orders/"+identifier(orderId)+"/tracking",{auth,shop:true});
   const events:Json[]=(Array.isArray(data.tracking)?data.tracking:[]).slice().sort((a:Json,b:Json)=>Number(b.update_time_millis??0)-Number(a.update_time_millis??0));
   return events[0]?.description?String(events[0].description).slice(0,120):undefined;
  }catch(error){
   if(error instanceof MarketplaceError&&(error.code==="TIKTOK_NOT_FOUND"||error.code.startsWith("TIKTOK_API_ERROR_")))return undefined;throw error;
  }
 }
 async getReturns(auth:ProviderAuth,orderId:string):Promise<ExternalReturn[]>{
  identifier(orderId);
  const records:Json[]=[];let token:string|undefined;
  for(let page=0;page<10;page++){
   const data=await this.request("POST","/return_refund/202602/returns/search",{auth,shop:true,query:{page_size:"50",...(token?{page_token:token}:{})},body:{order_ids:[orderId]}});
   const list:Json[]=Array.isArray(data.return_orders)?data.return_orders:[];records.push(...list);
   token=list.length&&data.next_page_token?String(data.next_page_token):undefined;if(!token)break;
  }
  let skuProduct:Map<string,string>|undefined;
  const result:ExternalReturn[]=[];
  for(const ret of records.filter(r=>r.return_id&&String(r.order_id)===orderId)){
   const lines:Json[]=Array.isArray(ret.return_line_items)?ret.return_line_items:[];
   if(lines.some(l=>!l.product_id)&&!skuProduct){
    const order=await this.rawOrder(auth,orderId);
    skuProduct=new Map((order.line_items??[]).map((l:Json)=>[String(l.sku_id),String(l.product_id)]));
   }
   const grouped=new Map<string,{externalItemId:string;externalVariationId?:string;quantity:number}>();
   for(const line of lines){
    const product=line.product_id?String(line.product_id):skuProduct?.get(String(line.sku_id));if(!product)continue;
    const key=product+"|"+(line.sku_id??"");const existing=grouped.get(key);
    if(existing)existing.quantity++;else grouped.set(key,{externalItemId:product,externalVariationId:line.sku_id?String(line.sku_id):undefined,quantity:1});
   }
   const createdAt=iso(ret.create_time)??new Date(0).toISOString();
   result.push({id:String(ret.return_id),orderId,state:RETURN_STATE[String(ret.return_status)]??"REQUESTED",externalStatus:String(ret.return_status??""),
    reason:ret.return_reason?String(ret.return_reason).slice(0,200):undefined,refundCents:ret.refund_amount?.refund_total!==undefined?tiktokCents(ret.refund_amount.refund_total):undefined,
    items:[...grouped.values()],createdAt,updatedAt:iso(ret.update_time)??createdAt});
  }
  return result;
 }
 async shippingLabel(auth:ProviderAuth,order:ExternalOrder):Promise<ShippingLabel>{
  if(order.externalStatus!=="AWAITING_COLLECTION"||!order.shipment?.externalId||!order.shipment.labelAvailable)throw new MarketplaceError("TIKTOK_LABEL_NOT_AVAILABLE");
  const data=await this.request("GET","/fulfillment/202309/packages/"+identifier(order.shipment.externalId)+"/shipping_documents",{auth,shop:true,query:{document_type:"SHIPPING_LABEL"}});
  const url=https(data.doc_url);
  const host=url?new URL(url).hostname:"";
  if(!url||!LABEL_HOSTS.some(d=>host===d||host.endsWith("."+d)))throw new MarketplaceError("TIKTOK_LABEL_NOT_AVAILABLE");
  const {bytes,contentType}=await this.download(url,20*1024*1024,/^(application\/pdf|application\/octet-stream|image\/png)$/,"TIKTOK_LABEL");
  const pdf=contentType!=="image/png";
  return {contentType:pdf?"application/pdf":"image/png",base64:Buffer.from(bytes).toString("base64"),filename:`etiqueta-tiktok-${order.id}.${pdf?"pdf":"png"}`};
 }
 /**
  * Cancelamento total pelo vendedor antes do envio (Cancel Order 202602, docv2/page/69c30707909b3e049e3d774e).
  * `cancel_reason` precisa ser um "reason name" oficial: a doc manda obtê-lo de Get Aftersale Eligibility
  * (initiate_aftersale_user=SELLER, request_types=CANCEL → available_reason_names) porque a lista varia por mercado/status e muda
  * (ex.: dois motivos removidos em 31/10/2026). Texto livre ou motivo fora da lista atual nunca é enviado.
  */
 async cancelOrder(auth:ProviderAuth,order:ExternalOrder,reason:string):Promise<void>{
  if(!CANCELLABLE.has(order.externalStatus))throw new MarketplaceError("TIKTOK_ORDER_NOT_CANCELLABLE");
  const code=reason.trim();if(!/^[a-z0-9_]{1,120}$/.test(code))throw new MarketplaceError("TIKTOK_CANCEL_REASON_CODE_REQUIRED");
  const orderId=identifier(order.id);
  const data=await this.request("GET","/return_refund/202602/orders/"+orderId+"/aftersale_eligibility",{auth,shop:true,query:{initiate_aftersale_user:"SELLER",request_types:"CANCEL"}});
  const entries:Json[]=(Array.isArray(data.sku_eligibility)?data.sku_eligibility:[]).flatMap((s:Json)=>Array.isArray(s.line_item_eligibility)?s.line_item_eligibility:[])
   .filter((e:Json)=>e.request_type==="CANCEL");
  // Cancelamento parcial por item só existe em US/UK: qualquer linha inelegível bloqueia o cancelamento total.
  if(!entries.length||entries.some(e=>e.eligible!==true))throw new MarketplaceError("TIKTOK_ORDER_NOT_CANCELLABLE");
  if(!entries.every(e=>Array.isArray(e.available_reason_names)&&e.available_reason_names.map(String).includes(code)))throw new MarketplaceError("TIKTOK_CANCEL_REASON_NOT_AVAILABLE");
  await this.request("POST","/return_refund/202602/cancellations",{auth,shop:true,body:{order_id:orderId,cancel_reason:code}});
 }
 async resolveOrderId(_auth:ProviderAuth,resource:string):Promise<string|undefined>{return resource.match(/^order:(\d{1,30})$/)?.[1];}
 /**
  * Assinatura (Webhooks overview, docv2/page/64f1997e93f5dc028e357341): header Authorization = HMAC-SHA256(app_secret, app_key + corpo bruto),
  * hex minúsculo, sem "Bearer". Sem assinatura válida → ignorado.
  */
 parseNotification(input:{headers:Record<string,string|undefined>;rawBody:string}):ProviderNotification|undefined{
  const header=Object.entries(input.headers).find(([k])=>k.toLowerCase()==="authorization")?.[1]?.trim().toLowerCase();
  if(!header||!/^[0-9a-f]{64}$/.test(header))return undefined;
  const expected=createHmac("sha256",this.config.appSecret).update(this.config.appKey+input.rawBody).digest();
  if(!timingSafeEqual(expected,Buffer.from(header,"hex")))return undefined;
  let body:Json;try{body=JSON.parse(input.rawBody);}catch{return undefined;}
  const type=Number(body?.type),event=WEBHOOK[type],shop=String(body?.shop_id??"");
  if(!event||!ID.test(shop))return undefined;
  const data:Json=body.data&&typeof body.data==="object"?body.data:{};
  // Package update (4) não traz order_id: os pedidos vêm em package_list[].order_id_list; usa o primeiro (a reconciliação cobre os demais).
  const rawOrder=type===4?(Array.isArray(data.package_list)?data.package_list:[]).flatMap((p:Json)=>Array.isArray(p?.order_id_list)?p.order_id_list:[])[0]:data.order_id;
  const orderId=typeof rawOrder==="string"&&ID.test(rawOrder)?rawOrder:undefined;
  // O exemplo oficial do tópico 5 traz product_id numérico (perde precisão no JSON.parse): lê os dígitos do corpo bruto.
  const rawProduct=typeof data.product_id==="number"?input.rawBody.match(/"product_id"\s*:\s*(\d{1,30})\s*[,}]/)?.[1]:data.product_id;
  const productId=rawProduct!==undefined&&ID.test(String(rawProduct))?String(rawProduct):undefined;
  if(event.kind!=="LISTING"&&!orderId)return undefined;
  if(event.kind==="LISTING"&&!productId)return undefined;
  const notificationId=typeof body.tts_notification_id==="string"&&/^[A-Za-z0-9_.:-]{1,200}$/.test(body.tts_notification_id)?body.tts_notification_id:undefined;
  // Fallback estável inclui o timestamp: o recurso sozinho suprimiria mudanças futuras.
  const eventId=notificationId??createHash("sha256").update([shop,type,orderId??productId,body.timestamp,JSON.stringify(data)].join(":")).digest("hex");
  return {accountId:shop,eventId,topic:event.topic,kind:event.kind,resource:orderId?"order:"+orderId:"product:"+productId,...(orderId?{externalOrderId:orderId}:{})};
 }
}

export function tiktokShopConfig(env:NodeJS.ProcessEnv):TikTokShopConfig|undefined{
 const {TIKTOK_SHOP_APP_KEY:appKey,TIKTOK_SHOP_APP_SECRET:appSecret,TIKTOK_SHOP_SERVICE_ID:serviceId,TIKTOK_SHOP_API_BASE_URL:base}=env;
 if(!appKey||!appSecret||!serviceId)return;
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(appKey)||!/^[A-Za-z0-9_-]{1,100}$/.test(serviceId))return;
 // Só a origem oficial: qualquer outra base vazaria token e assinatura.
 if(base!==undefined&&base!==""&&base.replace(/\/+$/,"")!==API_ORIGIN)return;
 return {appKey,appSecret,serviceId,apiBaseUrl:API_ORIGIN};
}
