import { createHash,randomUUID } from "node:crypto";
import type { Pool,PoolClient } from "pg";
import type { CatalogTransaction,MarketplaceRepositoryPort,OAuthState,StoredConnection } from "../../application/ports/marketplace-repository.port.js";
import { MarketplaceError,type ChannelListing,type MarketplaceActor,type MarketplaceJob,type MarketplaceScope } from "../../domain/marketplaces/marketplace.model.js";
import { PostgresProductRepository } from "../storage/postgres/postgres-product-repository.js";
import { PostgresProductEngineRepository } from "../storage/postgres/postgres-product-engine-repository.js";
import { PostgresSalesCatalogRepository } from "../storage/postgres/postgres-sales-engine-repositories.js";
type Row=Record<string,any>;
const iso=(v:any):string|undefined=>v?new Date(v).toISOString():undefined;
const num=(v:any):number|undefined=>v===null||v===undefined?undefined:Number(v);
const scopeArgs=(s:MarketplaceScope)=>[s.tenantId,s.workspaceId];
function connection(r:Row):StoredConnection{return {id:r.id,tenantId:r.tenant_id,workspaceId:r.workspace_id,provider:r.provider,externalAccountId:r.external_account_id,
 externalAccountName:r.external_account_name,status:r.status,siteId:r.site_id,userProducts:r.user_products,safetyStock:Number(r.safety_stock),
 connectedAt:iso(r.connected_at),lastSyncAt:iso(r.last_sync_at),lastError:r.last_error??undefined,credentialsRef:r.credentials_ref,
 tokenExpiresAt:iso(r.token_expires_at),applicationId:r.application_id,refreshLeaseUntil:iso(r.refresh_lease_until),
 settings:r.settings??{},metadata:r.metadata??{},ordersSyncedAt:iso(r.orders_synced_at)};}
function listing(r:Row):ChannelListing{return {id:r.id,tenantId:r.tenant_id,workspaceId:r.workspace_id,connectionId:r.connection_id,productId:r.product_id,variantId:r.variant_id??undefined,
 externalListingId:r.external_listing_id??undefined,externalProductId:r.external_product_id??undefined,externalCategoryId:r.external_category_id,externalUrl:r.external_url??undefined,
 externalSku:r.external_sku??undefined,status:r.status,syncStatus:r.sync_status,externalPrice:num(r.external_price),externalQuantity:num(r.external_quantity),
 lastSyncedPrice:num(r.last_synced_price),lastSyncedQuantity:num(r.last_synced_quantity),lastSyncAt:iso(r.last_sync_at),lastError:r.last_error??undefined,
 variantLinks:r.variant_links??[],lastSyncedVariants:r.last_synced_variants??[],snapshot:r.snapshot??undefined,draft:r.draft??undefined,productName:r.product_name};}
function job(r:Row):MarketplaceJob{return {id:r.id,tenantId:r.tenant_id,workspaceId:r.workspace_id,connectionId:r.connection_id,kind:r.kind,status:r.status,payload:r.payload,
 progress:r.progress,total:r.total,attempts:r.attempts,lastError:r.last_error??undefined,leaseToken:r.lease_token??undefined,createdAt:iso(r.created_at)};}
