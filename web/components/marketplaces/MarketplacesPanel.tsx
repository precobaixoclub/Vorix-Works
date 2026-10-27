"use client";
import { useEffect,useMemo,useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/Button";
import { Input,Label,Textarea } from "@/components/Field";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useMyAccess } from "@/features/auth/access";
import { marketplaceApi,marketplaceMessage,type Category,type Decision,type Draft,type Identity,type Job,type Listing } from "@/features/marketplaces/api";
import { apiClient } from "@/lib/api-client";
import { formatCurrencyCents } from "@/lib/format";
const selectClass="h-10 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm";
const box="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5";
const statusText:Record<string,string>={CONNECTED:"Conectado",DISCONNECTED:"Desconectado",REAUTH_REQUIRED:"Reautenticação necessária",ERROR:"Erro",SYNCED:"Sincronizado",PENDING:"Pendente",DIVERGED:"Divergência",RUNNING:"Processando",COMPLETED:"Concluído",COMPLETED_WITH_ERRORS:"Concluído com erros",FAILED:"Falhou",UNKNOWN_RESULT:"Resultado incerto",active:"Ativo",paused:"Pausado",closed:"Finalizado",DRAFT:"Rascunho",PUBLISHING:"Publicando",MISSING:"Anúncio não encontrado"};
const status=(s:string)=>statusText[s]??s;
const identityKey=(i:Identity)=>i.productId+":"+(i.variantId??"");
const productOption=(i:Identity)=><option key={identityKey(i)} value={identityKey(i)}>{i.name}{i.sku?" · "+i.sku:""}</option>;
export function MarketplacesPanel(){
 const workspace=useCurrentWorkspace(),{can}=useMyAccess(),manage=can("marketplace:manage"),read=can("marketplace:read");
 const api=useMemo(()=>marketplaceApi(workspace.id),[workspace.id]);
 const {data,error,mutate}=useSWR(read?["marketplaces",workspace.id]:null,()=>api.dashboard(),{refreshInterval:5000});
 const {data:catalog=[]}=useSWR(read&&data?.configured?["marketplace-catalog",workspace.id]:null,()=>api.catalog());
 const [connectionId,setConnectionId]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[jobId,setJobId]=useState("");
 const [publish,setPublish]=useState(false),[editing,setEditing]=useState<Listing>(),[initialProduct,setInitialProduct]=useState("");
 const connection=data?.connections.find(c=>c.id===connectionId)??data?.connections[0];
 const {data:job,mutate:refreshJob}=useSWR(jobId?["marketplace-job",workspace.id,jobId]:null,()=>api.job(jobId),{refreshInterval:3000});
 useEffect(()=>{const productId=new URLSearchParams(window.location.search).get("productId");if(productId){setInitialProduct(productId);setPublish(true);}},[]);
 async function run(fn:()=>Promise<unknown>,success="Operação enviada para processamento."){
  setBusy(true);setMessage("");try{await fn();setMessage(success);await mutate();await refreshJob();}catch(e){setMessage(marketplaceMessage(e));}finally{setBusy(false);}
 }
 const queue=(operation:Record<string,unknown>,operationKey?:string)=>run(async()=>{if(!connection)return;const j=await api.enqueue(connection.id,operation,operationKey);setJobId(j.id);if(operation.kind==="PUBLISH"||operation.kind==="UPDATE"){setPublish(false);setEditing(undefined);}});
 function listingAction(l:Listing,kind:string,extra:Record<string,unknown>={}){
  return run(async()=>{const j=await api.enqueue(l.connectionId,{kind,listingId:l.id,...extra});setJobId(j.id);});
 }
 return <SettingsShell active="marketplaces" title="Marketplaces" description="Conecte o Mercado Livre e gerencie os anúncios do seu catálogo Vorix.">
  <div className="min-w-0 space-y-5">
   {!read&&<p role="status">Você não tem permissão para visualizar marketplaces.</p>}
   {error&&<p role="alert" className="break-words text-sm text-destructive">{marketplaceMessage(error)}</p>}
   {message&&<p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
   {read&&<>
    <section className={box} aria-label="Conexão Mercado Livre">
     <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Mercado Livre</h2><p className="text-sm text-muted-foreground">Produtos, anúncios, preços e estoque disponível.</p></div>
      <Button disabled={busy||!manage||!data?.configured} onClick={()=>run(async()=>{const {url}=await api.connect();window.location.assign(url);},"Abrindo autorização do Mercado Livre.")}>{connection?.status==="REAUTH_REQUIRED"?"Autorizar novamente":"Conectar conta"}</Button>
     </div>
     {data&&!data.configured&&<p className="mt-3 text-sm">A integração aguarda a configuração da aplicação Mercado Livre pelo administrador da plataforma.</p>}
     {!connection&&data?.configured&&<p className="mt-3 text-sm">Nenhuma conta conectada.</p>}
     {connection&&<div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
      <div className="min-w-0 space-y-2"><Label htmlFor="marketplace-account">Conta</Label><select id="marketplace-account" className={selectClass} value={connection.id} onChange={e=>setConnectionId(e.target.value)}>{data?.connections.map(c=><option key={c.id} value={c.id}>{c.externalAccountName} · {status(c.status)}</option>)}</select>
       <p className="text-sm">{status(connection.status)} · {connection.userProducts?"User Products":"Modelo tradicional"}</p>
       <p className="text-xs text-muted-foreground">Última reconciliação: {connection.lastSyncAt?new Date(connection.lastSyncAt).toLocaleString("pt-BR"):"ainda não realizada"}</p>
       {connection.lastError&&<p className="break-words text-sm text-destructive">{marketplaceMessage(connection.lastError)}</p>}
      </div>
      <div className="min-w-0"><Label htmlFor="marketplace-safety-stock">Reserva de segurança do canal</Label>
       <SafetyStock key={connection.id+":"+connection.safetyStock} value={connection.safetyStock} disabled={busy||!manage} onSave={n=>run(()=>api.safetyStock(connection.id,n),"Reserva de segurança atualizada.")}/>
       <p className="mt-1 text-xs text-muted-foreground">Quantidade enviada = saldo físico − reservas − segurança. O padrão é zero.</p>
      </div>
      {manage&&<div className="flex flex-wrap gap-2 md:col-span-2">
       <Button variant="secondary" disabled={busy||connection.status!=="CONNECTED"} onClick={()=>queue({kind:"PREVIEW"})}>Importar anúncios</Button>
       <Button variant="secondary" disabled={busy||connection.status!=="CONNECTED"} onClick={()=>{setEditing(undefined);setPublish(v=>!v);}}>Publicar produto</Button>
       <Button variant="secondary" disabled={busy||connection.status!=="CONNECTED"} onClick={()=>queue({kind:"RECONCILE"})}>Verificar divergências</Button>
       <Button variant="ghost" disabled={busy||connection.status==="DISCONNECTED"} onClick={()=>{if(window.confirm("Desconectar esta conta e interromper a sincronização? Os anúncios continuarão no Mercado Livre."))void run(()=>api.disconnect(connection.id),"Conta desconectada.");}}>Desconectar</Button>
      </div>}
     </div>}
    </section>
    {publish&&manage&&connection&&<PublishForm key={connection.id+":"+(editing?.id??"new")} workspaceId={workspace.id} connectionId={connection.id} catalog={catalog} initialProduct={initialProduct} listing={editing} disabled={busy}
     onSubmit={(operation,key)=>queue(operation,key)} onClose={()=>{setPublish(false);setEditing(undefined);}}/>}
    {job&&<section className={box} aria-label="Progresso da importação"><h2 className="font-semibold">Processamento: {status(job.status)}</h2><p className="mt-1 text-sm">{job.progress} de {job.total||"—"}</p>
     <progress className="mt-2 w-full" max={Math.max(1,job.total)} value={job.progress} aria-label="Progresso"/>
     {job.lastError&&<p className="mt-2 break-words text-sm text-destructive">{marketplaceMessage(job.lastError)}</p>}
     {job.kind==="PUBLISH"&&job.status==="UNKNOWN_RESULT"&&manage&&<Button className="mt-3" variant="secondary" disabled={busy} onClick={()=>run(async()=>{
      const recovery=await api.enqueue(job.connectionId,{kind:"RECONCILE",publicationJobId:job.id});setJobId(recovery.id);
     },"Buscando o anúncio existente na conta Mercado Livre.")}>Localizar publicação no Mercado Livre</Button>}
     {job.items?.filter(i=>i.status==="ERROR").map(i=><p key={i.externalId} className="mt-1 break-words text-sm text-destructive">{i.externalId}: {marketplaceMessage(i.result.code)}</p>)}
     {job.kind==="PREVIEW"&&job.status==="COMPLETED"&&manage&&<ImportPreview job={job} catalog={catalog} disabled={busy} onImport={decisions=>queue({kind:"IMPORT",previewJobId:job.id,decisions})}/>}
    </section>}
    <section className={box} aria-label="Anúncios do catálogo"><h2 className="text-lg font-semibold">Anúncios</h2><p className="mt-1 text-sm text-muted-foreground">O produto e o estoque físico permanecem no catálogo central.</p>
     {!data?.listings.length&&<p className="mt-4 text-sm">Nenhum anúncio vinculado. Importe os existentes ou publique um produto.</p>}
     <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">{data?.listings.map(l=><article key={l.id} className="min-w-0 rounded-lg border p-3">
      <h3 className="break-words font-medium">{l.productName??l.productId}</h3><p className="break-all text-xs text-muted-foreground">{l.externalListingId??"Aguardando publicação"}</p>
      <p className="mt-2 text-sm">{status(l.status)} · <strong>{status(l.syncStatus)}</strong></p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm"><span>Preço externo: {l.externalPrice===undefined?"—":formatCurrencyCents(l.externalPrice)}</span><span>Publicado: {l.externalQuantity??"—"} un.</span></div>
      {l.snapshot?.variants.map(v=><p key={v.id} className="mt-1 break-words text-xs">{Object.values(v.options).join(" / ")}: {v.quantity} un.</p>)}
      {l.lastError&&<p className="mt-2 break-words text-sm text-destructive">{marketplaceMessage(l.lastError)}</p>}
      {l.externalUrl&&<a href={l.externalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm underline">Ver no Mercado Livre</a>}
      {manage&&l.externalListingId&&<div className="mt-3 flex flex-wrap gap-2">
       <Button size="sm" variant="secondary" disabled={busy} onClick={()=>listingAction(l,"RECONCILE")}>Conferir</Button>
       <Button size="sm" variant="secondary" disabled={busy||l.status==="closed"} onClick={()=>{
        if(l.syncStatus==="DIVERGED"){
         if(window.confirm("Aplicar o preço e estoque disponíveis do Vorix ao anúncio? Confira os valores externos exibidos. Mudanças posteriores serão bloqueadas."))void listingAction(l,"SYNC",{resolveConflict:true,expectedExternalPrice:l.externalPrice,expectedExternalQuantity:l.externalQuantity,expectedVariantQuantities:l.snapshot?.variants.map(v=>({id:v.id,quantity:v.quantity}))});
        }else void listingAction(l,"SYNC");
       }}>Sincronizar</Button>
       <Button size="sm" variant="secondary" disabled={busy||l.status==="closed"} onClick={()=>{setConnectionId(l.connectionId);setEditing(l);setPublish(true);}}>Atualizar</Button>
       <Button size="sm" variant="secondary" disabled={busy||l.status==="closed"} onClick={()=>listingAction(l,"STATUS",{status:l.status==="paused"?"active":"paused"})}>{l.status==="paused"?"Reativar":"Pausar"}</Button>
       <Button size="sm" variant="danger" disabled={busy||l.status==="closed"} onClick={()=>{if(window.confirm("Finalizar este anúncio no Mercado Livre? Esta ação pode impedir sua reativação e exigir uma nova publicação."))void listingAction(l,"STATUS",{status:"closed",confirm:true});}}>Finalizar</Button>
      </div>}
     </article>)}</div>
    </section>
    {!!data?.jobs.length&&<section className={box} aria-label="Histórico de processamento"><h2 className="font-semibold">Processamentos recentes</h2><div className="mt-3 space-y-2">{data.jobs.slice(0,12).map(j=><button type="button" key={j.id} onClick={()=>setJobId(j.id)} className="flex w-full min-w-0 flex-wrap justify-between gap-2 rounded-lg border p-3 text-left text-sm"><span>{({PREVIEW:"Prévia de importação",IMPORT:"Importação",PUBLISH:"Publicação",UPDATE:"Atualização",SYNC:"Sincronização",RECONCILE:"Reconciliação",STATUS:"Alteração de status"} as Record<string,string>)[j.kind]??j.kind}</span><span>{status(j.status)} · {j.progress}/{j.total}</span></button>)}</div></section>}
   </>}
  </div>
 </SettingsShell>;
}
function SafetyStock({value,disabled,onSave}:{value:number;disabled:boolean;onSave:(value:number)=>void}){
 const [n,setN]=useState(String(value));return <div className="mt-1 flex min-w-0 gap-2"><Input id="marketplace-safety-stock" type="number" min={0} step={1} value={n} onChange={e=>setN(e.target.value)} disabled={disabled}/><Button variant="secondary" disabled={disabled||!/^\d+$/.test(n)} onClick={()=>onSave(Number(n))}>Salvar</Button></div>;
}
function ImportPreview({job,catalog,disabled,onImport}:{job:Job;catalog:Identity[];disabled:boolean;onImport:(decisions:Decision[])=>void}){
 const items=job.items?.filter(i=>i.result.external)??[];
 const defaults=useMemo(()=>Object.fromEntries(items.map(item=>{
  const e=item.result.external!,candidate=item.result.match?.candidates.length===1?item.result.match.candidates[0]:undefined;
  return [e.id,{externalId:e.id,action:candidate?"LINK":"IGNORE",productId:candidate?.productId,variantId:e.variants.length?undefined:candidate?.variantId,
   variantLinks:e.variants.flatMap(v=>{const match=item.result.variantMatches?.find(m=>m.externalVariantId===v.id)?.match;return match?.candidates.length===1&&match.candidates[0].variantId?[{externalVariantId:v.id,variantId:match.candidates[0].variantId}]:[];}),useExternalInitialStock:false} as Decision];
 })),[job.id,job.items]);
 const [choices,setChoices]=useState<Record<string,Decision>>({});
 const update=(id:string,patch:Partial<Decision>)=>setChoices(previous=>({...previous,[id]:{...defaults[id],...previous[id],...patch}}));
 const decisions=items.map(i=>choices[i.externalId]??defaults[i.externalId]);
 const valid=decisions.every((d,index)=>d.action!=="LINK"||(!!d.productId&&(!items[index].result.external!.variants.length||d.variantLinks.length===items[index].result.external!.variants.length)));
 return <div className="mt-4 min-w-0 space-y-3"><h3 className="font-medium">Prévia dos anúncios · {items.length}</h3><p className="text-sm text-muted-foreground">Revise vínculos e variações. Nenhuma alteração no catálogo ocorreu até aqui. O saldo externo só será usado se você marcar a opção.</p>
  <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={disabled} onClick={()=>setChoices(Object.fromEntries(items.map(i=>[i.externalId,{...defaults[i.externalId],action:"CREATE"}])))}>Criar todos no Vorix</Button><Button size="sm" variant="ghost" onClick={()=>setChoices({})}>Restaurar sugestões</Button></div>
  {items.map(item=>{const e=item.result.external!,d=choices[e.id]??defaults[e.id],products=[...new Map(catalog.map(i=>[i.productId,i])).values()];
   return <article key={e.id} className="min-w-0 space-y-3 rounded-lg border p-3"><div className="flex min-w-0 gap-3">{e.pictures[0]&&<img src={e.pictures[0]} alt="" className="h-14 w-14 shrink-0 rounded object-contain"/>}<div className="min-w-0"><h4 className="break-words font-medium">{e.title}</h4><p className="break-words text-xs">SKU: {e.sku??"—"} · EAN: {e.ean??"—"} · Categoria: {e.categoryId}</p></div></div>
    <p className="text-sm">{formatCurrencyCents(e.priceCents)} · Mercado Livre informa {e.quantity} unidades · {status(e.status)}</p>
    <p className="text-xs text-muted-foreground">Correspondência: {({SKU:"SKU exato",EAN:"EAN exato",AMBIGUOUS:"mais de um resultado; escolha manualmente",NONE:"nenhuma"} as Record<string,string>)[item.result.match?.kind??"NONE"]}</p>
    <Label htmlFor={"action-"+e.id}>Ação</Label><select id={"action-"+e.id} className={selectClass} value={d.action} onChange={ev=>update(e.id,{action:ev.target.value as Decision["action"]})}><option value="IGNORE">Ignorar</option><option value="LINK">Vincular ao catálogo Vorix</option><option value="CREATE">Criar produto no Vorix</option></select>
    {d.action==="LINK"&&<><Label htmlFor={"product-"+e.id}>Produto / variação Vorix</Label><select id={"product-"+e.id} className={selectClass} value={e.variants.length?d.productId??"":d.productId+":"+(d.variantId??"")} onChange={ev=>{const [productId,variantId]=ev.target.value.split(":");update(e.id,{productId,variantId:variantId||undefined,variantLinks:[]});}}><option value="">Selecione</option>{e.variants.length?products.map(i=><option key={i.productId} value={i.productId}>{i.name.split(" / ")[0]}</option>):catalog.map(productOption)}</select>
     {e.variants.map(v=><div key={v.id} className="min-w-0"><Label htmlFor={"variant-"+e.id+"-"+v.id}>{Object.values(v.options).join(" / ")+" · SKU "+(v.sku??"—")+" · "+v.quantity+" un."}</Label><select id={"variant-"+e.id+"-"+v.id} className={selectClass} value={d.variantLinks.find(l=>l.externalVariantId===v.id)?.variantId??""} onChange={ev=>update(e.id,{variantLinks:[...d.variantLinks.filter(l=>l.externalVariantId!==v.id),...(ev.target.value?[{externalVariantId:v.id,variantId:ev.target.value}]:[])]})}><option value="">Selecione a variação Vorix</option>{catalog.filter(i=>i.productId===d.productId&&i.variantId).map(i=><option key={i.variantId} value={i.variantId}>{i.name}</option>)}</select></div>)}
    </>}
    {d.action==="CREATE"&&e.variants.length>0&&<p className="break-words text-sm">{e.variants.length} variações serão criadas: {e.variants.map(v=>Object.values(v.options).join(" / ")).join("; ")}</p>}
    {d.action!=="IGNORE"&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 shrink-0" checked={d.useExternalInitialStock} onChange={ev=>update(e.id,{useExternalInitialStock:ev.target.checked})}/><span>Usar o saldo informado pelo Mercado Livre como saldo inicial. O saldo físico atual será ajustado por uma movimentação de importação.</span></label>}
   </article>;
  })}
  <Button disabled={disabled||!valid||decisions.every(d=>d.action==="IGNORE")} onClick={()=>onImport(decisions)}>Confirmar importação em lote</Button>
 </div>;
}
function PublishForm({workspaceId,connectionId,catalog,initialProduct,listing,disabled,onSubmit,onClose}:{workspaceId:string;connectionId:string;catalog:Identity[];initialProduct:string;listing?:Listing;disabled:boolean;onSubmit:(operation:Record<string,unknown>,key:string)=>void;onClose:()=>void}){
 const api=useMemo(()=>marketplaceApi(workspaceId),[workspaceId]),[selected,setSelected]=useState(listing?listing.productId+":"+(listing.variantId??""):"");
 const [draft,setDraft]=useState<Draft>(listing?.draft??{categoryId:listing?.snapshot?.categoryId??"",title:listing?.snapshot?.title??"",description:"",condition:"new",listingTypeId:"gold_special",buyingMode:"buy_it_now",attributes:[],pictures:listing?.snapshot?.pictures??[],settings:{}});
 const [category,setCategory]=useState<Category>(),[error,setError]=useState(""),[validated,setValidated]=useState(""),[loading,setLoading]=useState(false),[vorixCategory,setVorixCategory]=useState("");
 const [operationKey]=useState(()=>crypto.randomUUID());
 const {data:metadata}=useSWR(["marketplace-metadata",workspaceId],()=>api.metadata());
 useEffect(()=>{if(!selected&&initialProduct){const option=catalog.find(i=>i.productId===initialProduct);if(option)setSelected(identityKey(option));}},[initialProduct,catalog,selected]);
 useEffect(()=>{if(listing)return;const productId=selected.split(":")[0];if(!productId)return;let live=true;
  void apiClient.get<{name:string;description?:string;imageUrls:string[];categoryId?:string}>("/v1/products/"+encodeURIComponent(productId)+"?workspaceId="+encodeURIComponent(workspaceId)).then(p=>{if(live){setDraft(d=>({...d,title:p.name,description:p.description??"",pictures:p.imageUrls}));setVorixCategory(p.categoryId??"");}}).catch(()=>{});return()=>{live=false;};
 },[selected,workspaceId,listing]);
 const [productId,variantId]=selected.split(":"),body={connectionId,productId,variantId:variantId||undefined,listingId:listing?.id,draft},fingerprint=JSON.stringify(body);
 const patch=(p:Partial<Draft>)=>{setDraft(d=>({...d,...p}));setError("");};
 const field=(a:{id:string;name:string;required:boolean;values?:{id:string;name:string}[]},term=false)=>{
  const attributes=term?(draft.settings.sale_terms as Draft["attributes"]??[]):draft.attributes;
  const current=attributes.find(item=>item.id===a.id),setValue=(value:string,isId=false)=>{
   const next=[...attributes.filter(item=>item.id!==a.id),...(value?[{id:a.id,...(isId?{value_id:value}:{value_name:value})}]:[])];
   patch(term?{settings:{...draft.settings,sale_terms:next}}:{attributes:next});
  };
  const htmlId=(term?"term-":"attr-")+a.id;
  return <div key={htmlId} className="min-w-0"><Label htmlFor={htmlId}>{a.name+(a.required?" *":"")}</Label>{a.values?.length?<select id={htmlId} className={selectClass} value={current?.value_id??""} onChange={e=>setValue(e.target.value,true)}><option value="">Selecione</option>{a.values.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>:<Input id={htmlId} value={current?.value_name??""} onChange={e=>setValue(e.target.value)}/>}</div>;
 };
 async function loadCategory(){setLoading(true);setError("");try{setCategory(await api.category(connectionId,draft.categoryId));}catch(e){setError(marketplaceMessage(e));}finally{setLoading(false);}}
 return <section className={box} aria-label="Publicação no Mercado Livre"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{listing?"Atualizar anúncio":"Publicar produto no Mercado Livre"}</h2><Button size="sm" variant="ghost" onClick={onClose}>Fechar</Button></div>
  <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
   <div className="min-w-0 md:col-span-2"><Label htmlFor="publish-product">Produto / variação Vorix</Label><select id="publish-product" className={selectClass} value={selected} disabled={!!listing} onChange={e=>setSelected(e.target.value)}><option value="">Selecione</option>{listing&&!catalog.some(i=>identityKey(i)===selected)&&<option value={selected}>{listing.productName??listing.productId}</option>}{catalog.map(productOption)}</select><p className="mt-1 text-xs text-muted-foreground">Preço e quantidade vêm do catálogo e do estoque disponível. Selecione cada variação para publicá-la como um anúncio próprio.</p></div>
   <div className="min-w-0"><Label htmlFor="publish-category">Código da categoria Mercado Livre</Label><div className="flex min-w-0 gap-2"><Input id="publish-category" placeholder="MLB..." value={draft.categoryId} disabled={!!listing} onChange={e=>{patch({categoryId:e.target.value});setCategory(undefined);}}/><Button variant="secondary" disabled={loading||!draft.categoryId} onClick={loadCategory}>Consultar</Button></div>{category&&<p className="mt-1 text-sm">{category.name}{!category.leaf||!category.allowed?" · não aceita publicação":""}</p>}</div>
   <div className="min-w-0"><Label htmlFor="vorix-category">Categoria Vorix (mapeamento opcional)</Label><select id="vorix-category" className={selectClass} value={vorixCategory} onChange={e=>setVorixCategory(e.target.value)}><option value="">Sem mapeamento</option>{metadata?.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
   <div className="min-w-0 md:col-span-2"><Label htmlFor="publish-title">Título / nome da família</Label><Input id="publish-title" maxLength={160} value={draft.title} onChange={e=>patch({title:e.target.value})}/></div>
   <div><Label htmlFor="publish-condition">Condição</Label><select id="publish-condition" className={selectClass} disabled={!!listing} value={draft.condition} onChange={e=>patch({condition:e.target.value})}><option value="new">Novo</option><option value="used">Usado</option><option value="not_specified">Não especificada</option></select></div>
   <div><Label htmlFor="publish-type">Tipo de anúncio</Label><select id="publish-type" className={selectClass} disabled={!!listing} value={draft.listingTypeId} onChange={e=>patch({listingTypeId:e.target.value})}><option value="gold_special">Clássico</option><option value="gold_pro">Premium</option><option value="free">Grátis (se elegível)</option></select></div>
   <div className="md:col-span-2"><Label htmlFor="publish-description">Descrição</Label><Textarea id="publish-description" rows={4} value={draft.description} onChange={e=>patch({description:e.target.value})}/></div>
   <div className="md:col-span-2"><Label htmlFor="publish-pictures">Imagens (uma URL HTTPS por linha)</Label><Textarea id="publish-pictures" rows={3} value={draft.pictures.join("\n")} onChange={e=>patch({pictures:e.target.value.split("\n").filter(Boolean)})}/></div>
   {category?.attributes.filter(a=>a.required||draft.attributes.some(v=>v.id===a.id)).map(a=>field(a))}
   {category&&<div className="md:col-span-2"><Label htmlFor="add-attribute">Adicionar atributo da categoria</Label><select id="add-attribute" className={selectClass} value="" onChange={e=>{if(e.target.value)patch({attributes:[...draft.attributes,{id:e.target.value,value_name:""}]});}}><option value="">Selecione</option>{category.attributes.filter(a=>!a.required&&!draft.attributes.some(v=>v.id===a.id)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
   {!!category?.saleTerms?.length&&<h3 className="font-medium md:col-span-2">Condições de venda da categoria</h3>}
   {category?.saleTerms?.map(a=>field(a,true))}
   <div className="md:col-span-2"><Label htmlFor="publish-shipping">Modalidade de envio do anúncio</Label><select id="publish-shipping" className={selectClass} value={(draft.settings.shipping as {mode?:string})?.mode??""} onChange={e=>patch({settings:{...draft.settings,shipping:e.target.value?{mode:e.target.value}:undefined}})}><option value="">Usar configuração da conta</option><option value="me2">Mercado Envios</option><option value="not_specified">Combinar com o comprador</option><option value="custom">Envio personalizado (se elegível)</option></select><p className="mt-1 text-xs text-muted-foreground">A elegibilidade e os requisitos desta modalidade serão conferidos pelo Mercado Livre antes da publicação.</p></div>
   {!!draft.settings.shipping&&<div className="flex flex-wrap gap-4 md:col-span-2">{[["local_pick_up","Permitir retirada"],["free_shipping","Oferecer frete grátis"]].map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!(draft.settings.shipping as Record<string,unknown>)?.[key]} onChange={e=>patch({settings:{...draft.settings,shipping:{...draft.settings.shipping as Record<string,unknown>,[key]:e.target.checked}}})}/>{label}</label>)}</div>}
  </div>
  {error&&<p role="alert" className="mt-3 whitespace-pre-line break-words text-sm text-destructive">{error}</p>}
  {validated===fingerprint&&<p role="status" className="mt-3 text-sm">Pronto para {listing?"atualizar":"publicar"}. A configuração passou pela validação do Mercado Livre.</p>}
  <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={loading||disabled||!productId||!category} onClick={async()=>{setLoading(true);setError("");try{const result=await api.validate(body);if(result.errors.length)setError(result.errors.join("\n"));else setValidated(fingerprint);}catch(e){setError(marketplaceMessage(e));}finally{setLoading(false);}}}>{loading?"Validando…":"Validar no Mercado Livre"}</Button>
   <Button disabled={disabled||loading||validated!==fingerprint} onClick={()=>onSubmit(listing?{kind:"UPDATE",listingId:listing.id,draft}:{kind:"PUBLISH",productId,variantId:variantId||undefined,draft},operationKey)}>{listing?"Atualizar anúncio":"Publicar anúncio"}</Button>
   <Button variant="ghost" disabled={loading||!vorixCategory||!category} onClick={async()=>{setLoading(true);try{await api.mapping({connectionId,categoryId:vorixCategory,externalCategoryId:draft.categoryId,attributes:draft.attributes});setError("Mapeamento salvo.");}catch(e){setError(marketplaceMessage(e));}finally{setLoading(false);}}}>Salvar mapeamento</Button>
  </div>
 </section>;
}
