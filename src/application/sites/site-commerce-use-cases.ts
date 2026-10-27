import {createHash,randomBytes} from "node:crypto";
import type {Site,SiteSnapshot} from "../../domain/sites/site.model.js";
import type {Product} from "../../domain/crm/crm.model.js";
import {SALES_INTENT_TTL_MS,extractSalesIntentReference,isSalesIntentReference,newSalesIntentReference,salesIntentWhatsappMessage,siteCommerceSettingsSchema,type SalesIntent,type SalesIntentItem,type SalesIntentType,type SiteCommerceSettings,type Utm} from "../../domain/sites/site-commerce.js";
import type {CreateSalesIntentInput,SiteCartItemSnapshot,SiteCommerceRepositoryPort,SiteEventInput} from "../ports/site-commerce-repository.port.js";
import {commerceContext,isPublicCatalogProduct,presentPublicProduct,resolvePublishedSite,type PublicSiteProduct,type SiteCommerceContext,type SiteEngineDeps} from "./site-use-cases.js";
import {signOwnedUrl,OBJECT_URL_TTL} from "../../shared/utils/object-url-signing.js";

export type SiteCommerceDeps=SiteEngineDeps&{commerceRepository:SiteCommerceRepositoryPort;teamBelongsToWorkspace?:(input:{tenantId:string;workspaceId:string;teamId:string})=>Promise<boolean>;now?:()=>Date;log?:(event:string,data:Record<string,unknown>)=>void};
export type PublicLookup={slug?:string;hostname?:string};
export type VisitorContext={sessionId?:string;pageUrl?:string;utm?:Utm};
const CART_TTL_MS=30*24*60*60*1000;
const MAX_CART_LINES=50;
const now=(deps:SiteCommerceDeps)=>deps.now?.()??new Date();
const hashToken=(token:string)=>createHash("sha256").update(token).digest("hex");
const cleanUtm=(utm:Utm|undefined):Utm=>Object.fromEntries(Object.entries(utm??{}).filter(([,value])=>typeof value==="string"&&value.trim()).map(([key,value])=>[key,String(value).trim()]));
/** Só guarda URL http(s) sem credenciais; query e fragmento são descartados (UTMs vêm em campo próprio). */
export function safePageUrl(value:string|undefined):string|undefined{try{if(!value)return undefined;const url=new URL(value);if(!["https:","http:"].includes(url.protocol)||url.username||url.password)return undefined;return `${url.origin}${url.pathname}`.slice(0,500);}catch{return undefined;}}
function emit(deps:SiteCommerceDeps,input:SiteEventInput){deps.commerceRepository.recordEvent(input).catch(error=>deps.log?.("site_event_failed",{type:input.type,error:error instanceof Error?error.message:String(error)}));}

type PublicContext={site:Site;snapshot:SiteSnapshot;commerce:SiteCommerceContext;metadata:Awaited<ReturnType<SiteEngineDeps["productEngineRepository"]["metadata"]>>};
async function publicContext(deps:SiteCommerceDeps,lookup:PublicLookup):Promise<PublicContext>{
 const {site,snapshot}=await resolvePublishedSite(deps,lookup);
 return {site,snapshot,commerce:await commerceContext(deps,site,snapshot),metadata:await deps.productEngineRepository.metadata(site)};
}
/** Produto e variação validados contra o site publicado — nunca confia no ID vindo do navegador. */
async function publicProduct(deps:SiteCommerceDeps,context:PublicContext,productId:string,variantId?:string){
 const product=await deps.productRepository.getById(productId);
 if(!product||product.tenantId!==context.site.tenantId||product.workspaceId!==context.site.workspaceId||!isPublicCatalogProduct(product,context.metadata))throw Error("SITE_NOT_FOUND: produto não encontrado.");
 const presented=await presentPublicProduct(deps,product,context.metadata,context.commerce);
 const variant=variantId?presented.variants.find(item=>item.id===variantId):undefined;
 if(variantId&&!variant)throw Error("SITE_NOT_FOUND: opção do produto não encontrada.");
 if(presented.options.length&&!variant)throw Error("SITE_VALIDATION: escolha todas as opções do produto.");
 return {product,presented,variant};
}
type Resolved=Awaited<ReturnType<typeof publicProduct>>;
function variantLabel(resolved:Resolved){return resolved.variant?resolved.presented.options.map(option=>`${option.name}: ${resolved.variant!.optionValues[option.key]}`).join(", "):undefined;}
function availableQuantity(resolved:Resolved){return resolved.variant?resolved.variant.availableQuantity:resolved.presented.availableQuantity;}
function itemSnapshot(resolved:Resolved,quantity:number):SalesIntentItem{
 const {product,presented,variant}=resolved;
 const specifications=Object.entries(presented.attributes).slice(0,12).map(([key,value])=>({label:presented.attributeLabels[key]??key,value:typeof value==="boolean"?(value?"Sim":"Não"):String(value)}));
 return {productId:product.id,variantId:variant?.id,name:product.name,variantLabel:variantLabel(resolved),sku:variant?.sku??product.code,imageUrl:canonicalImage(product),quantity,unitPriceCents:variant?.priceCents??product.priceCents,currency:product.currency,...(specifications.length?{specifications}:{})};
}
/** Guarda a URL canônica (sem assinatura) para a imagem continuar válida no histórico. */
function canonicalImage(product:Product){return product.imageUrls[0];}
function presentIntentItem(item:SalesIntentItem){return {...item,imageUrl:item.imageUrl?signOwnedUrl(item.imageUrl,OBJECT_URL_TTL.preview):undefined};}

