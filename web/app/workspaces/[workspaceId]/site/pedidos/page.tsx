"use client";
import {useEffect,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import useSWR from "swr";
import {toast} from "sonner";
import {ClipboardList,CreditCard,History,Package,Receipt,Truck} from "lucide-react";
import {useCurrentWorkspace} from "@/contexts/workspace-context";
import {useMyAccess} from "@/features/auth/access";
import {PageHeader} from "@/components/PageHeader";
import {Card,CardBody} from "@/components/Card";
import {Button} from "@/components/Button";
import {Input,Label} from "@/components/Field";
import {DetailModal} from "@/components/DetailModal";
import {ConfirmDialog} from "@/components/ConfirmDialog";
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from "@/components/ui/tooltip";
import {useDebounce} from "@/hooks/useDebounce";
import {formatCurrencyCents,formatDateTime} from "@/lib/format";
import {advanceCommerceOrder,cancelCommerceOrder,CANCEL_REASON_LABELS,getCommerceOrder,listCommerceOrders,ORDER_EVENT_LABELS,ORDER_STATUS_LABELS,PAYMENT_STATUS_LABELS,SHIPPING_STATUS_LABELS,simulateOrderPayment,type CommerceOrder,type OrderStatus,type OrderFilter} from "@/features/commerce/api";

/** Vorix Commerce, Fase 2 — Central de pedidos da loja online. */
const PAGE_SIZE=25;
const TONE:Record<OrderStatus,string>={PENDING:"bg-muted text-muted-foreground",AWAITING_PAYMENT:"bg-amber-500/15 text-amber-700 dark:text-amber-300",PAID:"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",CONFIRMED:"bg-sky-500/15 text-sky-700 dark:text-sky-300",PROCESSING:"bg-sky-500/15 text-sky-700 dark:text-sky-300",SHIPPED:"bg-violet-500/15 text-violet-700 dark:text-violet-300",DELIVERED:"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",CANCELLED:"bg-rose-500/15 text-rose-700 dark:text-rose-300"};
const Badge=({status}:{status:OrderStatus})=><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[status]}`}>{ORDER_STATUS_LABELS[status]}</span>;
const SOURCE_LABELS:Record<string,string>={SITE:"Site",MANUAL:"Manual",MERCADO_LIVRE:"Mercado Livre",SHOPEE:"Shopee",TIKTOK_SHOP:"TikTok Shop"};
const PERIODS={"":"Todo o período","7":"Últimos 7 dias","30":"Últimos 30 dias","90":"Últimos 90 dias"} as const;

export default function OrdersPage(){
 const workspace=useCurrentWorkspace(),{can}=useMyAccess(),router=useRouter(),params=useSearchParams();
 const [status,setStatus]=useState<OrderStatus|"">(""),[payment,setPayment]=useState(""),[shipping,setShipping]=useState(""),[period,setPeriod]=useState<keyof typeof PERIODS>(""),[search,setSearch]=useState(""),[offset,setOffset]=useState(0);
 const term=useDebounce(search.trim(),300);
 useEffect(()=>setOffset(0),[status,payment,shipping,period,term]);
 const filter:OrderFilter={limit:PAGE_SIZE,offset,...(status?{status}:{}),...(payment?{paymentStatus:payment as OrderFilter["paymentStatus"]}:{}),...(shipping?{shippingStatus:shipping as OrderFilter["shippingStatus"]}:{}),...(term?{search:term}:{}),...(period?{from:new Date(Date.now()-Number(period)*86400000).toISOString()}:{})};
 const {data,error,isLoading,mutate}=useSWR(can("order:read")?["commerce-orders",workspace.id,JSON.stringify(filter)]:null,()=>listCommerceOrders(workspace.id,filter));
 const openId=params.get("pedido")??undefined;
 const open=(id?:string)=>router.replace(id?`?pedido=${encodeURIComponent(id)}`:"?",{scroll:false});
 if(!can("order:read"))return <><PageHeader title="Pedidos"/><Card><CardBody className="text-sm text-muted-foreground">Seu perfil não tem acesso aos pedidos da loja. Peça a um administrador.</CardBody></Card></>;
 const select=(id:string,label:string,value:string,onChange:(value:string)=>void,options:Record<string,string>)=><div className="min-w-0"><Label htmlFor={id}>{label}</Label><select id={id} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={value} onChange={event=>onChange(event.target.value)}>{Object.entries(options).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></div>;
 return <div className="space-y-5">
  <PageHeader title="Pedidos" description="Compras feitas pela loja online: pagamento, entrega e histórico de cada pedido."/>
  <Card><CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
   <div className="min-w-0 sm:col-span-2 lg:col-span-1"><Label htmlFor="orders-search">Buscar</Label><Input id="orders-search" value={search} placeholder="Nº do pedido, nome ou e-mail" onChange={event=>setSearch(event.target.value)}/></div>
   {select("orders-status","Status",status,value=>setStatus(value as OrderStatus|""),{"":"Todos",...ORDER_STATUS_LABELS})}
   {select("orders-payment","Pagamento",payment,setPayment,{"":"Todos",...PAYMENT_STATUS_LABELS})}
   {select("orders-shipping","Entrega",shipping,setShipping,{"":"Todas",...SHIPPING_STATUS_LABELS})}
   {select("orders-period","Período",period,value=>setPeriod(value as keyof typeof PERIODS),PERIODS)}
  </CardBody></Card>
  <Card><CardBody className="p-0">
   {error?<div className="space-y-2 p-5 text-sm"><p>Não foi possível carregar os pedidos.</p><Button variant="secondary" size="sm" onClick={()=>void mutate()}>Tentar novamente</Button></div>
   :isLoading&&!data?<p className="p-5 text-sm text-muted-foreground">Carregando pedidos...</p>
   :!data?.orders.length?<div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground"><Receipt size={28} aria-hidden="true"/><p>{term||status||payment||shipping||period?"Nenhum pedido com esses filtros.":"Ainda não há pedidos. Eles aparecem aqui assim que alguém comprar pelo site."}</p></div>
   :<>
    <table className="hidden w-full text-sm md:table"><thead className="border-b border-border/60 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Pedido</th><th className="px-4 py-3 font-medium">Cliente</th><th className="px-4 py-3 font-medium">Data</th><th className="px-4 py-3 font-medium">Origem</th><th className="px-4 py-3 text-right font-medium">Valor</th><th className="px-4 py-3 font-medium">Pagamento</th><th className="px-4 py-3 font-medium">Entrega</th><th className="px-4 py-3 font-medium">Status</th></tr></thead>
     <tbody>{data.orders.map(order=><tr key={order.id} className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40" onClick={()=>open(order.id)}><td className="px-4 py-3"><button type="button" className="font-medium tabular-nums underline-offset-2 hover:underline" onClick={event=>{event.stopPropagation();open(order.id);}}>#{order.number}</button></td><td className="max-w-[220px] truncate px-4 py-3">{order.customer.name}</td><td className="px-4 py-3 text-muted-foreground">{formatDateTime(order.createdAt)}</td><td className="px-4 py-3">{SOURCE_LABELS[order.source]??order.source}</td><td className="px-4 py-3 text-right tabular-nums">{formatCurrencyCents(order.totalCents,order.currency)}</td><td className="px-4 py-3">{PAYMENT_STATUS_LABELS[order.paymentStatus]}</td><td className="px-4 py-3">{SHIPPING_STATUS_LABELS[order.shippingStatus]}</td><td className="px-4 py-3"><Badge status={order.status}/></td></tr>)}</tbody></table>
    <ul className="divide-y divide-border/60 md:hidden">{data.orders.map(order=><li key={order.id}><button type="button" className="flex w-full flex-col gap-1 px-4 py-3 text-left" onClick={()=>open(order.id)}><span className="flex items-center justify-between gap-2"><span className="font-medium tabular-nums">#{order.number}</span><Badge status={order.status}/></span><span className="truncate text-sm">{order.customer.name}</span><span className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{formatDateTime(order.createdAt)} · {PAYMENT_STATUS_LABELS[order.paymentStatus]}</span><span className="tabular-nums text-foreground">{formatCurrencyCents(order.totalCents,order.currency)}</span></span></button></li>)}</ul>
    <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground"><span className="tabular-nums">{offset+1}–{Math.min(offset+PAGE_SIZE,data.total)} de {data.total}</span><span className="flex gap-2"><Button size="sm" variant="secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-PAGE_SIZE))}>Anteriores</Button><Button size="sm" variant="secondary" disabled={offset+PAGE_SIZE>=data.total} onClick={()=>setOffset(offset+PAGE_SIZE)}>Próximos</Button></span></div>
   </>}
  </CardBody></Card>
  {openId?<OrderDetail workspaceId={workspace.id} id={openId} canManage={can("order:manage")} onClose={()=>open()} onChanged={()=>void mutate()}/>:null}
 </div>;
}

const NEXT_STEP:Partial<Record<OrderStatus,{to:OrderStatus;label:string}>>={PAID:{to:"PROCESSING",label:"Iniciar preparação"},CONFIRMED:{to:"PROCESSING",label:"Iniciar preparação"}};
function OrderDetail({workspaceId,id,canManage,onClose,onChanged}:{workspaceId:string;id:string;canManage:boolean;onClose:()=>void;onChanged:()=>void}){
 const {data,error,mutate}=useSWR(["commerce-order",workspaceId,id],()=>getCommerceOrder(workspaceId,id));
 const [section,setSection]=useState("resumo"),[busy,setBusy]=useState(false),[confirmCancel,setConfirmCancel]=useState(false),[restock,setRestock]=useState(true),[tracking,setTracking]=useState("");
 const order=data?.order;
 async function run(action:()=>Promise<unknown>,success:string){setBusy(true);try{await action();toast.success(success);await mutate();onChanged();}catch(caught){toast.error(caught instanceof Error?caught.message:"Não foi possível concluir.");}finally{setBusy(false);}}
 const pickup=order?.delivery.kind==="PICKUP";
 const next=order?(order.status==="PROCESSING"?(pickup?{to:"DELIVERED" as const,label:"Marcar como retirado"}:{to:"SHIPPED" as const,label:"Marcar como enviado"}):order.status==="SHIPPED"?{to:"DELIVERED" as const,label:"Marcar como entregue"}:NEXT_STEP[order.status]):undefined;
 const sandbox=data?.payments.at(-1)?.provider==="SANDBOX";
 const cancellable=order&&["PENDING","AWAITING_PAYMENT","PAID","CONFIRMED","PROCESSING"].includes(order.status);
 const blocked=(reason:string,button:React.ReactNode)=>canManage?button:<TooltipProvider><Tooltip><TooltipTrigger asChild><span>{button}</span></TooltipTrigger><TooltipContent>{reason}</TooltipContent></Tooltip></TooltipProvider>;
 const footer=order?<div className="flex flex-wrap items-center gap-2">
  {sandbox&&order.status==="AWAITING_PAYMENT"?<>{blocked("Sem permissão para operar pedidos.",<Button size="sm" variant="secondary" disabled={!canManage||busy} onClick={()=>void run(()=>simulateOrderPayment(workspaceId,order.id,"APPROVED"),"Pagamento de teste aprovado.")}>Simular pagamento aprovado</Button>)}{blocked("Sem permissão para operar pedidos.",<Button size="sm" variant="ghost" disabled={!canManage||busy} onClick={()=>void run(()=>simulateOrderPayment(workspaceId,order.id,"FAILED"),"Pagamento de teste recusado.")}>Simular recusa</Button>)}</>:null}
  {next?<>{next.to==="SHIPPED"?<Input aria-label="Código de rastreio (opcional)" className="h-9 w-48" placeholder="Rastreio (opcional)" value={tracking} onChange={event=>setTracking(event.target.value)}/>:null}{blocked("Sem permissão para operar pedidos.",<Button size="sm" disabled={!canManage||busy} onClick={()=>void run(()=>advanceCommerceOrder(workspaceId,order.id,next.to,tracking||undefined),`Pedido: ${ORDER_STATUS_LABELS[next.to]}.`)}>{next.label}</Button>)}</>:null}
  {cancellable?blocked("Sem permissão para operar pedidos.",<Button size="sm" variant="danger" disabled={!canManage||busy} onClick={()=>setConfirmCancel(true)}>Cancelar pedido</Button>):null}
 </div>:undefined;
 return <>
  <DetailModal open onOpenChange={value=>{if(!value)onClose();}} title={order?`Pedido #${order.number}`:"Pedido"} eyebrow="Loja online" description={order?`${order.customer.name} · ${formatDateTime(order.createdAt)}`:undefined}
   headerExtra={order?<Badge status={order.status}/>:undefined} widthStorageKey="commerce-order-detail" defaultWidthPercent={60}
   sections={[{value:"resumo",label:"Resumo",icon:ClipboardList},{value:"itens",label:"Itens",icon:Package},{value:"pagamento",label:"Pagamento",icon:CreditCard},{value:"entrega",label:"Entrega",icon:Truck},{value:"historico",label:"Histórico",icon:History}]}
   value={section} onValueChange={setSection} footer={footer}>
   {error?<div className="space-y-2 text-sm"><p>Não foi possível carregar o pedido.</p><Button size="sm" variant="secondary" onClick={()=>void mutate()}>Tentar novamente</Button></div>:!order?<p className="text-sm text-muted-foreground">Carregando...</p>:<OrderSection order={order} section={section} payments={data!.payments} events={data!.events}/>}
  </DetailModal>
  {confirmCancel&&order?<ConfirmDialog open variant="danger" title={`Cancelar o pedido #${order.number}?`} description={`${order.paymentStatus==="APPROVED"?"O pagamento será estornado ao cliente. ":""}${order.stockState==="RESERVED"?"A reserva volta para o estoque. ":""}Esta ação não pode ser desfeita.`} confirmLabel="Cancelar pedido" busy={busy}
   onCancel={()=>setConfirmCancel(false)} onConfirm={()=>{setConfirmCancel(false);void run(()=>cancelCommerceOrder(workspaceId,order.id,{restock}),"Pedido cancelado.");}}>
   {order.stockState==="SOLD"?<label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={restock} onChange={event=>setRestock(event.target.checked)}/>Devolver os itens ao estoque (ainda não saíram da loja)</label>:null}
  </ConfirmDialog>:null}
 </>;
}

