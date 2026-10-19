import {validSitePath} from "@/features/sites/public-routing";
import {notFound} from "next/navigation";
import {fetchTenantSite,tenantSiteMetadata} from "@/features/sites/server";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
type Props={params:Promise<{hostname:string;path?:string[]}>};
export const dynamic="force-dynamic";
export async function generateMetadata({params}:Props){const {hostname,path}=await params;return tenantSiteMetadata(await fetchTenantSite({hostname}),path,`https://${hostname}`);}
export default async function TenantDomainPage({params}:Props){const {hostname,path=[]}=await params;const site=await fetchTenantSite({hostname});if(!site)notFound();if(!validSitePath(site,path))notFound();return <TenantSiteRenderer site={site} basePath="" canonicalBase={`https://${hostname}`} path={path}/>;}
