import {importedTemplateView} from "./site-imported-template.js";
import type {CommercialRuleRepositoryPort} from "../ports/commercial-rule-repository.port.js";
import {ruleActive,ruleMatchesProduct,type CommercialRule} from "../../domain/commerce/commercial-rules.js";
import {evaluateCommercialRules,pricingLine,categoryAncestors} from "../commerce/commercial-rule-use-cases.js";
import type {SiteRepositoryPort} from "../ports/site-repository.port.js";
import type {ProductRepositoryPort} from "../ports/product-repository.port.js";
import type {ProductEngineRepositoryPort} from "../ports/product-engine-repository.port.js";
import type {SalesCatalogRepositoryPort} from "../ports/sales-engine-repository.port.js";
import {normalizeSiteHostname,siteContentSchema,siteThemeSchema,siteSnapshotSchema,captureSiteTemplateConfig,siteImageUrls,type Site,type SiteSnapshot} from "../../domain/sites/site.model.js";
import {signOwnedUrl,OBJECT_URL_TTL} from "../../shared/utils/object-url-signing.js";
import {publicVehicleDetails,publicRealEstateDetails} from "../../domain/products/product-specializations.js";
import type {Product} from "../../domain/crm/crm.model.js";
import type {SiteCommerceRepositoryPort} from "../ports/site-commerce-repository.port.js";
import {defaultSiteCommerceSettings,resolveProductCommerce,siteCommerceSummary,type SiteCommerceSettings} from "../../domain/sites/site-commerce.js";
export type SiteEngineDeps={repository:SiteRepositoryPort;productRepository:ProductRepositoryPort;productEngineRepository:ProductEngineRepositoryPort;salesCatalogRepository:SalesCatalogRepositoryPort;hasAccess:(tenantId:string)=>Promise<boolean>;canPublish:(tenantId:string)=>Promise<boolean>;resolveTxt:(hostname:string)=>Promise<string[][]>;publicBaseDomain?:string;commerceRepository?:SiteCommerceRepositoryPort;commercialRules?:CommercialRuleRepositoryPort;now?:()=>Date;
 /** Fase 2 — loja pronta para vender online (pagamento + entrega + credencial). Sem isso, nunca há checkout. */
 checkoutStatus?:(site:Site,settings:SiteCommerceSettings)=>Promise<{ready:boolean;missing:string[]}>};