async function createIntent(deps:SiteCommerceDeps,input:Omit<CreateSalesIntentInput,"reference"|"expiresAt">):Promise<{intent:SalesIntent;created:boolean}>{
 const expiresAt=new Date(now(deps).getTime()+SALES_INTENT_TTL_MS).toISOString();
 for(let attempt=0;;attempt++){
  try{return await deps.commerceRepository.createIntent({...input,reference:newSalesIntentReference(),expiresAt});}
  catch(error){if((error as {code?:string})?.code==="23505"&&attempt<4&&String((error as {constraint?:string}).constraint??"").includes("reference"))continue;throw error;}
 }
}
function whatsappUrl(number:string,intent:Pick<SalesIntent,"type"|"reference"|"snapshot">){return `https://wa.me/${number}?text=${encodeURIComponent(salesIntentWhatsappMessage(intent))}`;}
function intentResult(intent:SalesIntent,number:string){
 return {reference:intent.reference,redirectPath:`/i/${intent.reference}`,whatsappUrl:whatsappUrl(number,intent)};
}

/** Visitante clicou em "Falar no WhatsApp" num produto. Cria só a intenção — nunca contato ou oportunidade. */
export async function startProductWhatsapp(deps:SiteCommerceDeps,input:{lookup:PublicLookup;productId:string;variantId?:string;quantity?:number;requestKey:string}&VisitorContext){
 const context=await publicContext(deps,input.lookup);const number=context.snapshot.content.whatsapp;
 const resolved=await publicProduct(deps,context,input.productId,input.variantId);
 if(!number||!resolved.presented.commerce.allowedActions.includes("whatsapp"))throw Error("SITE_VALIDATION: este produto não está disponível para atendimento pelo WhatsApp.");
 const quantity=Math.max(1,Math.min(999,Math.trunc(input.quantity??1)));
 const item=itemSnapshot(resolved,quantity);const utm=cleanUtm(input.utm),pageUrl=safePageUrl(input.pageUrl);
 const {intent,created}=await createIntent(deps,{tenantId:context.site.tenantId,workspaceId:context.site.workspaceId,siteId:context.site.id,type:"PRODUCT_WHATSAPP",productId:item.productId,variantId:item.variantId,quantity,snapshot:{items:[item],subtotalCents:item.unitPriceCents*quantity,currency:item.currency,siteName:context.snapshot.content.name},pageUrl,utm,anonymousSessionId:input.sessionId,requestKey:input.requestKey});
 const base={tenantId:intent.tenantId,workspaceId:intent.workspaceId,siteId:intent.siteId,anonymousSessionId:input.sessionId,productId:item.productId,variantId:item.variantId,salesIntentId:intent.id,pageUrl,utm};
 // Duplo clique/retry devolve a mesma intenção sem contar o evento de novo.
 if(created){emit(deps,{...base,type:"PRODUCT_WHATSAPP_CLICK"});emit(deps,{...base,type:"SALES_INTENT_CREATED"});deps.log?.("SalesIntentCreated",{intentId:intent.id,type:intent.type,siteId:intent.siteId});}
 return intentResult(intent,number);
}

