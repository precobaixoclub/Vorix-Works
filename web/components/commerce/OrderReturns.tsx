"use client";
import {useState} from "react";
import {toast} from "sonner";
import {Undo2} from "lucide-react";
import {Button} from "@/components/Button";
import {Input,Label,MoneyInput,Textarea} from "@/components/Field";
import {ConfirmDialog} from "@/components/ConfirmDialog";
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from "@/components/ui/tooltip";
import {formatCurrencyCents,formatDateTime} from "@/lib/format";
import {centsFromCurrencyInput,currencyInputFromCents} from "@/features/crm/presentation";
import {createOrderReturn,receiveOrderReturn,refundOrderReturn,transitionOrderReturn,type CommerceOrder,type OrderActions,type OrderReturn} from "@/features/commerce/api";
import {buildReturnItems,canReceiveReturn,canRefundReturn,clampQuantity,defaultRefundCents,DESTRUCTIVE_RETURN_ACTIONS,refundStatusLabel,RETURN_ACTION_LABELS,returnableQuantity,returnStatusActions,returnStatusLabel,validateReceipt,type ReturnStatusTarget} from "@/features/commerce/multichannel";
import {commerceErrorMessage} from "./commerce-ui";

const TONE:Record<string,string>={REQUESTED:"bg-amber-500/15 text-amber-700 dark:text-amber-300",APPROVED:"bg-sky-500/15 text-sky-700 dark:text-sky-300",IN_TRANSIT:"bg-violet-500/15 text-violet-700 dark:text-violet-300",RECEIVED:"bg-sky-500/15 text-sky-700 dark:text-sky-300",COMPLETED:"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",REJECTED:"bg-rose-500/15 text-rose-700 dark:text-rose-300",CANCELLED:"bg-muted text-muted-foreground"};
const newKey=()=>typeof crypto!=="undefined"&&"randomUUID" in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;

type Props={workspaceId:string;order:CommerceOrder;returns:OrderReturn[];actions?:OrderActions;canManage:boolean;canRefundPermission:boolean;onChanged:()=>Promise<unknown>|void};

