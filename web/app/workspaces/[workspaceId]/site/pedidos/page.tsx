"use client";
import {useEffect,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import useSWR from "swr";
import {Receipt} from "lucide-react";
import {useCurrentWorkspace} from "@/contexts/workspace-context";
import {useMyAccess} from "@/features/auth/access";
import {PageHeader} from "@/components/PageHeader";
import {Card,CardBody} from "@/components/Card";
import {Button} from "@/components/Button";
import {Input,Label} from "@/components/Field";
import {useDebounce} from "@/hooks/useDebounce";
import {formatCurrencyCents,formatDateTime} from "@/lib/format";
import {listCommerceOrders,ORDER_STATUS_LABELS,PAYMENT_STATUS_LABELS,SHIPPING_STATUS_LABELS,type OrderStatus,type OrderFilter} from "@/features/commerce/api";
import {ChannelFilter,SourceBadge,StockConflictBadge} from "@/components/commerce/commerce-ui";
import {OrderDetail,OrderStatusBadge as Badge} from "@/components/commerce/OrderDetail";

/** Vorix Commerce — Central de pedidos multicanal (site + marketplaces). */
const PAGE_SIZE=25;
const PERIODS={"":"Todo o período","7":"Últimos 7 dias","30":"Últimos 30 dias","90":"Últimos 90 dias"} as const;

export default function OrdersPage(){
 const workspace=useCurrentWorkspace(),{can}=useMyAccess(),router=useRouter(),params=useSearchParams();
 const [source,setSource]=useState(""),[status,setStatus]=useState<OrderStatus|"">(""),[payment,setPayment]=useState(""),[shipping,setShipping]=useState(""),[period,setPeriod]=useState<keyof typeof PERIODS>(""),[search,setSearch]=useState(""),[offset,setOffset]=useState(0);
 const term=useDebounce(search.trim(),300);
 useEffect(()=>setOffset(0),[source,status,payment,shipping,period,term]);
 const filter:OrderFilter={limit:PAGE_SIZE,offset,...(source?{source}:{}),...(status?{status}:{}),...(payment?{paymentStatus:payment as OrderFilter["paymentStatus"]}:{}),...(shipping?{shippingStatus:shipping as OrderFilter["shippingStatus"]}:{}),...(term?{search:term}:{}),...(period?{from:new Date(Date.now()-Number(period)*86400000).toISOString()}:{})};
 const {data,error,isLoading,mutate}=useSWR(can("order:read")?["commerce-orders",workspace.id,JSON.stringify(filter)]:null,()=>listCommerceOrders(workspace.id,filter));
 const openId=params.get("pedido")??undefined;
 const open=(id?:string)=>router.replace(id?`?pedido=${encodeURIComponent(id)}`:"?",{scroll:false});
 if(!can("order:read"))return <><PageHeader title="Pedidos"/><Card><CardBody className="text-sm text-muted-foreground">Seu perfil não tem acesso aos pedidos da loja. Peça a um administrador.</CardBody></Card></>;
 const select=(id:string,label:string,value:string,onChange:(value:string)=>void,options:Record<string,string>)=><div className="min-w-0"><Label htmlFor={id}>{label}</Label><select id={id} className="mt-1 h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm" value={value} onChange={event=>onChange(event.target.value)}>{Object.entries(options).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></div>;
 const filtered=!!(term||status||payment||shipping||period||source);
 return <div className="min-w-0 space-y-5">
  <PageHeader title="Pedidos" description="Compras do site e dos marketplaces em um só lugar: pagamento, entrega, devoluções e histórico de cada pedido."/>
  <Card><CardBody className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
   <div className="min-w-0 sm:col-span-2 lg:col-span-5"><ChannelFilter value={source} onChange={setSource}/></div>
   <div className="min-w-0 sm:col-span-2 lg:col-span-1"><Label htmlFor="orders-search">Buscar</Label><Input id="orders-search" value={search} placeholder="Nº do pedido, nome ou e-mail" onChange={event=>setSearch(event.target.value)}/></div>
   {select("orders-status","Status",status,value=>setStatus(value as OrderStatus|""),{"":"Todos",...ORDER_STATUS_LABELS})}
   {select("orders-payment","Pagamento",payment,setPayment,{"":"Todos",...PAYMENT_STATUS_LABELS})}
   {select("orders-shipping","Entrega",shipping,setShipping,{"":"Todas",...SHIPPING_STATUS_LABELS})}
   {select("orders-period","Período",period,value=>setPeriod(value as keyof typeof PERIODS),PERIODS)}
  </CardBody></Card>
  <Card><CardBody className="min-w-0 p-0">
   {error?<div className="space-y-2 p-5 text-sm"><p>Não foi possível carregar os pedidos.</p><Button variant="secondary" size="sm" onClick={()=>void mutate()}>Tentar novamente</Button></div>
   :isLoading&&!data?<p className="p-5 text-sm text-muted-foreground">Carregando pedidos...</p>
   :!data?.orders.length?<div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground"><Receipt size={28} aria-hidden="true"/><p>{filtered?"Nenhum pedido com esses filtros.":"Ainda não há pedidos. Eles aparecem aqui assim que alguém comprar pelo site ou por um marketplace conectado."}</p></div>
   :<>
    <div className="hidden min-w-0 overflow-x-auto lg:block"><table className="w-full text-sm" aria-label="Pedidos"><thead className="border-b border-border/60 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Pedido</th><th className="px-4 py-3 font-medium">Cliente</th><th className="px-4 py-3 font-medium">Data</th><th className="px-4 py-3 font-medium">Canal</th><th className="px-4 py-3 text-right font-medium">Valor</th><th className="px-4 py-3 font-medium">Pagamento</th><th className="px-4 py-3 font-medium">Entrega</th><th className="px-4 py-3 font-medium">Status</th></tr></thead>
     <tbody>{data.orders.map(order=><tr key={order.id} className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40" onClick={()=>open(order.id)}><td className="px-4 py-3"><button type="button" className="font-medium tabular-nums underline-offset-2 hover:underline" onClick={event=>{event.stopPropagation();open(order.id);}}>#{order.number}</button></td><td className="max-w-[200px] truncate px-4 py-3">{order.customer.name}</td><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(order.createdAt)}</td><td className="px-4 py-3"><SourceBadge source={order.source}/>{order.externalOrderId?<span className="mt-0.5 block max-w-[160px] truncate font-mono text-[11px] text-muted-foreground" title={order.externalOrderId}>{order.externalOrderId}</span>:null}</td><td className="px-4 py-3 text-right tabular-nums">{formatCurrencyCents(order.totalCents,order.currency)}</td><td className="px-4 py-3">{PAYMENT_STATUS_LABELS[order.paymentStatus]??order.paymentStatus}</td><td className="px-4 py-3">{SHIPPING_STATUS_LABELS[order.shippingStatus]??order.shippingStatus}</td><td className="px-4 py-3"><span className="flex flex-col items-start gap-1"><Badge status={order.status}/>{order.stockState==="CONFLICT"?<StockConflictBadge/>:null}</span></td></tr>)}</tbody></table></div>
    <ul className="divide-y divide-border/60 lg:hidden" aria-label="Pedidos">{data.orders.map(order=><li key={order.id}><button type="button" className="flex w-full min-w-0 flex-col gap-1 px-4 py-3 text-left" onClick={()=>open(order.id)}><span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><span className="font-medium tabular-nums">#{order.number}</span><SourceBadge source={order.source}/></span><Badge status={order.status}/></span><span className="truncate text-sm">{order.customer.name}</span>{order.externalOrderId?<span className="truncate font-mono text-[11px] text-muted-foreground">Pedido no canal: {order.externalOrderId}</span>:null}{order.stockState==="CONFLICT"?<span><StockConflictBadge/></span>:null}<span className="flex justify-between gap-2 text-xs text-muted-foreground"><span className="min-w-0 truncate">{formatDateTime(order.createdAt)} · {PAYMENT_STATUS_LABELS[order.paymentStatus]??order.paymentStatus}</span><span className="tabular-nums text-foreground">{formatCurrencyCents(order.totalCents,order.currency)}</span></span></button></li>)}</ul>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground"><span className="tabular-nums">{offset+1}–{Math.min(offset+PAGE_SIZE,data.total)} de {data.total}</span><span className="flex gap-2"><Button size="sm" variant="secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-PAGE_SIZE))}>Anteriores</Button><Button size="sm" variant="secondary" disabled={offset+PAGE_SIZE>=data.total} onClick={()=>setOffset(offset+PAGE_SIZE)}>Próximos</Button></span></div>
   </>}
  </CardBody></Card>
  {openId?<OrderDetail workspaceId={workspace.id} id={openId} onClose={()=>open()} onChanged={()=>void mutate()}/>:null}
 </div>;
}