/** `/i/:reference` — valida, registra o clique e devolve o destino. Nunca expõe dados internos. */
export async function resolveSalesIntentRedirect(deps:SiteCommerceDeps,reference:string):Promise<{status:"redirect";url:string}|{status:"expired"|"not_found";siteSlug?:string}>{
 const normalized=extractSalesIntentReference(reference);
 if(!normalized||!isSalesIntentReference(normalized))return {status:"not_found"};
 const intent=await deps.commerceRepository.getIntentByReference(normalized);
 if(!intent||!["PRODUCT_WHATSAPP","CART_WHATSAPP"].includes(intent.type))return {status:"not_found"};
 const site=await deps.repository.get(intent.siteId);
 if(!site?.published?.content.whatsapp||!await deps.hasAccess(site.tenantId))return {status:"not_found"};
 if(intent.status!=="CONVERTED"&&Date.parse(intent.expiresAt)<=now(deps).getTime())return {status:"expired",siteSlug:site.slug};
 await deps.commerceRepository.recordIntentClick(intent.id);
 return {status:"redirect",url:whatsappUrl(site.published.content.whatsapp,intent)};
}

export async function recordPublicSiteEvent(deps:SiteCommerceDeps,input:{lookup:PublicLookup;type:"SITE_VIEW"|"PRODUCT_VIEW";productId?:string}&VisitorContext){
 const {site}=await resolvePublishedSite(deps,input.lookup);
 let productId:string|undefined;
 if(input.productId){const product=await deps.productRepository.getById(input.productId);if(product&&product.tenantId===site.tenantId&&product.workspaceId===site.workspaceId)productId=product.id;}
 if(input.type==="PRODUCT_VIEW"&&!productId)return;
 await deps.commerceRepository.recordEvent({tenantId:site.tenantId,workspaceId:site.workspaceId,siteId:site.id,type:input.type,anonymousSessionId:input.sessionId,productId,pageUrl:safePageUrl(input.pageUrl),utm:cleanUtm(input.utm)});
}

