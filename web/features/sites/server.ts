import "server-only";
import type {Metadata} from "next";
import {getApiBaseUrl} from "@/lib/api-error";
import type {PublicTenantSite} from "./types";
export async function fetchTenantSite(lookup:{slug?:string;hostname?:string},options:{path?:string[];sitemap?:boolean}={}):Promise<PublicTenantSite|null>{
 // O caminho da página vai junto: o servidor inclui o produto/categoria da URL (catálogo é paginado).
 const extra=[options.path?.length?`path=${encodeURIComponent(options.path.join("/"))}`:"",options.sitemap?"sitemap=1":""].filter(Boolean).join("&");
 const path=(lookup.hostname?`/v1/public/sites/resolve?hostname=${encodeURIComponent(lookup.hostname)}`:`/v1/public/sites/${encodeURIComponent(lookup.slug??"")}`)+(extra?(lookup.hostname?"&":"?")+extra:"");
 const response=await fetch(getApiBaseUrl()+path,{cache:"no-store",signal:AbortSignal.timeout(15000)});
 if(response.status===404)return null;if(!response.ok)throw Error(`Não foi possível carregar este site (HTTP ${response.status}).`);
 const envelope=await response.json();return envelope.data;
}
export function tenantSiteMetadata(site:PublicTenantSite|null,path:string[]=[],base?:string):Metadata{
 if(!site)return {title:"Site indisponível",robots:{index:false,follow:false}};
 const product=path.length===2&&path[0]==="produto"?site.products.find(item=>item.slug===path[1]):undefined;
 const page=path.length===1?site.content.pages.find(item=>item.slug===path[0]):undefined;
 const category=path.length===2&&path[0]==="categoria"?site.categories.find(item=>item.slug===path[1]):undefined;
 const canonical=(base??`https://vorixworks.com/s/${site.slug}`)+(path.length?"/"+path.map(encodeURIComponent).join("/"):"/");
 const transactional=path[0]==="checkout"||path[0]==="pedido";
 const title=transactional?(path[0]==="checkout"?"Finalizar compra":"Seu pedido")+` — ${site.content.name}`:product?.seo.title||product?.name||category?.name||page?.title||site.content.seo.title||site.content.name;
 const description=product?.seo.description||product?.description||page?.seoDescription||site.content.seo.description||site.content.description;
 return {title:{absolute:title},description,alternates:{canonical},robots:{index:!transactional,follow:!transactional},icons:site.content.faviconUrl?{icon:site.content.faviconUrl}:undefined,openGraph:{title,description,url:canonical,images:product?.imageUrls[0]?[product.imageUrls[0]]:site.content.logoUrl?[site.content.logoUrl]:[]}};
}
