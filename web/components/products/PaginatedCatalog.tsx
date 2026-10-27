"use client";
import {useEffect,useState,type ReactNode} from "react";
import useSWR from "swr";
import {useSearchParams} from "next/navigation";
import {useCurrentWorkspace} from "@/contexts/workspace-context";
import {useMyAccess} from "@/features/auth/access";
import {useCommercialSettings} from "@/features/sales/hooks";
import {getProductMetadata} from "@/features/product-engine/api";
import type {Product} from "@/features/crm/types";
import {apiClient} from "@/lib/api-client";
import {bulkPath} from "@/features/product-engine/bulk-api";
import {formatCurrencyCents} from "@/lib/format";
import {Button} from "@/components/Button";
import {PageHeader} from "@/components/PageHeader";
import {Input} from "@/components/Field";
import {ErrorState} from "@/components/ErrorState";
import {ProductFormModal} from "./ProductFormModal";
import {CatalogBulkTools} from "./CatalogBulkTools";

export function PaginatedCatalog({card}:{card:(product:Product,onOpen:()=>void)=>ReactNode}){
 const workspace=useCurrentWorkspace(),access=useMyAccess(),searchParams=useSearchParams();
 const [search,setSearch]=useState(searchParams.get("q")??""),[query,setQuery]=useState(search),[category,setCategory]=useState(""),[brand,setBrand]=useState(""),[type,setType]=useState(""),[active,setActive]=useState("true"),[site,setSite]=useState(""),[stock,setStock]=useState(searchParams.get("filtro")==="sem-estoque"?"out":searchParams.get("filtro")==="repor"?"low":""),[sort,setSort]=useState("recentes"),[page,setPage]=useState(0),[view,setView]=useState(searchParams.get("view")==="lista"?"list":"grid");
 const [selected,setSelected]=useState<string[]>([]),[editing,setEditing]=useState<Product|"new">();
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setPage(0);},250);return()=>clearTimeout(timer);},[search]);
 const filters=Object.fromEntries(Object.entries({search:query,category,brand,type,active,site,stock}).filter(([,v])=>v));
 const key=bulkPath(workspace.id,`products?${new URLSearchParams({...filters,offset:String(page*50),limit:"50",sort})}`);
 const {data,error,isLoading,mutate}=useSWR(key,()=>apiClient.get<{items:Product[];total:number}>(key));
 const {data:metadata}=useSWR(["product-metadata",workspace.id],()=>getProductMetadata(workspace.id));
 const {data:settings}=useCommercialSettings(workspace.id);
 const visibility=settings?.visibility??{canViewCost:false,isManager:false};
 const canManage=access.can("product:manage");const items=data?.items??[];
 const change=(setter:(value:string)=>void)=>(event:React.ChangeEvent<HTMLSelectElement>)=>{setter(event.target.value);setPage(0);setSelected([]);};
 const selectStyle="min-w-0 w-full rounded-md border border-border bg-background p-2 text-sm";
 const toggle=(id:string)=>setSelected(ids=>ids.includes(id)?ids.filter(v=>v!==id):ids.length<500?[...ids,id]:ids);
 return <div className="mx-auto max-w-7xl px-3 py-6 sm:px-6">
  <PageHeader title="Produtos" description="Seu catálogo em um só lugar: produtos, preços, estoque e operações em massa." actions={canManage?<Button onClick={()=>setEditing("new")}>Cadastrar produto</Button>:undefined}/>
  <CatalogBulkTools key={workspace.id} workspaceId={workspace.id} selectedIds={selected} filters={filters} canManage={canManage} canViewCost={visibility.canViewCost} isManager={visibility.isManager} inventoryManage={access.can("inventory:manage")} onSaved={()=>{void mutate();setSelected([]);}}/>
  <section aria-label="Filtros do catálogo" className="mb-4 grid grid-cols-1 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
   <label className="text-xs">Buscar produto<Input aria-label="Buscar produto" placeholder="Nome, código, modelo ou cidade" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <label className="text-xs">Categoria<select aria-label="Categoria" className={selectStyle} value={category} onChange={change(setCategory)}><option value="">Todas as categorias</option>{metadata?.categories.map(c=><option key={c.id} value={c.id}>{metadata.categories.find(p=>p.id===c.parentId)?.name?`${metadata.categories.find(p=>p.id===c.parentId)?.name} / `:""}{c.name}</option>)}</select></label>
   <label className="text-xs">Marca<select aria-label="Marca" className={selectStyle} value={brand} onChange={change(setBrand)}><option value="">Todas as marcas</option>{metadata?.brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   <label className="text-xs">Tipo<select aria-label="Tipo de produto" className={selectStyle} value={type} onChange={change(setType)}><option value="">Todos os tipos</option>{["GENERAL","APPAREL","VEHICLE","REAL_ESTATE","SERVICE"].map((v,i)=><option key={v} value={v}>{["Geral","Vestuário","Veículos","Imóveis","Serviços"][i]}</option>)}</select></label>
   <label className="text-xs">Situação<select aria-label="Situação" className={selectStyle} value={active} onChange={change(setActive)}><option value="">Ativos e desativados</option><option value="true">Ativos</option><option value="false">Desativados</option></select></label>
   <label className="text-xs">Site<select aria-label="Visibilidade no site" className={selectStyle} value={site} onChange={change(setSite)}><option value="">Qualquer visibilidade</option><option value="true">Aparecer no site</option><option value="false">Não aparecer no site</option></select></label>
   {access.can("inventory:read")?<label className="text-xs">Estoque<select aria-label="Estoque" className={selectStyle} value={stock} onChange={change(setStock)}><option value="">Qualquer estoque</option><option value="in">Com estoque</option><option value="out">Sem estoque</option><option value="low">Precisa repor</option></select></label>:null}
   <label className="text-xs">Ordenar<select aria-label="Ordenar" className={selectStyle} value={sort} onChange={change(setSort)}>{["recentes","atualizados","nome","menor-preco","maior-preco",...(access.can("inventory:read")?["menor-estoque"]:[])].map((v,i)=><option key={v} value={v}>{["Mais recentes","Atualizados por último","Nome (A–Z)","Menor preço","Maior preço","Menor estoque"][i]}</option>)}</select></label>
  </section>
  <div className="mb-3 flex flex-wrap items-center gap-3"><span className="text-sm">{data?.total??0} produtos</span>{canManage?<label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Selecionar página" checked={items.length>0&&items.every(p=>selected.includes(p.id))} onChange={e=>setSelected(ids=>e.target.checked?[...new Set([...ids,...items.map(p=>p.id)])].slice(0,500):ids.filter(id=>!items.some(p=>p.id===id)))}/>Selecionar página</label>:null}{selected.length?<Button variant="ghost" onClick={()=>setSelected([])}>Limpar seleção</Button>:null}<Button variant="ghost" onClick={()=>setView(view==="grid"?"list":"grid")}>{view==="grid"?"Lista":"Vitrine"}</Button></div>
  {isLoading?<p role="status">Carregando produtos…</p>:null}{error?<ErrorState error={error} onRetry={()=>mutate()}/>:null}
  {!isLoading&&!error&&!items.length?<p className="rounded-xl border border-dashed p-8 text-center text-sm">Nenhum produto encontrado com esses filtros.</p>:null}
  <div className={view==="grid"?"grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5":"space-y-2"}>{items.map(p=><div key={p.id} className="relative min-w-0">{canManage?<label className="absolute right-2 top-2 z-10 flex rounded-md border bg-background p-2"><input aria-label={`Selecionar ${p.name}`} type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)}/></label>:null}{view==="grid"?card(p,()=>setEditing(p)):<button className="flex w-full flex-wrap gap-3 rounded-lg border p-4 pr-14 text-left text-sm" onClick={()=>setEditing(p)}><span className="min-w-0 flex-1 break-words font-medium">{p.name}<span className="block text-xs text-muted-foreground">{p.code}</span></span><span>{formatCurrencyCents(p.priceCents)}</span>{access.can("inventory:read")?<span>{p.trackStock?`${p.stockQuantity} em estoque`:"Sem controle"}</span>:null}</button>}</div>)}</div>
  <nav aria-label="Paginação do catálogo" className="mt-4 flex flex-wrap items-center justify-between gap-3"><Button variant="secondary" disabled={page===0} onClick={()=>setPage(v=>v-1)}>Anterior</Button><span className="text-sm">Página {page+1} de {Math.max(1,Math.ceil((data?.total??0)/50))} · até 50 itens por página</span><Button variant="secondary" disabled={!data||(page+1)*50>=data.total} onClick={()=>setPage(v=>v+1)}>Próxima</Button></nav>
  {editing?<ProductFormModal workspaceId={workspace.id} product={editing==="new"?undefined:editing} canViewCost={visibility.canViewCost} isManager={visibility.isManager} onClose={()=>setEditing(undefined)} onSaved={async()=>{setEditing(undefined);await mutate();}}/>:null}
 </div>;
}
