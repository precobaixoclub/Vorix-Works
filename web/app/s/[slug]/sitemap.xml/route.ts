import {fetchTenantSite} from "@/features/sites/server";
import {tenantSitemap} from "@/features/sites/public-routing";
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){const {slug}=await params,site=await fetchTenantSite({slug},{sitemap:true});return site?new Response(tenantSitemap(site,`https://vorixworks.com/s/${encodeURIComponent(slug)}`),{headers:{"content-type":"application/xml; charset=utf-8"}}):new Response("Site não encontrado",{status:404});}
