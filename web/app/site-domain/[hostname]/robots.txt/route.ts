import {fetchTenantSite} from "@/features/sites/server";
import {tenantRobots} from "@/features/sites/public-routing";
export async function GET(_request:Request,{params}:{params:Promise<{hostname:string}>}){const {hostname}=await params,site=await fetchTenantSite({hostname});return site?new Response(tenantRobots(`https://${hostname}`),{headers:{"content-type":"text/plain; charset=utf-8"}}):new Response("User-agent: *\nDisallow: /",{status:404});}
