"use client";
import useSWR from "swr";
import {Button} from "@/components/Button";
import {formatCurrencyCents} from "@/lib/format";
import {getChannelAnalytics} from "@/features/commerce/api";
import {channelShare,SOURCE_BAR,sourceLabel,type ChannelRow} from "@/features/commerce/multichannel";

const n=(value:number)=>value.toLocaleString("pt-BR");
const money=(cents:number)=>formatCurrencyCents(cents);

/** "Vendas por canal" — receita, ticket, reembolsos, cancelamentos e devoluções por origem do pedido. */
export function ChannelSalesBlock({workspaceId,from,to,cacheKey}:{workspaceId:string;from:string;to:string;cacheKey:string}){
 const {data,error,isLoading,mutate}=useSWR(["commerce-channel-analytics",cacheKey,workspaceId,from,to],()=>getChannelAnalytics(workspaceId,from,to),{revalidateOnFocus:false});
 const rows=data?.channels??[];
 return <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4" aria-labelledby="channel-sales-title">
  <div><h2 id="channel-sales-title" className="font-semibold">Vendas por canal</h2><p className="mt-1 text-xs text-muted-foreground">Pedidos do site e dos marketplaces no mesmo período. A receita é bruta; reembolsos aparecem em coluna própria.</p></div>
  {isLoading&&!data?<p role="status" className="text-sm text-muted-foreground">Carregando vendas por canal…</p>:null}
  {error?<div className="space-y-2 text-sm"><p>Não foi possível carregar as vendas por canal.</p><Button size="sm" variant="secondary" onClick={()=>void mutate()}>Tentar novamente</Button></div>:null}
  {data&&!rows.length?<p className="text-sm text-muted-foreground">Nenhum pedido no período.</p>:null}
  {rows.length?<>
   <ol className="space-y-3" aria-label="Receita por canal">{rows.map(row=><li key={row.source} className="space-y-1">
    <div className="flex justify-between gap-2 text-sm"><span>{sourceLabel(row.source)}</span><strong className="tabular-nums">{money(row.revenueCents)}</strong></div>
    <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation"><div className={`h-full rounded-full ${SOURCE_BAR[row.source]??"bg-primary"}`} style={{width:`${channelShare(rows,row)}%`}}/></div>
   </li>)}</ol>
   <div className="hidden min-w-0 overflow-x-auto md:block">
    <table className="w-full text-sm"><caption className="sr-only">Vendas por canal no período</caption>
     <thead className="border-b text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-2 pr-3 font-medium">Canal</th>{["Pedidos","Vendas","Receita","Ticket médio","Reembolsos","Cancelamentos","Devoluções"].map(label=><th key={label} scope="col" className="px-2 py-2 text-right font-medium">{label}</th>)}</tr></thead>
     <tbody>{rows.map(row=><Row key={row.source} label={sourceLabel(row.source)} row={row}/>)}</tbody>
     {data?.totals?<tfoot className="border-t font-medium"><Row label="Total" row={{source:"TOTAL",...data.totals}}/></tfoot>:null}
    </table>
   </div>
   <ul className="grid gap-2 md:hidden" aria-label="Detalhes por canal">{[...rows,...(data?.totals?[{source:"TOTAL",...data.totals}]:[])].map(row=><li key={row.source} className="min-w-0 rounded-lg border p-3">
    <p className="text-sm font-semibold">{row.source==="TOTAL"?"Total":sourceLabel(row.source)}</p>
    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">{([["Pedidos",n(row.orders)],["Vendas",n(row.sales)],["Receita",money(row.revenueCents)],["Ticket médio",money(row.averageTicketCents)],["Reembolsos",money(row.refundsCents)],["Cancelamentos",n(row.cancellations)],["Devoluções",n(row.returns)]] as const).map(([label,value])=><div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium tabular-nums">{value}</dd></div>)}</dl>
   </li>)}</ul>
  </>:null}
 </section>;
}
function Row({label,row}:{label:string;row:ChannelRow}){
 const cell="px-2 py-2 text-right tabular-nums";
 return <tr className="border-b border-border/40 last:border-0"><th scope="row" className="py-2 pr-3 text-left font-medium">{label}</th><td className={cell}>{n(row.orders)}</td><td className={cell}>{n(row.sales)}</td><td className={cell}>{money(row.revenueCents)}</td><td className={cell}>{money(row.averageTicketCents)}</td><td className={cell}>{money(row.refundsCents)}</td><td className={cell}>{n(row.cancellations)}</td><td className={cell}>{n(row.returns)}</td></tr>;
}
