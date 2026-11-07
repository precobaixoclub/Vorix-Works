"use client";
import {useState} from "react";
import useSWR from "swr";
import {toast} from "sonner";
import {CheckCircle2,Clock,Copy,ExternalLink} from "lucide-react";
import {Button} from "@/components/Button";
import {Input,Label} from "@/components/Field";
import {ConfirmDialog} from "@/components/ConfirmDialog";
import {changeSiteSlug,claimDomain,listDomains,removeDomain,verifyDomain} from "@/features/sites/api";
import {cleanHostname,domainRecords,pointRecordType,siteSlugProblem,toSiteSlug} from "@/features/sites/site-address";
import type {SiteDomain,TenantSite} from "@/features/sites/types";

const errorText=(error:unknown,fallback:string)=>error instanceof Error?error.message.replace(/^[A-Z_]+:\s*/,""):fallback;

/** Endereço do site (editável) e domínio próprio com passo a passo de DNS. */
export function SiteAddressPanel({site,baseDomain,customDomainTarget,canManage,onSiteChanged}:{site:TenantSite;baseDomain?:string;customDomainTarget?:string;canManage:boolean;onSiteChanged:(site:TenantSite)=>void}){
 return <section className="space-y-6"><SlugEditor site={site} baseDomain={baseDomain} canManage={canManage} onSiteChanged={onSiteChanged}/><DomainGuide site={site} target={customDomainTarget} canManage={canManage}/></section>;
}

