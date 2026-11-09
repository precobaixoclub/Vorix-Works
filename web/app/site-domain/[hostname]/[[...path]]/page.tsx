import {validSitePath} from "@/features/sites/public-routing";
import {notFound} from "next/navigation";
import {fetchTenantSite,tenantSiteMetadata} from "@/features/sites/server";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
type Props={params:Promise<{hostname:string;path?:string[]}>};
// Rendered pages are reused for 15s (ISR): repeat visits skip the API and the render entirely.
// Keep in sync with PUBLIC_SITE_REVALIDATE_SECONDS (route segment config must be a literal).
export const revalidate=15;
// No paths at build time: each page is generated on its first visit and then reused (on-demand ISR).
export async function generateStaticParams(){return [];}
export async function generateMetadata({params}:Props){const {hostname,path=[]}=await params;return tenantSiteMetadata(await fetchTenantSite({hostname},{path}),path,`https://${hostname}`);}
export default async function TenantDomainPage({params}:Props){const {hostname,path=[]}=await params;const site=await fetchTenantSite({hostname},{path});if(!site)notFound();if(!validSitePath(site,path))notFound();return <TenantSiteRenderer site={site} basePath="" canonicalBase={`https://${hostname}`} path={path}/>;}