// ---------------------------------------------------------------- carrinho (intenção, não pedido)
async function activeCart(deps:SiteCommerceDeps,context:PublicContext,token:string|undefined){
 if(!token)return undefined;const cart=await deps.commerceRepository.getCart({siteId:context.site.id,tokenHash:hashToken(token)});
 return cart&&cart.status==="ACTIVE"&&Date.parse(cart.expiresAt)>now(deps).getTime()?cart:undefined;
}
async function presentCart(deps:SiteCommerceDeps,context:PublicContext,cart:{id:string}|undefined,token:string|undefined){
 const items=cart?await deps.commerceRepository.listCartItems(cart.id):[];
 const lines=await Promise.all(items.map(async item=>{
  try{
   const resolved=await publicProduct(deps,context,item.productId,item.variantId);const available=availableQuantity(resolved);
   const purchasable=resolved.presented.commerce.allowedActions.includes("add_to_cart")&&(available===undefined||available>=item.quantity);
   const snapshot=itemSnapshot(resolved,item.quantity);
   return {productId:item.productId,variantId:item.variantId,quantity:item.quantity,name:snapshot.name,variantLabel:snapshot.variantLabel,sku:snapshot.sku,slug:resolved.presented.slug,imageUrl:resolved.variant?.imageUrl??resolved.presented.imageUrls[0],unitPriceCents:snapshot.unitPriceCents,currency:snapshot.currency,availableQuantity:available,available:purchasable,resolved};
  }catch{
   return {productId:item.productId,variantId:item.variantId,quantity:item.quantity,name:item.productSnapshot.name,variantLabel:item.productSnapshot.variantLabel,sku:item.productSnapshot.sku,slug:undefined,imageUrl:undefined,unitPriceCents:item.productSnapshot.unitPriceCents,currency:item.productSnapshot.currency,availableQuantity:0,available:false,resolved:undefined};
  }
 }));
 const valid=lines.filter(line=>line.available);const currency=valid[0]?.currency??lines[0]?.currency??"BRL";
 return {token,lines,view:{items:lines.map(({resolved:_resolved,...line})=>line),subtotalCents:valid.reduce((sum,line)=>sum+line.unitPriceCents*line.quantity,0),currency,itemCount:valid.reduce((sum,line)=>sum+line.quantity,0)}};
}
export async function getPublicCart(deps:SiteCommerceDeps,input:{lookup:PublicLookup;token?:string}){
 const context=await publicContext(deps,input.lookup);const cart=await activeCart(deps,context,input.token);
 return (await presentCart(deps,context,cart,cart?input.token:undefined)).view;
}
/** Define a quantidade de uma linha (0 remove). Cria o carrinho anônimo na primeira inclusão. */
export async function setPublicCartItem(deps:SiteCommerceDeps,input:{lookup:PublicLookup;token?:string;productId:string;variantId?:string;quantity:number}&VisitorContext){
 const context=await publicContext(deps,input.lookup);
 const quantity=Math.trunc(input.quantity);if(!(quantity>=0&&quantity<=99))throw Error("SITE_VALIDATION: quantidade inválida.");
 let cart=await activeCart(deps,context,input.token),token=cart?input.token!:undefined;
 const base={tenantId:context.site.tenantId,workspaceId:context.site.workspaceId,siteId:context.site.id,anonymousSessionId:input.sessionId,productId:input.productId,variantId:input.variantId,pageUrl:safePageUrl(input.pageUrl),utm:cleanUtm(input.utm)};
 if(quantity===0){
  if(cart&&await deps.commerceRepository.removeCartItem({cartId:cart.id,productId:input.productId,variantId:input.variantId}))emit(deps,{...base,cartId:cart.id,type:"REMOVE_FROM_CART"});
  return {...(await presentCart(deps,context,cart,token)).view,token};
 }
 const resolved=await publicProduct(deps,context,input.productId,input.variantId);
 if(!resolved.presented.commerce.allowedActions.includes("add_to_cart"))throw Error("SITE_VALIDATION: este produto não pode ser adicionado ao carrinho.");
 const available=availableQuantity(resolved);
 if(available!==undefined&&available<quantity)throw Error(available>0?`SITE_VALIDATION: só temos ${available} unidade(s) disponível(is) desta opção.`:"SITE_VALIDATION: esta opção está indisponível no momento.");
 if(!cart){token=randomBytes(24).toString("base64url");cart=await deps.commerceRepository.createCart({tenantId:context.site.tenantId,workspaceId:context.site.workspaceId,siteId:context.site.id,tokenHash:hashToken(token),anonymousSessionId:input.sessionId,expiresAt:new Date(now(deps).getTime()+CART_TTL_MS).toISOString()});}
 const items=await deps.commerceRepository.listCartItems(cart.id);
 if(items.length>=MAX_CART_LINES&&!items.some(item=>item.productId===input.productId&&(item.variantId??"")===(input.variantId??"")))throw Error(`SITE_VALIDATION: o carrinho aceita até ${MAX_CART_LINES} produtos diferentes.`);
 const snapshot=itemSnapshot(resolved,quantity);const productSnapshot:SiteCartItemSnapshot={name:snapshot.name,variantLabel:snapshot.variantLabel,sku:snapshot.sku,imageUrl:snapshot.imageUrl,unitPriceCents:snapshot.unitPriceCents,currency:snapshot.currency};
 await deps.commerceRepository.setCartItem({cartId:cart.id,productId:input.productId,variantId:resolved.variant?.id,quantity,productSnapshot,expiresAt:new Date(now(deps).getTime()+CART_TTL_MS).toISOString()});
 emit(deps,{...base,variantId:resolved.variant?.id,cartId:cart.id,type:"ADD_TO_CART"});
 return {...(await presentCart(deps,context,cart,token)).view,token};
}
/** "Finalizar pelo WhatsApp": congela o carrinho numa intenção CART_WHATSAPP. Repetir devolve a mesma intenção. */
export async function checkoutPublicCartToWhatsapp(deps:SiteCommerceDeps,input:{lookup:PublicLookup;token:string;requestKey:string}&VisitorContext){
 const context=await publicContext(deps,input.lookup);const number=context.snapshot.content.whatsapp;
 if(!number)throw Error("SITE_VALIDATION: o WhatsApp da empresa não está configurado.");
 const cart=await deps.commerceRepository.getCart({siteId:context.site.id,tokenHash:hashToken(input.token)});
 if(!cart)throw Error("SITE_NOT_FOUND: carrinho não encontrado.");
 if(cart.status==="CHECKED_OUT"&&cart.salesIntentId){
  const previous=await deps.commerceRepository.getIntent(cart.salesIntentId);
  if(previous)return intentResult(previous,number);
 }
 if(cart.status!=="ACTIVE"||Date.parse(cart.expiresAt)<=now(deps).getTime())throw Error("SITE_VALIDATION: este carrinho expirou. Monte um novo carrinho.");
 const {lines}=await presentCart(deps,context,cart,input.token);
 if(!lines.length)throw Error("SITE_VALIDATION: o carrinho está vazio.");
 const blocked=lines.find(line=>!line.available||!line.resolved);
 if(blocked)throw Error(`SITE_VALIDATION: revise o carrinho — ${blocked.name}${blocked.variantLabel?` (${blocked.variantLabel})`:""} não está disponível nessa quantidade.`);
 const items=lines.map(line=>itemSnapshot(line.resolved!,line.quantity));
 const currencies=new Set(items.map(item=>item.currency));if(currencies.size>1)throw Error("SITE_VALIDATION: o carrinho tem produtos em moedas diferentes.");
 const utm=cleanUtm(input.utm),pageUrl=safePageUrl(input.pageUrl);
 const {intent,created}=await createIntent(deps,{tenantId:cart.tenantId,workspaceId:cart.workspaceId,siteId:cart.siteId,type:"CART_WHATSAPP",snapshot:{items,subtotalCents:items.reduce((sum,item)=>sum+item.unitPriceCents*item.quantity,0),currency:items[0].currency,siteName:context.snapshot.content.name},pageUrl,utm,anonymousSessionId:input.sessionId,requestKey:input.requestKey});
 await deps.commerceRepository.checkoutCart({cartId:cart.id,salesIntentId:intent.id});
 const base={tenantId:intent.tenantId,workspaceId:intent.workspaceId,siteId:intent.siteId,anonymousSessionId:input.sessionId,cartId:cart.id,salesIntentId:intent.id,pageUrl,utm};
 if(created){emit(deps,{...base,type:"CART_WHATSAPP_START"});emit(deps,{...base,type:"SALES_INTENT_CREATED"});deps.log?.("WhatsAppCartStarted",{intentId:intent.id,siteId:intent.siteId,lines:items.length});}
 return intentResult(intent,number);
}

