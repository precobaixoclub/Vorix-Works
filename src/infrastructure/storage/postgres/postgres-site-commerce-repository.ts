import type {Pool} from "pg";
import {randomUUID} from "node:crypto";
import {safeReferrer,SITE_ANALYTICS_EVENTS} from "../../../domain/sites/site-analytics.js";
import type {CreateSalesIntentInput,SalesIntentLinks,SiteCart,SiteCartItem,SiteCommerceRepositoryPort,SiteEventInput} from "../../../application/ports/site-commerce-repository.port.js";
import {siteCommerceSettingsSchema,utmSchema,type SalesIntent,type SiteCommerceSettings} from "../../../domain/sites/site-commerce.js";
import {safePageUrl} from "../../../application/sites/site-commerce-use-cases.js";
type Row=Record<string,any>;
const iso=(value:unknown)=>value instanceof Date?value.toISOString():value?String(value):undefined;
const intent=(row:Row):SalesIntent=>({id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,siteId:row.site_id,reference:row.reference,type:row.type,status:row.status,source:"SITE",
 productId:row.product_id??undefined,variantId:row.variant_id??undefined,quantity:row.quantity===null?undefined:Number(row.quantity),snapshot:row.snapshot,pageUrl:row.page_url??undefined,
 utm:Object.fromEntries(Object.entries({source:row.utm_source,medium:row.utm_medium,campaign:row.utm_campaign,content:row.utm_content,term:row.utm_term}).filter(([,value])=>value!==null&&value!==undefined)),
 anonymousSessionId:row.anonymous_session_id??undefined,clickCount:Number(row.click_count),contactId:row.contact_id??undefined,conversationId:row.conversation_id??undefined,attendanceId:row.attendance_id??undefined,dealId:row.deal_id??undefined,conversionError:row.conversion_error??undefined,
 createdAt:iso(row.created_at)!,expiresAt:iso(row.expires_at)!,convertedAt:iso(row.converted_at)});
