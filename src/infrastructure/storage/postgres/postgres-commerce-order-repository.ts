import type {Pool,PoolClient} from "pg";
import {randomUUID} from "node:crypto";
import type {CommerceOrderRepositoryPort,CreateOrderInput,ExternalOrderInput,OrderEventInput,OrderListFilter,OrderPatch,ReturnInput,ShipmentInput} from "../../../application/ports/commerce-ports.js";
import type {Order,OrderEvent,OrderReturn,OrderStatus,Payment,PaymentInstructions,PaymentMethod,PaymentStatus,ReturnStatus,Shipment,StockState} from "../../../domain/commerce/order.model.js";
type Row=Record<string,any>;
const iso=(value:unknown)=>value instanceof Date?value.toISOString():value?String(value):undefined;
const num=(value:unknown)=>Number(value??0);
function mapOrder(row:Row,items:Row[]):Order{
 return {id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,siteId:row.site_id??undefined,number:row.number,source:row.source,status:row.status,paymentStatus:row.payment_status,shippingStatus:row.shipping_status,stockState:row.stock_state,
  contactId:row.contact_id??undefined,customer:row.customer,shippingAddress:row.shipping_address??undefined,delivery:row.delivery,
  subtotalCents:num(row.subtotal_cents),discountCents:num(row.discount_cents),shippingCents:num(row.shipping_cents),totalCents:num(row.total_cents),currency:row.currency,
  crmDealId:row.crm_deal_id??undefined,salesIntentId:row.sales_intent_id??undefined,cartId:row.cart_id??undefined,anonymousSessionId:row.anonymous_session_id??undefined,utm:row.utm??{},
  reservationExpiresAt:iso(row.reservation_expires_at),cancelReason:row.cancel_reason??undefined,createdAt:iso(row.created_at)!,updatedAt:iso(row.updated_at)!,paidAt:iso(row.paid_at),cancelledAt:iso(row.cancelled_at),
  connectionId:row.connection_id??undefined,externalOrderId:row.external_order_id??undefined,externalStatus:row.external_status??undefined,externalUpdatedAt:iso(row.external_updated_at),externalData:row.external_data??{},
  refundedCents:num(row.refunded_cents),shippedAt:iso(row.shipped_at),deliveredAt:iso(row.delivered_at),
  items:items.filter(item=>item.order_id===row.id).sort((a,b)=>a.position-b.position).map(item=>({id:item.id,position:item.position,productId:item.product_id??"",externalItemId:item.external_item_id??undefined,externalVariationId:item.external_variation_id??undefined,variantId:item.variant_id??undefined,sku:item.sku??undefined,name:item.name,variantLabel:item.variant_label??undefined,imageUrl:item.image_url??undefined,quantity:item.quantity,unitPriceCents:num(item.unit_price_cents),totalCents:num(item.total_cents),trackStock:item.track_stock,specifications:item.specifications??[]}))};
}
const mapPayment=(row:Row):Payment=>({id:row.id,orderId:row.order_id,provider:row.provider,method:row.method as PaymentMethod,status:row.status as PaymentStatus,amountCents:num(row.amount_cents),refundedCents:num(row.refunded_cents),currency:row.currency,providerPaymentId:row.provider_payment_id??undefined,instructions:(row.instructions??{}) as PaymentInstructions,failureReason:row.failure_reason??undefined,createdAt:iso(row.created_at)!,approvedAt:iso(row.approved_at),refundedAt:iso(row.refunded_at)});
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
  const columns:Record<string,unknown>={status:patch.status,payment_status:patch.paymentStatus,shipping_status:patch.shippingStatus,stock_state:patch.stockState,contact_id:patch.contactId,crm_deal_id:patch.crmDealId,sales_intent_id:patch.salesIntentId,cancel_reason:patch.cancelReason,paid_at:patch.paidAt,cancelled_at:patch.cancelledAt,reservation_expires_at:patch.reservationExpiresAt,
   external_status:patch.externalStatus,external_updated_at:patch.externalUpdatedAt,external_data:patch.externalData===undefined?undefined:JSON.stringify(patch.externalData),shipped_at:patch.shippedAt,delivered_at:patch.deliveredAt,
   shipping_cents:patch.shippingCents,total_cents:patch.totalCents};
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
 // ---------------------------------------------------------------- multicanal
 /** Idempotente por (conexão, pedido externo): webhook e polling repetidos devolvem o mesmo pedido. */
 async upsertExternalOrder(input:ExternalOrderInput){
  const client=await this.pool.connect();let result:{id:string;created:boolean};
  try{
   await client.query("begin");
   await client.query("select pg_advisory_xact_lock(hashtext($1))",[`commerce-external-order:${input.connectionId}:${input.externalOrderId}`]);
   const previous=await client.query("select id from commerce_orders where connection_id=$1 and external_order_id=$2",[input.connectionId,input.externalOrderId]);
   if(previous.rowCount){await client.query("commit");result={id:previous.rows[0].id,created:false};}
   else{
    const {rows:[counter]}=await client.query("insert into commerce_order_counters(workspace_id,last_number) values($1,1) on conflict(workspace_id) do update set last_number=commerce_order_counters.last_number+1 returning last_number",[input.workspaceId]);
    const id="order-"+randomUUID();
    await client.query(`insert into commerce_orders(id,tenant_id,workspace_id,site_id,number,public_token_hash,source,status,payment_status,shipping_status,stock_state,customer,shipping_address,delivery,subtotal_cents,discount_cents,shipping_cents,total_cents,currency,utm,
      connection_id,external_order_id,external_status,external_updated_at,external_data,created_at)
     values($1,$2,$3,null,$4,$5,$6,'PENDING','PENDING','PENDING','NONE',$7,$8,$9,$10,$11,$12,$13,$14,'{}'::jsonb,$15,$16,$17,$18,$19,coalesce($20::timestamptz,now()))`,
     [id,input.tenantId,input.workspaceId,counter.last_number,"external-"+randomUUID(),input.source,JSON.stringify(input.customer),input.shippingAddress?JSON.stringify(input.shippingAddress):null,JSON.stringify(input.delivery),
      input.subtotalCents,input.discountCents,input.shippingCents,input.totalCents,input.currency,input.connectionId,input.externalOrderId,input.externalStatus,input.externalUpdatedAt??null,JSON.stringify(input.externalData),input.createdAt??null]);
    for(const item of input.items)await client.query("insert into commerce_order_items(id,order_id,position,product_id,variant_id,sku,name,variant_label,image_url,quantity,unit_price_cents,total_cents,track_stock,specifications,external_item_id,external_variation_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'[]'::jsonb,$14,$15)",
     ["order-item-"+randomUUID(),id,item.position,item.productId||null,item.variantId??null,item.sku??null,item.name,item.variantLabel??null,item.imageUrl??null,item.quantity,item.unitPriceCents,item.totalCents,item.trackStock,item.externalItemId??null,item.externalVariationId??null]);
    await insertEvent(client,id,{type:"order_imported",toStatus:"PENDING",actorType:"provider",data:{source:input.source,externalOrderId:input.externalOrderId,items:input.items.length}});
    await client.query("commit");result={id,created:true};
   }
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
  return {order:(await this.get(result.id))!,created:result.created};
 }
 getByExternal(connectionId:string,externalOrderId:string){return this.load("connection_id=$1 and external_order_id=$2",[connectionId,externalOrderId]);}
 async shipments(orderId:string):Promise<Shipment[]>{return (await this.pool.query("select * from commerce_shipments where order_id=$1 order by created_at",[orderId])).rows.map(mapShipment);}
 async upsertShipment(input:ShipmentInput):Promise<Shipment>{
  const values=[input.tenantId,input.workspaceId,input.orderId,input.provider,input.externalShipmentId??null,input.status,input.externalStatus??null,input.substatus??null,input.logisticType??null,input.carrier??null,input.trackingNumber??null,input.trackingUrl??null,input.labelAvailable,input.fulfilledByMarketplace,input.shippedAt??null,input.deliveredAt??null,input.estimatedDeliveryAt??null];
  // Status repetido não duplica o histórico; rastreio/transportadora nunca são apagados por um snapshot incompleto.
  const set="status=excluded.status,external_status=excluded.external_status,substatus=excluded.substatus,logistic_type=coalesce(excluded.logistic_type,commerce_shipments.logistic_type),carrier=coalesce(excluded.carrier,commerce_shipments.carrier),tracking_number=coalesce(excluded.tracking_number,commerce_shipments.tracking_number),tracking_url=coalesce(excluded.tracking_url,commerce_shipments.tracking_url),label_available=excluded.label_available,fulfilled_by_marketplace=excluded.fulfilled_by_marketplace,shipped_at=coalesce(commerce_shipments.shipped_at,excluded.shipped_at),delivered_at=coalesce(commerce_shipments.delivered_at,excluded.delivered_at),estimated_delivery_at=coalesce(excluded.estimated_delivery_at,commerce_shipments.estimated_delivery_at),"+
   "events=case when commerce_shipments.status=excluded.status then commerce_shipments.events else commerce_shipments.events||jsonb_build_array(jsonb_build_object('status',excluded.status,'at',now())) end,updated_at=now()";
  const insert="insert into commerce_shipments(id,tenant_id,workspace_id,order_id,provider,external_shipment_id,status,external_status,substatus,logistic_type,carrier,tracking_number,tracking_url,label_available,fulfilled_by_marketplace,shipped_at,delivered_at,estimated_delivery_at,events) values($18,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,jsonb_build_array(jsonb_build_object('status',$6::text,'at',now())))";
  const conflict=input.externalShipmentId?"on conflict(order_id,external_shipment_id) where external_shipment_id is not null":"on conflict(order_id) where external_shipment_id is null";
  const {rows}=await this.pool.query(`${insert} ${conflict} do update set ${set} returning *`,[...values,"shipment-"+randomUUID()]);
  return mapShipment(rows[0]);
 }
 async returns(orderId:string):Promise<OrderReturn[]>{
  const rows=(await this.pool.query("select * from commerce_returns where order_id=$1 order by created_at",[orderId])).rows;
  const items=rows.length?(await this.pool.query("select * from commerce_return_items where return_id=any($1)",[rows.map(r=>r.id)])).rows:[];
  return rows.map(r=>mapReturn(r,items));
 }
 async getReturn(id:string):Promise<OrderReturn|undefined>{
  const {rows}=await this.pool.query("select * from commerce_returns where id=$1",[id]);if(!rows[0])return undefined;
  return mapReturn(rows[0],(await this.pool.query("select * from commerce_return_items where return_id=$1",[id])).rows);
 }
 /**
  * Cria a devolução sob trava do pedido: a soma das devoluções ativas nunca passa do vendido.
  * Idempotente por requestKey (duplo clique) ou externalReturnId (webhook/polling repetido).
  */
 async createReturn(input:ReturnInput):Promise<{ret:OrderReturn;created:boolean}>{
  const client=await this.pool.connect();let id:string,created=false;
  try{
   await client.query("begin");
   await client.query("select id from commerce_orders where id=$1 for update",[input.orderId]);
   const previous=await client.query("select id from commerce_returns where order_id=$1 and ((request_key is not null and request_key=$2) or (external_return_id is not null and external_return_id=$3))",[input.orderId,input.requestKey??null,input.externalReturnId??null]);
   if(previous.rowCount){id=previous.rows[0].id;await client.query("commit");}
   else{
    const sold=(await client.query("select id,quantity from commerce_order_items where order_id=$1",[input.orderId])).rows;
    const used=(await client.query("select ri.order_item_id,sum(ri.quantity)::int q from commerce_return_items ri join commerce_returns r on r.id=ri.return_id where r.order_id=$1 and r.status<>all($2) group by 1",[input.orderId,["REJECTED","CANCELLED"]])).rows;
    if(!input.items.length)throw Error("ORDER_RETURN_VALIDATION: escolha ao menos um item.");
    for(const item of input.items){
     const line=sold.find(row=>row.id===item.orderItemId);if(!line)throw Error("ORDER_RETURN_VALIDATION: item não pertence ao pedido.");
     const available=line.quantity-(used.find(row=>row.order_item_id===item.orderItemId)?.q??0);
     if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>available)throw Error(`ORDER_RETURN_VALIDATION: quantidade acima do que ainda pode ser devolvido (${Math.max(0,available)}).`);
    }
    id="return-"+randomUUID();created=true;
    await client.query("insert into commerce_returns(id,tenant_id,workspace_id,order_id,source,external_return_id,request_key,status,external_status,reason,refund_cents,refund_status,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
     [id,input.tenantId,input.workspaceId,input.orderId,input.source,input.externalReturnId??null,input.requestKey??null,input.status,input.externalStatus??null,input.reason??null,input.refundCents,input.refundStatus,input.createdBy??null]);
    for(const item of input.items)await client.query("insert into commerce_return_items(id,return_id,order_item_id,quantity,reason) values($1,$2,$3,$4,$5)",["return-item-"+randomUUID(),id,item.orderItemId,item.quantity,item.reason??null]);
    await insertEvent(client,input.orderId,{type:"return_requested",actorType:input.createdBy?"user":"provider",actorId:input.createdBy,data:{returnId:id,items:input.items}});
    await client.query("commit");
   }
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
  return {ret:(await this.getReturn(id))!,created};
 }
 /** Muda a devolução só se o estado atual for um dos esperados (concorrência); grava o evento no pedido. */
 async updateReturn(id:string,patch:{status?:ReturnStatus;externalStatus?:string;refundStatus?:OrderReturn["refundStatus"];refundCents?:number;refundProviderId?:string},expected:{statuses?:readonly ReturnStatus[];refundStatuses?:readonly OrderReturn["refundStatus"][]},event?:OrderEventInput){
  const sets=["updated_at=now()"],params:unknown[]=[id];
  const add=(sql:string,value:unknown)=>{params.push(value);sets.push(sql.replace("?",`$${params.length}`));};
  if(patch.status){add("status=?",patch.status);if(patch.status==="APPROVED")sets.push("approved_at=coalesce(approved_at,now())");if(patch.status==="RECEIVED")sets.push("received_at=coalesce(received_at,now())");if(patch.status==="COMPLETED")sets.push("completed_at=coalesce(completed_at,now())");}
  if(patch.externalStatus!==undefined)add("external_status=?",patch.externalStatus);
  if(patch.refundStatus){add("refund_status=?",patch.refundStatus);if(patch.refundStatus==="REFUNDED")sets.push("refunded_at=coalesce(refunded_at,now())");}
  if(patch.refundCents!==undefined)add("refund_cents=?",patch.refundCents);if(patch.refundProviderId!==undefined)add("refund_provider_id=?",patch.refundProviderId);
  const conditions=["id=$1"];
  if(expected.statuses){params.push([...expected.statuses]);conditions.push(`status=any($${params.length})`);}
  if(expected.refundStatuses){params.push([...expected.refundStatuses]);conditions.push(`refund_status=any($${params.length})`);}
  const client=await this.pool.connect();
  try{
   await client.query("begin");
   const result=await client.query(`update commerce_returns set ${sets.join(",")} where ${conditions.join(" and ")} returning order_id`,params);
   if(!result.rowCount){await client.query("rollback");return undefined;}
   if(event)await insertEvent(client,result.rows[0].order_id,event);
   await client.query("commit");
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
  return this.getReturn(id);
 }
 /** Reivindica o recebimento do item uma única vez (repetição/duplo clique não repõe estoque de novo). */
 async setReturnItemReceived(returnId:string,orderItemId:string,received:number,restocked:number){
  const r=await this.pool.query("update commerce_return_items set received_quantity=$3,restocked_quantity=$4 where return_id=$1 and order_item_id=$2 and received_quantity=0 and restocked_quantity=0 returning id",[returnId,orderItemId,received,restocked]);
  return (r.rowCount??0)>0;
 }
 /** Vendas por canal (pedidos, não oportunidades: venda do Site com oportunidade ganha conta uma vez). */
 async channelSummary(input:{tenantId:string;workspaceId:string;from:string;to:string;global:boolean;teamIds:readonly string[];ownerUserIds:readonly string[]}){
  const {rows}=await this.pool.query(`select o.source,count(*)::int orders,
    count(*) filter(where o.paid_at is not null and o.status<>'CANCELLED')::int sales,
    coalesce(sum(o.total_cents) filter(where o.paid_at is not null and o.status<>'CANCELLED'),0)::bigint gross_cents,
    coalesce(sum(o.refunded_cents+coalesce(mr.refund_cents,0)) filter(where o.paid_at is not null and o.status<>'CANCELLED'),0)::bigint refunds_cents,
    count(*) filter(where o.status='CANCELLED')::int cancellations,coalesce(sum(r.returns),0)::int returns
   from commerce_orders o
   left join lateral(select count(*)::int returns from commerce_returns x where x.order_id=o.id and x.status not in ('REJECTED','CANCELLED'))r on true
   left join lateral(select sum(x.refund_cents) refund_cents from commerce_returns x where x.order_id=o.id and x.refund_status='MARKETPLACE' and x.status not in ('REJECTED','CANCELLED'))mr on true
   left join site_commerce_settings s on s.site_id=o.site_id
   left join deals d on d.id=o.crm_deal_id and d.tenant_id=o.tenant_id
   where o.tenant_id=$1 and o.workspace_id=$2 and o.created_at>=$3 and o.created_at<$4
    and ($5::boolean or s.settings->>'teamId'=any($6::text[]) or d.owner_user_id=any($7::text[]) or d.team_id=any($6::text[]))
   group by o.source order by o.source`,[input.tenantId,input.workspaceId,input.from,input.to,input.global,[...input.teamIds],[...input.ownerUserIds]]);
  return rows.map(row=>{const revenueCents=Number(row.gross_cents)-Number(row.refunds_cents);
   return {source:row.source,orders:row.orders,sales:row.sales,revenueCents,refundsCents:Number(row.refunds_cents),averageTicketCents:row.sales?Math.round(Number(row.gross_cents)/row.sales):0,cancellations:row.cancellations,returns:row.returns};});
 }
 /** Soma o estorno ao pagamento e ao pedido (nunca passa do valor pago). */
 async recordRefund(paymentId:string,orderId:string,amountCents:number){
  const client=await this.pool.connect();
  try{
   await client.query("begin");
   const {rows:[payment]}=await client.query("update commerce_payments set refunded_cents=refunded_cents+$2,status=case when refunded_cents+$2>=amount_cents then 'REFUNDED' else status end,refunded_at=case when refunded_cents+$2>=amount_cents then coalesce(refunded_at,now()) else refunded_at end,updated_at=now() where id=$1 and refunded_cents+$2<=amount_cents returning *",[paymentId,amountCents]);
   if(!payment)throw Error("PAYMENT_VALIDATION: estorno acima do valor pago.");
   await client.query("update commerce_orders set refunded_cents=refunded_cents+$2,payment_status=case when refunded_cents+$2>=total_cents then 'REFUNDED' else 'PARTIALLY_REFUNDED' end,updated_at=now() where id=$1",[orderId,amountCents]);
   await client.query("commit");return mapPayment(payment);
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
 }
}
const mapShipment=(row:Row):Shipment=>({id:row.id,orderId:row.order_id,provider:row.provider,externalShipmentId:row.external_shipment_id??undefined,status:row.status,externalStatus:row.external_status??undefined,substatus:row.substatus??undefined,logisticType:row.logistic_type??undefined,
 carrier:row.carrier??undefined,trackingNumber:row.tracking_number??undefined,trackingUrl:row.tracking_url??undefined,labelAvailable:row.label_available,fulfilledByMarketplace:row.fulfilled_by_marketplace,shippedAt:iso(row.shipped_at),deliveredAt:iso(row.delivered_at),estimatedDeliveryAt:iso(row.estimated_delivery_at),events:row.events??[],updatedAt:iso(row.updated_at)!});
const mapReturn=(row:Row,items:Row[]):OrderReturn=>({id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,orderId:row.order_id,source:row.source,externalReturnId:row.external_return_id??undefined,status:row.status,externalStatus:row.external_status??undefined,reason:row.reason??undefined,
 refundCents:num(row.refund_cents),refundStatus:row.refund_status,refundProviderId:row.refund_provider_id??undefined,createdBy:row.created_by??undefined,createdAt:iso(row.created_at)!,updatedAt:iso(row.updated_at)!,approvedAt:iso(row.approved_at),receivedAt:iso(row.received_at),completedAt:iso(row.completed_at),refundedAt:iso(row.refunded_at),
 items:items.filter(i=>i.return_id===row.id).map(i=>({id:i.id,orderItemId:i.order_item_id,quantity:i.quantity,receivedQuantity:i.received_quantity,restockedQuantity:i.restocked_quantity,reason:i.reason??undefined}))});