/** Adapt existing repositories to one transaction; nested inventory transactions become savepoints. */
function transactionPool(client:PoolClient):Pool {
 let level=0;
 const query=async(text:any,values?:any)=>{
  if(typeof text==="string"&&/^begin$/i.test(text.trim())){level++;return client.query("savepoint marketplace_nested_"+level);}
  if(typeof text==="string"&&/^commit$/i.test(text.trim()))return client.query("release savepoint marketplace_nested_"+level--);
  if(typeof text==="string"&&/^rollback$/i.test(text.trim()))return client.query("rollback to savepoint marketplace_nested_"+level--);
  return client.query(text,values);
 };
 return {query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;
}
export class PostgresMarketplaceRepository implements MarketplaceRepositoryPort {
 constructor(private readonly pool:Pool){}
 async transaction<T>(scope:MarketplaceScope,key:string,run:(tx:CatalogTransaction)=>Promise<T>):Promise<T>{
  const client=await this.pool.connect();try{
   await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtext($1))",["marketplace:"+scope.tenantId+":"+scope.workspaceId+":"+key]);
   const pool=transactionPool(client);const result=await run({marketplace:new PostgresMarketplaceRepository(pool),
    productRepository:new PostgresProductRepository(pool),productEngineRepository:new PostgresProductEngineRepository(pool),salesCatalogRepository:new PostgresSalesCatalogRepository(pool)});
   await client.query("commit");return result;
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
 }
 async connections(s:MarketplaceScope){return (await this.pool.query("select * from marketplace_connections where tenant_id=$1 and workspace_id=$2 order by connected_at desc",scopeArgs(s))).rows.map(connection);}
 async connection(s:MarketplaceScope,id:string){const r=await this.pool.query("select * from marketplace_connections where tenant_id=$1 and workspace_id=$2 and id=$3",[...scopeArgs(s),id]);return r.rows[0]?connection(r.rows[0]):undefined;}
 async saveConnection(c:StoredConnection){
  await this.pool.query(`insert into marketplace_connections(id,tenant_id,workspace_id,provider,external_account_id,external_account_name,application_id,site_id,user_products,status,credentials_ref,safety_stock,token_expires_at,connected_at,settings,metadata)
   values($1,$2,$3,$13,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$14::jsonb,$15::jsonb)
   on conflict(id) do update set external_account_name=excluded.external_account_name,user_products=excluded.user_products,status=excluded.status,metadata=excluded.metadata,
   refresh_owner=case when excluded.token_expires_at is distinct from marketplace_connections.token_expires_at then null else marketplace_connections.refresh_owner end,
   refresh_lease_until=case when excluded.token_expires_at is distinct from marketplace_connections.token_expires_at then null else marketplace_connections.refresh_lease_until end,
   token_expires_at=excluded.token_expires_at,safety_stock=excluded.safety_stock,last_error=null,updated_at=now()
   where marketplace_connections.tenant_id=excluded.tenant_id and marketplace_connections.workspace_id=excluded.workspace_id`,
   [c.id,c.tenantId,c.workspaceId,c.externalAccountId,c.externalAccountName,c.applicationId,c.siteId,c.userProducts,c.status,c.credentialsRef,c.safetyStock,c.tokenExpiresAt??null,c.provider,JSON.stringify(c.settings??{}),JSON.stringify(c.metadata??{})]);
 }
 async connectionError(s:MarketplaceScope,id:string,status:StoredConnection["status"],code?:string){
  await this.pool.query("update marketplace_connections set status=$4,last_error=$5,updated_at=now() where tenant_id=$1 and workspace_id=$2 and id=$3",[...scopeArgs(s),id,status,code??null]);
  if(status==="REAUTH_REQUIRED")await this.pool.query("update channel_listings set sync_status='REAUTH_REQUIRED',last_error='REAUTH_REQUIRED' where tenant_id=$1 and workspace_id=$2 and connection_id=$3",[...scopeArgs(s),id]);
 }
 async refreshClaim(s:MarketplaceScope,id:string,owner:string):Promise<"CLAIMED"|"BUSY"|"EXPIRED">{
  const expired=await this.pool.query("update marketplace_connections set status='REAUTH_REQUIRED',last_error='ML_REFRESH_OUTCOME_UNCERTAIN',refresh_owner=null,refresh_lease_until=null where tenant_id=$1 and workspace_id=$2 and id=$3 and refresh_lease_until<now() returning id",[...scopeArgs(s),id]);if(expired.rowCount)return "EXPIRED";
  const r=await this.pool.query("update marketplace_connections set refresh_owner=$4,refresh_lease_until=now()+interval '2 minutes' where tenant_id=$1 and workspace_id=$2 and id=$3 and status='CONNECTED' and refresh_owner is null returning id",[...scopeArgs(s),id,owner]);
  return r.rowCount?"CLAIMED":"BUSY";
 }
 async refreshComplete(s:MarketplaceScope,id:string,owner:string,expiresAt?:string){
  const r=await this.pool.query("update marketplace_connections set refresh_owner=null,refresh_lease_until=null,token_expires_at=coalesce($5::timestamptz,token_expires_at) where tenant_id=$1 and workspace_id=$2 and id=$3 and refresh_owner=$4 returning id",[...scopeArgs(s),id,owner,expiresAt??null]);
  if(!r.rowCount)throw new MarketplaceError("ML_REFRESH_LEASE_LOST");
 }
 async oauthSave(hash:string,s:OAuthState){await this.pool.query("insert into marketplace_oauth_states(state_hash,tenant_id,workspace_id,user_id,verifier_ref,browser_hash,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",[hash,s.tenantId,s.workspaceId,s.userId,s.verifierRef,s.browserHash]);
  await this.pool.query("update marketplace_oauth_states set provider=$2 where state_hash=$1",[hash,s.provider]);}
 // Single use even when the browser does not match: a state opened in another browser is burned, never reusable.
 async oauthConsume(hash:string,browserHash:string){const r=await this.pool.query("delete from marketplace_oauth_states where state_hash=$1 and expires_at>now() returning *",[hash]);const v=r.rows[0];return v&&v.browser_hash&&v.browser_hash===browserHash?{tenantId:v.tenant_id,workspaceId:v.workspace_id,userId:v.user_id,verifierRef:v.verifier_ref,browserHash:v.browser_hash,provider:v.provider??"MERCADO_LIVRE"}:undefined;}
 async listings(s:MarketplaceScope,productId?:string){return (await this.pool.query("select l.*,p.name as product_name from channel_listings l join products p on p.id=l.product_id where l.tenant_id=$1 and l.workspace_id=$2 and ($3::text is null or l.product_id=$3) order by l.updated_at desc",[...scopeArgs(s),productId??null])).rows.map(listing);}
 async listing(s:MarketplaceScope,id:string){const r=await this.pool.query("select * from channel_listings where tenant_id=$1 and workspace_id=$2 and id=$3",[...scopeArgs(s),id]);return r.rows[0]?listing(r.rows[0]):undefined;}
 async externalListing(s:MarketplaceScope,connectionId:string,externalId:string){const r=await this.pool.query("select * from channel_listings where tenant_id=$1 and workspace_id=$2 and connection_id=$3 and external_listing_id=$4",[...scopeArgs(s),connectionId,externalId]);return r.rows[0]?listing(r.rows[0]):undefined;}
 async saveListing(l:ChannelListing){
  const product=await this.pool.query("select id from products where tenant_id=$1 and workspace_id=$2 and id=$3",[...scopeArgs(l),l.productId]);if(!product.rowCount)throw new MarketplaceError("MARKETPLACE_PRODUCT_NOT_FOUND");
  for(const variantId of [l.variantId,...l.variantLinks.map(v=>v.variantId)].filter(Boolean)){
   const v=await this.pool.query("select id from product_variants where tenant_id=$1 and workspace_id=$2 and product_id=$3 and id=$4",[...scopeArgs(l),l.productId,variantId]);if(!v.rowCount)throw new MarketplaceError("MARKETPLACE_VARIANT_NOT_FOUND");
  }
  await this.pool.query(`insert into channel_listings(id,tenant_id,workspace_id,connection_id,product_id,variant_id,external_listing_id,external_product_id,external_category_id,external_url,external_sku,status,sync_status,external_price,external_quantity,last_synced_price,last_synced_quantity,snapshot,draft,variant_links,last_sync_at,last_error)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,$21,$22)
   on conflict(id) do update set external_listing_id=excluded.external_listing_id,external_product_id=excluded.external_product_id,external_url=excluded.external_url,
   external_sku=excluded.external_sku,status=excluded.status,sync_status=excluded.sync_status,external_price=excluded.external_price,external_quantity=excluded.external_quantity,
   last_synced_price=excluded.last_synced_price,last_synced_quantity=excluded.last_synced_quantity,snapshot=excluded.snapshot,draft=excluded.draft,variant_links=excluded.variant_links,
   last_sync_at=excluded.last_sync_at,last_error=excluded.last_error,updated_at=now()
   where channel_listings.tenant_id=excluded.tenant_id and channel_listings.workspace_id=excluded.workspace_id and channel_listings.connection_id=excluded.connection_id`,
   [l.id,l.tenantId,l.workspaceId,l.connectionId,l.productId,l.variantId??null,l.externalListingId??null,l.externalProductId??null,l.externalCategoryId,l.externalUrl??null,l.externalSku??null,l.status,l.syncStatus,l.externalPrice??null,l.externalQuantity??null,l.lastSyncedPrice??null,l.lastSyncedQuantity??null,JSON.stringify(l.snapshot??null),JSON.stringify(l.draft??null),JSON.stringify(l.variantLinks),l.lastSyncAt??null,l.lastError??null]);
  await this.pool.query("update channel_listings set last_synced_variants=$4::jsonb where tenant_id=$1 and workspace_id=$2 and id=$3",[...scopeArgs(l),l.id,JSON.stringify(l.lastSyncedVariants??[])]);
 }
 async enqueue(a:MarketplaceActor,connectionId:string,kind:MarketplaceJob["kind"],payload:Record<string,unknown>,operationKey:string){
  if(!await this.connection(a,connectionId))throw new MarketplaceError("MARKETPLACE_CONNECTION_NOT_FOUND");
  const body={...payload,actorId:a.userId};const hash=createHash("sha256").update(JSON.stringify([connectionId,kind,body])).digest("hex");
  const r=await this.pool.query(`insert into marketplace_jobs(id,tenant_id,workspace_id,connection_id,kind,payload,operation_key,request_hash)
   values($1,$2,$3,$4,$5,$6::jsonb,$7,$8) on conflict(tenant_id,workspace_id,operation_key) do update set operation_key=excluded.operation_key returning *`,
   ["mpjob-"+randomUUID(),a.tenantId,a.workspaceId,connectionId,kind,JSON.stringify(body),operationKey,hash]);
  if(r.rows[0].request_hash!==hash)throw new MarketplaceError("MARKETPLACE_IDEMPOTENCY_CONFLICT");return job(r.rows[0]);
 }
 async jobs(s:MarketplaceScope){return (await this.pool.query("select * from marketplace_jobs where tenant_id=$1 and workspace_id=$2 order by created_at desc limit 100",scopeArgs(s))).rows.map(job);}
 async job(s:MarketplaceScope,id:string){const r=await this.pool.query("select * from marketplace_jobs where tenant_id=$1 and workspace_id=$2 and id=$3",[...scopeArgs(s),id]);return r.rows[0]?job(r.rows[0]):undefined;}
 async claimJob(){
  // Never resend a publication whose worker disappeared after a POST may have reached ML.
  await this.pool.query("update marketplace_jobs set status='UNKNOWN_RESULT',last_error='ML_PUBLICATION_OUTCOME_UNCERTAIN',lease_token=null where status='RUNNING' and kind='PUBLISH' and lease_until<now()");
  // A job that keeps killing its worker stops being reclaimed (the retry cap otherwise only applies to caught errors).
  await this.pool.query("update marketplace_jobs set status='FAILED',last_error='MARKETPLACE_JOB_ABANDONED',lease_token=null,lease_until=null,updated_at=now() where status='RUNNING' and kind<>'PUBLISH' and lease_until<now() and attempts>=6");
  const client=await this.pool.connect();
  try{
   await client.query("begin");
   const account=await client.query(`select c.id from marketplace_connections c where
    exists(select 1 from marketplace_jobs j where j.connection_id=c.id and ((j.status='PENDING' and j.run_after<=now()) or (j.status='RUNNING' and j.lease_until<now() and j.kind<>'PUBLISH')))
    and not exists(select 1 from marketplace_jobs j where j.connection_id=c.id and j.status='RUNNING' and j.lease_until>now())
    order by c.id for update skip locked limit 1`);
   if(!account.rows[0]){await client.query("commit");return;}
   // Stock/price writes go before read-only reconciliations queued for the same account.
   const r=await client.query(`update marketplace_jobs set status='RUNNING',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '5 minutes',updated_at=now()
    where id=(select id from marketplace_jobs where connection_id=$2 and ((status='PENDING' and run_after<=now()) or (status='RUNNING' and lease_until<now() and kind<>'PUBLISH')) order by (kind='RECONCILE'),run_after for update skip locked limit 1) returning *`,[randomUUID(),account.rows[0].id]);
   await client.query("commit");return r.rows[0]?job(r.rows[0]):undefined;
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
 }
 async checkpoint(j:MarketplaceJob,progress:number,total:number,payload?:Record<string,unknown>){
  const r=await this.pool.query("update marketplace_jobs set progress=$5,total=$6,payload=coalesce($7::jsonb,payload),lease_until=now()+interval '5 minutes',updated_at=now() where tenant_id=$1 and workspace_id=$2 and id=$3 and lease_token=$4 and status='RUNNING' returning id",[...scopeArgs(j),j.id,j.leaseToken,progress,total,payload?JSON.stringify(payload):null]);if(!r.rowCount)throw new MarketplaceError("MARKETPLACE_JOB_LEASE_LOST");
 }
 async finishJob(j:MarketplaceJob,status:MarketplaceJob["status"],code?:string,delayMs=0){
  await this.pool.query("update marketplace_jobs set status=$5,last_error=$6,run_after=now()+($7::bigint*interval '1 millisecond'),lease_token=null,lease_until=null,updated_at=now() where tenant_id=$1 and workspace_id=$2 and id=$3 and lease_token=$4",[...scopeArgs(j),j.id,j.leaseToken,status,code??null,delayMs]);
  // Only a full reconciliation counts: one scoped to a notification or listing must not postpone the periodic sweep.
  if(j.kind==="RECONCILE"&&status==="COMPLETED"&&!j.payload.resource&&!j.payload.publicationJobId&&!j.payload.listingId)await this.pool.query("update marketplace_connections set last_sync_at=now() where tenant_id=$1 and workspace_id=$2 and id=$3",[...scopeArgs(j),j.connectionId]);
 }
 async jobItems(s:MarketplaceScope,jobId:string){return (await this.pool.query("select i.* from marketplace_job_items i join marketplace_jobs j on j.id=i.job_id where j.tenant_id=$1 and j.workspace_id=$2 and j.id=$3 order by i.external_id",[...scopeArgs(s),jobId])).rows.map(r=>({externalId:r.external_id,status:r.status,result:r.result}));}
 async completeRecoveredPublication(s:MarketplaceScope,id:string,externalId:string){
  const r=await this.pool.query("update marketplace_jobs set status='COMPLETED',last_error=null,progress=1,total=1,updated_at=now() where tenant_id=$1 and workspace_id=$2 and id=$3 and kind='PUBLISH' and status='UNKNOWN_RESULT' returning id",[...scopeArgs(s),id]);
  if(!r.rowCount)throw new MarketplaceError("ML_PUBLICATION_RECOVERY_CONFLICT");
  await this.pool.query("insert into marketplace_job_items(job_id,external_id,status,result) values($1,'publication','PUBLISHED',$2::jsonb) on conflict(job_id,external_id) do update set status=excluded.status,result=excluded.result",[id,JSON.stringify({externalListingId:externalId,recovered:true})]);
 }
 async item(j:MarketplaceJob,id:string){return (await this.jobItems(j,j.id)).find(v=>v.externalId===id);}
 async saveItem(j:MarketplaceJob,id:string,status:string,result:Record<string,unknown>){
  const lease=await this.pool.query("select id from marketplace_jobs where tenant_id=$1 and workspace_id=$2 and id=$3 and lease_token=$4 and status='RUNNING' and lease_until>now() for update",[...scopeArgs(j),j.id,j.leaseToken]);if(!lease.rowCount)throw new MarketplaceError("MARKETPLACE_JOB_LEASE_LOST");
  await this.pool.query("insert into marketplace_job_items(job_id,external_id,status,result) values($1,$2,$3,$4::jsonb) on conflict(job_id,external_id) do update set status=excluded.status,result=excluded.result",[j.id,id,status,JSON.stringify(result)]);
 }
 async audit(a:MarketplaceActor,action:string,targetId:string,code?:string){await this.pool.query("insert into marketplace_audit(id,tenant_id,workspace_id,actor_id,action,target_id,code) values($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),a.tenantId,a.workspaceId,a.userId,action,targetId,code??null]);}
 async auditLog(s:MarketplaceScope){return (await this.pool.query("select actor_id,action,target_id,code,created_at from marketplace_audit where tenant_id=$1 and workspace_id=$2 order by created_at desc limit 100",scopeArgs(s))).rows;}
 async mappings(s:MarketplaceScope){return (await this.pool.query("select connection_id,category_id,external_category_id,attributes from marketplace_category_mappings where tenant_id=$1 and workspace_id=$2",scopeArgs(s))).rows;}
 async saveMapping(a:MarketplaceActor,input:{connectionId:string;categoryId:string;externalCategoryId:string;attributes:unknown[]}){
  await this.pool.query(`insert into marketplace_category_mappings(tenant_id,workspace_id,connection_id,category_id,external_category_id,attributes)
   select $1,$2,$3,c.id,$5,$6::jsonb from product_categories c where c.tenant_id=$1 and c.workspace_id=$2 and c.id=$4
   on conflict(tenant_id,workspace_id,connection_id,category_id) do update set external_category_id=excluded.external_category_id,attributes=excluded.attributes`,
   [a.tenantId,a.workspaceId,input.connectionId,input.categoryId,input.externalCategoryId,JSON.stringify(input.attributes)]);
 }
 async notifications(n:{provider:StoredConnection["provider"];applicationId:string;sellerId:string;eventId:string;topic:string;resource:string;kind:"ORDER"|"LISTING"|"RETURN";externalOrderId?:string}){
  const r=await this.pool.query("select * from marketplace_connections where provider=$3 and application_id=$1 and external_account_id=$2 and status='CONNECTED'",[n.applicationId,n.sellerId,n.provider]);if(!r.rows[0])return false;
  const c=connection(r.rows[0]);
  return this.transaction(c,"notification:"+n.eventId,async tx=>{
   const store=tx.marketplace as PostgresMarketplaceRepository;
   const inserted=await store.pool.query("insert into marketplace_notifications(connection_id,event_id,topic,resource) values($1,$2,$3,$4) on conflict do nothing returning event_id",[c.id,n.eventId,n.topic,n.resource]);if(!inserted.rowCount)return false;
   // A pending reconciliation of the same resource already covers this event (bursts or forged ids never pile up jobs).
   // Pedido/envio/devolução: relê o pedido inteiro (a ordem das notificações não importa).
   const kind=n.kind==="LISTING"?"RECONCILE":"ORDER",payload=n.kind==="LISTING"?{resource:n.resource}:n.externalOrderId?{externalOrderId:n.externalOrderId}:{resource:n.resource};
   const target=n.kind!=="LISTING"&&n.externalOrderId?n.externalOrderId:n.resource;
   const queued=await store.pool.query("select 1 from marketplace_jobs where connection_id=$1 and kind=$3 and status='PENDING' and coalesce(payload->>'externalOrderId',payload->>'resource')=$2 limit 1",[c.id,target,kind]);if(queued.rowCount)return true;
   await store.enqueue({...c,userId:"marketplace-notification"},c.id,kind,payload,"notification:"+c.id+":"+n.eventId);return true;
  });
 }
 async listingByExternal(s:MarketplaceScope,connectionId:string,externalListingId:string){
  const r=await this.pool.query("select * from channel_listings where tenant_id=$1 and workspace_id=$2 and connection_id=$3 and external_listing_id=$4",[...scopeArgs(s),connectionId,externalListingId]);return r.rows[0]?listing(r.rows[0]):undefined;
 }
 async markOrdersSynced(s:MarketplaceScope,connectionId:string,at:string){await this.pool.query("update marketplace_connections set orders_synced_at=greatest(coalesce(orders_synced_at,$4::timestamptz),$4::timestamptz) where tenant_id=$1 and workspace_id=$2 and id=$3",[...scopeArgs(s),connectionId,at]);}
 async saveSettings(s:MarketplaceScope,connectionId:string,settings:StoredConnection["settings"]){await this.pool.query("update marketplace_connections set settings=$4::jsonb,updated_at=now() where tenant_id=$1 and workspace_id=$2 and id=$3",[...scopeArgs(s),connectionId,JSON.stringify(settings)]);}
 async scheduleDue(){
  // Snapshot+delete revision prevents losing a new update committed while the job is running.
  const dirty=await this.pool.query("select * from marketplace_outbox order by updated_at limit 50");
  for(const d of dirty.rows)await this.transaction({tenantId:d.tenant_id,workspaceId:d.workspace_id},"outbox:"+d.product_id,async tx=>{
   const store=tx.marketplace as PostgresMarketplaceRepository;
   const rows=await store.pool.query("select distinct connection_id from channel_listings where tenant_id=$1 and workspace_id=$2 and product_id=$3",[d.tenant_id,d.workspace_id,d.product_id]);
   for(const r of rows.rows)await store.enqueue({tenantId:d.tenant_id,workspaceId:d.workspace_id,userId:"marketplace-outbox"},r.connection_id,"SYNC",{productId:d.product_id},"outbox:"+d.product_id+":"+d.revision+":"+r.connection_id);
   await store.pool.query("delete from marketplace_outbox where tenant_id=$1 and workspace_id=$2 and product_id=$3 and revision=$4",[d.tenant_id,d.workspace_id,d.product_id,d.revision]);
  });
  // A full reconciliation still queued or running blocks the next one: large catalogs otherwise pile up RECONCILE jobs ahead of stock SYNC.
  const connections=await this.pool.query(`select * from marketplace_connections c where c.status='CONNECTED' and (c.last_sync_at is null or c.last_sync_at<now()-interval '15 minutes')
   and not exists(select 1 from marketplace_jobs j where j.connection_id=c.id and j.kind='RECONCILE' and j.status in ('PENDING','RUNNING') and not (j.payload ? 'resource') and not (j.payload ? 'publicationJobId') and not (j.payload ? 'listingId')) limit 50`);
  for(const r of connections.rows){
   const c=connection(r);
   await this.enqueue({...c,userId:"marketplace-reconciliation"},c.id,"RECONCILE",{},"periodic:"+c.id+":"+Math.floor(Date.now()/900000));
  }
  // Pedidos: varredura periódica cobre webhook perdido/atrasado (uma por vez por conta).
  const due=await this.pool.query(`select * from marketplace_connections c where c.status='CONNECTED' and (c.orders_synced_at is null or c.orders_synced_at<now()-interval '10 minutes')
   and not exists(select 1 from marketplace_jobs j where j.connection_id=c.id and j.kind='ORDERS' and j.status in ('PENDING','RUNNING')) limit 50`);
  for(const r of due.rows){const c=connection(r);await this.enqueue({...c,userId:"marketplace-reconciliation"},c.id,"ORDERS",{},"orders:"+c.id+":"+Math.floor(Date.now()/600000));}
 }
}
