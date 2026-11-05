import type {Pool} from "pg";
import {randomUUID} from "node:crypto";
import {commercialRuleSchema,type CommercialRule,type CommercialRuleInput,type RuleScope} from "../../../domain/commerce/commercial-rules.js";
import type {CommercialRuleRepositoryPort} from "../../../application/ports/commercial-rule-repository.port.js";
type Row=Record<string,any>;
const map=(row:Row):CommercialRule=>({...commercialRuleSchema.parse(row.definition),id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,siteId:row.site_id,revision:row.revision,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()});
export class PostgresCommercialRuleRepository implements CommercialRuleRepositoryPort{
 constructor(private readonly pool:Pool){}
 async list(scope:RuleScope){const {rows}=await this.pool.query("select * from commerce_rules where tenant_id=$1 and workspace_id=$2 and site_id=$3 order by (definition->>'priority')::int desc,created_at,id",[scope.tenantId,scope.workspaceId,scope.siteId]);return rows.map(map);}
 async save(scope:RuleScope,input:CommercialRuleInput,actor:string,update?:{id:string;revision:number}){
  const client=await this.pool.connect();try{
   await client.query("begin");
   await client.query("select pg_advisory_xact_lock(hashtext($1))",[`commerce-rules:${scope.siteId}`]);
   if(!update&&Number((await client.query("select count(*) n from commerce_rules where site_id=$1",[scope.siteId])).rows[0].n)>=100)throw Error("SITE_VALIDATION: limite de 100 regras por loja.");
   const values=[scope.tenantId,scope.workspaceId,scope.siteId,JSON.stringify(input),actor];
   const result=update?await client.query("update commerce_rules set definition=$4,updated_by_user_id=$5,revision=revision+1,updated_at=now() where tenant_id=$1 and workspace_id=$2 and site_id=$3 and id=$6 and revision=$7 returning *",[...values,update.id,update.revision]):await client.query("insert into commerce_rules(tenant_id,workspace_id,site_id,definition,created_by_user_id,updated_by_user_id,id) values($1,$2,$3,$4,$5,$5,$6) returning *",[...values,"rule-"+randomUUID()]);
   const row=result.rows[0];if(!row){await client.query("rollback");return undefined;}
   await client.query("insert into commerce_rule_audit(id,tenant_id,workspace_id,site_id,rule_id,actor_user_id,action,revision,definition) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",["rule-audit-"+randomUUID(),scope.tenantId,scope.workspaceId,scope.siteId,row.id,actor,update?"UPDATE":"CREATE",row.revision,JSON.stringify(input)]);
   await client.query("commit");return map(row);
  }catch(error){await client.query("rollback");if((error as {code?:string}).code==="23505")throw Error("SITE_VALIDATION: esse código de cupom já está cadastrado.");throw error;}finally{client.release();}
 }
 async remove(scope:RuleScope,id:string,revision:number,actor:string){
  const client=await this.pool.connect();try{await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtext($1))",[`commerce-rules:${scope.siteId}`]);
   const {rows}=await client.query("delete from commerce_rules where tenant_id=$1 and workspace_id=$2 and site_id=$3 and id=$4 and revision=$5 returning *",[scope.tenantId,scope.workspaceId,scope.siteId,id,revision]);
   if(rows[0])await client.query("insert into commerce_rule_audit(id,tenant_id,workspace_id,site_id,rule_id,actor_user_id,action,revision,definition) values($1,$2,$3,$4,$5,$6,'DELETE',$7,$8)",["rule-audit-"+randomUUID(),scope.tenantId,scope.workspaceId,scope.siteId,id,actor,revision,JSON.stringify(rows[0].definition)]);
   await client.query("commit");return !!rows[0];
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
 }
}
