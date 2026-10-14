// Explicit fixture-only composition root; production application/authentication remain unchanged.
import pg from 'pg';
import { buildApp } from '../../dist/interfaces/api/app.js';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const database=(await pool.query('select current_database() as name')).rows[0].name;
await pool.end();
if(!database.startsWith('vorix_structural_fixture_'))throw new Error('Fixture database required');
const app=await buildApp();
app.get('/fixture-only/scope',async()=>({fixtureOnly:true,database,googleRealEnabled:false}));
await app.listen({host:'0.0.0.0',port:3300});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
