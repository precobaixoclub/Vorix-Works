/**
 * Vorix Commerce, Fase 2 — pedido da loja → CRM. Compra cria/atualiza o Contato (reaproveitando
 * quem já existe por e-mail/telefone). Oportunidade ganha é OPCIONAL (configuração do site) para não
 * poluir o funil de quem só vende online. O ganho nunca baixa estoque de novo: o pedido já baixou.
 */
import type {CommerceOrderRepositoryPort} from "../ports/commerce-ports.js";
import {createContact,type ContactUseCaseDeps} from "../crm/contact-use-cases.js";
import {createDeal,type DealUseCaseDeps} from "../crm/deal-use-cases.js";
import {ensureDefaultPipeline,type PipelineUseCaseDeps} from "../crm/pipeline-use-cases.js";
import {addDealItem,loseDeal,reopenDeal,winDeal} from "../sales/deal-commercial-use-cases.js";
import type {SalesEngineDeps} from "../sales/sales-context.js";
import {listCloseReasons} from "../sales/sales-config-use-cases.js";
import type {Order} from "../../domain/commerce/order.model.js";

export const ORDER_CONTACT_ORIGIN="site";
export type OrderCrmDeps={orders:CommerceOrderRepositoryPort;contact:ContactUseCaseDeps;crm?:PipelineUseCaseDeps&DealUseCaseDeps;sales?:SalesEngineDeps};
const systemActor=(tenantId:string)=>({tenantId,userId:"system",role:"owner" as const});

export async function ensureOrderContact(deps:OrderCrmDeps,order:Order):Promise<string>{
 if(order.contactId)return order.contactId;
 const customer=order.customer;
 const existing=await deps.orders.findContactForCustomer({tenantId:order.tenantId,workspaceId:order.workspaceId,email:customer.email,phone:customer.phone});
 if(existing){
  const current=await deps.contact.contactRepository.getById(existing);
  if(current)await deps.contact.contactRepository.update(existing,{customFields:{...current.customFields,email:current.customFields.email??customer.email,phone:current.customFields.phone??customer.phone},...(customer.document&&!current.document?{document:customer.document}:{})});
  return existing;
 }
 const contact=await createContact(deps.contact,{tenantId:order.tenantId,workspaceId:order.workspaceId,name:customer.name,origin:ORDER_CONTACT_ORIGIN,document:customer.document,customFields:{email:customer.email,phone:customer.phone,siteId:order.siteId,firstOrderId:order.id}});
 return contact.id;
}

/** Pedido pago → oportunidade já ganha com os itens. Idempotente via `order.crmDealId`. */
export async function createWonOpportunityForOrder(deps:OrderCrmDeps,order:Order,contactId:string):Promise<string|undefined>{
 if(order.crmDealId)return order.crmDealId;
 if(!deps.crm||!deps.sales)return undefined;
 const {pipeline,stages}=await ensureDefaultPipeline(deps.crm,order.tenantId,order.workspaceId);
 const stage=[...stages].filter(item=>!item.isWon&&!item.isLost).sort((a,b)=>a.position-b.position)[0];
 const deal=await createDeal(deps.crm,{tenantId:order.tenantId,workspaceId:order.workspaceId,pipelineId:pipeline.id,stageId:stage.id,contactId,title:`Pedido #${order.number} — loja online`,valueCents:0,currency:order.currency,origin:"site_checkout",customFields:{commerceOrderId:order.id,commerceOrderNumber:order.number}});
 const actor=systemActor(order.tenantId);
 for(const item of order.items){
  try{await addDealItem(deps.sales,actor,{workspaceId:order.workspaceId,dealId:deal.id,productId:item.productId,variantId:item.variantId,quantity:item.quantity,proposedUnitPriceCents:item.unitPriceCents});}
  catch{await addDealItem(deps.sales,actor,{workspaceId:order.workspaceId,dealId:deal.id,name:`${item.name}${item.variantLabel?` (${item.variantLabel})`:""}`,listPriceCents:item.unitPriceCents,quantity:item.quantity});}
 }
 if(order.shippingCents>0)await addDealItem(deps.sales,actor,{workspaceId:order.workspaceId,dealId:deal.id,name:`Frete — ${order.delivery.label}`,listPriceCents:order.shippingCents,quantity:1});
 await winDeal(deps.sales,actor,{workspaceId:order.workspaceId,dealId:deal.id,finalValueCents:order.totalCents,wonReason:"Compra na loja online",source:"automation",settledSale:true});
 return deal.id;
}

/** Pedido cancelado/estornado depois de pago: a oportunidade ganha vira perdida (a receita sai do CRM e das metas). */
export async function loseOpportunityForCancelledOrder(deps:OrderCrmDeps,order:Order,reason:string):Promise<void>{
 if(!order.crmDealId||!deps.sales)return;
 // Perda exige um motivo ativo das regras comerciais: usa um de cancelamento se houver; sem nenhum, não mexe na oportunidade.
 const reasons=await listCloseReasons(deps.sales,{tenantId:order.tenantId,workspaceId:order.workspaceId,kind:"lost"});
 const lossReason=(reasons.find(item=>/cancel|desist|estorn|devol/i.test(item.label))??reasons[0])?.label;
 if(!lossReason)throw Error(`ORDER_CRM: nenhum motivo de perda ativo para marcar a oportunidade do pedido #${order.number}.`);
 const actor=systemActor(order.tenantId);
 await reopenDeal(deps.sales,actor,{workspaceId:order.workspaceId,dealId:order.crmDealId,source:"automation"});
 await loseDeal(deps.sales,actor,{workspaceId:order.workspaceId,dealId:order.crmDealId,lossReason,comment:`Pedido #${order.number} cancelado (${reason}).`,source:"automation"});
}
