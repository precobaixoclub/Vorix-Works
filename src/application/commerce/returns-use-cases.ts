/**
 * Devolução parcial (Site e marketplaces) e estorno parcial (Site).
 *
 * - pedir devolução não mexe no estoque; só o recebimento confirmado repõe — e só a quantidade reposta;
 * - nunca devolve mais que vendido − devoluções ativas (validado sob trava do pedido);
 * - cada item é recebido uma vez (reivindicação condicional) e o movimento tem chave por devolução/item;
 * - estorno por devolução acontece uma vez (estado reivindicado + chave de idempotência no provedor);
 *   parcial só quando o meio de pagamento declara suporte; marketplace estorna no próprio canal.
 */
import {paymentProviderFor,providerContext,type CheckoutDeps,type OrderAdminScope} from "./checkout-use-cases.js";
import {canTransitionReturn,type Order,type OrderReturn,type ReturnStatus} from "../../domain/commerce/order.model.js";

const SYSTEM="system:returns";
async function mustOrder(deps:CheckoutDeps,scope:OrderAdminScope,id:string):Promise<Order>{
 const order=await deps.orders.get(id);if(!order||order.tenantId!==scope.tenantId||order.workspaceId!==scope.workspaceId)throw Error("SITE_NOT_FOUND: pedido não encontrado.");return order;
}
async function mustReturn(deps:CheckoutDeps,scope:OrderAdminScope,id:string):Promise<{ret:OrderReturn;order:Order}>{
 const ret=await deps.orders.getReturn(id);if(!ret||ret.tenantId!==scope.tenantId||ret.workspaceId!==scope.workspaceId)throw Error("SITE_NOT_FOUND: devolução não encontrada.");
 return {ret,order:await mustOrder(deps,scope,ret.orderId)};
}
/** Item que de fato saiu do estoque central (só esse pode voltar a ele). */
function restockable(order:Order,orderItemId:string):boolean{
 const item=order.items.find(i=>i.id===orderItemId);if(!item?.trackStock||!item.productId)return false;
 if(order.source==="SITE")return order.stockState==="SOLD";
 const sold=Array.isArray(order.externalData?.vorixSoldItemIds)?order.externalData!.vorixSoldItemIds as string[]:[];
 return ["SOLD","CONFLICT"].includes(order.stockState)&&sold.includes(orderItemId);
}

export async function requestReturn(deps:CheckoutDeps,scope:OrderAdminScope,input:{orderId:string;requestKey:string;reason?:string;items:{orderItemId:string;quantity:number}[]}){
 const order=await mustOrder(deps,scope,input.orderId);
 if(!["PAID","CONFIRMED","PROCESSING","SHIPPED","DELIVERED"].includes(order.status))throw Error("ORDER_RETURN_VALIDATION: só pedidos vendidos podem ter devolução.");
 const {ret}=await deps.orders.createReturn({tenantId:order.tenantId,workspaceId:order.workspaceId,orderId:order.id,source:order.source,requestKey:input.requestKey,status:"REQUESTED",reason:input.reason?.trim().slice(0,300)||undefined,
  refundCents:0,refundStatus:order.source==="SITE"?"NONE":"MARKETPLACE",createdBy:scope.actorUserId,items:input.items});
 return ret;
}

export async function transitionReturn(deps:CheckoutDeps,scope:OrderAdminScope,input:{returnId:string;to:Extract<ReturnStatus,"APPROVED"|"IN_TRANSIT"|"REJECTED"|"CANCELLED"|"COMPLETED">}){
 const {ret}=await mustReturn(deps,scope,input.returnId);
 if(ret.status===input.to)return ret;
 if(!canTransitionReturn(ret.status,input.to))throw Error(`ORDER_RETURN_VALIDATION: a devolução não pode ir de ${ret.status} para ${input.to}.`);
 const updated=await deps.orders.updateReturn(ret.id,{status:input.to},{statuses:[ret.status]},{type:"return_status_changed",fromStatus:ret.status,toStatus:input.to,actorType:"user",actorId:scope.actorUserId,data:{returnId:ret.id}});
 if(!updated)throw Error("ORDER_RETURN_VALIDATION: a devolução mudou enquanto você editava. Atualize a tela.");
 return updated;
}

