import type {SiteRepositoryPort} from "../ports/site-repository.port.js";
import type {ProductRepositoryPort} from "../ports/product-repository.port.js";
import type {ProductEngineRepositoryPort} from "../ports/product-engine-repository.port.js";
import type {SalesCatalogRepositoryPort} from "../ports/sales-engine-repository.port.js";
import {normalizeSiteHostname,siteContentSchema,siteThemeSchema,siteSnapshotSchema,captureSiteTemplateConfig,siteImageUrls,type Site,type SiteSnapshot} from "../../domain/sites/site.model.js";
import {signOwnedUrl,OBJECT_URL_TTL} from "../../shared/utils/object-url-signing.js";
import {publicVehicleDetails,publicRealEstateDetails} from "../../domain/products/product-specializations.js";
export type SiteEngineDeps={repository:SiteRepositoryPort;productRepository:ProductRepositoryPort;productEngineRepository:ProductEngineRepositoryPort;salesCatalogRepository:SalesCatalogRepositoryPort;hasAccess:(tenantId:string)=>Promise<boolean>;canPublish:(tenantId:string)=>Promise<boolean>;resolveTxt:(hostname:string)=>Promise<string[][]>;publicBaseDomain?:string};
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
export async function publicSite(deps:SiteEngineDeps,lookup:{slug?:string;hostname?:string},preview?:Site){
 if(lookup.hostname&&deps.publicBaseDomain&&lookup.hostname.endsWith(`.${deps.publicBaseDomain}`)){
  const label=lookup.hostname.slice(0,-deps.publicBaseDomain.length-1);if(label&&!label.includes(".")&&!new Set(["api","app","www","admin","mail","static"]).has(label))lookup={slug:label};
 }
 const site=preview??await deps.repository.findPublic(lookup);
 if(!site||!await deps.hasAccess(site.tenantId))throw Error("SITE_NOT_FOUND: site não encontrado.");
 const snapshot=preview?site.draft:site.published;if(!snapshot)throw Error("SITE_NOT_FOUND: site não publicado.");
 const metadata=await deps.productEngineRepository.metadata(site);
 const visibleCategory=(id:string|undefined):boolean=>{
  const visited=new Set<string>();while(id){if(visited.has(id))return false;visited.add(id);const category=metadata.categories.find(item=>item.id===id);if(!category||!category.active||!category.siteVisible)return false;id=category.parentId;}return true;
 };
 const products=await deps.productRepository.listByWorkspace({...site,activeOnly:true});
 const catalog=await Promise.all(products.filter(product=>product.active&&product.details?.siteVisible&&product.details.catalogVisible&&!(product.details.type==="REAL_ESTATE"&&product.details.realEstate&&["sold","rented","inactive"].includes(product.details.realEstate.status))&&visibleCategory(product.categoryId)).map(async product=>{
  const variants=(await deps.salesCatalogRepository.listVariants(product.id)).filter(variant=>variant.active&&(!product.details?.options.length||(Object.keys(variant.optionValues??{}).length===product.details.options.length&&product.details.options.every(option=>option.values.includes(variant.optionValues?.[option.key]??"")))));
  const details=product.details!;
  return {id:product.id,name:product.name,description:product.description,sku:product.code,slug:details.slug??product.id,type:details.type,categoryId:product.categoryId,brandId:product.brandId,priceCents:product.priceCents,currency:product.currency,unit:product.unit,
   imageUrls:product.imageUrls.map(url=>signOwnedUrl(url,OBJECT_URL_TTL.preview)),media:details.media.map(item=>({...item,url:signOwnedUrl(item.url,OBJECT_URL_TTL.preview)})),attributes:details.attributes,attributeLabels:Object.fromEntries(metadata.attributes.filter(item=>item.active).map(item=>[item.key,item.unit?`${item.label} (${item.unit})`:item.label])),apparel:details.type==="APPAREL"?details.apparel:undefined,vehicle:details.type==="VEHICLE"?publicVehicleDetails(details.vehicle):undefined,realEstate:details.type==="REAL_ESTATE"?publicRealEstateDetails(details.realEstate):undefined,billingType:product.billingType,options:details.options,seo:details.seo,
   availableQuantity:product.trackStock?(details.options.length?variants.reduce((n,item)=>n+Math.max(0,(item.stockQuantity??0)-(item.reservedQuantity??0)),0):Math.max(0,product.stockQuantity-(product.reservedQuantity??0))):undefined,
   // Compra online depende do fluxo de checkout do Site, não de um booleano do produto.
   canPurchaseOnline:false,
   variants:variants.map(variant=>({id:variant.id,name:variant.name,sku:variant.code,optionValues:variant.optionValues??{},priceCents:variant.priceOverride===false?product.priceCents:variant.listPriceCents,imageUrl:variant.imageUrl?signOwnedUrl(variant.imageUrl,OBJECT_URL_TTL.preview):undefined,availableQuantity:product.trackStock?Math.max(0,(variant.stockQuantity??0)-(variant.reservedQuantity??0)):undefined})),
  };
 }));
 const ids=new Set(catalog.map(product=>product.id));
 const ownedImages=new Set(siteImageUrls(snapshot));
 const signed=<T>(value:T):T=>JSON.parse(JSON.stringify(value,(_key,value)=>typeof value==="string"&&ownedImages.has(value)?signOwnedUrl(value,OBJECT_URL_TTL.preview):value));
 const blocks=(items:SiteSnapshot["content"]["blocks"])=>items.filter(item=>item.enabled).map(item=>signed({...item,slides:item.slides?.filter(slide=>slide.enabled&&(preview||(!slide.startsAt||Date.parse(slide.startsAt)<=Date.now())&&(!slide.endsAt||Date.parse(slide.endsAt)>Date.now()))),productIds:item.productIds.filter(id=>ids.has(id))}));
 const content={...snapshot.content,logoUrl:snapshot.content.logoUrl?signOwnedUrl(snapshot.content.logoUrl,OBJECT_URL_TTL.preview):undefined,faviconUrl:snapshot.content.faviconUrl?signOwnedUrl(snapshot.content.faviconUrl,OBJECT_URL_TTL.preview):undefined,blocks:blocks(snapshot.content.blocks),pages:snapshot.content.pages.filter(page=>preview||page.published).map(page=>({...page,blocks:blocks(page.blocks)}))};
 return {id:site.id,slug:site.slug,content,theme:snapshot.theme,activeTemplateId:snapshot.activeTemplateId??snapshot.theme.template,templateVersion:snapshot.templateConfigs?.[snapshot.theme.template]?.templateVersion??1,layoutConfig:signed(snapshot.layoutConfig??{heroVariant:"signature",productGallery:"split"}),publishedAt:site.publishedAt,products:catalog,categories:metadata.categories.filter(category=>category.active&&category.siteVisible&&visibleCategory(category.id)).map(({id,name,slug,parentId,position,imageUrl})=>({id,name,slug,parentId,position,imageUrl:imageUrl?signOwnedUrl(imageUrl,OBJECT_URL_TTL.preview):undefined})),brands:metadata.brands.filter(brand=>brand.active).map(({id,name,slug,logoUrl})=>({id,name,slug,logoUrl:logoUrl?signOwnedUrl(logoUrl,OBJECT_URL_TTL.preview):undefined})),commerceEnabled:false};
}
export async function verifySiteDomain(deps:SiteEngineDeps,input:{siteId:string;tenantId:string;id:string}){
 const domains=await deps.repository.domains(input.siteId,input.tenantId);const domain=domains.find(item=>item.id===input.id);
 if(!domain)throw Error("SITE_NOT_FOUND: domínio não encontrado.");
 const hostname=normalizeSiteHostname(domain.hostname);
 const records=await deps.resolveTxt(`_vorix-site.${hostname}`).catch(()=>[]);
 if(!records.some(parts=>parts.join("")===`vorix-site-verification=${domain.challenge}`))throw Error("SITE_VALIDATION: registro TXT ainda não encontrado. Confira a configuração DNS.");
 const verified=await deps.repository.verifyDomain({...input,challenge:domain.challenge});if(!verified)throw Error("SITE_VALIDATION: verificação expirada. Gere um novo registro.");return verified;
}
