import {fetchTenantSite} from "@/features/sites/server";
import {tenantRobots} from "@/features/sites/public-routing";
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){const {slug}=await params,site=await fetchTenantSite({slug});return site?new Response(tenantRobots(`https://vorixworks.com/s/${encodeURIComponent(slug)}`),{headers:{"content-type":"text/plain; charset=utf-8"}}):new Response("User-agent: *\nDisallow: /",{status:404});}
