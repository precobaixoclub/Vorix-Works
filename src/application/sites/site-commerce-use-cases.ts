import {evaluateCommercialRules,pricingFingerprint,pricingLine} from "../commerce/commercial-rule-use-cases.js";
import type {AppliedCommercialRule,RuleProgress} from "../../domain/commerce/commercial-rules.js";
import {createHash,randomBytes} from "node:crypto";
import type {Site,SiteSnapshot} from "../../domain/sites/site.model.js";
import type {Product} from "../../domain/crm/crm.model.js";
import {SALES_INTENT_TTL_MS,extractSalesIntentReference,isSalesIntentReference,newSalesIntentReference,salesIntentWhatsappMessage,siteCommerceSettingsSchema,type SalesIntent,type SalesIntentItem,type SalesIntentType,type SiteCommerceSettings,type Utm} from "../../domain/sites/site-commerce.js";
import type {CreateSalesIntentInput,SiteCartItemSnapshot,SiteCommerceRepositoryPort,SiteEventInput} from "../ports/site-commerce-repository.port.js";
import {commerceContext,isPublicCatalogProduct,presentPublicProduct,resolvePublishedSite,type PublicSiteProduct,type SiteCommerceContext,type SiteEngineDeps} from "./site-use-cases.js";
import {signOwnedUrl,OBJECT_URL_TTL} from "../../shared/utils/object-url-signing.js";

export type SiteCommerceDeps=SiteEngineDeps&{commerceRepository:SiteCommerceRepositoryPort;
 /** Registra o pedido do carrinho no CRM (contato já criado → oportunidade com os itens). Vem da ponte Site→CRM. */
 registerCartLead?:(input:{intentId:string;contactId:string;customer:string})=>Promise<{dealId?:string}>;
teamBelongsToWorkspace?:(input:{tenantId:string;workspaceId:string;teamId:string})=>Promise<boolean>;now?:()=>Date;log?:(event:string,data:Record<string,unknown>)=>void};
export type PublicLookup={slug?:string;hostname?:string};
export type VisitorContext={sessionId?:string;pageUrl?:string;utm?:Utm;eventKey?:string;referrer?:string;device?:"mobile"|"tablet"|"desktop"|"unknown"};
const CART_TTL_MS=30*24*60*60*1000;
const MAX_CART_LINES=50;
const now=(deps:SiteCommerceDeps)=>deps.now?.()??new Date();
export const hashToken=(token:string)=>createHash("sha256").update(token).digest("hex");
export const cleanUtm=(utm:Utm|undefined):Utm=>Object.fromEntries(Object.entries(utm??{}).filter(([,value])=>typeof value==="string"&&value.trim()).map(([key,value])=>[key,String(value).trim()]));
/** Só guarda URL http(s) sem credenciais; query e fragmento são descartados (UTMs vêm em campo próprio). */
export function safePageUrl(value:string|undefined):string|undefined{try{if(!value)return undefined;const url=new URL(value);if(!["https:","http:"].includes(url.protocol)||url.username||url.password)return undefined;return `${url.origin}${url.pathname}`.slice(0,500);}catch{return undefined;}}
export function emit(deps:SiteCommerceDeps,input:SiteEventInput){deps.commerceRepository.recordEvent(input).catch(error=>deps.log?.("site_event_failed",{type:input.type,error:error instanceof Error?error.message:String(error)}));}