/** Devoluções (parciais) do pedido: registrar, avançar status, receber/repor e reembolsar. */
export function OrderReturns({workspaceId,order,returns,actions,canManage,canRefundPermission,onChanged}:Props){
 const manageable=!!actions?.canManageReturns&&canManage;
 const [creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[receiving,setReceiving]=useState<string>(),[confirm,setConfirm]=useState<{ret:OrderReturn;to:ReturnStatusTarget}>(),[refunding,setRefunding]=useState<OrderReturn>();
 const itemName=(id:string)=>order.items.find(item=>item.id===id)?.name??"Item";
 async function run(action:()=>Promise<unknown>,success:string){
  setBusy(true);
  try{await action();toast.success(success);await onChanged();return true;}
  catch(caught){toast.error(commerceErrorMessage(caught));return false;}
  finally{setBusy(false);}
 }
 const anyReturnable=order.items.some(item=>returnableQuantity(item,returns)>0);
 const createButton=<Button size="sm" variant="secondary" disabled={!manageable||!anyReturnable||busy} onClick={()=>setCreating(true)}><Undo2 size={14} aria-hidden="true"/>Registrar devolução parcial</Button>;
 const blockedReason=!actions?.canManageReturns?"As devoluções deste pedido são tratadas no canal de venda.":!canManage?"Sem permissão para operar pedidos.":!anyReturnable?"Todos os itens já estão em devolução.":"";
 return <div className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <p className="text-sm text-muted-foreground">{returns.length?`${returns.length} devolução(ões) neste pedido.`:"Nenhuma devolução registrada."}</p>
   {creating?null:blockedReason?<TooltipProvider><Tooltip><TooltipTrigger asChild><span tabIndex={0} aria-label={`Registrar devolução parcial indisponível: ${blockedReason}`}>{createButton}</span></TooltipTrigger><TooltipContent>{blockedReason}</TooltipContent></Tooltip></TooltipProvider>:createButton}
  </div>
  {creating?<CreateReturnForm order={order} returns={returns} busy={busy} onCancel={()=>setCreating(false)} onSubmit={async input=>{if(await run(()=>createOrderReturn(workspaceId,order.id,input),"Devolução registrada."))setCreating(false);}}/>:null}
  <ul className="space-y-3" aria-label="Devoluções">{returns.map(ret=>{
   const transitions=manageable?returnStatusActions(ret.status):[];
   const refundable=canRefundReturn(ret,!!actions?.canRefund)&&canRefundPermission;
   return <li key={ret.id} className="min-w-0 rounded-lg border border-border/60 p-3" aria-label={`Devolução de ${formatDateTime(ret.createdAt)}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
     <span className="text-sm font-medium">Devolução · {formatDateTime(ret.createdAt)}{ret.externalReturnId?<span className="ml-1 font-mono text-xs text-muted-foreground">({ret.externalReturnId})</span>:null}</span>
     <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[ret.status]??TONE.CANCELLED}`}>{returnStatusLabel(ret.status)}</span>
    </div>
    {ret.reason?<p className="mt-1 break-words text-sm">Motivo: {ret.reason}</p>:null}
    <ul className="mt-2 space-y-1 text-sm">{ret.items.map(item=><li key={item.orderItemId} className="flex flex-wrap justify-between gap-x-3"><span className="min-w-0 break-words">{itemName(item.orderItemId)}</span><span className="tabular-nums text-muted-foreground">{item.quantity} devolvido(s) · {item.receivedQuantity} recebido(s) · {item.restockedQuantity} reposto(s)</span></li>)}</ul>
    <p className="mt-2 text-xs text-muted-foreground">{refundStatusLabel(ret.refundStatus)}{ret.refundCents?` · ${formatCurrencyCents(ret.refundCents,order.currency)}`:""}</p>
    {(transitions.length||(manageable&&canReceiveReturn(ret.status))||refundable)&&receiving!==ret.id?<div className="mt-3 flex flex-wrap gap-2">
     {transitions.map(to=><Button key={to} size="sm" variant={DESTRUCTIVE_RETURN_ACTIONS.includes(to)?"ghost":"secondary"} disabled={busy} onClick={()=>DESTRUCTIVE_RETURN_ACTIONS.includes(to)?setConfirm({ret,to}):void run(()=>transitionOrderReturn(workspaceId,ret.id,to),`Devolução: ${RETURN_ACTION_LABELS[to].toLowerCase()}.`)}>{RETURN_ACTION_LABELS[to]}</Button>)}
     {manageable&&canReceiveReturn(ret.status)?<Button size="sm" disabled={busy} onClick={()=>setReceiving(ret.id)}>Receber e repor</Button>:null}
     {refundable?<Button size="sm" variant="danger" disabled={busy} onClick={()=>setRefunding(ret)}>Reembolsar</Button>:null}
    </div>:null}
    {receiving===ret.id?<ReceiveForm ret={ret} itemName={itemName} busy={busy} onCancel={()=>setReceiving(undefined)} onSubmit={async items=>{if(await run(()=>receiveOrderReturn(workspaceId,ret.id,items),"Devolução recebida."))setReceiving(undefined);}}/>:null}
   </li>;
  })}</ul>
  {confirm?<ConfirmDialog open variant="danger" busy={busy} title={`${RETURN_ACTION_LABELS[confirm.to]} desta devolução?`} description={confirm.to==="REJECTED"?"A devolução será recusada e os itens voltam a poder ser devolvidos depois. Esta ação não pode ser desfeita.":"A devolução será cancelada e os itens voltam a poder ser devolvidos depois. Esta ação não pode ser desfeita."} confirmLabel={RETURN_ACTION_LABELS[confirm.to]}
   onCancel={()=>setConfirm(undefined)} onConfirm={async()=>{const {ret,to}=confirm;await run(()=>transitionOrderReturn(workspaceId,ret.id,to),`Devolução: ${returnStatusLabel(to).toLowerCase()}.`);setConfirm(undefined);}}/>:null}
  {refunding?<RefundDialog order={order} ret={refunding} partial={!!actions?.partialRefund} busy={busy} onCancel={()=>setRefunding(undefined)} onConfirm={async amount=>{if(await run(()=>refundOrderReturn(workspaceId,refunding.id,amount),"Reembolso solicitado."))setRefunding(undefined);}}/>:null}
 </div>;
}

function CreateReturnForm({order,returns,busy,onCancel,onSubmit}:{order:CommerceOrder;returns:OrderReturn[];busy:boolean;onCancel:()=>void;onSubmit:(input:{requestKey:string;reason:string;items:{orderItemId:string;quantity:number}[]})=>Promise<void>}){
 // Mesma chave para todas as tentativas desta submissão: um retry após falha de rede não duplica a devolução.
 const [requestKey]=useState(newKey);
 const [quantities,setQuantities]=useState<Record<string,number>>({}),[reason,setReason]=useState(""),[error,setError]=useState("");
 function submit(event:React.FormEvent){
  event.preventDefault();
  const built=buildReturnItems(order.items,returns,quantities);
  if(built.error)return setError(built.error);
  if(!reason.trim())return setError("Informe o motivo da devolução.");
  setError("");void onSubmit({requestKey,reason:reason.trim(),items:built.items});
 }
 return <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" aria-label="Registrar devolução parcial">
  <h3 className="text-sm font-semibold">Registrar devolução parcial</h3>
  <ul className="space-y-3">{order.items.map(item=>{const max=returnableQuantity(item,returns),id=`return-qty-${item.id}`;
   return <li key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] items-end gap-3">
    <div className="min-w-0"><Label htmlFor={id}>{item.variantLabel?`${item.name} · ${item.variantLabel}`:item.name}</Label><p id={`${id}-hint`} className="text-xs text-muted-foreground">{max?`Pode devolver até ${max}`:"Nada a devolver"}{` · vendido ${item.quantity}`}</p></div>
    <Input id={id} type="number" inputMode="numeric" min={0} max={max} step={1} disabled={!max} aria-describedby={`${id}-hint`} value={quantities[item.id]??0} onChange={event=>setQuantities(previous=>({...previous,[item.id]:clampQuantity(event.target.value,max)}))}/>
   </li>;})}</ul>
  <div><Label htmlFor="return-reason">Motivo</Label><Textarea id="return-reason" rows={2} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Ex.: tamanho errado, produto com defeito"/></div>
  {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
  <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy}>{busy?"Registrando...":"Registrar devolução"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button></div>
 </form>;
}

function ReceiveForm({ret,itemName,busy,onCancel,onSubmit}:{ret:OrderReturn;itemName:(id:string)=>string;busy:boolean;onCancel:()=>void;onSubmit:(items:{orderItemId:string;receivedQuantity:number;restockQuantity:number}[])=>Promise<void>}){
 const [values,setValues]=useState<Record<string,{received:number;restock:number}>>(()=>Object.fromEntries(ret.items.map(item=>[item.orderItemId,{received:item.quantity,restock:item.quantity}])));
 const [error,setError]=useState("");
 const set=(id:string,patch:Partial<{received:number;restock:number}>)=>setValues(previous=>{const current={...previous[id],...patch};return {...previous,[id]:{...current,restock:Math.min(current.restock,current.received)}};});
 function submit(event:React.FormEvent){
  event.preventDefault();
  const invalid=validateReceipt(ret.items,values);if(invalid)return setError(invalid);
  setError("");void onSubmit(ret.items.map(item=>({orderItemId:item.orderItemId,receivedQuantity:values[item.orderItemId].received,restockQuantity:values[item.orderItemId].restock})));
 }
 return <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-border bg-muted/20 p-3" aria-label="Receber e repor">
  <h3 className="text-sm font-semibold">Receber e repor</h3>
  <p className="text-xs text-muted-foreground">O estoque só volta para o que for reposto. Itens recebidos com defeito podem ficar fora do estoque.</p>
  <ul className="space-y-3">{ret.items.map(item=>{const value=values[item.orderItemId],base=`receive-${ret.id}-${item.orderItemId}`;
   return <li key={item.orderItemId} className="min-w-0 space-y-1">
    <p className="break-words text-sm font-medium">{itemName(item.orderItemId)} <span className="font-normal text-muted-foreground">· {item.quantity} solicitado(s)</span></p>
    <div className="grid grid-cols-2 gap-3">
     <div><Label htmlFor={`${base}-received`}>Recebido</Label><Input id={`${base}-received`} type="number" inputMode="numeric" min={0} max={item.quantity} step={1} value={value.received} onChange={event=>set(item.orderItemId,{received:clampQuantity(event.target.value,item.quantity)})}/></div>
     <div><Label htmlFor={`${base}-restock`}>Repor no estoque</Label><Input id={`${base}-restock`} type="number" inputMode="numeric" min={0} max={value.received} step={1} value={value.restock} onChange={event=>set(item.orderItemId,{restock:clampQuantity(event.target.value,value.received)})}/></div>
    </div>
   </li>;})}</ul>
  {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
  <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy}>{busy?"Salvando...":"Confirmar recebimento"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button></div>
 </form>;
}

function RefundDialog({order,ret,partial,busy,onCancel,onConfirm}:{order:CommerceOrder;ret:OrderReturn;partial:boolean;busy:boolean;onCancel:()=>void;onConfirm:(amountCents?:number)=>Promise<void>}){
 const suggested=defaultRefundCents(order.items,ret.items),remaining=Math.max(0,order.totalCents-(order.refundedCents??0));
 const [text,setText]=useState(currencyInputFromCents(Math.min(suggested,remaining)||suggested));
 const amount=centsFromCurrencyInput(text),invalid=partial&&(!amount||amount>remaining);
 return <ConfirmDialog open variant="danger" busy={busy} confirmDisabled={invalid} title="Reembolsar esta devolução?"
  description={partial?`O valor será devolvido ao cliente pelo provedor de pagamento. Sugestão: ${formatCurrencyCents(suggested,order.currency)} (preço × quantidade devolvida). Esta ação não pode ser desfeita.`:`O provedor de pagamento deste pedido só permite reembolso integral: ${formatCurrencyCents(remaining,order.currency)}. Esta ação não pode ser desfeita.`}
  confirmLabel="Reembolsar" onCancel={onCancel} onConfirm={()=>onConfirm(partial?amount:undefined)}>
  {partial?<div className="space-y-1"><Label htmlFor="refund-amount">Valor do reembolso</Label><MoneyInput id="refund-amount" value={text} onChange={event=>setText(event.target.value)} aria-describedby="refund-amount-hint"/><p id="refund-amount-hint" className="text-xs text-muted-foreground">Máximo disponível: {formatCurrencyCents(remaining,order.currency)}</p></div>:<p className="text-sm font-medium">Somente reembolso integral é possível.</p>}
 </ConfirmDialog>;
}
