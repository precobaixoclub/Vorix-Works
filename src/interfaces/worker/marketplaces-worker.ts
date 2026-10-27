import pg from "pg";
import { setTimeout as sleep } from "node:timers/promises";
import { PostgresSecretManager } from "../../infrastructure/operations/postgres-secret-manager.js";
import { mercadoLivreConfig } from "../../infrastructure/marketplaces/mercado-livre-provider.js";
import { buildMarketplaceService } from "../../infrastructure/marketplaces/build-marketplace-service.js";
const config=mercadoLivreConfig(process.env),databaseUrl=process.env.DATABASE_URL,masterKey=process.env.JWT_SECRET;
if(!config||!databaseUrl||!masterKey)throw new Error("MARKETPLACE_WORKER_CONFIGURATION_REQUIRED");
const pool=new pg.Pool({connectionString:databaseUrl,max:5});
const {service}=buildMarketplaceService(pool,config,new PostgresSecretManager(pool,masterKey));
let stop=false;process.on("SIGTERM",()=>{stop=true;});process.on("SIGINT",()=>{stop=true;});
try{while(!stop){try{const active=await service.runOnce();await sleep(active?500:3000);}catch{console.error("marketplace_worker_iteration_failed");await sleep(5000);}}}finally{await pool.end();}