export type PublicContext={site:Site;snapshot:SiteSnapshot;commerce:SiteCommerceContext;metadata:Awaited<ReturnType<SiteEngineDeps["productEngineRepository"]["metadata"]>>};
export async function publicContext(deps:SiteCommerceDeps,lookup:PublicLookup):Promise<PublicContext>{
 const {site,snapshot}=await resolvePublishedSite(deps,lookup);
 return {site,snapshot,commerce:await commerceContext(deps,site,snapshot),metadata:await deps.productEngineRepository.metadata(site)};
}
/** Produto e variação validados contra o site publicado — nunca confia no ID vindo do navegador. */
export async function publicProduct(deps:SiteCommerceDeps,context:PublicContext,productId:string,variantId?:string){
 const product=await deps.productRepository.getById(productId);
 if(!product||product.tenantId!==context.site.tenantId||product.workspaceId!==context.site.workspaceId||!isPublicCatalogProduct(product,context.metadata))throw Error("SITE_NOT_FOUND: produto não encontrado.");
 const presented=await presentPublicProduct(deps,product,context.metadata,context.commerce);
 const variant=variantId?presented.variants.find(item=>item.id===variantId):undefined;
 if(variantId&&!variant)throw Error("SITE_NOT_FOUND: opção do produto não encontrada.");
 if(presented.options.length&&!variant)throw Error("SITE_VALIDATION: escolha todas as opções do produto.");
 return {product,presented,variant};
}
export type Resolved=Awaited<ReturnType<typeof publicProduct>>;
function variantLabel(resolved:Resolved){return resolved.variant?resolved.presented.options.map(option=>`${option.name}: ${resolved.variant!.optionValues[option.key]}`).join(", "):undefined;}
export function availableQuantity(resolved:Resolved){return resolved.variant?resolved.variant.availableQuantity:resolved.presented.availableQuantity;}
export function itemSnapshot(resolved:Resolved,quantity:number):SalesIntentItem{
 const {product,presented,variant}=resolved;
 const specifications=Object.entries(presented.attributes).slice(0,12).map(([key,value])=>({label:presented.attributeLabels[key]??key,value:typeof value==="boolean"?(value?"Sim":"Não"):String(value)}));
 return {productId:product.id,variantId:variant?.id,name:product.name,variantLabel:variantLabel(resolved),sku:variant?.sku??product.code,imageUrl:canonicalImage(product),quantity,unitPriceCents:variant?.originalPriceCents??variant?.priceCents??product.priceCents,currency:product.currency,...(specifications.length?{specifications}:{})};
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
 const item=itemSnapshot(resolved,quantity);
 const pricing=evaluateCommercialRules({lines:[pricingLine(resolved.product,resolved.variant?.id,quantity,item.unitPriceCents,context.metadata.categories)],rules:context.commerce.rules??[],channel:"WHATSAPP",now:now(deps)}).items[0];
 Object.assign(item,{unitPriceCents:pricing.unitPriceCents,totalCents:pricing.totalCents,pricing:{originalUnitPriceCents:pricing.originalUnitPriceCents,discountCents:pricing.discountCents,appliedRules:pricing.appliedRules}});
 const utm=cleanUtm(input.utm),pageUrl=safePageUrl(input.pageUrl);
 const {intent,created}=await createIntent(deps,{tenantId:context.site.tenantId,workspaceId:context.site.workspaceId,siteId:context.site.id,type:"PRODUCT_WHATSAPP",productId:item.productId,variantId:item.variantId,quantity,snapshot:{items:[item],subtotalCents:item.totalCents??item.unitPriceCents*quantity,currency:item.currency,siteName:context.snapshot.content.name},pageUrl,utm,anonymousSessionId:input.sessionId,requestKey:input.requestKey});
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
 if(input.productId){const product=await deps.productRepository.getById(input.productId);if(product&&product.tenantId===site.tenantId&&product.workspaceId===site.workspaceId&&isPublicCatalogProduct(product,await deps.productEngineRepository.metadata(site)))productId=product.id;}
 if(input.type==="PRODUCT_VIEW"&&!productId)return;
 await deps.commerceRepository.recordEvent({tenantId:site.tenantId,workspaceId:site.workspaceId,siteId:site.id,type:input.type,anonymousSessionId:input.sessionId,productId,pageUrl:safePageUrl(input.pageUrl),utm:cleanUtm(input.utm),eventKey:input.eventKey,referrer:input.referrer,device:input.device});
}

