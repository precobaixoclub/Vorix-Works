import {evaluateCommercialRules,pricingLine} from "../commerce/commercial-rule-use-cases.js";
import {normalizeContactPhone} from "../../domain/crm/contact-phone.js";
import {salesIntentWhatsappMessage,type SalesIntent} from "../../domain/sites/site-commerce.js";
import {presentPublicProduct,isPublicCatalogProduct} from "./site-use-cases.js";
import {publicContext,publicProduct,itemSnapshot,availableQuantity,type SiteCommerceDeps} from "./site-commerce-use-cases.js";
import {signOwnedUrl,OBJECT_URL_TTL} from "../../shared/utils/object-url-signing.js";
import {selectionUrl} from "./site-selection-links.js";

const current=(deps:SiteCommerceDeps)=>deps.now?.()??new Date();
async function load(deps:SiteCommerceDeps,token:string){
 if(!/^[a-f0-9]{64}$/.test(token))throw Error("SITE_NOT_FOUND");
 const intent=await deps.commerceRepository.getSelection(token);
 if(!intent||!["PRODUCT_WHATSAPP","CART_WHATSAPP"].includes(intent.type))throw Error("SITE_NOT_FOUND");
 const site=await deps.repository.get(intent.siteId);
 if(!site?.published||!await deps.hasAccess(intent.tenantId))throw Error("SITE_NOT_FOUND");
 return {intent,site};
}
async function editable(deps:SiteCommerceDeps,intent:SalesIntent){
 return Date.parse(intent.expiresAt)>current(deps).getTime()&&intent.status!=="EXPIRED"&&
 (!intent.dealId||!!deps.selectionDealOpen&&await deps.selectionDealOpen(intent.dealId,intent.tenantId,intent.workspaceId));
}
export async function getPublicSelection(deps:SiteCommerceDeps,token:string){
 const {intent,site}=await load(deps,token);
 const context=await publicContext(deps,{slug:site.slug});
 const products=await Promise.all([...new Set(intent.snapshot.items.map(item=>item.productId))].map(async id=>{
  const product=await deps.productRepository.getById(id);
  if(!product||product.tenantId!==site.tenantId||product.workspaceId!==site.workspaceId||!isPublicCatalogProduct(product,context.metadata))return undefined;
  return presentPublicProduct(deps,product,context.metadata,context.commerce);
 }));
 return {reference:intent.reference,revision:intent.selectionRevision??1,siteName:intent.snapshot.siteName??site.published!.content.name,
  siteSlug:site.slug,logoUrl:site.published!.content.logoUrl?signOwnedUrl(site.published!.content.logoUrl,OBJECT_URL_TTL.preview):undefined,
  createdAt:intent.createdAt,expiresAt:intent.expiresAt,submittedAt:intent.selectionSubmittedAt,
  editable:await editable(deps,intent),syncPending:!!intent.selectionSyncError,
  snapshot:{...intent.snapshot,items:intent.snapshot.items.map(item=>({...item,imageUrl:item.imageUrl?signOwnedUrl(item.imageUrl,OBJECT_URL_TTL.preview):undefined}))},
  products:products.filter(product=>!!product),
  history:(intent.selectionHistory??[]).map(item=>({revision:item.revision,at:item.at})),
  whatsappUrl:site.published!.content.whatsapp?`https://wa.me/${site.published!.content.whatsapp}?text=${encodeURIComponent(salesIntentWhatsappMessage(intent,selectionUrl(token)))}`:undefined};
}

