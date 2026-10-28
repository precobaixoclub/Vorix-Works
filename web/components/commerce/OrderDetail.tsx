"use client";
import {useState} from "react";
import useSWR from "swr";
import {toast} from "sonner";
import {ClipboardList,CreditCard,History,Package,RefreshCw,Truck,Undo2} from "lucide-react";
import {useMyAccess} from "@/features/auth/access";
import {Button} from "@/components/Button";
import {Input} from "@/components/Field";
import {DetailModal} from "@/components/DetailModal";
import {ConfirmDialog} from "@/components/ConfirmDialog";
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from "@/components/ui/tooltip";
import {formatCurrencyCents,formatDateTime} from "@/lib/format";
import {advanceCommerceOrder,cancelCommerceOrder,CANCEL_REASON_LABELS,getCommerceOrder,ORDER_EVENT_LABELS,ORDER_STATUS_LABELS,PAYMENT_STATUS_LABELS,getCancelReasons,refreshCommerceOrder,SHIPPING_STATUS_LABELS,simulateOrderPayment,type CommerceOrderDetail,type OrderStatus} from "@/features/commerce/api";
import {isMarketplaceSource,sourceLabel,STOCK_STATE_LABELS} from "@/features/commerce/multichannel";
import {commerceErrorMessage,SourceBadge,StockConflictBadge} from "./commerce-ui";
import {OrderShipments} from "./OrderShipments";
import {OrderReturns} from "./OrderReturns";

