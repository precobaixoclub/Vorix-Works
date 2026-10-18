import {notFound} from "next/navigation";
import {fetchTenantSite,tenantSiteMetadata} from "@/features/sites/server";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
type Props={params:Promise<{hostname:string;path?:string[]}>};
export const dynamic="force-dynamic";
export async function generateMetadata({params}:Props){const {hostname,path}=await params;return tenantSiteMetadata(await fetchTenantSite({hostname}),path);}
export default async function TenantDomainPage({params}:Props){const {hostname,path=[]}=await params;const site=await fetchTenantSite({hostname});if(!site)notFound();if(path.length&&!(path.length===2&&path[0]==="produto"&&site.products.some(product=>product.slug===path[1]))&&!(path.length===1&&site.content.pages.some(page=>page.slug===path[0])))notFound();return <TenantSiteRenderer site={site} basePath="" path={path}/>;}