const cart=(row:Row):SiteCart=>({id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,siteId:row.site_id,status:row.status,salesIntentId:row.sales_intent_id??undefined,expiresAt:iso(row.expires_at)!,updatedAt:iso(row.updated_at)!});
export class PostgresSiteCommerceRepository implements SiteCommerceRepositoryPort{
 constructor(private readonly pool:Pool){}
 async getSettings(siteId:string){const {rows}=await this.pool.query("select settings from site_commerce_settings where site_id=$1",[siteId]);return rows[0]?siteCommerceSettingsSchema.parse(rows[0].settings):undefined;}
 async saveSettings(input:{siteId:string;tenantId:string;workspaceId:string;settings:SiteCommerceSettings;actorUserId:string}){
  await this.pool.query("insert into site_commerce_settings(site_id,tenant_id,workspace_id,settings,updated_by_user_id) values($1,$2,$3,$4,$5) on conflict(site_id) do update set settings=excluded.settings,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()",[input.siteId,input.tenantId,input.workspaceId,JSON.stringify(input.settings),input.actorUserId]);
  return input.settings;
 }
 async createIntent(input:CreateSalesIntentInput){
  const {rows}=await this.pool.query(`insert into sales_intents(id,tenant_id,workspace_id,site_id,reference,type,status,product_id,variant_id,quantity,snapshot,page_url,utm_source,utm_medium,utm_campaign,utm_content,utm_term,anonymous_session_id,request_key,expires_at,contact_id,deal_id,converted_at)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,case when $7='CONVERTED' then now() end)
   on conflict(site_id,request_key) where request_key is not null do nothing returning *`,
   ["intent-"+randomUUID(),input.tenantId,input.workspaceId,input.siteId,input.reference,input.type,input.status??"OPEN",input.productId??null,input.variantId??null,input.quantity??null,JSON.stringify(input.snapshot),input.pageUrl??null,input.utm.source??null,input.utm.medium??null,input.utm.campaign??null,input.utm.content??null,input.utm.term??null,input.anonymousSessionId??null,input.requestKey??null,input.expiresAt,input.contactId??null,input.dealId??null]);
  if(rows[0])return {intent:intent(rows[0]),created:true};
  const existing=await this.pool.query("select * from sales_intents where site_id=$1 and request_key=$2",[input.siteId,input.requestKey]);return {intent:intent(existing.rows[0]),created:false};
 }
 async getIntent(id:string){const {rows}=await this.pool.query("select * from sales_intents where id=$1",[id]);return rows[0]?intent(rows[0]):undefined;}
 async findIntentByRequestKey(input:{siteId:string;requestKey:string}){const {rows}=await this.pool.query("select * from sales_intents where site_id=$1 and request_key=$2",[input.siteId,input.requestKey]);return rows[0]?intent(rows[0]):undefined;}
 async getIntentByReference(reference:string){const {rows}=await this.pool.query("select * from sales_intents where reference=$1",[reference]);return rows[0]?intent(rows[0]):undefined;}
 async recordIntentClick(id:string){await this.pool.query("update sales_intents set click_count=click_count+1,last_clicked_at=now() where id=$1",[id]);}
 async claimIntent(input:{id:string;staleBefore:string}){
  const {rows}=await this.pool.query("update sales_intents set status='CONVERTING',claimed_at=now() where id=$1 and (status='OPEN' or (status='CONVERTING' and claimed_at<$2)) returning *",[input.id,input.staleBefore]);
  return rows[0]?intent(rows[0]):undefined;
 }
 async updateIntentLinks(id:string,links:SalesIntentLinks){await this.pool.query("update sales_intents set contact_id=coalesce($2,contact_id),conversation_id=coalesce($3,conversation_id),attendance_id=coalesce($4,attendance_id),deal_id=coalesce($5,deal_id) where id=$1",[id,links.contactId??null,links.conversationId??null,links.attendanceId??null,links.dealId??null]);}
 async completeIntent(id:string,links:SalesIntentLinks){
  const {rows}=await this.pool.query("update sales_intents set status='CONVERTED',converted_at=coalesce(converted_at,now()),conversion_error=null,contact_id=coalesce($2,contact_id),conversation_id=coalesce($3,conversation_id),attendance_id=coalesce($4,attendance_id),deal_id=coalesce($5,deal_id) where id=$1 and status in ('CONVERTING','CONVERTED') returning *",[id,links.contactId??null,links.conversationId??null,links.attendanceId??null,links.dealId??null]);
  return rows[0]?intent(rows[0]):undefined;
 }
 async releaseIntent(id:string,error:string){await this.pool.query("update sales_intents set status='OPEN',claimed_at=null,conversion_error=$2 where id=$1 and status='CONVERTING'",[id,error.slice(0,500)]);}
 async listIntents(input:{tenantId:string;workspaceId:string;siteId?:string;limit:number}){
  const {rows}=await this.pool.query("select * from sales_intents where tenant_id=$1 and workspace_id=$2 and ($3::text is null or site_id=$3) order by created_at desc limit $4",[input.tenantId,input.workspaceId,input.siteId??null,input.limit]);return rows.map(intent);
 }
 async getCart(input:{siteId:string;tokenHash:string}){const {rows}=await this.pool.query("select * from site_carts where site_id=$1 and token_hash=$2",[input.siteId,input.tokenHash]);return rows[0]?cart(rows[0]):undefined;}
 async createCart(input:{tenantId:string;workspaceId:string;siteId:string;tokenHash:string;anonymousSessionId?:string;expiresAt:string}){
  const {rows}=await this.pool.query("insert into site_carts(id,tenant_id,workspace_id,site_id,token_hash,anonymous_session_id,expires_at) values($1,$2,$3,$4,$5,$6,$7) on conflict(token_hash) do update set updated_at=site_carts.updated_at returning *",["cart-"+randomUUID(),input.tenantId,input.workspaceId,input.siteId,input.tokenHash,input.anonymousSessionId??null,input.expiresAt]);
  return cart(rows[0]);
 }
 async listCartItems(cartId:string):Promise<SiteCartItem[]>{
  const {rows}=await this.pool.query("select * from site_cart_items where cart_id=$1 order by created_at,id",[cartId]);
  return rows.map(row=>({id:row.id,productId:row.product_id,variantId:row.variant_id??undefined,quantity:Number(row.quantity),productSnapshot:row.product_snapshot}));
 }
 async setCartItem(input:{cartId:string;productId:string;variantId?:string;quantity:number;productSnapshot:SiteCartItem["productSnapshot"];expiresAt:string}){
  const client=await this.pool.connect();try{await client.query("begin");
   await client.query("insert into site_cart_items(id,cart_id,product_id,variant_id,quantity,product_snapshot) values($1,$2,$3,$4,$5,$6) on conflict(cart_id,product_id,coalesce(variant_id,'')) do update set quantity=excluded.quantity,product_snapshot=excluded.product_snapshot,updated_at=now()",["cart-item-"+randomUUID(),input.cartId,input.productId,input.variantId??null,input.quantity,JSON.stringify(input.productSnapshot)]);
   await client.query("update site_carts set updated_at=now(),expires_at=$2 where id=$1",[input.cartId,input.expiresAt]);
   await client.query("commit");
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
 }
 async removeCartItem(input:{cartId:string;productId:string;variantId?:string}){
  const result=await this.pool.query("delete from site_cart_items where cart_id=$1 and product_id=$2 and coalesce(variant_id,'')=coalesce($3,'')",[input.cartId,input.productId,input.variantId??null]);
  await this.pool.query("update site_carts set updated_at=now() where id=$1",[input.cartId]);return (result.rowCount??0)>0;
 }
 async checkoutCart(input:{cartId:string;salesIntentId:string}){const result=await this.pool.query("update site_carts set status='CHECKED_OUT',sales_intent_id=$2,updated_at=now() where id=$1 and status='ACTIVE'",[input.cartId,input.salesIntentId]);return (result.rowCount??0)>0;}
 async recordEvent(input:SiteEventInput){
  if(!SITE_ANALYTICS_EVENTS.includes(input.type)||input.amountCents!==undefined&&(!Number.isSafeInteger(input.amountCents)||input.amountCents<0)||input.currency!==undefined&&!/^[A-Z]{3}$/.test(input.currency))throw Error("SITE_VALIDATION: evento analítico inválido.");
  const businessKey=(["SALES_INTENT_CREATED","SALES_INTENT_CONVERTED","CONTACT_FORM_SUBMITTED"].includes(input.type)?input.salesIntentId:["ORDER_CREATED","ORDER_PAID","ORDER_CANCELLED","ORDER_COMPLETED","PAYMENT_APPROVED"].includes(input.type)?input.orderId:undefined)??input.eventKey;
  const eventKey=businessKey?`${input.type}:${businessKey}`:undefined;
  const utm=utmSchema.parse(input.utm??{});
  await this.pool.query(`insert into site_events(id,tenant_id,workspace_id,site_id,type,anonymous_session_id,contact_id,product_id,variant_id,sales_intent_id,cart_id,page_url,utm,event_key,referrer_host,device_type,order_id,opportunity_id,conversation_id,attendance_id,amount_cents,currency)
   select $1,$2,$3,s.id,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22 from tenant_sites s where s.id=$4 and s.tenant_id=$2 and s.workspace_id=$3
   on conflict(site_id,event_key) where event_key is not null do nothing`,
   ["site-event-"+randomUUID(),input.tenantId,input.workspaceId,input.siteId,input.type,input.anonymousSessionId??null,input.contactId??null,input.productId??null,input.variantId??null,input.salesIntentId??null,input.cartId??null,safePageUrl(input.pageUrl)??null,JSON.stringify(utm),eventKey??null,safeReferrer(input.referrer)??null,input.device??null,input.orderId??null,input.opportunityId??null,input.conversationId??null,input.attendanceId??null,input.amountCents??null,input.currency??null]);
 }
 async markCartOrdered(cartId:string){await this.pool.query("update site_carts set status='ORDERED',updated_at=now() where id=$1 and status='ACTIVE'",[cartId]);}
 async variantMeasures(variantIds:readonly string[]){
  const result=new Map<string,{weightGrams?:number;heightCm?:number;widthCm?:number;lengthCm?:number}>();if(!variantIds.length)return result;
  for(const row of (await this.pool.query("select id,weight_grams,height_cm,width_cm,length_cm from product_variants where id=any($1)",[[...variantIds]])).rows)result.set(row.id,{weightGrams:row.weight_grams??undefined,heightCm:row.height_cm===null?undefined:Number(row.height_cm),widthCm:row.width_cm===null?undefined:Number(row.width_cm),lengthCm:row.length_cm===null?undefined:Number(row.length_cm)});
  return result;
 }
 async attachContactToSession(input:{siteId:string;anonymousSessionId:string;contactId:string}){await this.pool.query("select vorix_site_analytics_link($1,$2,$3)",[input.siteId,input.anonymousSessionId,input.contactId]);}
}