// ---------------------------------------------------------------- administração
export async function getSiteCommerceSettings(deps:SiteCommerceDeps,site:Site):Promise<{settings:SiteCommerceSettings;configured:boolean;hasWhatsapp:boolean}>{
 const saved=await deps.commerceRepository.getSettings(site.id);const snapshot=site.published??site.draft;const hasWhatsapp=!!snapshot.content.whatsapp;
 return {settings:saved??(await commerceContext(deps,site,snapshot)).settings,configured:!!saved,hasWhatsapp};
}
export async function saveSiteCommerceSettings(deps:SiteCommerceDeps,input:{site:Site;settings:unknown;actorUserId:string}){
 const settings=siteCommerceSettingsSchema.parse(input.settings);
 if(settings.teamId&&deps.teamBelongsToWorkspace&&!await deps.teamBelongsToWorkspace({tenantId:input.site.tenantId,workspaceId:input.site.workspaceId,teamId:settings.teamId}))throw Error("SITE_VALIDATION: equipe não encontrada neste workspace.");
 return deps.commerceRepository.saveSettings({siteId:input.site.id,tenantId:input.site.tenantId,workspaceId:input.site.workspaceId,settings,actorUserId:input.actorUserId});
}
export async function listSiteSalesIntents(deps:SiteCommerceDeps,input:{tenantId:string;workspaceId:string;siteId?:string;limit?:number}){
 return (await deps.commerceRepository.listIntents({...input,limit:Math.min(200,Math.max(1,input.limit??50))})).map(intent=>({...intent,anonymousSessionId:undefined,snapshot:{...intent.snapshot,items:intent.snapshot.items.map(presentIntentItem)}}));
}
export type {PublicSiteProduct,SalesIntentType};
