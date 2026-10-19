import "server-only";
import type {Metadata} from "next";
import {getApiBaseUrl} from "@/lib/api-error";
import type {PublicTenantSite} from "./types";
export async function fetchTenantSite(lookup:{slug?:string;hostname?:string}):Promise<PublicTenantSite|null>{
 const path=lookup.hostname?`/v1/public/sites/resolve?hostname=${encodeURIComponent(lookup.hostname)}`:`/v1/public/sites/${encodeURIComponent(lookup.slug??"")}`;
 const response=await fetch(getApiBaseUrl()+path,{cache:"no-store",signal:AbortSignal.timeout(15000)});
 if(response.status===404)return null;if(!response.ok)throw Error(`Não foi possível carregar este site (HTTP ${response.status}).`);
 const envelope=await response.json();return envelope.data;
}
export function tenantSiteMetadata(site:PublicTenantSite|null,path:string[]=[]):Metadata{
 if(!site)return {title:"Site indisponível",robots:{index:false,follow:false}};
 const product=path.length===2&&path[0]==="produto"?site.products.find(item=>item.slug===path[1]):undefined;
 const page=path.length===1?site.content.pages.find(item=>item.slug===path[0]):undefined;
 const title=product?.seo.title||product?.name||page?.title||site.content.seo.title||site.content.name;
 const description=product?.seo.description||product?.description||page?.seoDescription||site.content.seo.description||site.content.description;
 return {title:{absolute:title},description,icons:site.content.faviconUrl?{icon:site.content.faviconUrl}:undefined,openGraph:{title,description,images:product?.imageUrls[0]?[product.imageUrls[0]]:site.content.logoUrl?[site.content.logoUrl]:[]}};
}
