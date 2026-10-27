/**
 * Vorix Commerce, Fase 1 — produto dentro do Vorix Conversas. O atendente escolhe do catálogo e o
 * Vorix monta a mensagem (foto, nome, preço, descrição curta e link do Site); ninguém copia nada à mão.
 * Fica na ponte porque junta Conversas (envio) com Catálogo/CRM (produto e oportunidade).
 */
import type {ProductRepositoryPort} from "../ports/product-repository.port.js";
import type {SalesCatalogRepositoryPort} from "../ports/sales-engine-repository.port.js";
import type {SiteRepositoryPort} from "../ports/site-repository.port.js";
import type {ObjectStoragePort} from "../ports/object-storage.port.js";
import type {ProductEngineRepositoryPort} from "../ports/product-engine-repository.port.js";
import type {Product} from "../../domain/crm/crm.model.js";
import type {Site} from "../../domain/sites/site.model.js";
import {sendInboxMediaMessage,sendInboxMessage,type InboxUseCaseDeps} from "../inbox/inbox-use-cases.js";
import {mustConversationInWorkspace} from "./conversation-guard.js";
import {isPublicCatalogProduct} from "../sites/site-use-cases.js";
import {signOwnedUrl,OBJECT_URL_TTL,parseOwnedObjectUrl} from "../../shared/utils/object-url-signing.js";
import {ensureCrmContactForInboxContact,type InboxCrmBridgeDeps} from "./inbox-crm-bridge-use-cases.js";
import {addDealItem} from "../sales/deal-commercial-use-cases.js";
import {resolveDealScope,type SalesActor,type SalesEngineDeps} from "../sales/sales-context.js";
import {createDeal,type DealUseCaseDeps} from "../crm/deal-use-cases.js";
import {ensureDefaultPipeline,type PipelineUseCaseDeps} from "../crm/pipeline-use-cases.js";
import {hasPermission} from "../../domain/identity/identity.model.js";

export type ConversationProductDeps={
 inbox:InboxUseCaseDeps;
 productRepository:ProductRepositoryPort;salesCatalogRepository:SalesCatalogRepositoryPort;productEngineRepository:ProductEngineRepositoryPort;
 siteRepository?:SiteRepositoryPort;objectStorage?:ObjectStoragePort;publicBaseDomain?:string;appBaseUrl?:string;
 crmBridge?:InboxCrmBridgeDeps;sales?:SalesEngineDeps;crm?:PipelineUseCaseDeps&DealUseCaseDeps;
};
const MAX_IMAGE_BYTES=5_000_000;
const money=(cents:number,currency:string)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency}).format(cents/100);
const shortText=(text:string|undefined,max=180)=>{const clean=(text??"").replace(/\s+/g," ").trim();return clean.length>max?`${clean.slice(0,max-1).trimEnd()}…`:clean;};

/** Endereço público do Site: domínio próprio verificado → subdomínio da plataforma → caminho /s/slug. Nunca um host fixo. */
export async function publicSiteBaseUrl(deps:Pick<ConversationProductDeps,"siteRepository"|"publicBaseDomain"|"appBaseUrl">,site:Site):Promise<string|undefined>{
 const domain=(await deps.siteRepository?.domains(site.id,site.tenantId).catch(()=>[])??[]).find(item=>item.verifiedAt);
 if(domain)return `https://${domain.hostname}`;
 if(deps.publicBaseDomain)return `https://${site.slug}.${deps.publicBaseDomain}`;
 return deps.appBaseUrl?`${deps.appBaseUrl.replace(/\/$/,"")}/s/${site.slug}`:undefined;
}
async function publishedSite(deps:ConversationProductDeps,tenantId:string,workspaceId:string){return (await deps.siteRepository?.list(tenantId,workspaceId).catch(()=>[])??[]).find(site=>site.published);}