function OrderSection({order,section,payments,events}:{order:CommerceOrder;section:string;payments:Awaited<ReturnType<typeof getCommerceOrder>>["payments"];events:Awaited<ReturnType<typeof getCommerceOrder>>["events"]}){
 const money=(cents:number)=>formatCurrencyCents(cents,order.currency);
 const row=(label:React.ReactNode,value:React.ReactNode)=><div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="text-right">{value}</dd></div>;
 if(section==="itens")return <ul className="divide-y divide-border/60">{order.items.map(item=><li key={item.id} className="flex items-center gap-3 py-3"><span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">{item.imageUrl?<img src={item.imageUrl} alt="" className="h-full w-full object-cover"/>:<Package size={18} aria-hidden="true"/>}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{[item.variantLabel,item.sku?`SKU ${item.sku}`:undefined].filter(Boolean).join(" · ")||"—"}</span></span><span className="text-right text-sm tabular-nums"><span className="block">{item.quantity} × {money(item.unitPriceCents)}</span><span className="block font-medium">{money(item.totalCents)}</span></span></li>)}</ul>;
 if(section==="pagamento")return <div className="space-y-4">{payments.length?payments.map(payment=><dl key={payment.id} className="rounded-lg border border-border/60 p-3">{row("Forma",payment.instructions.sandbox?"Teste (sem cobrança)":payment.method==="PIX"?"PIX":"Cartão")}{row("Provedor",payment.provider==="MERCADO_PAGO"?"Mercado Pago":payment.provider==="SANDBOX"?"Modo de teste":payment.provider)}{row("Status",PAYMENT_STATUS_LABELS[payment.status])}{row("Valor",<span className="tabular-nums">{money(payment.amountCents)}</span>)}{payment.providerPaymentId&&!payment.instructions.sandbox?row("ID no provedor",<span className="font-mono text-xs">{payment.providerPaymentId}</span>):null}{payment.approvedAt?row("Aprovado em",formatDateTime(payment.approvedAt)):null}{payment.refundedAt?row("Estornado em",formatDateTime(payment.refundedAt)):null}{payment.failureReason?row("Motivo",payment.failureReason):null}</dl>):<p className="text-sm text-muted-foreground">Nenhum pagamento iniciado.</p>}</div>;
 if(section==="entrega")return <dl>{row("Forma",order.delivery.label)}{row("Status",SHIPPING_STATUS_LABELS[order.shippingStatus])}{row("Frete",order.shippingCents?money(order.shippingCents):"Grátis")}{order.delivery.days!==undefined?row("Prazo informado",`${order.delivery.days} dia(s)`):null}{order.shippingAddress?row("Endereço",<span>{order.shippingAddress.street}, {order.shippingAddress.number}{order.shippingAddress.complement?` — ${order.shippingAddress.complement}`:""}<br/>{order.shippingAddress.district} · {order.shippingAddress.city}/{order.shippingAddress.state}<br/>CEP {order.shippingAddress.postalCode.replace(/(\d{5})(\d{3})/,"$1-$2")}</span>):row("Endereço","Retirada no local")}{events.filter(event=>typeof event.data.trackingCode==="string").map(event=><div key={event.id}>{row("Rastreio",String(event.data.trackingCode))}</div>)}</dl>;
 if(section==="historico")return <ol className="space-y-3 border-l border-border/60 pl-4">{events.map(event=><li key={event.id} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true"/><span className="font-medium">{ORDER_EVENT_LABELS[event.type]??event.type}{event.toStatus&&event.type==="status_changed"?`: ${ORDER_STATUS_LABELS[event.toStatus as OrderStatus]??event.toStatus}`:""}</span><span className="block text-xs text-muted-foreground">{formatDateTime(event.createdAt)} · {event.actorType==="user"?"Equipe":event.actorType==="customer"?"Cliente":event.actorType==="provider"?"Provedor de pagamento":"Sistema"}{typeof event.data.reason==="string"?` · ${CANCEL_REASON_LABELS[event.data.reason]??event.data.reason}`:""}</span></li>)}</ol>;
 return <div className="grid gap-5 md:grid-cols-2">
  <dl><h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Cliente</h3>{row("Nome",order.customer.name)}{row("E-mail",order.customer.email)}{row("Telefone",order.customer.phone)}{order.customer.document?row("CPF/CNPJ",order.customer.document.replace(/^(\d{3})\d{5}(\d{3})$/,"$1.•••.•••-$2")):null}{order.contactId?row("CRM","Contato vinculado"):null}</dl>
  <dl><h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Valores</h3>{row("Subtotal",<span className="tabular-nums">{money(order.subtotalCents)}</span>)}{order.discountCents?row("Desconto",<span className="tabular-nums">−{money(order.discountCents)}</span>):null}{row("Frete",<span className="tabular-nums">{order.shippingCents?money(order.shippingCents):"Grátis"}</span>)}{row(<strong>Total</strong>,<strong className="tabular-nums">{money(order.totalCents)}</strong>)}{row("Pagamento",PAYMENT_STATUS_LABELS[order.paymentStatus])}{row("Entrega",SHIPPING_STATUS_LABELS[order.shippingStatus])}{order.cancelReason?row("Cancelamento",CANCEL_REASON_LABELS[order.cancelReason]??order.cancelReason):null}{order.utm.source?row("Campanha",[order.utm.source,order.utm.campaign].filter(Boolean).join(" / ")):null}</dl>
 </div>;
}
