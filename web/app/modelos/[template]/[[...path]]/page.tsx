import {notFound} from "next/navigation";
import {PREMIUM_TEMPLATES} from "@/features/sites/template-registry";
import {templateDemo} from "@/features/sites/demo-content";
import {TemplateDemo} from "@/components/sites/TemplateDemo";
type Props={params:Promise<{template:string;path?:string[]}>};
export const metadata={title:"Modelos de site — demonstração Vorix",robots:{index:false,follow:false}};
export default async function TemplateDemoPage({params}:Props){const {template,path=[]}=await params;if(!PREMIUM_TEMPLATES.some(item=>item.id===template))notFound();const demo=templateDemo(template);if(path.length&&!(path.length===2&&path[0]==="produto"&&demo.products.some(p=>p.slug===path[1]))&&!(path.length===2&&path[0]==="categoria"&&demo.categories.some(c=>c.slug===path[1]))&&!(path.length===1&&demo.content.pages.some(p=>p.slug===path[0])))notFound();return <TemplateDemo id={template} path={path}/>;}