function SlugEditor({site,baseDomain,canManage,onSiteChanged}:{site:TenantSite;baseDomain?:string;canManage:boolean;onSiteChanged:(site:TenantSite)=>void}){
 const [value,setValue]=useState(site.slug),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 const slug=toSiteSlug(value),problem=value.trim()?siteSlugProblem(slug):"Informe o endereço.";
 const origin=typeof window==="undefined"?"":window.location.origin;
 const url=(item:string)=>baseDomain?`https://${item}.${baseDomain}`:`${origin}/s/${item}`;
 const changed=slug!==site.slug;
 return <div className="space-y-3">
  <div><h2 className="text-base font-semibold">Endereço do site</h2><p className="text-xs leading-relaxed text-muted-foreground">É o link que seus clientes usam para abrir o site. Você pode trocar quando quiser.</p></div>
  <div className="space-y-1.5"><Label htmlFor="site-slug">Endereço</Label>
   <div className="flex min-w-0 items-stretch overflow-hidden rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
    {!baseDomain?<span className="flex shrink-0 items-center border-r border-border bg-muted/40 px-2 text-xs text-muted-foreground">/s/</span>:null}
    <input id="site-slug" value={value} disabled={!canManage||busy} onChange={event=>setValue(event.target.value)} onBlur={()=>{if(slug)setValue(slug);}} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none" autoComplete="off" spellCheck={false} aria-describedby="site-slug-help"/>
    {baseDomain?<span className="flex shrink-0 items-center border-l border-border bg-muted/40 px-2 text-xs text-muted-foreground">.{baseDomain}</span>:null}
   </div>
   <p id="site-slug-help" className={`text-xs ${problem&&changed?"text-destructive":"text-muted-foreground"}`}>{problem&&changed?problem:changed?<>Novo link: <span className="break-all font-medium text-foreground">{url(slug)}</span></>:"Use letras sem acento, números e hífen. Ex.: minha-loja."}</p>
  </div>
  <div className="flex flex-wrap items-center gap-2">
   <Button size="sm" disabled={!canManage||!changed||!!problem} loading={busy} onClick={()=>setConfirm(true)}>Trocar endereço</Button>
   {changed?<Button size="sm" variant="ghost" disabled={busy} onClick={()=>setValue(site.slug)}>Cancelar</Button>:null}
   {site.publishedAt?<a href={url(site.slug)} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 text-xs underline"><span className="truncate">{url(site.slug).replace(/^https?:\/\//,"")}</span><ExternalLink size={12} className="shrink-0"/></a>:null}
  </div>
  {!canManage?<p className="text-xs text-muted-foreground">Somente o dono ou um administrador pode trocar o endereço.</p>:null}
  <ConfirmDialog open={confirm} title="Trocar o endereço do site?" description={`O site passa a abrir em ${url(slug)} na hora, sem precisar publicar. O endereço antigo (${url(site.slug)}) deixa de funcionar: atualize links na bio, QR Codes e mensagens já enviadas. Um domínio próprio já conectado continua funcionando.`} confirmLabel="Trocar endereço" busy={busy} onCancel={()=>setConfirm(false)} onConfirm={async()=>{setBusy(true);try{const updated=await changeSiteSlug(site,slug);onSiteChanged(updated);setValue(updated.slug);setConfirm(false);toast.success("Endereço do site atualizado.");}catch(error){toast.error(errorText(error,"Não foi possível trocar o endereço."));}finally{setBusy(false);}}}/>
 </div>;
}

function CopyValue({label,value}:{label:string;value:string}){
 return <div className="min-w-0 space-y-1"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><div className="flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1.5"><code className="min-w-0 flex-1 break-all text-xs">{value}</code><button type="button" aria-label={`Copiar ${label.toLowerCase()}`} title="Copiar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground" onClick={()=>{void navigator.clipboard?.writeText(value).then(()=>toast.success(`${label} copiado.`),()=>toast.error("Não foi possível copiar."));}}><Copy size={14}/></button></div></div>;
}

function RecordCard({step,type,name,fullName,value,hint}:{step:string;type:string;name:string;fullName?:string;value:string;hint?:string}){
 return <div className="space-y-2 rounded-lg border border-border/60 p-3"><p className="text-xs font-semibold">{step}</p><div className="grid gap-2"><CopyValue label="Tipo" value={type}/><CopyValue label="Nome / Host" value={name}/><CopyValue label="Valor / Destino" value={value}/></div>{fullName||hint?<p className="text-[11px] leading-relaxed text-muted-foreground">{fullName?<>Se o painel pedir o nome completo, use <code className="break-all">{fullName}</code>. </>:null}{hint}</p>:null}</div>;
}

const PROVIDERS:[string,string][]=[
 ["Registro.br (.com.br)","Entre em registro.br → Domínios → clique no domínio → “Editar zona” (se aparecer, ative “Utilizar os DNS do Registro.br”) → “Nova entrada”. Em Nome, digite só a parte antes do domínio (ex.: _vorix-site.www)."],
 ["Hostinger","Painel → Domínios → Gerenciar → DNS / Nameservers → “Adicionar registro”. Em Nome, use a parte antes do domínio; o TTL pode ficar no padrão."],
 ["GoDaddy","Meus produtos → Domínio → DNS → “Adicionar novo registro”. Em Nome, use a parte antes do domínio (o painel completa o resto)."],
 ["Cloudflare","DNS → Records → “Add record”. No registro que aponta o site, deixe a nuvem cinza (“DNS only”) até o domínio ficar ativo aqui."],
 ["Outro provedor","Procure por “Zona DNS”, “Gerenciar DNS” ou “Registros DNS”. Os campos têm sempre os mesmos nomes: Tipo, Nome (ou Host) e Valor (ou Destino/Aponta para)."],
];

function DomainGuide({site,target,canManage}:{site:TenantSite;target?:string;canManage:boolean}){
 const {data,mutate,error}=useSWR(["site-domains",site.id],()=>listDomains(site));
 const [hostname,setHostname]=useState(""),[busy,setBusy]=useState<string>(),[removing,setRemoving]=useState<SiteDomain>();
 const clean=cleanHostname(hostname);
 const valid=/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(clean);
 return <div className="space-y-4 border-t border-border/60 pt-5">
  <div><h3 className="text-base font-semibold">Usar meu próprio domínio</h3><p className="text-xs leading-relaxed text-muted-foreground">Faça o site abrir em um endereço seu, como <strong className="text-foreground">www.sualoja.com.br</strong>. Leva de 5 a 15 minutos de configuração.</p></div>
  <ol className="space-y-2 text-xs leading-relaxed text-muted-foreground">
   <li><strong className="text-foreground">1. Tenha um domínio.</strong> Se ainda não tem, compre em um registrador (Registro.br para .com.br, Hostinger, GoDaddy...). Recomendamos usar o endereço com <strong className="text-foreground">www</strong>.</li>
   <li><strong className="text-foreground">2. Informe o domínio abaixo</strong> e clique em “Gerar instruções”.</li>
   <li><strong className="text-foreground">3. Crie os registros</strong> no painel de DNS de onde você comprou o domínio, copiando os valores mostrados.</li>
   <li><strong className="text-foreground">4. Clique em “Verificar agora”.</strong> A propagação costuma levar de alguns minutos a algumas horas (até 24 h).</li>
  </ol>
  <div className="space-y-1.5"><Label htmlFor="site-domain">Seu domínio</Label><Input id="site-domain" value={hostname} disabled={!canManage} placeholder="www.sualoja.com.br" autoComplete="off" spellCheck={false} onChange={event=>setHostname(event.target.value)}/><p className={`text-xs ${hostname&&!valid?"text-destructive":"text-muted-foreground"}`}>{hostname&&!valid?"Informe só o domínio, como www.sualoja.com.br (sem https:// nem barras).":"Pode colar o link completo: a gente aproveita só o domínio."}</p></div>
  <Button size="sm" disabled={!canManage||!valid} loading={busy==="claim"} onClick={async()=>{setBusy("claim");try{await claimDomain(site,clean);await mutate();setHostname("");toast.success("Instruções geradas. Crie os registros abaixo no seu provedor.");}catch(error){toast.error(errorText(error,"Não foi possível adicionar o domínio."));}finally{setBusy(undefined);}}}>Gerar instruções</Button>
  {error?<Button size="sm" variant="secondary" onClick={()=>void mutate()}>Tentar carregar domínios novamente</Button>:data?.map(domain=>{
   const records=domainRecords(domain.hostname),expired=!domain.verifiedAt&&new Date(domain.expiresAt).getTime()<Date.now();
   return <article key={domain.id} className="space-y-3 rounded-xl border border-border/60 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-all text-sm font-semibold">{domain.hostname}</p>{domain.verifiedAt?<span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success"><CheckCircle2 size={12}/>Verificado</span>:<span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning"><Clock size={12}/>{expired?"Instruções expiradas":"Aguardando DNS"}</span>}</div>
    {expired?<p className="text-xs text-muted-foreground">O código de verificação vale 2 horas. Clique em “Gerar novo código”, troque o valor do TXT no seu provedor e verifique de novo.</p>:null}
    {!domain.verifiedAt&&!expired?<RecordCard step="Registro 1 — comprova que o domínio é seu" type="TXT" name={records.txtName} fullName={records.txtFullName} value={`vorix-site-verification=${domain.challenge}`} hint={`Código válido até ${new Date(domain.expiresAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}.`}/>:null}
    {target?<RecordCard step={`Registro ${domain.verifiedAt?"":"2 "}— leva os visitantes ao seu site`} type={pointRecordType(target)} name={records.pointName} value={target} hint={records.apex&&pointRecordType(target)==="CNAME"?"Domínio sem www não aceita CNAME na maioria dos provedores: prefira usar www.":records.apex?"Apague outros registros A ou AAAA com o mesmo nome. Dica: configure também o www e redirecione o domínio sem www para ele no seu provedor.":"Se já existir um registro com esse nome (ex.: de outra hospedagem), edite-o em vez de criar outro."}/>:<p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">O endereço para onde apontar o domínio ainda não foi liberado nesta conta. Você já pode criar o registro TXT e verificar: o restante é informado aqui assim que a conexão de domínios for ativada pela equipe Vorix.</p>}
    {domain.verifiedAt?<p className="text-xs leading-relaxed text-muted-foreground">Domínio comprovado. Com o registro de apontamento criado, o site passa a abrir nesse endereço e o cadeado de segurança (HTTPS) é ativado automaticamente — pode levar alguns minutos depois que o DNS propagar. Mantenha os registros no provedor.</p>:null}
    <div className="flex flex-wrap gap-2">
     {!domain.verifiedAt?expired?<Button size="sm" disabled={!canManage||!!busy} loading={busy===domain.id} onClick={async()=>{setBusy(domain.id);try{await claimDomain(site,domain.hostname);await mutate();toast.success("Novo código gerado. Atualize o valor do TXT no provedor.");}catch(error){toast.error(errorText(error,"Não foi possível gerar um novo código."));}finally{setBusy(undefined);}}}>Gerar novo código</Button>:<Button size="sm" disabled={!canManage||!!busy} loading={busy===domain.id} onClick={async()=>{setBusy(domain.id);try{await verifyDomain(site,domain);await mutate();toast.success("Domínio verificado.");}catch(error){toast.error(errorText(error,"Ainda não encontramos o registro. A propagação pode levar algumas horas; tente de novo mais tarde."));}finally{setBusy(undefined);}}}>Verificar agora</Button>:null}
     <Button size="sm" variant="ghost" disabled={!canManage||!!busy} onClick={()=>setRemoving(domain)}>Remover domínio</Button>
    </div>
   </article>;})}
  <details className="rounded-lg border border-border/60 p-3"><summary className="cursor-pointer text-sm font-medium">Onde criar os registros no meu provedor?</summary><dl className="mt-3 space-y-3">{PROVIDERS.map(([name,text])=><div key={name}><dt className="text-xs font-semibold">{name}</dt><dd className="text-xs leading-relaxed text-muted-foreground">{text}</dd></div>)}</dl></details>
  <details className="rounded-lg border border-border/60 p-3"><summary className="cursor-pointer text-sm font-medium">Não funcionou? Confira</summary><ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground"><li>Copie os valores exatamente como aparecem, sem espaços nem aspas extras (alguns painéis colocam aspas sozinhos — tudo bem).</li><li>No campo Nome, muitos painéis completam o domínio sozinhos: se ficar “_vorix-site.www.sualoja.com.br.sualoja.com.br”, digite só a primeira parte.</li><li>Se o domínio usa os servidores DNS de outra empresa (ex.: Cloudflare), crie os registros lá, não no registrador.</li><li>Mudanças de DNS podem levar até 24 h. Você pode fechar esta tela e verificar depois.</li><li>E-mail no mesmo domínio continua funcionando: não apague registros MX.</li></ul></details>
  {removing?<ConfirmDialog open title={`Remover ${removing.hostname}?`} description="O site deixa de abrir por esse domínio. O endereço padrão e o conteúdo continuam iguais. Você pode adicionar o domínio de novo depois." confirmLabel="Remover domínio" variant="danger" onCancel={()=>setRemoving(undefined)} onConfirm={async()=>{try{await removeDomain(site,removing);await mutate();setRemoving(undefined);}catch(error){toast.error(errorText(error,"Não foi possível remover."));}}}/>:null}
 </div>;
}