async function productView(deps:ConversationProductDeps,product:Product,site:Site|undefined,siteBase:string|undefined,metadata:Awaited<ReturnType<ProductEngineRepositoryPort["metadata"]>>|undefined){
 const variants=(await deps.salesCatalogRepository.listVariants(product.id)).filter(variant=>variant.active);
 const options=product.details?.options??[];
 const onSite=!!site&&!!metadata&&isPublicCatalogProduct(product,metadata);
 return {id:product.id,name:product.name,sku:product.code,description:shortText(product.description),priceCents:product.priceCents,currency:product.currency,
  imageUrl:product.imageUrls[0]?signOwnedUrl(product.imageUrls[0],OBJECT_URL_TTL.preview):undefined,
  availableQuantity:product.trackStock?Math.max(0,product.stockQuantity-(product.reservedQuantity??0)):undefined,
  siteUrl:onSite&&siteBase?`${siteBase}/produto/${encodeURIComponent(product.details?.slug??product.id)}`:undefined,
  variants:variants.map(variant=>({id:variant.id,label:options.length?options.map(option=>variant.optionValues?.[option.key]).filter(Boolean).join(" / "):variant.name,sku:variant.code,priceCents:variant.priceOverride===false?product.priceCents:variant.listPriceCents,availableQuantity:product.trackStock?Math.max(0,(variant.stockQuantity??0)-(variant.reservedQuantity??0)):undefined})),
  requiresVariant:options.length>0};
}
export type ConversationProductView=Awaited<ReturnType<typeof productView>>;
export async function searchConversationProducts(deps:ConversationProductDeps,input:{tenantId:string;workspaceId:string;search?:string;limit?:number}):Promise<ConversationProductView[]>{
 const products=(await deps.productRepository.listByWorkspace({tenantId:input.tenantId,workspaceId:input.workspaceId,search:input.search?.trim()||undefined,activeOnly:true})).slice(0,Math.min(40,input.limit??20));
 const site=await publishedSite(deps,input.tenantId,input.workspaceId);
 const [siteBase,metadata]=site?await Promise.all([publicSiteBaseUrl(deps,site),deps.productEngineRepository.metadata(site)]):[undefined,undefined];
 return Promise.all(products.map(product=>productView(deps,product,site,siteBase,metadata)));
}
async function mustProduct(deps:ConversationProductDeps,input:{tenantId:string;workspaceId:string;productId:string}){
 const product=await deps.productRepository.getById(input.productId);
 if(!product||product.tenantId!==input.tenantId||product.workspaceId!==input.workspaceId||!product.active)throw Error("CONVERSATION_PRODUCT_NOT_FOUND: produto não encontrado.");
 return product;
}
/** Texto do card do produto, montado a partir do catálogo. */
export function productShareText(view:ConversationProductView,variantId?:string):string{
 const variant=variantId?view.variants.find(item=>item.id===variantId):undefined;
 const lines=[`*${view.name}${variant?` — ${variant.label}`:""}*`,money(variant?.priceCents??view.priceCents,view.currency)];
 if(view.description)lines.push(view.description);
 if(view.siteUrl)lines.push(`Veja mais: ${view.siteUrl}`);
 return lines.join("\n");
}
export async function sendProductToConversation(deps:ConversationProductDeps,input:{tenantId:string;workspaceId:string;conversationId:string;userId:string;productId:string;variantId?:string;withImage:boolean}){
 const conversation=await mustConversationInWorkspace(deps.inbox,input);
 const product=await mustProduct(deps,input);
 const site=await publishedSite(deps,input.tenantId,input.workspaceId);
 const [siteBase,metadata]=site?await Promise.all([publicSiteBaseUrl(deps,site),deps.productEngineRepository.metadata(site)]):[undefined,undefined];
 const view=await productView(deps,product,site,siteBase,metadata);
 if(input.variantId&&!view.variants.some(item=>item.id===input.variantId))throw Error("CONVERSATION_PRODUCT_NOT_FOUND: opção do produto não encontrada.");
 const text=productShareText(view,input.variantId);
 const image=input.withImage?await readProductImage(deps,product):undefined;
 if(image)return sendInboxMediaMessage(deps.inbox,{tenantId:input.tenantId,workspaceId:input.workspaceId,conversationId:conversation.id,sentByUserId:input.userId,type:"image",body:image.body,mimeType:image.mimeType,fileName:image.fileName,caption:text});
 return sendInboxMessage(deps.inbox,{tenantId:input.tenantId,workspaceId:input.workspaceId,conversationId:conversation.id,sentByUserId:input.userId,body:text,linkPreview:!!view.siteUrl});
}
async function readProductImage(deps:ConversationProductDeps,product:Product){
 const url=product.imageUrls[0];if(!url||!deps.objectStorage?.read)return undefined;
 const key=parseOwnedObjectUrl(url)?.key;if(!key)return undefined;
 const extension=key.split(".").pop()?.toLowerCase();
 const mimeType=extension==="png"?"image/png":extension==="webp"?"image/webp":extension==="jpg"||extension==="jpeg"?"image/jpeg":undefined;
 if(!mimeType)return undefined;
 try{return {body:await deps.objectStorage.read(key,{maxBytes:MAX_IMAGE_BYTES}),mimeType,fileName:`produto.${extension}`};}catch{return undefined;}
}