export async function mustSite(deps:Pick<SiteEngineDeps,"repository">,input:{id:string;tenantId:string;workspaceId:string}):Promise<Site>{
 const site=await deps.repository.get(input.id);if(!site||site.tenantId!==input.tenantId||site.workspaceId!==input.workspaceId)throw Error("SITE_NOT_FOUND: site não encontrado.");return site;
}
export function validateSiteSnapshot(raw:unknown):SiteSnapshot{
 if(JSON.stringify(raw??{}).length>500_000)throw Error("SITE_VALIDATION: o site excedeu o limite de conteúdo. Reduza textos ou quantidade de seções.");
 return captureSiteTemplateConfig(siteSnapshotSchema.parse(raw));
}
export async function publishSite(deps:SiteEngineDeps,input:{id:string;tenantId:string;workspaceId:string;revision:number;actorUserId:string;unpublish?:boolean}):Promise<Site>{
 const current=await mustSite(deps,input);
 if(!input.unpublish&&(!await deps.hasAccess(input.tenantId)||!await deps.canPublish(input.tenantId)))throw Error("SITE_ENTITLEMENT_REQUIRED: habilite Vorix Site e regularize a assinatura para publicar.");
 validateSiteSnapshot(current.draft);
 const saved=await deps.repository.publish(input);if(!saved)throw Error("SITE_REVISION_CONFLICT: o site mudou. Atualize a tela antes de publicar.");return saved;
}
type CatalogMetadata=Awaited<ReturnType<ProductEngineRepositoryPort["metadata"]>>;
function visibleCategory(metadata:CatalogMetadata,id:string|undefined):boolean{
 const visited=new Set<string>();while(id){if(visited.has(id))return false;visited.add(id);const category=metadata.categories.find(item=>item.id===id);if(!category||!category.active||!category.siteVisible)return false;id=category.parentId;}return true;
}
/** Mesma regra de vitrine para catálogo, carrinho e intenção: produto ativo, visível e em categoria visível. */
export function isPublicCatalogProduct(product:Product,metadata:CatalogMetadata):boolean{
 return product.active&&!!product.details?.siteVisible&&product.details.catalogVisible&&!(product.details.type==="REAL_ESTATE"&&product.details.realEstate&&["sold","rented","inactive"].includes(product.details.realEstate.status))&&visibleCategory(metadata,product.categoryId);
}
export type SiteCommerceContext={settings:SiteCommerceSettings;hasWhatsapp:boolean;contactForm:boolean;checkoutReady:boolean;rules?:CommercialRule[];now?:Date};
export async function commerceContext(deps:Pick<SiteEngineDeps,"commerceRepository"|"checkoutStatus"|"commercialRules"|"now">,site:Site,snapshot:SiteSnapshot,preview=false):Promise<SiteCommerceContext>{
 const hasWhatsapp=!!snapshot.content.whatsapp;
 const settings=preview&&snapshot.commerceConfig?snapshot.commerceConfig.settings:await deps.commerceRepository?.getSettings(site.id)??defaultSiteCommerceSettings(hasWhatsapp);
 const checkoutReady=deps.checkoutStatus?(await deps.checkoutStatus(site,settings).catch(()=>({ready:false}))).ready:false;
 return {settings,hasWhatsapp,contactForm:snapshot.content.contactForm,checkoutReady,rules:preview&&snapshot.commerceConfig?snapshot.commerceConfig.rules.map(({id,definition})=>({...definition,id,tenantId:site.tenantId,workspaceId:site.workspaceId,siteId:site.id,revision:1,createdAt:"",updatedAt:""})):await deps.commercialRules?.list({tenantId:site.tenantId,workspaceId:site.workspaceId,siteId:site.id})??[],now:deps.now?.()??new Date()};
}
export async function presentPublicProduct(deps:Pick<SiteEngineDeps,"salesCatalogRepository">,product:Product,metadata:CatalogMetadata,commerce:SiteCommerceContext,preloadedVariants?:Awaited<ReturnType<SiteEngineDeps["salesCatalogRepository"]["listVariants"]>>){
  const variants=(preloadedVariants??await deps.salesCatalogRepository.listVariants(product.id)).filter(variant=>variant.active&&(!product.details?.options.length||(Object.keys(variant.optionValues??{}).length===product.details.options.length&&product.details.options.every(option=>option.values.includes(variant.optionValues?.[option.key]??"")))));
  const details=product.details!;
  const availableQuantity=product.trackStock?(details.options.length?variants.reduce((n,item)=>n+Math.max(0,(item.stockQuantity??0)-(item.reservedQuantity??0)),0):Math.max(0,product.stockQuantity-(product.reservedQuantity??0))):undefined;
  const resolvedCommerce=resolveProductCommerce({settings:commerce.settings,hasWhatsapp:commerce.hasWhatsapp,contactForm:commerce.contactForm,checkoutReady:commerce.checkoutReady,product:{type:details.type,itemType:product.itemType,saleMode:details.saleMode,trackStock:product.trackStock,availableQuantity,priceCents:product.priceCents}});
  // Rules match product, category, collection and currency — never the variant — so the unit price
  // depends only on the list price: evaluate once per distinct price instead of once per variant.
  const unitByPrice=new Map<number,number>();
  const effectiveUnit=(price:number,variantId?:string)=>{const known=unitByPrice.get(price);if(known!==undefined)return known;const value=evaluateUnit(price,variantId);unitByPrice.set(price,value);return value;};
  const evaluateUnit=(price:number,variantId?:string)=>{const item=evaluateCommercialRules({lines:[pricingLine(product,variantId,1,price,metadata.categories)],rules:commerce.rules??[],channel:resolvedCommerce.allowedActions.includes("buy_now")?"CHECKOUT":"WHATSAPP",now:commerce.now}).items[0];return item.appliedRules.some(rule=>rule.benefit.type==="FIXED")?price:item.totalCents;};
  return {id:product.id,name:product.name,description:product.description,sku:product.code,slug:details.slug??product.id,type:details.type,categoryId:product.categoryId,brandId:product.brandId,priceCents:effectiveUnit(product.priceCents),originalPriceCents:product.priceCents,currency:product.currency,unit:product.unit,
   imageUrls:product.imageUrls.map(url=>signOwnedUrl(url,OBJECT_URL_TTL.publicSite)),media:details.media.map(item=>({...item,url:signOwnedUrl(item.url,OBJECT_URL_TTL.publicSite)})),attributes:details.attributes,attributeLabels:Object.fromEntries(metadata.attributes.filter(item=>item.active).map(item=>[item.key,item.unit?`${item.label} (${item.unit})`:item.label])),apparel:details.type==="APPAREL"?details.apparel:undefined,vehicle:details.type==="VEHICLE"?publicVehicleDetails(details.vehicle):undefined,realEstate:details.type==="REAL_ESTATE"?publicRealEstateDetails(details.realEstate):undefined,billingType:product.billingType,options:details.options.map(option=>option.images?{...option,images:Object.fromEntries(Object.entries(option.images).map(([value,url])=>[value,signOwnedUrl(url,OBJECT_URL_TTL.publicSite)]))}:option),specs:details.specs,seo:details.seo,
   availableQuantity,
   // Compra online depende do fluxo de checkout do Site (Fase 2), não de um booleano do produto.
   canPurchaseOnline:false as const,
   quantityOffers:(commerce.rules??[]).filter(rule=>!rule.couponCode&&ruleActive(rule,commerce.now??new Date())&&rule.channels.includes(resolvedCommerce.allowedActions.includes("buy_now")?"CHECKOUT":"WHATSAPP")&&rule.benefit.type==="UNIT_PRICE"&&ruleMatchesProduct(rule,{productId:product.id,categoryIds:categoryAncestors(product.categoryId,metadata.categories),collection:details.apparel?.collection,currency:product.currency})).map(rule=>({id:rule.id,name:rule.name,count:rule.trigger.type==="QUANTITY"?rule.trigger.count:"ELIGIBLE",tiers:rule.benefit.type==="UNIT_PRICE"?rule.benefit.tiers:[],currency:rule.currency})),
   commerce:resolveProductCommerce({settings:commerce.settings,hasWhatsapp:commerce.hasWhatsapp,contactForm:commerce.contactForm,checkoutReady:commerce.checkoutReady,product:{type:details.type,itemType:product.itemType,saleMode:details.saleMode,trackStock:product.trackStock,availableQuantity,priceCents:product.priceCents}}),
   variants:variants.map(variant=>({id:variant.id,name:variant.name,sku:variant.code,optionValues:variant.optionValues??{},priceCents:effectiveUnit(variant.priceOverride===false?product.priceCents:variant.listPriceCents,variant.id),originalPriceCents:variant.priceOverride===false?product.priceCents:variant.listPriceCents,imageUrl:variant.imageUrl?signOwnedUrl(variant.imageUrl,OBJECT_URL_TTL.publicSite):undefined,availableQuantity:product.trackStock?Math.max(0,(variant.stockQuantity??0)-(variant.reservedQuantity??0)):undefined})),
  };
}
export type PublicSiteProduct=Awaited<ReturnType<typeof presentPublicProduct>>;
/** Presents many products with their variants loaded in ONE query (instead of one per product). */
export async function presentPublicProducts(deps:Pick<SiteEngineDeps,"salesCatalogRepository">,products:readonly Product[],metadata:CatalogMetadata,commerce:SiteCommerceContext){
 const batch=deps.salesCatalogRepository.listVariantsForProducts&&products.length>1?await deps.salesCatalogRepository.listVariantsForProducts(products.map(product=>product.id)):undefined;
 return Promise.all(products.map(product=>presentPublicProduct(deps,product,metadata,commerce,batch?.get(product.id))));
}
/** Resolve o site publicado por slug, subdomínio da plataforma ou domínio próprio. */
export async function resolvePublishedSite(deps:Pick<SiteEngineDeps,"repository"|"hasAccess"|"publicBaseDomain">,lookup:{slug?:string;hostname?:string}):Promise<{site:Site;snapshot:SiteSnapshot}>{
 if(lookup.hostname&&deps.publicBaseDomain&&lookup.hostname.endsWith(`.${deps.publicBaseDomain}`)){
  const label=lookup.hostname.slice(0,-deps.publicBaseDomain.length-1);if(label&&!label.includes(".")&&!new Set(["api","app","www","admin","mail","static"]).has(label))lookup={slug:label};
 }
 const site=await deps.repository.findPublic(lookup);
 if(!site||!await deps.hasAccess(site.tenantId))throw Error("SITE_NOT_FOUND: site não encontrado.");
 if(!site.published)throw Error("SITE_NOT_FOUND: site não publicado.");
 return {site,snapshot:site.published};
}
/** Primeira carga do catálogo público; o restante vem paginado do banco (busca, filtros, "mostrar mais"). */
export const PUBLIC_CATALOG_INITIAL=24;
function descendants(metadata:CatalogMetadata,rootId:string):string[]{const ids=[rootId];for(let i=0;i<ids.length;i++)for(const category of metadata.categories)if(category.parentId===ids[i]&&!ids.includes(category.id))ids.push(category.id);return ids;}
export type PublicSiteOptions={path?:readonly string[];includeSlugs?:boolean};
export async function publicSite(deps:SiteEngineDeps,lookup:{slug?:string;hostname?:string},preview?:Site,options:PublicSiteOptions={}){
 let site:Site,snapshot:SiteSnapshot;
 if(preview){if(!await deps.hasAccess(preview.tenantId))throw Error("SITE_NOT_FOUND: site não encontrado.");site=preview;snapshot=preview.draft;}
 else ({site,snapshot}=await resolvePublishedSite(deps,lookup));
 const metadata=await deps.productEngineRepository.metadata(site);
 const commerce=await commerceContext(deps,site,snapshot,!!preview);
 const visibleCategoryIds=metadata.categories.filter(category=>category.active&&category.siteVisible&&visibleCategory(metadata,category.id)).map(category=>category.id);
 let products:Product[],catalogTotal:number,slugs:{id:string;slug:string}[]|undefined,stocked:Set<string>|undefined;
 if(deps.productRepository.listPublicCatalog){
  // Paginação no banco (Fase 2): só o que esta página precisa — 1ª página, produtos citados nas seções e o produto/categoria da URL.
  const list=deps.productRepository.listPublicCatalog.bind(deps.productRepository),scope={tenantId:site.tenantId,workspaceId:site.workspaceId,visibleCategoryIds};
  const blocks=[...snapshot.content.blocks,...snapshot.content.pages.flatMap(page=>page.blocks)];
  const referenced=[...new Set([...blocks.flatMap(block=>block.productIds),...(snapshot.layoutConfig?.featuredProductId?[snapshot.layoutConfig.featuredProductId]:[])])].slice(0,200);
  const path=options.path??[];const category=path[0]==="categoria"?metadata.categories.find(item=>item.slug===path[1]):undefined;
  const sort=snapshot.theme.catalog?.sort;
  const empty=Promise.resolve({products:[] as Product[],total:0});
  const [first,cited,byPath,byCategory]=await Promise.all([
   list({...scope,sort,offset:0,limit:PUBLIC_CATALOG_INITIAL}),
   referenced.length?list({...scope,ids:referenced,offset:0,limit:200}):empty,
   path[0]==="produto"&&path[1]?list({...scope,slug:path[1],offset:0,limit:1}):empty,
   category?list({...scope,categoryIds:descendants(metadata,category.id),sort,offset:0,limit:PUBLIC_CATALOG_INITIAL}):empty,
  ]);
  const unique=new Map<string,Product>();for(const product of [...first.products,...cited.products,...byPath.products,...byCategory.products])unique.set(product.id,product);
  products=[...unique.values()];catalogTotal=first.total;
  if(options.includeSlugs&&deps.productRepository.listPublicCatalogSlugs)slugs=await deps.productRepository.listPublicCatalogSlugs(scope);
  if(deps.productRepository.listPublicCatalogCategoryIds)stocked=new Set(await deps.productRepository.listPublicCatalogCategoryIds(scope));
 }else{
  products=(await deps.productRepository.listByWorkspace({...site,activeOnly:true})).filter(product=>isPublicCatalogProduct(product,metadata));catalogTotal=products.length;
  if(options.includeSlugs)slugs=products.map(product=>({id:product.id,slug:product.details?.slug??product.id}));
  stocked=new Set(products.flatMap(product=>product.categoryId?[product.categoryId]:[]));
 }
 // Uma categoria só aparece no site (menu, abas, página) se ela ou uma subcategoria tem produto à venda.
 const populated=(id:string)=>!stocked||descendants(metadata,id).some(item=>stocked!.has(item));
 const visible=products.filter(product=>isPublicCatalogProduct(product,metadata));
 const catalog=await presentPublicProducts(deps,visible,metadata,commerce);
 const ids=new Set(catalog.map(product=>product.id));
 const ownedImages=new Set(siteImageUrls(snapshot));
 const signed=<T>(value:T):T=>JSON.parse(JSON.stringify(value,(_key,value)=>typeof value==="string"&&ownedImages.has(value)?signOwnedUrl(value,OBJECT_URL_TTL.publicSite):value));
 const blocks=(items:SiteSnapshot["content"]["blocks"])=>items.filter(item=>item.enabled).map(item=>signed({...item,slides:item.slides?.filter(slide=>slide.enabled&&(preview||(!slide.startsAt||Date.parse(slide.startsAt)<=Date.now())&&(!slide.endsAt||Date.parse(slide.endsAt)>Date.now()))),productIds:item.productIds.filter(id=>ids.has(id))}));
 const content={...snapshot.content,logoUrl:snapshot.content.logoUrl?signOwnedUrl(snapshot.content.logoUrl,OBJECT_URL_TTL.publicSite):undefined,faviconUrl:snapshot.content.faviconUrl?signOwnedUrl(snapshot.content.faviconUrl,OBJECT_URL_TTL.publicSite):undefined,blocks:blocks(snapshot.content.blocks),pages:snapshot.content.pages.filter(page=>preview||page.published).map(page=>({...page,blocks:blocks(page.blocks)}))};
 const importedTemplate=await importedTemplateView(deps.repository,site,snapshot);
 return {id:site.id,slug:site.slug,content,theme:snapshot.theme,...(importedTemplate?{importedTemplate}:{}),activeTemplateId:snapshot.activeTemplateId??snapshot.theme.template,templateVersion:snapshot.templateConfigs?.[snapshot.theme.template]?.templateVersion??1,layoutConfig:signed(snapshot.layoutConfig??{heroVariant:"signature",productGallery:"split"}),publishedAt:site.publishedAt,products:catalog,categories:metadata.categories.filter(category=>category.active&&category.siteVisible&&visibleCategory(metadata,category.id)&&populated(category.id)).map(({id,name,slug,parentId,position,imageUrl})=>({id,name,slug,parentId,position,imageUrl:imageUrl?signOwnedUrl(imageUrl,OBJECT_URL_TTL.publicSite):undefined})),brands:metadata.brands.filter(brand=>brand.active).map(({id,name,slug,logoUrl})=>({id,name,slug,logoUrl:logoUrl?signOwnedUrl(logoUrl,OBJECT_URL_TTL.publicSite):undefined})),commerceEnabled:false,commerce:{...siteCommerceSummary(commerce.settings,commerce.hasWhatsapp,commerce.checkoutReady),couponsAvailable:(commerce.rules??[]).some(rule=>!!rule.couponCode&&ruleActive(rule,commerce.now??new Date()))},catalog:{total:catalogTotal,initial:PUBLIC_CATALOG_INITIAL,...(slugs?{slugs}:{})}};
}
export async function verifySiteDomain(deps:SiteEngineDeps,input:{siteId:string;tenantId:string;id:string}){
 const domains=await deps.repository.domains(input.siteId,input.tenantId);const domain=domains.find(item=>item.id===input.id);
 if(!domain)throw Error("SITE_NOT_FOUND: domínio não encontrado.");
 const hostname=normalizeSiteHostname(domain.hostname);
 const records=await deps.resolveTxt(`_vorix-site.${hostname}`).catch(()=>[]);
 if(!records.some(parts=>parts.join("")===`vorix-site-verification=${domain.challenge}`))throw Error("SITE_VALIDATION: registro TXT ainda não encontrado. Confira a configuração DNS.");
 const verified=await deps.repository.verifyDomain({...input,challenge:domain.challenge});if(!verified)throw Error("SITE_VALIDATION: verificação expirada. Gere um novo registro.");return verified;
}

