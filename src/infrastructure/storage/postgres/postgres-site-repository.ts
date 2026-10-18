import type {Pool} from "pg";
import {randomUUID} from "node:crypto";
import type {SiteRepositoryPort} from "../../../application/ports/site-repository.port.js";
import type {Site,SiteDomain} from "../../../domain/sites/site.model.js";
type Row=Record<string,any>;
const site=(row:Row):Site=>({id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,slug:row.slug,draft:row.draft,published:row.published??undefined,revision:row.revision,publishedAt:row.published_at?.toISOString(),updatedAt:row.updated_at.toISOString()});
const domain=(row:Row):SiteDomain=>({id:row.id,siteId:row.site_id,tenantId:row.tenant_id,hostname:row.hostname,challenge:row.challenge,verifiedAt:row.verified_at?.toISOString(),expiresAt:row.expires_at.toISOString()});
export class PostgresSiteRepository implements SiteRepositoryPort{
 constructor(private readonly pool:Pool){}
 async list(tenantId:string,workspaceId:string){return(await this.pool.query("select * from tenant_sites where tenant_id=$1 and workspace_id=$2",[tenantId,workspaceId])).rows.map(site);}
 async get(id:string){const {rows}=await this.pool.query("select * from tenant_sites where id=$1",[id]);return rows[0]?site(rows[0]):undefined;}
 async findPublic(input:{slug?:string;hostname?:string}){
  const {rows}=input.hostname?await this.pool.query("select s.* from tenant_sites s join site_domains d on d.site_id=s.id and d.tenant_id=s.tenant_id where d.hostname=$1 and d.verified_at is not null and d.expires_at>now() and s.published is not null",[input.hostname]):await this.pool.query("select * from tenant_sites where slug=$1 and published is not null",[input.slug]);
  return rows[0]?site(rows[0]):undefined;
 }
 async create(input:Parameters<SiteRepositoryPort["create"]>[0]){return site((await this.pool.query("insert into tenant_sites(id,tenant_id,workspace_id,slug,draft) values($1,$2,$3,$4,$5) returning *",["site-"+randomUUID(),input.tenantId,input.workspaceId,input.slug,JSON.stringify(input.draft)])).rows[0]);}
 async saveDraft(input:Parameters<SiteRepositoryPort["saveDraft"]>[0]){const {rows}=await this.pool.query("update tenant_sites set draft=$4,revision=revision+1,updated_at=now() where id=$1 and tenant_id=$2 and revision=$3 returning *",[input.id,input.tenantId,input.revision,JSON.stringify(input.draft)]);return rows[0]?site(rows[0]):undefined;}
 async publish(input:Parameters<SiteRepositoryPort["publish"]>[0]){
  const client=await this.pool.connect();try{await client.query("begin");
   const {rows}=await client.query(`update tenant_sites set published=${input.unpublish?"null":"draft"},published_at=${input.unpublish?"null":"now()"},revision=revision+1,updated_at=now() where id=$1 and tenant_id=$2 and revision=$3 returning *`,[input.id,input.tenantId,input.revision]);
   if(!rows[0]){await client.query("rollback");return undefined;}
   await client.query("insert into site_publication_events(id,site_id,tenant_id,revision,actor_user_id,event_type) values($1,$2,$3,$4,$5,$6)",["site-event-"+randomUUID(),input.id,input.tenantId,rows[0].revision,input.actorUserId,input.unpublish?"unpublished":"published"]);
   await client.query("commit");return site(rows[0]);
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
 }
 async domains(siteId:string,tenantId:string){return(await this.pool.query("select * from site_domains where site_id=$1 and tenant_id=$2 order by hostname",[siteId,tenantId])).rows.map(domain);}
 async claimDomain(input:Parameters<SiteRepositoryPort["claimDomain"]>[0]){
  const {rows}=await this.pool.query(`insert into site_domains(id,site_id,tenant_id,hostname,challenge,expires_at) values($1,$2,$3,$4,$5,now()+interval '2 hours')
   on conflict(hostname) do update set site_id=excluded.site_id,tenant_id=excluded.tenant_id,challenge=excluded.challenge,verified_at=null,expires_at=excluded.expires_at
   where (site_domains.tenant_id=$3 and site_domains.site_id=$2) or (site_domains.verified_at is null and site_domains.expires_at<now()) returning *`,["domain-"+randomUUID(),input.siteId,input.tenantId,input.hostname,randomUUID()+randomUUID()]);
  return rows[0]?domain(rows[0]):undefined;
 }
 async verifyDomain(input:Parameters<SiteRepositoryPort["verifyDomain"]>[0]){const {rows}=await this.pool.query("update site_domains set verified_at=now(),expires_at=now()+interval '30 days' where id=$1 and site_id=$2 and tenant_id=$3 and challenge=$4 and expires_at>now() returning *",[input.id,input.siteId,input.tenantId,input.challenge]);return rows[0]?domain(rows[0]):undefined;}
 async removeDomain(input:Parameters<SiteRepositoryPort["removeDomain"]>[0]){await this.pool.query("delete from site_domains where id=$1 and site_id=$2 and tenant_id=$3",[input.id,input.siteId,input.tenantId]);}
 async addInquiry(input:Parameters<SiteRepositoryPort["addInquiry"]>[0]){
  const client=await this.pool.connect();try{await client.query("begin");
   await client.query("select pg_advisory_xact_lock(hashtext($1))",[input.site.id+":"+input.requestKey]);
   const previous=await client.query("select id from site_inquiries where site_id=$1 and request_key=$2",[input.site.id,input.requestKey]);
   if(previous.rowCount){await client.query("commit");return {id:String(previous.rows[0].id)};}
   await client.query("select pg_advisory_xact_lock(hashtext($1))",[`site-contact:${input.site.tenantId}:${input.site.workspaceId}:${input.phone??input.email}`]);
   const existing=await client.query("select id from contacts where tenant_id=$1 and workspace_id=$2 and (($3::text is not null and custom_fields->>'phone'=$3) or ($4::text is not null and custom_fields->>'email'=$4)) order by id limit 1",[input.site.tenantId,input.site.workspaceId,input.phone??null,input.email??null]);
   const contactId=existing.rows[0]?.id??"contact-"+randomUUID();
   if(!existing.rowCount)await client.query("insert into contacts(id,tenant_id,workspace_id,name,origin,notes,custom_fields) values($1,$2,$3,$4,'site',$5,$6)",[contactId,input.site.tenantId,input.site.workspaceId,input.name,input.message,JSON.stringify({email:input.email,phone:input.phone,siteId:input.site.id,productId:input.productId,variantId:input.variantId})]);
   const id="inquiry-"+randomUUID();await client.query("insert into site_inquiries(id,site_id,tenant_id,workspace_id,contact_id,product_id,variant_id,message,request_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",[id,input.site.id,input.site.tenantId,input.site.workspaceId,contactId,input.productId??null,input.variantId??null,input.message,input.requestKey]);
   await client.query("commit");return {id};
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
 }
}
