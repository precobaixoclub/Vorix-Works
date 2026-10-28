import pg from "pg";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { PostgresSecretManager } from "../../infrastructure/operations/postgres-secret-manager.js";
import { marketplaceProvidersFromEnv } from "../../infrastructure/marketplaces/marketplace-providers.js";
import { buildMarketplaceService } from "../../infrastructure/marketplaces/build-marketplace-service.js";
// Fila no PostgreSQL (marketplace_jobs/outbox): sem RabbitMQ. Sobe sempre com o deploy; sem canal configurado fica ocioso (saudável).
const databaseUrl=process.env.DATABASE_URL,masterKey=process.env.JWT_SECRET;
if(!databaseUrl||!masterKey)throw new Error("MARKETPLACE_WORKER_CONFIGURATION_REQUIRED");
const providers=marketplaceProvidersFromEnv(process.env);
const pool=new pg.Pool({connectionString:databaseUrl,max:5});
const {service}=buildMarketplaceService(pool,providers,new PostgresSecretManager(pool,masterKey));
console.log(JSON.stringify({event:"marketplace_worker_started",providers:providers.map(p=>p.id)}));
const heartbeat=process.env.MARKETPLACE_WORKER_HEARTBEAT_FILE;
const beat=async()=>{if(heartbeat)await writeFile(heartbeat,new Date().toISOString()).catch(()=>undefined);};
let stop=false;process.on("SIGTERM",()=>{stop=true;});process.on("SIGINT",()=>{stop=true;});
try{
 while(!stop){
  await beat();
  if(!providers.length){await sleep(60000);continue;}
  try{const active=await service.runOnce();await sleep(active?500:3000);}catch{console.error("marketplace_worker_iteration_failed");await sleep(5000);}
 }
}finally{await pool.end();}