// ---------------------------------------------------------------- carrinho (intenção, não pedido)
export async function activeCart(deps:SiteCommerceDeps,context:PublicContext,token:string|undefined){
 if(!token)return undefined;const cart=await deps.commerceRepository.getCart({siteId:context.site.id,tokenHash:hashToken(token)});
 return cart&&cart.status==="ACTIVE"&&Date.parse(cart.expiresAt)>now(deps).getTime()?cart:undefined;
}
export async function presentCart(deps:SiteCommerceDeps,context:PublicContext,cart:{id:string;couponCode?:string}|undefined,token:string|undefined){
 const items=cart?await deps.commerceRepository.listCartItems(cart.id):[];
 const lines=await Promise.all(items.map(async item=>{
  try{
   const resolved=await publicProduct(deps,context,item.productId,item.variantId);const available=availableQuantity(resolved);
   const purchasable=resolved.presented.commerce.allowedActions.includes("add_to_cart")&&(available===undefined||available>=item.quantity);
   const snapshot=itemSnapshot(resolved,item.quantity);
   // Fase 2: cada linha sabe por onde fecha — compra online ou WhatsApp (modo híbrido pode ter os dois).
   const channel:"checkout"|"whatsapp"=resolved.presented.commerce.allowedActions.includes("buy_now")?"checkout":"whatsapp";
   return {productId:item.productId,variantId:item.variantId,quantity:item.quantity,name:snapshot.name,variantLabel:snapshot.variantLabel,sku:snapshot.sku,slug:resolved.presented.slug,imageUrl:resolved.variant?.imageUrl??resolved.presented.imageUrls[0],unitPriceCents:snapshot.unitPriceCents,currency:snapshot.currency,availableQuantity:available,available:purchasable,channel,resolved};
  }catch{
   return {productId:item.productId,variantId:item.variantId,quantity:item.quantity,name:item.productSnapshot.name,variantLabel:item.productSnapshot.variantLabel,sku:item.productSnapshot.sku,slug:undefined,imageUrl:undefined,unitPriceCents:item.productSnapshot.unitPriceCents,currency:item.productSnapshot.currency,availableQuantity:0,available:false,channel:"whatsapp" as const,resolved:undefined};
  }
 }));
 const rules=context.commerce.rules??[];
 const raw=lines.map(line=>({...line,originalUnitPriceCents:line.unitPriceCents,totalCents:line.unitPriceCents*line.quantity,discountCents:0,appliedRules:[] as AppliedCommercialRule[]}));
 const progress:RuleProgress[]=[],appliedRules:AppliedCommercialRule[]=[];
 let couponStatus:import("../../domain/commerce/commercial-rules.js").CommercialPricing["couponStatus"];
 const groups=[...new Set(raw.filter(line=>line.available).map(line=>JSON.stringify([line.channel,line.currency])))];
 for(const group of groups){
  const eligible=raw.filter(line=>line.available&&JSON.stringify([line.channel,line.currency])===group);
  const pricing=evaluateCommercialRules({lines:eligible.map(line=>pricingLine(line.resolved!.product,line.variantId,line.quantity,line.originalUnitPriceCents,context.metadata.categories)),rules,channel:eligible[0].channel==="checkout"?"CHECKOUT":"WHATSAPP",now:now(deps),couponCode:cart?.couponCode});
  for(const item of pricing.items){const line=raw.find(line=>JSON.stringify([line.productId,line.variantId??""])===item.key)!;Object.assign(line,{unitPriceCents:item.unitPriceCents,totalCents:item.totalCents,discountCents:item.discountCents,appliedRules:item.appliedRules});}
  progress.push(...pricing.progress);appliedRules.push(...pricing.appliedRules);couponStatus=pricing.couponStatus;
 }
 const valid=raw.filter(line=>line.available),currency=valid[0]?.currency??raw[0]?.currency??"BRL";
 const originalSubtotalCents=valid.reduce((sum,line)=>sum+line.originalUnitPriceCents*line.quantity,0),subtotalCents=valid.reduce((sum,line)=>sum+line.totalCents,0);
 const pricingKey=pricingFingerprint(valid.map(line=>({...pricingLine(line.resolved!.product,line.variantId,line.quantity,line.originalUnitPriceCents,context.metadata.categories),totalCents:line.totalCents,discountCents:line.discountCents,appliedRules:line.appliedRules})),rules,cart?.couponCode);
 return {token,lines:raw,view:{items:raw.map(({resolved:_resolved,...line})=>line),subtotalCents,originalSubtotalCents,discountCents:originalSubtotalCents-subtotalCents,currency,itemCount:valid.reduce((sum,line)=>sum+line.quantity,0),progress:progress.slice(0,3),appliedRules,couponCode:cart?.couponCode,couponStatus,pricingKey}};
}
export async function getPublicCart(deps:SiteCommerceDeps,input:{lookup:PublicLookup;token?:string}){
 const context=await publicContext(deps,input.lookup);const cart=await activeCart(deps,context,input.token);
 return (await presentCart(deps,context,cart,cart?input.token:undefined)).view;
}
export async function setPublicCartCoupon(deps:SiteCommerceDeps,input:{lookup:PublicLookup;token:string;code?:string}){
 const context=await publicContext(deps,input.lookup),cart=await activeCart(deps,context,input.token);
 if(!cart||!deps.commerceRepository.setCartCoupon)throw Error("SITE_VALIDATION: seu carrinho expirou.");
 const code=input.code?.trim().toUpperCase()||undefined;
 if(code){const preview=await presentCart(deps,context,{...cart,couponCode:code},input.token);if(!preview.view.appliedRules.some(rule=>rule.coupon))throw Error(preview.view.couponStatus==="CONFLICT"?"SITE_VALIDATION: o cupom não acumula com o benefício atual. A melhor condição permitida foi mantida.":"SITE_VALIDATION: cupom inválido, expirado ou não elegível para este carrinho.");}
 await deps.commerceRepository.setCartCoupon(cart.id,code);
 return {...(await presentCart(deps,context,{...cart,couponCode:code},input.token)).view,token:input.token};
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
export async function checkoutPublicCartToWhatsapp(deps:SiteCommerceDeps,input:{lookup:PublicLookup;token:string;requestKey:string;customer?:{name:string;phone:string}}&VisitorContext){
 const context=await publicContext(deps,input.lookup);const number=context.snapshot.content.whatsapp;
 const cartLead=context.commerce.settings.cartLead;
 if(!number&&!cartLead)throw Error("SITE_VALIDATION: o WhatsApp da empresa não está configurado.");
 if(cartLead&&!input.customer)throw Error("SITE_VALIDATION: informe seu nome e WhatsApp para finalizar o pedido.");
 // Sem número no site, o pedido fica registrado no Vorix e a equipe entra em contato.
 const result=(intent:SalesIntent)=>number?intentResult(intent,number):{reference:intent.reference,received:true as const};
 const cart=await deps.commerceRepository.getCart({siteId:context.site.id,tokenHash:hashToken(input.token)});
 if(!cart)throw Error("SITE_NOT_FOUND: carrinho não encontrado.");
 const repeated=await deps.commerceRepository.findIntentByRequestKey({siteId:context.site.id,requestKey:input.requestKey});
 if(repeated)return result(repeated);
 if(cart.status==="CHECKED_OUT"&&cart.salesIntentId){
  const previous=await deps.commerceRepository.getIntent(cart.salesIntentId);
  if(previous)return result(previous);
 }
 if(cart.status!=="ACTIVE"||Date.parse(cart.expiresAt)<=now(deps).getTime())throw Error("SITE_VALIDATION: este carrinho expirou. Monte um novo carrinho.");
 const {lines:allLines}=await presentCart(deps,context,cart,input.token);
 // Itens de compra online seguem para o checkout; aqui só os que fecham pelo WhatsApp.
 const lines=allLines.filter(line=>line.channel==="whatsapp");
 if(!lines.length)throw Error(allLines.length?"SITE_VALIDATION: estes itens são finalizados pela compra online.":"SITE_VALIDATION: o carrinho está vazio.");
 const blocked=lines.find(line=>!line.available||!line.resolved);
 if(blocked)throw Error(`SITE_VALIDATION: revise o carrinho — ${blocked.name}${blocked.variantLabel?` (${blocked.variantLabel})`:""} não está disponível nessa quantidade.`);
 const items=lines.map(line=>({...itemSnapshot(line.resolved!,line.quantity),unitPriceCents:line.unitPriceCents,totalCents:line.totalCents,pricing:{originalUnitPriceCents:line.originalUnitPriceCents,discountCents:line.discountCents,appliedRules:line.appliedRules}}));
 const currencies=new Set(items.map(item=>item.currency));if(currencies.size>1)throw Error("SITE_VALIDATION: o carrinho tem produtos em moedas diferentes.");
 const utm=cleanUtm(input.utm),pageUrl=safePageUrl(input.pageUrl);
 const {intent,created}=await createIntent(deps,{tenantId:cart.tenantId,workspaceId:cart.workspaceId,siteId:cart.siteId,type:"CART_WHATSAPP",snapshot:{items,subtotalCents:items.reduce((sum,item)=>sum+item.totalCents,0),currency:items[0].currency,siteName:context.snapshot.content.name},pageUrl,utm,anonymousSessionId:input.sessionId,requestKey:input.requestKey});
 if(lines.length===allLines.length)await deps.commerceRepository.checkoutCart({cartId:cart.id,salesIntentId:intent.id});
 else for(const line of lines)await deps.commerceRepository.removeCartItem({cartId:cart.id,productId:line.productId,variantId:line.variantId});
 const base={tenantId:intent.tenantId,workspaceId:intent.workspaceId,siteId:intent.siteId,anonymousSessionId:input.sessionId,cartId:cart.id,salesIntentId:intent.id,pageUrl,utm};
 if(created){emit(deps,{...base,type:"CART_WHATSAPP_START"});emit(deps,{...base,type:"SALES_INTENT_CREATED"});deps.log?.("WhatsAppCartStarted",{intentId:intent.id,siteId:intent.siteId,lines:items.length});}
 if(created&&cartLead&&input.customer){
  // Mesmo padrão do formulário: falha no CRM nunca perde o pedido do visitante; o erro fica no log.
  try{
   const list=items.map(item=>`${item.quantity}x ${item.name}${item.variantLabel?` (${item.variantLabel})`:""}`).join("\n");
   const saved=await deps.repository.addInquiry({site:context.site,name:input.customer.name,phone:input.customer.phone,message:`Pedido pelo carrinho do site (${intent.reference}):\n${list}`.slice(0,4000),requestKey:input.requestKey});
   if(saved.contactId){if(deps.registerCartLead)await deps.registerCartLead({intentId:intent.id,contactId:saved.contactId,customer:input.customer.name});else await deps.commerceRepository.updateIntentLinks(intent.id,{contactId:saved.contactId});}
  }catch(error){deps.log?.("site_cart_lead_failed",{intentId:intent.id,error:error instanceof Error?error.message:String(error)});}
 }
 return result(intent);
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
export async function listSiteSalesIntents(deps:SiteCommerceDeps,input:{tenantId:string;workspaceId:string;siteId?:string;limit?:number;visibility?:{global:boolean;teamIds:readonly string[];ownerUserIds:readonly string[]}}){
 return (await deps.commerceRepository.listIntents({...input,limit:Math.min(200,Math.max(1,input.limit??50))})).map(intent=>({...intent,anonymousSessionId:undefined,snapshot:{...intent.snapshot,items:intent.snapshot.items.map(presentIntentItem)}}));
}
export type {PublicSiteProduct,SalesIntentType};