/** Confirmação explícita: guarda a revisão antes de integrar ao CRM; repetir após falha repara o mesmo registro. */
export async function submitPublicSelection(deps:SiteCommerceDeps,input:{token:string;revision:number;items:{productId:string;variantId?:string;quantity:number}[];customer?:{name:string;phone:string}}){
 const {intent,site}=await load(deps,input.token);
 if(!await editable(deps,intent))throw Error("SITE_VALIDATION: esta seleção não aceita mais alterações. Fale com a equipe para continuar.");
 if(!deps.registerCartLead)throw Error("SITE_VALIDATION: não foi possível registrar o pedido agora. Tente novamente em instantes.");
 const customer=intent.selectionCustomer??input.customer;
 const phone=customer?normalizeContactPhone(customer.phone):undefined;
 if(customer&&(customer.name.trim().length<2||!phone))throw Error("SITE_VALIDATION: informe seu nome e um WhatsApp válido com DDD.");
 if(!customer&&!site.published!.content.whatsapp)throw Error("SITE_VALIDATION: informe seu nome e WhatsApp para a equipe retornar sua solicitação.");
 if(!input.items.length||input.items.length>50)throw Error("SITE_VALIDATION: escolha entre 1 e 50 itens.");
 const keys=new Set<string>();
 const context=await publicContext(deps,{slug:site.slug});
 const resolved=await Promise.all(input.items.map(async line=>{
  const key=JSON.stringify([line.productId,line.variantId??""]);
  if(keys.has(key)||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>99)throw Error("SITE_VALIDATION: revise os itens e as quantidades.");keys.add(key);
  const product=await publicProduct(deps,context,line.productId,line.variantId);
  if(!product.presented.commerce.allowedActions.includes("whatsapp")&&!product.presented.commerce.allowedActions.includes("add_to_cart"))throw Error("SITE_VALIDATION: este item não está disponível para atendimento.");
  const available=availableQuantity(product);
  if(available!==undefined&&available>0&&line.quantity>available)throw Error(`SITE_VALIDATION: só temos ${available} unidade(s) de ${product.product.name}.`);
  return {product,item:itemSnapshot(product,line.quantity)};
 }));
 const currency=resolved[0].item.currency;
 if(resolved.some(({item})=>item.currency!==currency))throw Error("SITE_VALIDATION: escolha produtos na mesma moeda.");
 const pricing=evaluateCommercialRules({lines:resolved.map(({product,item})=>pricingLine(product.product,item.variantId,item.quantity,item.unitPriceCents,context.metadata.categories)),rules:context.commerce.rules??[],channel:"WHATSAPP",now:current(deps),couponCode:intent.snapshot.couponCode});
 const items=resolved.map(({item},index)=>{const price=pricing.items[index];return {...item,unitPriceCents:price.unitPriceCents,totalCents:price.totalCents,pricing:{originalUnitPriceCents:price.originalUnitPriceCents,discountCents:price.discountCents,appliedRules:price.appliedRules}};});
 if(!await deps.commerceRepository.claimSelection({id:intent.id,revision:input.revision}))throw Error("SITE_VALIDATION: esta seleção mudou ou está sendo salva. Atualize a página para continuar.");
 let persisted=false;
 try{
  const snapshot={...intent.snapshot,items,subtotalCents:items.reduce((sum,item)=>sum+item.totalCents,0),currency};
  const updated=await deps.commerceRepository.saveSelection({id:intent.id,revision:input.revision,snapshot,customer:customer&&phone?{name:customer.name.trim(),phone}:undefined});
  persisted=true;
  const list=items.map(item=>`${item.quantity}x ${item.name}${item.variantLabel?` (${item.variantLabel})`:""}`).join("\n");
  const saved=intent.contactId?{contactId:intent.contactId}:customer&&phone?await deps.repository.addInquiry({site,name:customer.name.trim(),phone,message:`Pedido ${intent.reference}:\n${list}\n${selectionUrl(input.token)}`.slice(0,4000),requestKey:`selection:${intent.id}`}):{};
  if(customer&&!saved.contactId)throw Error("Não foi possível registrar o contato.");
  if(saved.contactId)await deps.commerceRepository.updateIntentLinks(intent.id,{contactId:saved.contactId});
  const lead=await deps.registerCartLead({intentId:updated.id,contactId:saved.contactId,customer:customer?.name.trim()||"Visitante do site",reconcile:true});
  if(!lead.dealId)throw Error("Não foi possível concluir o registro da oportunidade.");
  if(saved.contactId){
   await deps.commerceRepository.completeIntent(intent.id,{contactId:saved.contactId,dealId:lead.dealId});
   if(!intent.convertedAt)await deps.commerceRepository.recordEvent({tenantId:intent.tenantId,workspaceId:intent.workspaceId,siteId:intent.siteId,type:"SALES_INTENT_CONVERTED",salesIntentId:intent.id,contactId:saved.contactId,anonymousSessionId:intent.anonymousSessionId,utm:intent.utm,eventKey:`intent-converted:${intent.id}`}).catch(()=>undefined);
   if(intent.anonymousSessionId)await deps.commerceRepository.attachContactToSession({siteId:intent.siteId,anonymousSessionId:intent.anonymousSessionId,contactId:saved.contactId}).catch(()=>undefined);
  }
  await deps.commerceRepository.finishSelection(intent.id);
 }catch(error){
  await deps.commerceRepository.finishSelection(intent.id,error instanceof Error?error.message:String(error));
  if(!persisted)throw error;
  deps.log?.("site_selection_sync_failed",{intentId:intent.id});
  // A revisão continua consultável e pode ser reenviada sem duplicar o contato ou a oportunidade.
  return {...await getPublicSelection(deps,input.token),syncPending:true};
 }
 return getPublicSelection(deps,input.token);
}

/** Finalização em um clique: registra a seleção e a oportunidade sem inventar um contato. */
export async function finalizeSelectionForWhatsapp(deps:SiteCommerceDeps,reference:string){
 const intent=await deps.commerceRepository.getIntentByReference(reference);
 if(!intent?.selectionToken)throw Error("SITE_NOT_FOUND");
 const selection=intent.selectionSubmittedAt&&!intent.selectionSyncError?await getPublicSelection(deps,intent.selectionToken):await submitPublicSelection(deps,{token:intent.selectionToken,revision:intent.selectionRevision??1,items:intent.snapshot.items.map(({productId,variantId,quantity})=>({productId,variantId,quantity}))});
 if(selection.syncPending)throw Error("SITE_VALIDATION: o pedido foi salvo, mas o registro na equipe está pendente. Tente finalizar novamente.");
 return selection;
}