/** Página do catálogo público (busca, categoria, marca, ordenação). Mesmas regras de vitrine. */
export async function publicCatalogPage(deps:SiteEngineDeps,lookup:{slug?:string;hostname?:string},query:{offset:number;limit:number;search?:string;category?:string;brand?:string;sort?:"manual"|"name"|"price_asc"|"price_desc";ids?:readonly string[]}){
 const {site,snapshot}=await resolvePublishedSite(deps,lookup);
 const metadata=await deps.productEngineRepository.metadata(site);const commerce=await commerceContext(deps,site,snapshot);
 const visibleCategoryIds=metadata.categories.filter(category=>category.active&&category.siteVisible&&visibleCategory(metadata,category.id)).map(category=>category.id);
 const category=query.category?metadata.categories.find(item=>item.id===query.category||item.slug===query.category):undefined;
 if(query.category&&(!category||!visibleCategoryIds.includes(category.id)))return {products:[],total:0};
 if(!deps.productRepository.listPublicCatalog){
  const all=(await deps.productRepository.listByWorkspace({...site,activeOnly:true})).filter(product=>isPublicCatalogProduct(product,metadata));
  return {products:await Promise.all(all.slice(query.offset,query.offset+query.limit).map(product=>presentPublicProduct(deps,product,metadata,commerce))),total:all.length};
 }
 const page=await deps.productRepository.listPublicCatalog({tenantId:site.tenantId,workspaceId:site.workspaceId,visibleCategoryIds,search:query.search,categoryIds:category?descendants(metadata,category.id):undefined,brandId:query.brand,ids:query.ids,sort:query.sort,offset:query.offset,limit:query.limit});
 return {products:await presentPublicProducts(deps,page.products.filter(product=>isPublicCatalogProduct(product,metadata)),metadata,commerce),total:page.total};
}
