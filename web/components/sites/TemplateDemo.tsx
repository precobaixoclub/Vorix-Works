"use client";
import {useRouter} from "next/navigation";
import {templateDemo} from "@/features/sites/demo-content";
import {TenantSiteRenderer} from "./TenantSiteRenderer";
export function TemplateDemo({id,path=[]}:{id:string;path?:string[]}){const router=useRouter();return <><div className="flex flex-wrap justify-center gap-2 bg-background px-3 py-2 text-center text-[11px] text-muted-foreground" data-testid="template-demo-notice"><strong>Demonstração Vorix</strong><span>Conteúdo, produtos e preços fictícios · Envios desabilitados</span></div><TenantSiteRenderer site={templateDemo(id)} basePath={`/modelos/${id}`} path={path} preview onNavigate={path=>router.push(`/modelos/${id}${path.length?"/"+path.join("/"):""}`,{scroll:true})}/></>;}
