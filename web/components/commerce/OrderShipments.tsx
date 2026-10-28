"use client";
import {useState} from "react";
import {toast} from "sonner";
import {Download,ExternalLink,Truck} from "lucide-react";
import {Button} from "@/components/Button";
import {formatDateTime} from "@/lib/format";
import {getOrderLabel,type OrderShipment} from "@/features/commerce/api";
import {base64ToBlob,shipmentStatusLabel,sourceLabel} from "@/features/commerce/multichannel";
import {commerceErrorMessage} from "./commerce-ui";

const TONE:Record<string,string>={PENDING:"bg-muted text-muted-foreground",READY_TO_SHIP:"bg-sky-500/15 text-sky-700 dark:text-sky-300",SHIPPED:"bg-violet-500/15 text-violet-700 dark:text-violet-300",DELIVERED:"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",NOT_DELIVERED:"bg-amber-500/15 text-amber-700 dark:text-amber-300",CANCELLED:"bg-rose-500/15 text-rose-700 dark:text-rose-300"};

/** Envios do pedido (o canal é a autoridade da logística em pedidos de marketplace). */
export function OrderShipments({workspaceId,orderId,shipments,canLabel}:{workspaceId:string;orderId:string;shipments:OrderShipment[];canLabel:boolean}){
 const [downloading,setDownloading]=useState(false);
 async function download(){
  setDownloading(true);
  try{
   const label=await getOrderLabel(workspaceId,orderId);
   const url=URL.createObjectURL(base64ToBlob(label.base64,label.contentType));
   const anchor=document.createElement("a");anchor.href=url;anchor.download=label.filename||`etiqueta-${orderId}.pdf`;document.body.appendChild(anchor);anchor.click();anchor.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
   toast.success("Etiqueta baixada.");
  }catch(caught){toast.error(commerceErrorMessage(caught,"Não foi possível baixar a etiqueta."));}
  finally{setDownloading(false);}
 }
 if(!shipments.length)return <p className="text-sm text-muted-foreground">Nenhum envio registrado ainda.</p>;
 return <ul className="space-y-3" aria-label="Envios">{shipments.map(shipment=><li key={shipment.id} className="min-w-0 rounded-lg border border-border/60 p-3">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><Truck size={16} aria-hidden="true" className="shrink-0 text-muted-foreground"/><span className="break-words">{shipment.carrier||sourceLabel(shipment.provider)}</span></span>
   <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[shipment.status]??TONE.PENDING}`}>{shipmentStatusLabel(shipment.status)}</span>
  </div>
  <dl className="mt-2 space-y-1 text-sm">
   <div className="flex flex-wrap justify-between gap-x-4"><dt className="text-muted-foreground">Rastreio</dt><dd className="min-w-0 break-all font-mono text-xs">{shipment.trackingNumber??"—"}</dd></div>
   {shipment.shippedAt?<div className="flex flex-wrap justify-between gap-x-4"><dt className="text-muted-foreground">Enviado em</dt><dd>{formatDateTime(shipment.shippedAt)}</dd></div>:null}
   {shipment.deliveredAt?<div className="flex flex-wrap justify-between gap-x-4"><dt className="text-muted-foreground">Entregue em</dt><dd>{formatDateTime(shipment.deliveredAt)}</dd></div>:null}
  </dl>
  {shipment.fulfilledByMarketplace?<p className="mt-2 text-xs text-muted-foreground">Enviado pelo estoque do próprio marketplace (fulfillment). O estoque central não é alterado.</p>:null}
  <div className="mt-3 flex flex-wrap gap-2">
   {shipment.trackingUrl?<a href={shipment.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline underline-offset-2">Acompanhar entrega<ExternalLink size={14} aria-hidden="true"/><span className="sr-only">(abre em nova aba)</span></a>:null}
   {shipment.labelAvailable&&canLabel?<Button size="sm" variant="secondary" disabled={downloading} onClick={()=>void download()}><Download size={14} aria-hidden="true"/>{downloading?"Baixando...":"Baixar etiqueta"}</Button>:null}
  </div>
  {shipment.events.length?<ol className="mt-3 space-y-2 border-l border-border/60 pl-4" aria-label="Linha do tempo do envio">{shipment.events.map((event,index)=><li key={`${event.at}-${index}`} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true"/><span className="font-medium">{shipmentStatusLabel(event.status)}</span><span className="block text-xs text-muted-foreground">{formatDateTime(event.at)}</span></li>)}</ol>:null}
 </li>)}</ul>;
}
