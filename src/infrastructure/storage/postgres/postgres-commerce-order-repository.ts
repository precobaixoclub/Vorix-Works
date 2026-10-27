import type {Pool,PoolClient} from "pg";
import {randomUUID} from "node:crypto";
import type {CommerceOrderRepositoryPort,CreateOrderInput,OrderEventInput,OrderListFilter,OrderPatch} from "../../../application/ports/commerce-ports.js";
import type {Order,OrderEvent,OrderStatus,Payment,PaymentInstructions,PaymentMethod,PaymentStatus,StockState} from "../../../domain/commerce/order.model.js";
type Row=Record<string,any>;
const iso=(value:unknown)=>value instanceof Date?value.toISOString():value?String(value):undefined;
const num=(value:unknown)=>Number(value??0);
function mapOrder(row:Row,items:Row[]):Order{
 return {id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,siteId:row.site_id??undefined,number:row.number,source:row.source,status:row.status,paymentStatus:row.payment_status,shippingStatus:row.shipping_status,stockState:row.stock_state,
  contactId:row.contact_id??undefined,customer:row.customer,shippingAddress:row.shipping_address??undefined,delivery:row.delivery,
  subtotalCents:num(row.subtotal_cents),discountCents:num(row.discount_cents),shippingCents:num(row.shipping_cents),totalCents:num(row.total_cents),currency:row.currency,
  crmDealId:row.crm_deal_id??undefined,salesIntentId:row.sales_intent_id??undefined,cartId:row.cart_id??undefined,anonymousSessionId:row.anonymous_session_id??undefined,utm:row.utm??{},
  reservationExpiresAt:iso(row.reservation_expires_at),cancelReason:row.cancel_reason??undefined,createdAt:iso(row.created_at)!,updatedAt:iso(row.updated_at)!,paidAt:iso(row.paid_at),cancelledAt:iso(row.cancelled_at),
  items:items.filter(item=>item.order_id===row.id).sort((a,b)=>a.position-b.position).map(item=>({id:item.id,position:item.position,productId:item.product_id,variantId:item.variant_id??undefined,sku:item.sku??undefined,name:item.name,variantLabel:item.variant_label??undefined,imageUrl:item.image_url??undefined,quantity:item.quantity,unitPriceCents:num(item.unit_price_cents),totalCents:num(item.total_cents),trackStock:item.track_stock,specifications:item.specifications??[]}))};
}
const mapPayment=(row:Row):Payment=>({id:row.id,orderId:row.order_id,provider:row.provider,method:row.method as PaymentMethod,status:row.status as PaymentStatus,amountCents:num(row.amount_cents),currency:row.currency,providerPaymentId:row.provider_payment_id??undefined,instructions:(row.instructions??{}) as PaymentInstructions,failureReason:row.failure_reason??undefined,createdAt:iso(row.created_at)!,approvedAt:iso(row.approved_at),refundedAt:iso(row.refunded_at)});
const mapEvent=(row:Row):OrderEvent=>({id:row.id,orderId:row.order_id,type:row.type,fromStatus:row.from_status??undefined,toStatus:row.to_status??undefined,actorType:row.actor_type,actorId:row.actor_id??undefined,data:row.data??{},createdAt:iso(row.created_at)!});
async function insertEvent(client:Pool|PoolClient,orderId:string,event:OrderEventInput){
 await client.query("insert into commerce_order_events(id,order_id,type,from_status,to_status,actor_type,actor_id,data) values($1,$2,$3,$4,$5,$6,$7,$8)",["order-event-"+randomUUID(),orderId,event.type,event.fromStatus??null,event.toStatus??null,event.actorType,event.actorId??null,JSON.stringify(event.data??{})]);
}
export class PostgresCommerceOrderRepository implements CommerceOrderRepositoryPort{
 constructor(private readonly pool:Pool){}
 private async load(where:string,params:unknown[]):Promise<Order|undefined>{
  const {rows}=await this.pool.query(`select * from commerce_orders where ${where}`,params);if(!rows[0])return undefined;
  const items=(await this.pool.query("select * from commerce_order_items where order_id=$1",[rows[0].id])).rows;return mapOrder(rows[0],items);
 }
 async create(input:CreateOrderInput){
  // Lê o pedido só depois de liberar a conexão da transação (nunca dentro dela).
  const client=await this.pool.connect();let result:{id:string;created:boolean};
  try{
   await client.query("begin");
   await client.query("select pg_advisory_xact_lock(hashtext($1))",[`commerce-order:${input.siteId}:${input.requestKey}`]);
   const previous=await client.query("select id from commerce_orders where site_id=$1 and request_key=$2",[input.siteId,input.requestKey]);
   if(previous.rowCount){await client.query("commit");result={id:previous.rows[0].id,created:false};}
   else{
   const {rows:[counter]}=await client.query("insert into commerce_order_counters(workspace_id,last_number) values($1,1) on conflict(workspace_id) do update set last_number=commerce_order_counters.last_number+1 returning last_number",[input.workspaceId]);
   const id="order-"+randomUUID();
   await client.query(`insert into commerce_orders(id,tenant_id,workspace_id,site_id,number,public_token_hash,source,status,payment_status,shipping_status,stock_state,customer,shipping_address,delivery,subtotal_cents,discount_cents,shipping_cents,total_cents,currency,cart_id,request_key,anonymous_session_id,utm,reservation_expires_at)
    values($1,$2,$3,$4,$5,$6,'SITE','PENDING','PENDING',$7,'NONE',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [id,input.tenantId,input.workspaceId,input.siteId,counter.last_number,input.publicTokenHash,input.delivery.requiresAddress?"PENDING":"NOT_REQUIRED",JSON.stringify(input.customer),input.shippingAddress?JSON.stringify(input.shippingAddress):null,JSON.stringify(input.delivery),input.subtotalCents,input.discountCents,input.shippingCents,input.totalCents,input.currency,input.cartId??null,input.requestKey,input.anonymousSessionId??null,JSON.stringify(input.utm),input.reservationExpiresAt]);
   for(const item of input.items)await client.query("insert into commerce_order_items(id,order_id,position,product_id,variant_id,sku,name,variant_label,image_url,quantity,unit_price_cents,total_cents,track_stock,specifications) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    ["order-item-"+randomUUID(),id,item.position,item.productId,item.variantId??null,item.sku??null,item.name,item.variantLabel??null,item.imageUrl??null,item.quantity,item.unitPriceCents,item.totalCents,item.trackStock,JSON.stringify(item.specifications)]);
   await insertEvent(client,id,{type:"order_created",toStatus:"PENDING",actorType:"customer",data:{totalCents:input.totalCents,items:input.items.length}});
   await client.query("commit");
   result={id,created:true};
   }
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
  const order=await this.get(result.id);if(!order)throw Error("ORDER_NOT_FOUND: pedido não encontrado após criação.");
  return {order,created:result.created};
 }
 get(id:string){return this.load("id=$1",[id]);}
 getByPublicTokenHash(hash:string){return this.load("public_token_hash=$1",[hash]);}
 async list(filter:OrderListFilter){
  const params:unknown[]=[filter.tenantId,filter.workspaceId];const where=["tenant_id=$1","workspace_id=$2"];
  const add=(sql:string,value:unknown)=>{params.push(value);where.push(sql.replace("?",`$${params.length}`));};
  if(filter.siteId)add("site_id=?",filter.siteId);if(filter.status)add("status=?",filter.status);if(filter.paymentStatus)add("payment_status=?",filter.paymentStatus);
  if(filter.shippingStatus)add("shipping_status=?",filter.shippingStatus);if(filter.source)add("source=?",filter.source);
  if(filter.from)add("created_at>=?",filter.from);if(filter.to)add("created_at<?",filter.to);
  if(filter.search){const term=filter.search.trim();params.push(term);const p=`$${params.length}`;where.push(/^\d+$/.test(term)?`(number::text=${p} or customer->>'phone' like '%'||${p}||'%')`:`(customer->>'name' ilike '%'||${p}||'%' or customer->>'email' ilike '%'||${p}||'%')`);}
  const clause=where.join(" and ");
  const total=Number((await this.pool.query(`select count(*) n from commerce_orders where ${clause}`,params)).rows[0].n);
  const rows=(await this.pool.query(`select * from commerce_orders where ${clause} order by created_at desc limit ${Math.min(200,filter.limit)} offset ${Math.max(0,filter.offset)}`,params)).rows;
  const items=rows.length?(await this.pool.query("select * from commerce_order_items where order_id=any($1)",[rows.map(row=>row.id)])).rows:[];
  return {orders:rows.map(row=>mapOrder(row,items)),total};
 }
 async update(id:string,patch:OrderPatch,event:OrderEventInput,expected?:{statuses?:readonly OrderStatus[];stockStates?:readonly StockState[]}){
  const columns:Record<string,unknown>={status:patch.status,payment_status:patch.paymentStatus,shipping_status:patch.shippingStatus,stock_state:patch.stockState,contact_id:patch.contactId,crm_deal_id:patch.crmDealId,sales_intent_id:patch.salesIntentId,cancel_reason:patch.cancelReason,paid_at:patch.paidAt,cancelled_at:patch.cancelledAt,reservation_expires_at:patch.reservationExpiresAt};
  const entries=Object.entries(columns).filter(([,value])=>value!==undefined);
  const params:unknown[]=[id,...entries.map(([,value])=>value)];
  const sets=[...entries.map(([column],index)=>`${column}=$${index+2}`),"updated_at=now()"];
  const conditions=["id=$1"];
  if(expected?.statuses){params.push([...expected.statuses]);conditions.push(`status=any($${params.length})`);}
  if(expected?.stockStates){params.push([...expected.stockStates]);conditions.push(`stock_state=any($${params.length})`);}
  const client=await this.pool.connect();
  try{
   await client.query("begin");
   const result=await client.query(`update commerce_orders set ${sets.join(",")} where ${conditions.join(" and ")} returning id`,params);
   if(!result.rowCount){await client.query("rollback");return undefined;}
   await insertEvent(client,id,event);await client.query("commit");
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
  return this.get(id);
 }
 async addEvent(orderId:string,event:OrderEventInput){await insertEvent(this.pool,orderId,event);}
 async events(orderId:string){return (await this.pool.query("select * from commerce_order_events where order_id=$1 order by created_at,id",[orderId])).rows.map(mapEvent);}
 async listExpiring(input:{now:string;limit:number}){
  const rows=(await this.pool.query("select id from commerce_orders where status='AWAITING_PAYMENT' and reservation_expires_at<$1 order by reservation_expires_at limit $2",[input.now,input.limit])).rows;
  return (await Promise.all(rows.map(row=>this.get(row.id)))).filter((order):order is Order=>!!order);
 }
 async createPayment(input:Parameters<CommerceOrderRepositoryPort["createPayment"]>[0]){
  const {rows}=await this.pool.query("insert into commerce_payments(id,tenant_id,workspace_id,order_id,provider,method,status,amount_cents,currency,provider_payment_id,instructions,failure_reason,approved_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,case when $7='APPROVED' then now() end) returning *",
   ["payment-"+randomUUID(),input.tenantId,input.workspaceId,input.orderId,input.provider,input.method,input.status,input.amountCents,input.currency,input.providerPaymentId??null,JSON.stringify(input.instructions),input.failureReason??null]);
  return mapPayment(rows[0]);
 }
 async updatePayment(id:string,patch:{status:PaymentStatus;failureReason?:string;instructions?:PaymentInstructions},expectedStatuses:readonly PaymentStatus[]){
  const {rows}=await this.pool.query("update commerce_payments set status=$2,failure_reason=coalesce($3,failure_reason),instructions=coalesce($4,instructions),updated_at=now(),approved_at=case when $2='APPROVED' then coalesce(approved_at,now()) else approved_at end,refunded_at=case when $2='REFUNDED' then coalesce(refunded_at,now()) else refunded_at end where id=$1 and status=any($5) returning *",
   [id,patch.status,patch.failureReason??null,patch.instructions?JSON.stringify(patch.instructions):null,[...expectedStatuses]]);
  return rows[0]?mapPayment(rows[0]):undefined;
 }
 async payments(orderId:string){return (await this.pool.query("select * from commerce_payments where order_id=$1 order by created_at",[orderId])).rows.map(mapPayment);}
 async paymentByProviderId(provider:string,providerPaymentId:string){const {rows}=await this.pool.query("select * from commerce_payments where provider=$1 and provider_payment_id=$2",[provider,providerPaymentId]);return rows[0]?mapPayment(rows[0]):undefined;}
 async claimWebhookEvent(input:{provider:string;eventKey:string;orderId?:string;paymentId?:string}){
  const result=await this.pool.query("insert into commerce_webhook_events(id,provider,event_key,order_id,payment_id) values($1,$2,$3,$4,$5) on conflict(provider,event_key) do nothing",["webhook-"+randomUUID(),input.provider,input.eventKey,input.orderId??null,input.paymentId??null]);
  return (result.rowCount??0)>0;
 }
 async findContactForCustomer(input:{tenantId:string;workspaceId:string;email:string;phone:string}){
  const digits=input.phone.replace(/\D/g,""),e164=digits.startsWith("55")?`+${digits}`:`+55${digits}`;
  const {rows}=await this.pool.query(`select c.id from contacts c where c.tenant_id=$1 and c.workspace_id=$2 and (
    lower(c.custom_fields->>'email')=lower($3) or regexp_replace(coalesce(c.custom_fields->>'phone',''),'\\D','','g') in ($4,$5)
    or c.id in (select ic.contact_id from inbox_contacts ic where ic.tenant_id=$1 and ic.workspace_id=$2 and ic.contact_id is not null and ic.phone_normalized=$6))
   order by c.created_at limit 1`,[input.tenantId,input.workspaceId,input.email,digits,digits.replace(/^55/,""),e164]);
  return rows[0]?.id;
 }
}