export type AddProductToOpportunityResult={status:"added";dealId:string;dealTitle:string;created:boolean}|{status:"choose";deals:{id:string;title:string}[]}|{status:"no_deal"}|{status:"no_contact"};
/**
 * "Adicionar à oportunidade" pela conversa. Uma oportunidade aberta do contato → adiciona; várias →
 * pede para escolher; nenhuma → só cria quando pedido E o usuário pode criar oportunidades.
 */
export async function addProductToConversationOpportunity(deps:ConversationProductDeps,actor:SalesActor,input:{workspaceId:string;conversationId:string;productId:string;variantId?:string;quantity:number;dealId?:string;createIfMissing?:boolean}):Promise<AddProductToOpportunityResult>{
 if(!deps.sales||!deps.crm)throw Error("CONVERSATION_PRODUCT_UNAVAILABLE: oportunidades indisponíveis neste ambiente.");
 const conversation=await mustConversationInWorkspace(deps.inbox,{tenantId:actor.tenantId,workspaceId:input.workspaceId,conversationId:input.conversationId});
 await mustProduct(deps,{tenantId:actor.tenantId,workspaceId:input.workspaceId,productId:input.productId});
 const inboxContact=conversation.contactId?await deps.inbox.contactRepository.getById(conversation.contactId):undefined;
 let contactId=inboxContact?.crmContactId;
 const scope=await resolveDealScope(deps.sales,actor,input.workspaceId);
 let dealId=input.dealId;let created=false;
 if(dealId){
  const deal=await deps.sales.dealRepository.getById(dealId);
  if(!deal||deal.tenantId!==actor.tenantId||deal.workspaceId!==input.workspaceId||deal.status!=="open"||(contactId&&deal.contactId!==contactId))throw Error("CONVERSATION_PRODUCT_NOT_FOUND: oportunidade não encontrada.");
 }else{
  const open=contactId?await deps.sales.dealRepository.listByWorkspace({tenantId:actor.tenantId,workspaceId:input.workspaceId,contactId,status:"open",limit:20,...scope}):[];
  if(open.length>1)return {status:"choose",deals:open.map(deal=>({id:deal.id,title:deal.title}))};
  if(open.length===1)dealId=open[0].id;
  else{
   if(!input.createIfMissing)return {status:"no_deal"};
   if(!hasPermission(actor,"deal:manage"))throw Error("CONVERSATION_PRODUCT_FORBIDDEN: você não tem permissão para criar oportunidades.");
   if(!contactId&&inboxContact&&deps.crmBridge)contactId=(await ensureCrmContactForInboxContact(deps.crmBridge,{tenantId:actor.tenantId,workspaceId:input.workspaceId,inboxContactId:inboxContact.id,contactName:inboxContact.name,contactPhone:inboxContact.phoneNormalized,origin:"whatsapp"}))?.contactId;
   if(!contactId)return {status:"no_contact"};
   const product=await mustProduct(deps,{tenantId:actor.tenantId,workspaceId:input.workspaceId,productId:input.productId});
   const {pipeline,stages}=await ensureDefaultPipeline(deps.crm,actor.tenantId,input.workspaceId);
   const stage=[...stages].filter(item=>!item.isWon&&!item.isLost).sort((a,b)=>a.position-b.position)[0];
   const deal=await createDeal(deps.crm,{tenantId:actor.tenantId,workspaceId:input.workspaceId,pipelineId:pipeline.id,stageId:stage.id,contactId,title:`${inboxContact?.name||"Cliente"} — ${product.name}`.slice(0,200),valueCents:0,currency:product.currency,ownerUserId:actor.userId,teamId:conversation.currentTeamId,origin:"whatsapp",actorUserId:actor.userId});
   dealId=deal.id;created=true;
  }
 }
 await addDealItem(deps.sales,actor,{workspaceId:input.workspaceId,dealId:dealId!,productId:input.productId,variantId:input.variantId,quantity:input.quantity});
 const deal=await deps.sales.dealRepository.getById(dealId!);
 return {status:"added",dealId:dealId!,dealTitle:deal?.title??"",created};
}
