import {validSitePath} from "@/features/sites/public-routing";
import {notFound} from "next/navigation";
import {preconnect} from "react-dom";
import {fetchTenantSite,tenantSiteMetadata} from "@/features/sites/server";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
type Props={params:Promise<{slug:string;path?:string[]}>};
// Rendered pages are reused for 15s (ISR): repeat visits skip the API and the render entirely.
// Keep in sync with PUBLIC_SITE_REVALIDATE_SECONDS (route segment config must be a literal).
export const revalidate=15;
// No paths at build time: each page is generated on its first visit and then reused (on-demand ISR).
export async function generateStaticParams(){return [];}
export async function generateMetadata({params}:Props){const {slug,path=[]}=await params;return tenantSiteMetadata(await fetchTenantSite({slug},{path}),path);}
/** Photos come from the API origin: open that connection while the HTML is still arriving. */
function preconnectImages(){const origin=process.env.NEXT_PUBLIC_API_URL?.trim();if(origin)preconnect(new URL(origin).origin);}
export default async function TenantSitePage({params}:Props){preconnectImages();const {slug,path=[]}=await params;const site=await fetchTenantSite({slug},{path});if(!site)notFound();if(!validSitePath(site,path))notFound();return <TenantSiteRenderer site={site} basePath={`/s/${encodeURIComponent(slug)}`} path={path}/>;}
