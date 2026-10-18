import type {Pool} from "pg";
import type {CapacityMutationRepositoryPort,CapacityMutationRepositories} from "../../../application/ports/capacity-mutation-repository.port.js";
import {PostgresSubscriptionRepository,PostgresSubscriptionItemRepository} from "./postgres-subscription-repository.js";
import {PostgresSubscriptionPendingChangeRepository} from "./postgres-subscription-pending-change-repository.js";
import {PostgresBillingEventRepository} from "./postgres-billing-ops-repository.js";
export class PostgresCapacityMutationRepository implements CapacityMutationRepositoryPort{
 private static readonly queues=new Map<string,Promise<void>>();
 constructor(private readonly pool:Pool){}
 async run<T>(tenantId:string,work:(repositories:CapacityMutationRepositories)=>Promise<T>):Promise<T>{
  const previous=PostgresCapacityMutationRepository.queues.get(tenantId)??Promise.resolve();let release!:()=>void;
  const next=new Promise<void>(resolve=>{release=resolve;});PostgresCapacityMutationRepository.queues.set(tenantId,next);await previous;
  try{return await this.execute(tenantId,work);}finally{release();if(PostgresCapacityMutationRepository.queues.get(tenantId)===next)PostgresCapacityMutationRepository.queues.delete(tenantId);}
 }
 private async execute<T>(tenantId:string,work:(repositories:CapacityMutationRepositories)=>Promise<T>):Promise<T>{
  const client=await this.pool.connect();
  let writing=false;
  try{
   await client.query("select pg_advisory_lock(hashtext($1))",[`billing-capacity:${tenantId}`]);
   const connection=client as unknown as Pool;
   const value=await work({beginCapacityWrite:async()=>{if(!writing){await client.query("begin");writing=true;}},subscriptionRepository:new PostgresSubscriptionRepository(connection),subscriptionItemRepository:new PostgresSubscriptionItemRepository(connection),subscriptionPendingChangeRepository:new PostgresSubscriptionPendingChangeRepository(connection),billingEventRepository:new PostgresBillingEventRepository(connection)});
   if(writing)await client.query("commit");return value;
  }catch(error){if(writing)await client.query("rollback");throw error;}finally{try{await client.query("select pg_advisory_unlock(hashtext($1))",[`billing-capacity:${tenantId}`]);}finally{client.release();}}
 }
}
