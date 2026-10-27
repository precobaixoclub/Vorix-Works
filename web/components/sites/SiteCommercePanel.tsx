"use client";
import {useEffect,useId,useState} from "react";
import useSWR from "swr";
import {toast} from "sonner";
import {Button} from "@/components/Button";
import {Label} from "@/components/Field";
import {SearchableCombo} from "@/components/SearchableCombo";
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from "@/components/ui/tooltip";
import {getSiteCommerce,listSiteSalesIntents,saveSiteCommerce} from "@/features/sites/api";
import {useTeams} from "@/features/identity/hooks";
import {useMyAccess} from "@/features/auth/access";
import type {SiteCommerceMode,SiteCommerceSettings,TenantSite} from "@/features/sites/types";
import {formatCurrencyCents,formatDateTime} from "@/lib/format";
import {Toggle} from "./SiteEditorFields";
import {SiteCheckoutSettings} from "./SiteCheckoutSettings";

/** "Como você quer vender?" — perguntas simples; os modos técnicos ficam no backend. */
const MODES:{value:SiteCommerceMode;title:string;text:string;soon?:boolean}[]=[
 {value:"SHOWCASE",title:"Apenas mostrar meus produtos",text:"Fotos, preço e detalhes. O cliente pede informações pelo formulário."},
 {value:"WHATSAPP",title:"Receber clientes pelo WhatsApp",text:"Cada produto tem um botão para conversar com sua equipe."},
 {value:"WHATSAPP_CART",title:"Montar um carrinho e finalizar pelo WhatsApp",text:"O cliente escolhe vários produtos e envia o pedido numa mensagem só."},
 {value:"HYBRID",title:"Configurar individualmente por produto",text:"Cada produto escolhe no cadastro. Sem escolha: serviços, veículos e imóveis vão para conversa; o resto, para o carrinho."},
 {value:"ONLINE_CHECKOUT",title:"Vender diretamente pelo site",text:"Carrinho, frete e pagamento pelo próprio site. Veículos, imóveis e serviços continuam na conversa."},
];
const CTAS:{value:SiteCommerceSettings["showcaseCta"];label:string}[]=[{value:"INTERESTED",label:"Tenho interesse"},{value:"LEARN_MORE",label:"Saiba mais"},{value:"QUOTE",label:"Solicitar orçamento"}];
const STOCK:{value:SiteCommerceSettings["outOfStock"];label:string}[]=[{value:"ASK_AVAILABILITY",label:"Mostrar \"Consultar disponibilidade\""},{value:"SHOW_UNAVAILABLE",label:"Mostrar como indisponível"},{value:"HIDE_CTA",label:"Esconder o botão"}];
const INTENT_TYPE={PRODUCT_WHATSAPP:"WhatsApp de produto",CART_WHATSAPP:"Carrinho pelo WhatsApp",CONTACT_FORM:"Formulário",CHECKOUT:"Compra",MARKETPLACE:"Marketplace",OTHER:"Outro"} as const;