const TONE:Record<OrderStatus,string>={PENDING:"bg-muted text-muted-foreground",AWAITING_PAYMENT:"bg-amber-500/15 text-amber-700 dark:text-amber-300",PAID:"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",CONFIRMED:"bg-sky-500/15 text-sky-700 dark:text-sky-300",PROCESSING:"bg-sky-500/15 text-sky-700 dark:text-sky-300",SHIPPED:"bg-violet-500/15 text-violet-700 dark:text-violet-300",DELIVERED:"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",CANCELLED:"bg-rose-500/15 text-rose-700 dark:text-rose-300"};
export const OrderStatusBadge=({status}:{status:OrderStatus})=><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[status]??TONE.PENDING}`}>{ORDER_STATUS_LABELS[status]??status}</span>;

const NEXT_STEP:Partial<Record<OrderStatus,{to:OrderStatus;label:string}>>={PAID:{to:"PROCESSING",label:"Iniciar preparação"},CONFIRMED:{to:"PROCESSING",label:"Iniciar preparação"}};
const CANCELLABLE:readonly OrderStatus[]=["PENDING","AWAITING_PAYMENT","PAID","CONFIRMED","PROCESSING"];

/** Detalhe do pedido (site ou marketplace) — canal, envios, devoluções e ações gateadas pelo servidor. */
export function OrderDetail({workspaceId,id,onClose,onChanged}:{workspaceId:string;id:string;onClose:()=>void;onChanged:()=>void}){
 const {can}=useMyAccess();
 const canManage=can("order:manage");
 const {data,error,mutate}=useSWR(["commerce-order",workspaceId,id],()=>getCommerceOrder(workspaceId,id));
 const [section,setSection]=useState("resumo"),[busy,setBusy]=useState(false),[confirmCancel,setConfirmCancel]=useState(false),[restock,setRestock]=useState(true),[tracking,setTracking]=useState(""),[cancelCode,setCancelCode]=useState("");
 const order=data?.order,actions=data?.actions,marketplace=!!order&&isMarketplaceSource(order.source);
 async function run(action:()=>Promise<unknown>,success:string){setBusy(true);try{await action();toast.success(success);await mutate();onChanged();}catch(caught){toast.error(commerceErrorMessage(caught));}finally{setBusy(false);}}
 // Motivo oficial do canal (Shopee/TikTok só aceitam códigos próprios); buscado ao abrir a confirmação.
 const reasons=useSWR(confirmCancel&&marketplace?["commerce-cancel-reasons",workspaceId,id]:null,()=>getCancelReasons(workspaceId,id));
 const reasonList=reasons.data?.reasons??[],needsReason=marketplace&&reasonList.length>0;
 const pickup=order?.delivery?.kind==="PICKUP";
 const next=order&&!marketplace?(order.status==="PROCESSING"?(pickup?{to:"DELIVERED" as const,label:"Marcar como retirado"}:{to:"SHIPPED" as const,label:"Marcar como enviado"}):order.status==="SHIPPED"?{to:"DELIVERED" as const,label:"Marcar como entregue"}:NEXT_STEP[order.status]):undefined;
 const sandbox=data?.payments.at(-1)?.provider==="SANDBOX";
 // Cancelar exige `order:cancel`; pedido do site já pago também estorna, então exige `payment:refund`.
 const paidSite=!!order&&!marketplace&&order.paymentStatus==="APPROVED";
 const cancelPermission=can("order:cancel")&&(!paidSite||can("payment:refund"));
 const cancellable=!!order&&CANCELLABLE.includes(order.status);
 const cancelReason=!order?"":actions&&!actions.canCancel?(actions.cancelBlockedReason||"Este pedido não pode ser cancelado agora."):!cancelPermission?(paidSite?"Cancelar um pedido pago estorna o pagamento: exige permissão de cancelar pedidos e de reembolsar.":"Sem permissão para cancelar pedidos."):"";
 const blocked=(reason:string,button:React.ReactNode)=>!reason?button:<TooltipProvider><Tooltip><TooltipTrigger asChild><span tabIndex={0} aria-label={reason}>{button}</span></TooltipTrigger><TooltipContent>{reason}</TooltipContent></Tooltip></TooltipProvider>;
 const noPermission=canManage?"":"Sem permissão para operar pedidos.";
 const footer=order?<div className="flex min-w-0 flex-wrap items-center gap-2">
  {sandbox&&order.status==="AWAITING_PAYMENT"?<>{blocked(noPermission,<Button size="sm" variant="secondary" disabled={!canManage||busy} onClick={()=>void run(()=>simulateOrderPayment(workspaceId,order.id,"APPROVED"),"Pagamento de teste aprovado.")}>Simular pagamento aprovado</Button>)}{blocked(noPermission,<Button size="sm" variant="ghost" disabled={!canManage||busy} onClick={()=>void run(()=>simulateOrderPayment(workspaceId,order.id,"FAILED"),"Pagamento de teste recusado.")}>Simular recusa</Button>)}</>:null}
  {next?<>{next.to==="SHIPPED"?<Input aria-label="Código de rastreio (opcional)" className="h-9 w-48" placeholder="Rastreio (opcional)" value={tracking} onChange={event=>setTracking(event.target.value)}/>:null}{blocked(noPermission,<Button size="sm" disabled={!canManage||busy} onClick={()=>void run(()=>advanceCommerceOrder(workspaceId,order.id,next.to,tracking||undefined),`Pedido: ${ORDER_STATUS_LABELS[next.to]}.`)}>{next.label}</Button>)}</>:null}
  {marketplace&&actions?.canRefresh?blocked(noPermission,<Button size="sm" variant="secondary" disabled={!canManage||busy} onClick={()=>void run(()=>refreshCommerceOrder(workspaceId,order.id),`Pedido atualizado com o ${sourceLabel(order.source)}.`)}><RefreshCw size={14} aria-hidden="true"/>Atualizar do canal</Button>):null}
  {cancellable?blocked(cancelReason,<Button size="sm" variant="danger" disabled={!!cancelReason||busy} onClick={()=>setConfirmCancel(true)}>Cancelar pedido</Button>):null}
  {cancellable&&actions&&!actions.canCancel&&actions.cancelBlockedReason?<p role="note" className="w-full text-xs text-muted-foreground">{actions.cancelBlockedReason}</p>:null}
 </div>:undefined;
 const sections=[{value:"resumo",label:"Resumo",icon:ClipboardList},{value:"itens",label:"Itens",icon:Package},{value:"pagamento",label:"Pagamento",icon:CreditCard},{value:"entrega",label:"Entrega",icon:Truck},{value:"devolucoes",label:"Devoluções",icon:Undo2,...(data?.returns?.length?{badge:String(data.returns.length)}:{})},{value:"historico",label:"Histórico",icon:History}];
 return <>
  <DetailModal open onOpenChange={value=>{if(!value)onClose();}} title={order?`Pedido #${order.number}`:"Pedido"} eyebrow={order?(marketplace?sourceLabel(order.source):"Loja online"):"Pedido"} description={order?`${order.customer.name} · ${formatDateTime(order.createdAt)}`:undefined}
   headerExtra={order?<span className="flex flex-wrap items-center gap-1"><OrderStatusBadge status={order.status}/>{order.stockState==="CONFLICT"?<StockConflictBadge/>:null}</span>:undefined} widthStorageKey="commerce-order-detail" defaultWidthPercent={60}
   sections={sections} value={section} onValueChange={setSection} footer={footer}>
   {error?<div className="space-y-2 text-sm"><p>Não foi possível carregar o pedido.</p><Button size="sm" variant="secondary" onClick={()=>void mutate()}>Tentar novamente</Button></div>
   :!order||!data?<p className="text-sm text-muted-foreground">Carregando...</p>
   :section==="devolucoes"?<OrderReturns workspaceId={workspaceId} order={order} returns={data.returns??[]} actions={actions} canManage={canManage} canRefundPermission={can("payment:refund")} onChanged={async()=>{await mutate();onChanged();}}/>
   :<OrderSection workspaceId={workspaceId} detail={data} section={section}/>}
  </DetailModal>
  {confirmCancel&&order?<ConfirmDialog open variant="danger" title={`Cancelar o pedido #${order.number}?`} description={`${marketplace?`O cancelamento será enviado ao ${sourceLabel(order.source)}. `:""}${order.paymentStatus==="APPROVED"&&!marketplace?"O pagamento será estornado ao cliente. ":""}${order.stockState==="RESERVED"?"A reserva volta para o estoque. ":""}Esta ação não pode ser desfeita.`} confirmLabel="Cancelar pedido" busy={busy} confirmDisabled={marketplace&&(!needsReason||!cancelCode)}
   onCancel={()=>setConfirmCancel(false)} onConfirm={()=>{setConfirmCancel(false);void run(()=>cancelCommerceOrder(workspaceId,order.id,needsReason?{reason:cancelCode}:{restock}),"Pedido cancelado.");}}>
   {order.stockState==="SOLD"?<label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={restock} onChange={event=>setRestock(event.target.checked)}/>Devolver os itens ao estoque (ainda não saíram da loja)</label>:null}
   {marketplace?reasons.isLoading?<p className="mt-2 text-sm text-muted-foreground">Consultando motivos aceitos pelo canal...</p>
    :reasons.error?<p className="mt-2 text-sm text-destructive">{commerceErrorMessage(reasons.error)}</p>
    :needsReason?<label className="mt-2 grid gap-1 text-sm">Motivo enviado ao canal ({sourceLabel(order.source)})<select className="h-9 rounded-md border bg-background px-2" value={cancelCode} onChange={event=>setCancelCode(event.target.value)}><option value="">Selecione</option>{reasonList.map(reason=><option key={reason.code} value={reason.code}>{reason.label}</option>)}</select></label>
    :<p className="mt-2 text-sm text-muted-foreground">O {sourceLabel(order.source)} não aceita cancelar este pedido agora. Confira no painel do canal.</p>:null}
  </ConfirmDialog>:null}
 </>;
}

