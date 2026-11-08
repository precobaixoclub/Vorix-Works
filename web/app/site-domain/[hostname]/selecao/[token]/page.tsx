export {metadata} from "@/app/selecao/[token]/page";
export const dynamic="force-dynamic";
import {SiteSelection} from "@/components/sites/storefront/SiteSelection";
export default async function SelectionPage({params}:{params:Promise<{token:string}>}){return <SiteSelection token={(await params).token} customDomain/>;}