/** Recebimento: registra o que chegou e repõe só o que voltou a ser vendável. */
export async function receiveReturn(deps:CheckoutDeps,scope:OrderAdminScope,input:{returnId:string;items:{orderItemId:string;receivedQuantity:number;restockQuantity:number}[]}){
 const {ret,order}=await mustReturn(deps,scope,input.returnId);
 if(!["REQUESTED","APPROVED","IN_TRANSIT","RECEIVED"].includes(ret.status))throw Error("ORDER_RETURN_VALIDATION: esta devolução não aceita mais recebimento.");
 for(const line of input.items){
  const item=ret.items.find(i=>i.orderItemId===line.orderItemId);if(!item)throw Error("ORDER_RETURN_VALIDATION: item fora desta devolução.");
  if(!Number.isInteger(line.receivedQuantity)||line.receivedQuantity<0||line.receivedQuantity>item.quantity)throw Error(`ORDER_RETURN_VALIDATION: recebido deve ficar entre 0 e ${item.quantity}.`);
  if(!Number.isInteger(line.restockQuantity)||line.restockQuantity<0||line.restockQuantity>line.receivedQuantity)throw Error("ORDER_RETURN_VALIDATION: só repõe o que foi recebido.");
  if(line.restockQuantity>0&&!restockable(order,line.orderItemId))throw Error("ORDER_RETURN_VALIDATION: este item não saiu do estoque central (sem vínculo, estoque do marketplace ou sem controle) — não há o que repor.");
 }
 for(const line of input.items){
  if(line.receivedQuantity===0)continue;
  if(!await deps.orders.setReturnItemReceived(ret.id,line.orderItemId,line.receivedQuantity,line.restockQuantity))continue;
  const item=order.items.find(i=>i.id===line.orderItemId)!;
  if(line.restockQuantity>0)await deps.productEngineRepository.move({tenantId:order.tenantId,workspaceId:order.workspaceId,productId:item.productId,variantId:item.variantId,kind:"RETURN",quantity:line.restockQuantity,operationKey:`return:${ret.id}:${item.id}`,userId:scope.actorUserId||SYSTEM});
 }
 const updated=ret.status==="RECEIVED"?ret:await deps.orders.updateReturn(ret.id,{status:"RECEIVED"},{statuses:[ret.status]},{type:"return_received",actorType:"user",actorId:scope.actorUserId,data:{returnId:ret.id,items:input.items}});
 if(ret.status==="RECEIVED")await deps.orders.addEvent(order.id,{type:"return_received",actorType:"user",actorId:scope.actorUserId,data:{returnId:ret.id,items:input.items}});
 return updated??(await deps.orders.getReturn(ret.id))!;
}

/** Valor padrão do estorno: preço unitário × quantidade devolvida (frete fica de fora). */
export function defaultReturnRefundCents(order:Order,ret:OrderReturn):number{
 return ret.items.reduce((sum,line)=>sum+(order.items.find(i=>i.id===line.orderItemId)?.unitPriceCents??0)*line.quantity,0);
}

export async function refundReturn(deps:CheckoutDeps,scope:OrderAdminScope,input:{returnId:string;amountCents?:number}){
 const {ret,order}=await mustReturn(deps,scope,input.returnId);
 if(order.source!=="SITE"||ret.refundStatus==="MARKETPLACE")throw Error("ORDER_RETURN_VALIDATION: o reembolso de pedidos de marketplace é feito pelo próprio canal.");
 if(ret.refundStatus==="REFUNDED")return ret;
 if(["REJECTED","CANCELLED"].includes(ret.status))throw Error("ORDER_RETURN_VALIDATION: devolução rejeitada/cancelada não gera estorno.");
 const payment=(await deps.orders.payments(order.id)).find(p=>(p.status==="APPROVED"||p.status==="REFUNDED")&&p.refundedCents<p.amountCents&&p.providerPaymentId);
 if(!payment)throw Error("ORDER_RETURN_VALIDATION: não há pagamento aprovado com saldo para estornar.");
 const remaining=payment.amountCents-payment.refundedCents;
 const amount=input.amountCents??Math.min(remaining,defaultReturnRefundCents(order,ret));
 if(!Number.isInteger(amount)||amount<=0||amount>remaining)throw Error(`ORDER_RETURN_VALIDATION: o estorno deve ficar entre R$ 0,01 e ${(remaining/100).toLocaleString("pt-BR",{style:"currency",currency:order.currency})}.`);
 const {provider,credentials}=await paymentProviderFor(deps,{tenantId:order.tenantId,id:order.siteId??""},payment.provider);
 if(amount<remaining&&!provider.partialRefund){
  await deps.orders.updateReturn(ret.id,{refundStatus:"NOT_SUPPORTED"},{refundStatuses:["NONE","FAILED"]});
  throw Error("ORDER_RETURN_VALIDATION: este meio de pagamento só permite estorno do valor total.");
 }
 // Reivindica o estorno: dois cliques/abas nunca estornam duas vezes a mesma devolução.
 const claimed=await deps.orders.updateReturn(ret.id,{refundStatus:"PROCESSING",refundCents:amount},{refundStatuses:["NONE","FAILED","NOT_SUPPORTED"]});
 if(!claimed)throw Error("ORDER_RETURN_VALIDATION: o estorno desta devolução já está em andamento.");
 try{
  await provider.refund(providerContext(order,credentials),payment.providerPaymentId!,amount,`return-${ret.id}`);
 }catch(error){
  await deps.orders.updateReturn(ret.id,{refundStatus:"FAILED"},{refundStatuses:["PROCESSING"]},{type:"refund_failed",actorType:"system",data:{returnId:ret.id}});
  throw Error("PAYMENT_VALIDATION: o provedor não confirmou o estorno. Nada foi registrado; tente novamente.");
 }
 await deps.orders.recordRefund(payment.id,order.id,amount);
 return (await deps.orders.updateReturn(ret.id,{refundStatus:"REFUNDED",refundProviderId:payment.providerPaymentId},{refundStatuses:["PROCESSING"]},
  {type:"payment_refunded",actorType:"user",actorId:scope.actorUserId,data:{returnId:ret.id,amountCents:amount,partial:amount<payment.amountCents}}))!;
}
