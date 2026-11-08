import type {Metadata} from "next";
import {SiteSelection} from "@/components/sites/storefront/SiteSelection";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:{absolute:"Sua seleção de produtos"},robots:{index:false,follow:false},referrer:"no-referrer",openGraph:{title:"Uma seleção feita por você",description:"Confira fotos, opções e detalhes dos produtos escolhidos.",images:[]},twitter:{card:"summary",images:[]}};
export default async function SelectionPage({params}:{params:Promise<{token:string}>}){return <SiteSelection token={(await params).token}/>;}
