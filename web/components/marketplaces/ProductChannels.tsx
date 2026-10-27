"use client";
import Link from "next/link";
import useSWR from "swr";
import { useMyAccess } from "@/features/auth/access";
import { marketplaceApi,marketplaceMessage } from "@/features/marketplaces/api";
import { formatCurrencyCents } from "@/lib/format";
export function ProductChannels({workspaceId,productId,siteVisible}:{workspaceId:string;productId:string;siteVisible:boolean}){
 const {can}=useMyAccess(),api=marketplaceApi(workspaceId);
 const {data,error}=useSWR(can("marketplace:read")?["product-channels",workspaceId,productId]:null,()=>api.dashboard(productId));
 return <section className="min-w-0 rounded-lg border p-3" aria-label="Canais do produto">
  <h3 className="font-medium">Canais</h3><p className="mt-2 text-sm">Site: {siteVisible?"visível na vitrine quando o site estiver publicado":"fora da vitrine"}</p>
  {can("marketplace:read")&&<><p className="mt-2 text-sm">Mercado Livre: {data?.listings.length?"":"não publicado"}</p>
   {error&&<p className="text-sm text-destructive">{marketplaceMessage(error)}</p>}
   {data?.listings.map(l=><div key={l.id} className="mt-2 break-words text-sm"><strong>{l.status}</strong> · {l.syncStatus} · {formatCurrencyCents(l.externalPrice??0)} · {l.externalQuantity??0} un.
    {l.externalUrl&&<a className="ml-2 underline" href={l.externalUrl} target="_blank" rel="noreferrer">Ver anúncio</a>}</div>)}
   <Link className="mt-3 inline-block text-sm underline" href={"/workspaces/"+workspaceId+"/settings/marketplaces?productId="+productId}>Gerenciar canais e publicar</Link>
  </>}
 </section>;
}