export function SiteCommercePanel({site,onGoToContact}:{site:TenantSite;onGoToContact:()=>void}){
 const {can}=useMyAccess();const canEdit=can("commerce:manage"),canRead=can("commerce:read");
 const {data,error,isLoading,mutate}=useSWR(["site-commerce",site.id],()=>getSiteCommerce(site));
 const {data:teams,isLoading:teamsLoading}=useTeams(site.workspaceId);
 const {data:intents,error:intentsError,mutate:reloadIntents}=useSWR(canRead?["site-sales-intents",site.id]:null,()=>listSiteSalesIntents(site));
 const [form,setForm]=useState<SiteCommerceSettings>(),[busy,setBusy]=useState(false);
 const groupId=useId();
 useEffect(()=>{if(data)setForm(data.settings);},[data]);
 if(isLoading||!form&&!error)return <p className="text-sm text-muted-foreground">Carregando suas preferências de venda...</p>;
 if(error||!form)return <div className="space-y-2"><p className="text-sm">Não foi possível carregar como você vende pelo site.</p><Button variant="secondary" size="sm" onClick={()=>void mutate()}>Tentar novamente</Button></div>;
 const set=(patch:Partial<SiteCommerceSettings>)=>setForm({...form,...patch});
 const dirty=JSON.stringify(form)!==JSON.stringify(data?.settings);
 async function save(){setBusy(true);try{const saved=await saveSiteCommerce(site,form!);await mutate(saved,false);toast.success("Pronto! Já vale para os visitantes do site.");}catch(caught){toast.error(caught instanceof Error?caught.message:"Não foi possível salvar.");}finally{setBusy(false);}}
 const needsWhatsapp=form.mode!=="SHOWCASE"&&!data?.hasWhatsapp;
 return <div className="space-y-6">
  <div><h2 className="text-base font-semibold">Como você quer vender pelo seu site?</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Vale na hora, sem precisar publicar o site de novo. Cada produto também pode ter um jeito próprio no cadastro do produto.</p></div>
  <fieldset className="space-y-2" disabled={!canEdit||busy}><legend className="sr-only">Modo de venda</legend>
   {MODES.map(option=>{const id=`${groupId}-${option.value}`,checked=form.mode===option.value;const card=<label htmlFor={id} className={`flex gap-3 rounded-xl border p-3 text-sm transition-colors ${checked?"border-primary bg-primary/5":"border-border/60"} ${option.soon?"cursor-not-allowed opacity-60":"cursor-pointer hover:border-primary/60"}`}>
    <input id={id} type="radio" name={`${groupId}-mode`} className="mt-1 h-4 w-4 accent-[var(--primary)]" checked={checked} disabled={option.soon} onChange={()=>set({mode:option.value})}/>
    <span className="min-w-0"><span className="flex flex-wrap items-center gap-2 font-medium">{option.title}{option.soon?<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Em preparação</span>:null}</span><span className="mt-0.5 block text-xs text-muted-foreground">{option.text}</span></span>
   </label>;
   return option.soon?<TooltipProvider key={option.value}><Tooltip><TooltipTrigger asChild><div>{card}</div></TooltipTrigger><TooltipContent>Chega junto com pagamento e entrega. Até lá, nenhum botão de compra online aparece no site.</TooltipContent></Tooltip></TooltipProvider>:<div key={option.value}>{card}</div>;})}
  </fieldset>
  {needsWhatsapp?<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">Cadastre o número do WhatsApp para os botões aparecerem. <button type="button" className="font-medium underline" onClick={onGoToContact}>Ir para Contato e redes sociais</button></div>:null}
  {form.mode==="SHOWCASE"?<div><Label htmlFor={`${groupId}-cta`}>Texto do botão dos produtos</Label><select id={`${groupId}-cta`} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm" disabled={!canEdit||busy} value={form.showcaseCta} onChange={event=>set({showcaseCta:event.target.value as SiteCommerceSettings["showcaseCta"]})}>{CTAS.map(cta=><option key={cta.value} value={cta.value}>{cta.label}</option>)}</select></div>:null}
  <div className="space-y-2"><h3 className="text-sm font-semibold">Para qual equipe os novos clientes devem ir?</h3><p className="text-xs text-muted-foreground">A distribuição (roleta) é a da própria equipe. Sem equipe, vale a regra do canal do WhatsApp.</p>
   <SearchableCombo id={`${groupId}-team`} items={(teams??[]).map(team=>({id:team.id,label:team.name}))} loading={teamsLoading} value={form.teamId??""} onValueChange={value=>set({teamId:value||undefined})} extraOption={{value:"",label:"Seguir a regra do canal do WhatsApp"}} placeholder="Seguir a regra do canal do WhatsApp" searchPlaceholder="Buscar equipe..." emptyText="Nenhuma equipe encontrada." disabled={!canEdit||busy}/>
  </div>
  <fieldset className="space-y-2" disabled={!canEdit||busy}><legend className="text-sm font-semibold">Quer criar oportunidades automaticamente?</legend>
   <Toggle label="Quando o cliente chamar no WhatsApp pelo site" checked={form.createOpportunityFromWhatsapp} onChange={value=>set({createOpportunityFromWhatsapp:value})}/>
   <Toggle label="Quando alguém enviar o formulário do site" checked={form.form.createOpportunity} onChange={value=>set({form:{...form.form,createOpportunity:value}})}/>
   <Toggle label="Abrir atendimento no WhatsApp para quem deixar telefone no formulário" checked={form.form.openAttendance} onChange={value=>set({form:{...form.form,openAttendance:value}})}/>
   <Toggle label="Avisar a equipe a cada novo interesse" checked={form.notifyTeam} onChange={value=>set({notifyTeam:value})}/>
  </fieldset>
  <fieldset className="space-y-2" disabled={!canEdit||busy}><legend className="text-sm font-semibold">Quando um produto acabar no estoque</legend>
   {STOCK.map(option=><label key={option.value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 p-3 text-sm"><input type="radio" name={`${groupId}-stock`} className="h-4 w-4 accent-[var(--primary)]" checked={form.outOfStock===option.value} onChange={()=>set({outOfStock:option.value})}/>{option.label}</label>)}
  </fieldset>
  <SiteCheckoutSettings site={site} value={form.checkout} onChange={checkout=>set({checkout})} disabled={!canEdit||busy} refreshKey={JSON.stringify(data?.settings.checkout??{})}/>
  <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 bg-card/95 px-1 py-3 backdrop-blur">{canEdit?<Button loading={busy} disabled={!dirty||busy} onClick={save}>Salvar como vender</Button>:<TooltipProvider><Tooltip><TooltipTrigger asChild><span><Button disabled>Salvar como vender</Button></span></TooltipTrigger><TooltipContent>Somente quem gerencia a parte comercial pode alterar.</TooltipContent></Tooltip></TooltipProvider>}{dirty?<span className="text-xs text-muted-foreground">Alterações não salvas</span>:null}</div>
  {canRead?<div className="space-y-2 border-t border-border/60 pt-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Últimos interesses pelo site</h3><Button variant="ghost" size="sm" onClick={()=>void reloadIntents()}>Atualizar</Button></div>
   {intentsError?<div className="text-xs"><p>Não foi possível carregar.</p><Button variant="ghost" size="sm" onClick={()=>void reloadIntents()}>Tentar novamente</Button></div>:!intents?<p className="text-xs text-muted-foreground">Carregando...</p>:!intents.length?<p className="text-xs text-muted-foreground">Ainda não houve cliques nem formulários. Eles aparecem aqui assim que acontecerem.</p>:
   <ul className="divide-y divide-border/60 rounded-lg border border-border/60">{intents.slice(0,15).map(intent=>{const first=intent.snapshot.items[0];return <li key={intent.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"><span className="min-w-0"><span className="font-medium">{INTENT_TYPE[intent.type]}</span> · {first?`${first.name}${intent.snapshot.items.length>1?` + ${intent.snapshot.items.length-1}`:""}`:"Contato"}{intent.snapshot.subtotalCents?<span className="tabular-nums"> · {formatCurrencyCents(intent.snapshot.subtotalCents,intent.snapshot.currency)}</span>:null}<span className="block text-muted-foreground">{formatDateTime(intent.createdAt)}{intent.utm.source?` · ${intent.utm.source}${intent.utm.campaign?` / ${intent.utm.campaign}`:""}`:""}</span></span><span className={`rounded-full px-2 py-0.5 ${intent.status==="CONVERTED"?"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300":"bg-muted text-muted-foreground"}`}>{intent.type==="CHECKOUT"?"Compra online":intent.status==="CONVERTED"?"Virou atendimento":Date.parse(intent.expiresAt)<Date.now()?"Expirou sem mensagem":"Aguardando mensagem"}</span></li>;})}</ul>}
  </div>:null}
 </div>;
}