function OrderSection({workspaceId,detail,section}:{workspaceId:string;detail:CommerceOrderDetail;section:string}){
 const {order,payments,events}=detail;
 const money=(cents:number)=>formatCurrencyCents(cents,order.currency);
 const marketplace=isMarketplaceSource(order.source);
 const row=(label:React.ReactNode,value:React.ReactNode)=><div className="flex min-w-0 justify-between gap-4 py-1.5 text-sm"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-right">{value}</dd></div>;
 if(section==="itens")return <ul className="divide-y divide-border/60">{order.items.map(item=><li key={item.id} className="flex items-center gap-3 py-3"><span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">{item.imageUrl?<img src={item.imageUrl} alt="" className="h-full w-full object-cover"/>:<Package size={18} aria-hidden="true"/>}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{[item.variantLabel,item.sku?`SKU ${item.sku}`:undefined,item.externalItemId?`Anúncio ${item.externalItemId}`:undefined].filter(Boolean).join(" · ")||"—"}</span>{item.productId?null:<span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">Anúncio não vinculado ao catálogo (sem baixa de estoque)</span>}</span><span className="text-right text-sm tabular-nums"><span className="block">{item.quantity} × {money(item.unitPriceCents)}</span><span className="block font-medium">{money(item.totalCents)}</span></span></li>)}</ul>;
 if(section==="pagamento")return <div className="space-y-4">{marketplace?<p className="text-sm text-muted-foreground">O pagamento deste pedido é processado pelo {sourceLabel(order.source)}.</p>:null}{payments.length?payments.map(payment=><dl key={payment.id} className="rounded-lg border border-border/60 p-3">{row("Forma",payment.instructions?.sandbox?"Teste (sem cobrança)":payment.method==="PIX"?"PIX":payment.method==="CARD"?"Cartão":payment.method||"—")}{row("Provedor",payment.provider==="MERCADO_PAGO"?"Mercado Pago":payment.provider==="SANDBOX"?"Modo de teste":sourceLabel(payment.provider))}{row("Status",PAYMENT_STATUS_LABELS[payment.status]??payment.status)}{row("Valor",<span className="tabular-nums">{money(payment.amountCents)}</span>)}{payment.refundedCents?row("Reembolsado",<span className="tabular-nums">{money(payment.refundedCents)}</span>):null}{payment.providerPaymentId&&!payment.instructions?.sandbox?row("ID no provedor",<span className="font-mono text-xs">{payment.providerPaymentId}</span>):null}{payment.approvedAt?row("Aprovado em",formatDateTime(payment.approvedAt)):null}{payment.refundedAt?row("Estornado em",formatDateTime(payment.refundedAt)):null}{payment.failureReason?row("Motivo",payment.failureReason):null}</dl>):marketplace?null:<p className="text-sm text-muted-foreground">Nenhum pagamento iniciado.</p>}</div>;
 if(section==="entrega")return <div className="space-y-4">
  {order.delivery?<dl>{row("Forma",order.delivery.label)}{row("Status",SHIPPING_STATUS_LABELS[order.shippingStatus]??order.shippingStatus)}{row("Frete",order.shippingCents?money(order.shippingCents):"Grátis")}{order.delivery.days!==undefined?row("Prazo informado",`${order.delivery.days} dia(s)`):null}{order.shippingAddress?row("Endereço",<span>{order.shippingAddress.street}, {order.shippingAddress.number}{order.shippingAddress.complement?` — ${order.shippingAddress.complement}`:""}<br/>{order.shippingAddress.district} · {order.shippingAddress.city}/{order.shippingAddress.state}<br/>CEP {order.shippingAddress.postalCode.replace(/(\d{5})(\d{3})/,"$1-$2")}</span>):row("Endereço",marketplace?"Gerenciado pelo canal":"Retirada no local")}{events.filter(event=>typeof event.data.trackingCode==="string").map(event=><div key={event.id}>{row("Rastreio",String(event.data.trackingCode))}</div>)}</dl>:<dl>{row("Status",SHIPPING_STATUS_LABELS[order.shippingStatus]??order.shippingStatus)}</dl>}
  {detail.shipments?.length||marketplace?<section aria-labelledby="order-shipments-title"><h3 id="order-shipments-title" className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Envios</h3><OrderShipments workspaceId={workspaceId} orderId={order.id} shipments={detail.shipments??[]} canLabel={!!detail.actions?.canLabel}/></section>:null}
 </div>;
 if(section==="historico")return <ol className="space-y-3 border-l border-border/60 pl-4">{events.map(event=><li key={event.id} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true"/><span className="font-medium">{ORDER_EVENT_LABELS[event.type]??event.type}{event.toStatus&&event.type==="status_changed"?`: ${ORDER_STATUS_LABELS[event.toStatus as OrderStatus]??event.toStatus}`:""}</span><span className="block text-xs text-muted-foreground">{formatDateTime(event.createdAt)} · {event.actorType==="user"?"Equipe":event.actorType==="customer"?"Cliente":event.actorType==="provider"?(marketplace?sourceLabel(order.source):"Provedor de pagamento"):"Sistema"}{typeof event.data.reason==="string"?` · ${CANCEL_REASON_LABELS[event.data.reason]??event.data.reason}`:""}</span></li>)}</ol>;
 return <div className="grid gap-5 md:grid-cols-2">
  {marketplace||order.externalOrderId?<dl className="md:col-span-2"><h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Canal</h3>{row("Origem",<SourceBadge source={order.source}/>)}{row("Pedido no canal",<span className="font-mono text-xs">{order.externalOrderId??"—"}</span>)}{row("Status no canal",order.externalStatus??"—")}{row("Estoque",order.stockState==="CONFLICT"?<StockConflictBadge/>:STOCK_STATE_LABELS[order.stockState]??order.stockState)}</dl>:null}
  <dl><h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Cliente</h3>{row("Nome",order.customer.name||"—")}{row("E-mail",order.customer.email||"—")}{row("Telefone",order.customer.phone||"—")}{order.customer.document?row("CPF/CNPJ",order.customer.document.replace(/^(\d{3})\d{5}(\d{3})$/,"$1.•••.•••-$2")):null}{order.contactId?row("CRM","Contato vinculado"):null}</dl>
  <dl><h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Valores</h3>{row("Subtotal",<span className="tabular-nums">{money(order.subtotalCents)}</span>)}{order.discountCents?row("Desconto",<span className="tabular-nums">−{money(order.discountCents)}</span>):null}{row("Frete",<span className="tabular-nums">{order.shippingCents?money(order.shippingCents):"Grátis"}</span>)}{row(<strong>Total</strong>,<strong className="tabular-nums">{money(order.totalCents)}</strong>)}{order.refundedCents?row("Reembolsado",<span className="tabular-nums">−{money(order.refundedCents)}</span>):null}{row("Pagamento",PAYMENT_STATUS_LABELS[order.paymentStatus]??order.paymentStatus)}{row("Entrega",SHIPPING_STATUS_LABELS[order.shippingStatus]??order.shippingStatus)}{order.cancelReason?row("Cancelamento",CANCEL_REASON_LABELS[order.cancelReason]??order.cancelReason):null}{order.utm?.source?row("Campanha",[order.utm.source,order.utm.campaign].filter(Boolean).join(" / ")):null}</dl>
 </div>;
}
