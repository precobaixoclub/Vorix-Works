import {validSitePath} from "@/features/sites/public-routing";
import {notFound} from "next/navigation";
import {fetchTenantSite,tenantSiteMetadata} from "@/features/sites/server";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
type Props={params:Promise<{slug:string;path?:string[]}>};
export const dynamic="force-dynamic";
export async function generateMetadata({params}:Props){const {slug,path=[]}=await params;return tenantSiteMetadata(await fetchTenantSite({slug},{path}),path);}
export default async function TenantSitePage({params}:Props){const {slug,path=[]}=await params;const site=await fetchTenantSite({slug},{path});if(!site)notFound();if(!validSitePath(site,path))notFound();return <TenantSiteRenderer site={site} basePath={`/s/${encodeURIComponent(slug)}`} path={path}/>;}
