import {fetchTenantSite} from "@/features/sites/server";
import {tenantSitemap} from "@/features/sites/public-routing";
export async function GET(_request:Request,{params}:{params:Promise<{hostname:string}>}){const {hostname}=await params,site=await fetchTenantSite({hostname},{sitemap:true});return site?new Response(tenantSitemap(site,`https://${hostname}`),{headers:{"content-type":"application/xml; charset=utf-8"}}):new Response("Site não encontrado",{status:404});}
