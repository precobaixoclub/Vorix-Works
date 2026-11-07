import type {PoolClient} from "pg";
import {randomUUID} from "node:crypto";
import {defaultSiteCommerceSettings,siteCommerceSettingsSchema} from "../../../domain/sites/site-commerce.js";
import {siteCommerceVersion,stableSiteJson} from "../../../domain/sites/site-commerce-draft.js";
import type {SiteSnapshot} from "../../../domain/sites/site.model.js";

/** Runs inside the site publication transaction, under the same locks as live writers. */
export async function publishSiteCommerce(client:PoolClient,site:{id:string;tenant_id:string;workspace_id:string;draft:SiteSnapshot;published?:SiteSnapshot},actor:string):Promise<SiteSnapshot>{
 const draft=site.draft,config=draft.commerceConfig;if(!config)return draft;
 await client.query("select pg_advisory_xact_lock(hashtext($1))",[`site-commerce:${site.id}`]);
 await client.query("select pg_advisory_xact_lock(hashtext($1))",[`commerce-rules:${site.id}`]);
 const currentSettings=(await client.query("select settings from site_commerce_settings where site_id=$1",[site.id])).rows[0]?.settings;
 const settings=siteCommerceSettingsSchema.parse(currentSettings??defaultSiteCommerceSettings(!!(site.published??draft).content.whatsapp));
 const current=(await client.query("select * from commerce_rules where site_id=$1 and tenant_id=$2 and workspace_id=$3",[site.id,site.tenant_id,site.workspace_id])).rows;
 if(siteCommerceVersion(settings,current)!==config.baseVersion)throw Error("SITE_REVISION_CONFLICT: as configurações comerciais em produção mudaram. Restaure a versão em produção antes de publicar.");
 if(config.settings.teamId&&!(await client.query("select id from teams where id=$1 and tenant_id=$2 and workspace_id=$3",[config.settings.teamId,site.tenant_id,site.workspace_id])).rowCount)throw Error("SITE_VALIDATION: equipe não encontrada neste workspace.");
 const desired=new Map(config.rules.map(rule=>[rule.id,rule]));
 const changed=current.filter(row=>!desired.has(row.id)||stableSiteJson(row.definition)!==stableSiteJson(desired.get(row.id)!.definition));
 const audit=async(id:string,action:string,revision:number,definition:unknown)=>client.query("insert into commerce_rule_audit(id,tenant_id,workspace_id,site_id,rule_id,actor_user_id,action,revision,definition) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",["rule-audit-"+randomUUID(),site.tenant_id,site.workspace_id,site.id,id,actor,action,revision,JSON.stringify(definition)]);
 // Remove changed definitions first so two coupons can exchange their codes atomically.
 for(const row of changed){await client.query("delete from commerce_rules where id=$1 and site_id=$2",[row.id,site.id]);if(!desired.has(row.id))await audit(row.id,"DELETE",row.revision,row.definition);}
 const versions:{id:string;revision:number}[]=[];
 for(const rule of config.rules){
  const previous=current.find(row=>row.id===rule.id);
  if(previous&&stableSiteJson(previous.definition)===stableSiteJson(rule.definition)){versions.push({id:rule.id,revision:previous.revision});continue;}
  const revision=previous?previous.revision+1:Number((await client.query("select coalesce(max(revision),0)+1 revision from commerce_rule_audit where site_id=$1 and rule_id=$2",[site.id,rule.id])).rows[0].revision);
  await client.query("insert into commerce_rules(id,tenant_id,workspace_id,site_id,definition,revision,created_by_user_id,updated_by_user_id,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz,now()))",[rule.id,site.tenant_id,site.workspace_id,site.id,JSON.stringify(rule.definition),revision,previous?.created_by_user_id??actor,actor,previous?.created_at??null]);
  await audit(rule.id,previous?"UPDATE":"CREATE",revision,rule.definition);versions.push({id:rule.id,revision});
 }
 await client.query("insert into site_commerce_settings(site_id,tenant_id,workspace_id,settings,updated_by_user_id) values($1,$2,$3,$4,$5) on conflict(site_id) do update set settings=excluded.settings,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()",[site.id,site.tenant_id,site.workspace_id,JSON.stringify(config.settings),actor]);
 return {...draft,commerceConfig:{...config,baseVersion:siteCommerceVersion(config.settings,versions)}};
}
