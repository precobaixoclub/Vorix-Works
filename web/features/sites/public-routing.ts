import type {PublicTenantSite} from "./types";
export function validSitePath(site:PublicTenantSite,path:string[]){return !path.length||path.length===2&&path[0]==="produto"&&site.products.some(p=>p.slug===path[1])||path.length===2&&path[0]==="categoria"&&site.categories.some(c=>c.slug===path[1])||path.length===1&&site.content.pages.some(p=>p.slug===path[0]&&p.published);}
export function sitePageUrls(site:PublicTenantSite,base:string){return [base+"/",...site.products.map(product=>`${base}/produto/${encodeURIComponent(product.slug)}`),...site.categories.map(category=>`${base}/categoria/${encodeURIComponent(category.slug)}`),...site.content.pages.filter(page=>page.published).map(page=>`${base}/${encodeURIComponent(page.slug)}`)];}
const xmlEscape=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
export function tenantSitemap(site:PublicTenantSite,base:string){return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitePageUrls(site,base).map(url=>`<url><loc>${xmlEscape(url)}</loc></url>`).join("")}</urlset>`;}
export function tenantRobots(base:string){return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;}
export function siteStructuredData(site:PublicTenantSite,path:string[],base:string){
 const product=path.length===2&&path[0]==="produto"?site.products.find(p=>p.slug===path[1]):undefined;
 const data=product?{"@context":"https://schema.org","@type":"Product",name:product.name,description:product.description,image:product.imageUrls,sku:product.sku,url:`${base}/produto/${encodeURIComponent(product.slug)}`,offers:{"@type":"Offer",priceCurrency:product.currency,price:product.priceCents/100,url:`${base}/produto/${encodeURIComponent(product.slug)}`,availability:product.availableQuantity===0?"https://schema.org/OutOfStock":"https://schema.org/InStock"}}:{"@context":"https://schema.org","@type":"WebSite",name:site.content.name,url:base+"/",description:site.content.description};
 return JSON.stringify(data).replaceAll("<","\\u003c");
}
