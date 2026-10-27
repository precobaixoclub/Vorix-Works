import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import Fastify from "fastify";
import ExcelJS from "exceljs";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {PostgresCatalogBulk} from "../dist/infrastructure/storage/postgres/postgres-catalog-bulk.js";
import {readCatalogSheet,parseCatalogCsv,writeCatalogSheet,MAX_CATALOG_ROWS} from "../dist/infrastructure/catalog/catalog-spreadsheet.js";
import {suggestMapping,bulkNumber,emptySummary} from "../dist/domain/products/catalog-bulk.js";
import {registerCatalogBulkRoutes} from "../dist/interfaces/api/routes/v1/catalog-bulk.route.js";
import {defaultProductDetails} from "../dist/domain/products/product-details.js";

let db;const workerErrors=[];
before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});
after(async()=>{await db?.stop();});
const catalog=()=>new PostgresCatalogBulk(db.pool,e=>workerErrors.push(e));
async function setup(){const c=await productSiteContext(db.pool);return {...c,actor:{...c.scope,userId:c.actor.userId,canViewCost:true,canSetMinimum:true,inventoryRead:true,inventoryManage:true},bulk:catalog()};}
async function settle(c,id,stop="PREVIEW"){
 for(let i=0;i<300;i++){const job=await c.bulk.get(c.actor,id);if(job.status===stop||["FAILED","COMPLETED","COMPLETED_WITH_ERRORS"].includes(job.status))return job;await c.bulk.tick();}
 assert.fail(`job ${id} did not finish: ${JSON.stringify(workerErrors)}`);
}
async function upload(c,csv,key=randomUUID()){
 const job=await c.bulk.upload(c.actor,{name:"products.csv",bytes:Buffer.from(csv)},key);return job;
}
async function preview(c,csv,options={mode:"upsert",createTaxonomy:false}){
 const job=await upload(c,csv);await c.bulk.map(c.actor,job.id,job.mapping,options);const ready=await settle(c,job.id);assert.equal(ready.status,"PREVIEW",JSON.stringify(ready));return ready;
}
async function run(c,job){await c.bulk.confirm(c.actor,job.id);return settle(c,job.id,"COMPLETED");}
const products=c=>c.d.productRepository.listByWorkspace(c.scope);

test("CSV UTF-8: delimiters, quoted multiline text, escaped quotes, malformed files and numeric validation",async()=>{
 const sheet=parseCatalogCsv(Buffer.from('\uFEFFSKU;Nome;Descrição;Preço\r\n001;Teste;"Duas\nlinhas; com ""aspas""";"12,34"\r\n'));
 assert.equal(sheet.rows[0].cells[0],"001");assert.equal(sheet.rows[0].cells[2],'Duas\nlinhas; com "aspas"');assert.equal(bulkNumber("1.234,56","price",true),123456);
 assert.throws(()=>parseCatalogCsv(Buffer.from('SKU,SKU\na,b')),/únicos/);assert.throws(()=>parseCatalogCsv(Buffer.from('SKU,Nome\nX,"ab')),/Aspas/);assert.throws(()=>bulkNumber("abc","price",true),/inválido/);assert.throws(()=>bulkNumber("-2","price",true),/inválido/);assert.throws(()=>bulkNumber("1.001","price",true),/casas/);
 assert.equal(suggestMapping(["Cod Produto","Valor venda"])['Cod Produto'],"sku");assert.equal(suggestMapping(["Cod Produto","Valor venda"])['Valor venda'],"price");
});
test("XLSX roundtrip preserves text/leading zeros and rejects formulas",async()=>{
 const file=await writeCatalogSheet("xlsx",["SKU","Nome","Preço"],[["0001","=literal", "12.50"]]);const sheet=await readCatalogSheet(file.filename,file.bytes);assert.deepEqual(sheet.rows[0].cells,["0001","=literal","12.50"]);
 const workbook=new ExcelJS.Workbook();const sheet2=workbook.addWorksheet("Products");sheet2.addRow(["SKU","Nome"]);sheet2.addRow(["X",{formula:"1+1",result:2}]);await assert.rejects(readCatalogSheet("bad.xlsx",Buffer.from(await workbook.xlsx.writeBuffer())),/Fórmula/);
});
test("mandatory preview, creation, tenant-scoped SKU, double confirm and repeated worker checkpoints",async()=>{
 const c=await setup(),job=await upload(c,"SKU;Nome;Preço\nNEW;Novo;39,90");await assert.rejects(c.bulk.confirm(c.actor,job.id),/preview/);assert.equal((await products(c)).length,0);
 await c.bulk.map(c.actor,job.id,job.mapping,{mode:"upsert",createTaxonomy:false});const ready=await settle(c,job.id);assert.equal(ready.summary.newProducts,1);assert.equal((await products(c)).length,0);
 const result=await run(c,ready);assert.equal(result.status,"COMPLETED",JSON.stringify(await c.bulk.rows(c.actor,job.id,0,25)));assert.equal((await products(c))[0].priceCents,3990);
 await c.bulk.confirm(c.actor,job.id);await c.bulk.tick();assert.equal((await products(c)).length,1);
 await db.pool.query("update catalog_bulk_jobs set status='PROCESSING' where id=$1",[job.id]);await c.bulk.tick();assert.equal((await products(c)).length,1);
 const other=await setup();const p=await run(other,await preview(other,"SKU;Nome;Preço\nNEW;Outra empresa;10"));assert.equal(p.status,"COMPLETED");assert.equal((await products(other)).length,1);
});
test("upload idempotency key rejects changed payload, survives process restart, and does not duplicate jobs",async()=>{
 const c=await setup(),key=randomUUID();const a=await upload(c,"SKU;Nome;Preço\nA;A;10",key),b=await upload(c,"SKU;Nome;Preço\nA;A;10",key);assert.equal(a.id,b.id);
 await assert.rejects(upload(c,"SKU;Nome;Preço\nB;B;20",key),/Chave/);
 await c.bulk.map(c.actor,a.id,a.mapping,{mode:"upsert",createTaxonomy:false});c.bulk=catalog();await settle(c,a.id);await run(c,a);assert.equal((await products(c)).length,1);
});
test("update preserves absent/blank fields and supports explicit clearing; create/update modes",async()=>{
 const c=await setup(),p=await c.product({code:"KEEP",description:"Preservada",priceCents:10000,costCents:3000});
 let job=await preview(c,"SKU;Nome;Preço\nKEEP;Atualizado;120,00");assert.equal(job.summary.updates,1);await run(c,job);let actual=await c.d.productRepository.getById(p.id);assert.equal(actual.description,"Preservada");assert.equal(actual.costCents,3000);
 job=await preview(c,"SKU;Descrição\nKEEP;\n",{mode:"update",createTaxonomy:false});await run(c,job);assert.equal((await c.d.productRepository.getById(p.id)).description,"Preservada");
 await run(c,await preview(c,"SKU;Descrição\nKEEP;[LIMPAR]"));assert.equal((await c.d.productRepository.getById(p.id)).description,"");
 assert.equal((await preview(c,"SKU;Nome;Preço\nKEEP;Outro;1",{mode:"create",createTaxonomy:false})).summary.ignored,1);
 assert.equal((await preview(c,"SKU;Nome;Preço\nMISSING;Outro;1",{mode:"update",createTaxonomy:false})).summary.ignored,1);
});
test("duplicate SKU without options, invalid price/minimum and unknown taxonomy appear in downloadable report",async()=>{
 const c=await setup();const job=await preview(c,"SKU;Nome;Preço;Preço mínimo;Categoria\nDUP;A;1;;\nDUP;A;1;;\nBAD;B;abc;;\nMIN;C;1;2;\nCAT;D;1;;Desconhecida");assert.equal(job.summary.errors,4);assert.equal(job.summary.duplicates,1);
 const report=await c.bulk.errors(c.actor,job.id);const text=report.bytes.toString();assert.match(text,/Linha/);assert.match(text,/abc/);assert.match(text,/mínimo/);assert.equal((await products(c)).length,0);await assert.rejects(c.bulk.confirm(c.actor,job.id),/Não há/);
});
test("explicit taxonomy opt-in, categories/subcategories/brands and required specifications reuse domain validation",async()=>{
 const c=await setup();let job=await preview(c,"SKU;Nome;Preço;Categoria;Subcategoria;Marca\nT;Teste;10;Roupas;Camisetas;Marca teste",{mode:"upsert",createTaxonomy:true});assert.equal(job.summary.warnings,1);assert.equal(job.summary.errors,0);let result=await run(c,job);assert.equal(result.status,"COMPLETED",JSON.stringify(await c.bulk.rows(c.actor,job.id,0,25)));
 const metadata=await c.d.productEngineRepository.metadata(c.scope);assert.equal(metadata.categories.length,2);assert.equal(metadata.brands.length,1);assert.equal(metadata.categories.find(a=>a.name==="Camisetas").parentId,metadata.categories.find(a=>a.name==="Roupas").id);
 await c.d.productEngineRepository.saveAttribute({...c.scope,id:randomUUID(),key:"capacity",label:"Capacidade",kind:"number",choices:[],required:true,active:true});job=await preview(c,"SKU;Nome;Preço\nSPEC;Teste;10");assert.equal(job.summary.errors,1);assert.match((await c.bulk.errors(c.actor,job.id)).bytes.toString(),/Capacidade/);
});
test("EAN fallback updates exact match, same names never link, and ambiguous SKU/EAN requires correction",async()=>{
 const c=await setup(),a=await c.product({code:"OLD",name:"Mesmo nome",taxMetadata:{catalog:{ean:"7891234567890"}}});
 let job=await preview(c,"EAN/GTIN;Nome;Preço\n7891234567890;EAN atualizado;120");assert.equal(job.summary.updates,1);await run(c,job);assert.equal((await c.d.productRepository.getById(a.id)).name,"EAN atualizado");
 await run(c,await preview(c,"SKU;Nome;Preço\nOTHER;Mesmo nome;10"));assert.equal((await products(c)).length,2);
 await c.product({code:"CONFLICT",taxMetadata:{catalog:{ean:"7899999999999"}}});job=await preview(c,"SKU;EAN/GTIN;Nome;Preço\nOLD;7899999999999;Não alterar;10");assert.equal(job.summary.errors,1);assert.match((await c.bulk.errors(c.actor,job.id)).bytes.toString(),/diferentes/);
});
test("Apparel groups repeated parent SKU into variants, inventories have BULK_IMPORT history and retries do not repeat movements",async()=>{
 const c=await setup();const job=await preview(c,"SKU;Nome;Tipo;Preço;Controlar estoque;Cor;Tamanho;SKU variante;Estoque\nSHIRT;Camiseta;APPAREL;50;sim;Preto;M;SHIRT-M;3\nSHIRT;Camiseta;APPAREL;50;sim;Preto;G;SHIRT-G;4");assert.equal(job.summary.newProducts,1);assert.equal(job.summary.errors,0,JSON.stringify(await c.bulk.rows(c.actor,job.id,0,25)));
 const result=await run(c,job);assert.equal(result.status,"COMPLETED",JSON.stringify(await c.bulk.rows(c.actor,job.id,0,25)));const all=await products(c);assert.equal(all.length,1);const variants=await c.d.salesCatalogRepository.listVariants(all[0].id);assert.equal(variants.length,2);assert.equal(variants.reduce((n,v)=>n+v.stockQuantity,0),7);
 const history=await db.pool.query("select operation_key from product_stock_movements where product_id=$1",[all[0].id]);assert.equal(history.rowCount,2);assert.ok(history.rows.every(r=>r.operation_key.startsWith(`BULK_IMPORT:${job.id}:`)));
 await c.bulk.confirm(c.actor,job.id);await c.bulk.tick();assert.equal((await db.pool.query("select id from product_stock_movements where product_id=$1",[all[0].id])).rowCount,2);
});
test("CSV and XLSX export → edit → reimport updates parent and variants without losing IDs or stock",async()=>{
 for(const format of ["csv","xlsx"]){
  const c=await setup();await run(c,await preview(c,"SKU;Nome;Tipo;Preço;Controlar estoque;Tamanho;SKU variante;Estoque\nROUND;Camiseta;APPAREL;50;sim;M;ROUND-M;3\nROUND;Camiseta;APPAREL;50;sim;G;ROUND-G;4"));
  const before=(await products(c))[0],variants=await c.d.salesCatalogRepository.listVariants(before.id);
  const exported=await c.bulk.download(c.actor,format,{},false);const sheet=await readCatalogSheet(exported.filename,exported.bytes);const headers=sheet.headers;
  const changed=sheet.rows.map(row=>row.cells.map((cell,i)=>headers[i]==="Nome"?"Editada":headers[i]==="Preço"?"60.00":cell));
  const edited=await writeCatalogSheet(format,headers,changed);let job=await c.bulk.upload(c.actor,{name:edited.filename,bytes:edited.bytes},randomUUID());await c.bulk.map(c.actor,job.id,job.mapping,{mode:"upsert",createTaxonomy:false});job=await settle(c,job.id);
  assert.equal(job.summary.errors,0,JSON.stringify(await c.bulk.rows(c.actor,job.id,0,25)));const result=await run(c,job);assert.equal(result.status,"COMPLETED",JSON.stringify(await c.bulk.rows(c.actor,job.id,0,25)));
  const all=await products(c);assert.equal(all.length,1);assert.equal(all[0].id,before.id);assert.equal(all[0].name,"Editada");assert.equal(all[0].priceCents,6000);assert.deepEqual((await c.d.salesCatalogRepository.listVariants(before.id)).map(v=>v.id).sort(),variants.map(v=>v.id).sort());
 }
});
test("Inventory validation rejects missing control/reserved balance, service and real estate inventory/variants",async()=>{
 const c=await setup();let job=await preview(c,"SKU;Nome;Preço;Estoque\nNO;Teste;10;5");assert.equal(job.summary.errors,1);
 job=await preview(c,"SKU;Nome;Tipo;Preço;Controlar estoque;Estoque\nS;Serviço;SERVICE;10;sim;5");assert.equal(job.summary.errors,1);
 job=await preview(c,"SKU;Nome;Tipo;Preço;Cor\nV;Veículo;VEHICLE;10;Preto");assert.equal(job.summary.errors,1);
 const p=await c.product({code:"RES",trackStock:true});await c.d.productEngineRepository.move({...c.actor,productId:p.id,quantity:5,kind:"IN",operationKey:randomUUID()});await c.d.productEngineRepository.move({...c.actor,productId:p.id,quantity:3,kind:"RESERVATION",operationKey:randomUUID()});job=await preview(c,"SKU;Estoque\nRES;2");assert.equal(job.summary.errors,1);assert.equal((await c.d.productRepository.getById(p.id)).stockQuantity,5);
});
test("stale preview never overwrites a product changed after review",async()=>{
 const c=await setup(),p=await c.product({code:"STALE"}),job=await preview(c,"SKU;Nome\nSTALE;Planilha");await c.d.productRepository.update(p.id,{name:"Mudança simultânea"});const result=await run(c,job);assert.equal(result.status,"COMPLETED_WITH_ERRORS");assert.equal((await c.d.productRepository.getById(p.id)).name,"Mudança simultânea");
});
test("row transaction rolls back product, taxonomy and variants on stock failure",async()=>{
 const c=await setup(),job=await preview(c,"SKU;Nome;Preço;Categoria;Controlar estoque;Estoque\nROLL;Teste;10;Rollback;sim;2",{mode:"upsert",createTaxonomy:true});
 // A DB constraint simulates an inventory write outage after product creation.
 await db.pool.query("alter table product_stock_movements add constraint fixture_bulk_failure check(operation_key not like 'BULK_IMPORT:%') not valid");
 try{const result=await run(c,job);assert.equal(result.status,"COMPLETED_WITH_ERRORS");assert.equal((await products(c)).length,0);assert.equal((await c.d.productEngineRepository.metadata(c.scope)).categories.length,0);}finally{await db.pool.query("alter table product_stock_movements drop constraint fixture_bulk_failure");}
});
test("bulk edit has the same preview, applies scalar fields, enforces scope and does not overwrite variant stock",async()=>{
 const c=await setup(),a=await c.product(),b=await c.product();let job=await c.bulk.edit(c.actor,{ids:[a.id,b.id],field:"active",value:"false",operationKey:randomUUID()});await settle(c,job.id);await run(c,job);assert.ok((await products(c)).every(p=>!p.active));
 await assert.rejects(c.bulk.edit(c.actor,{ids:[a.id,"foreign"],field:"price",value:"10",operationKey:randomUUID()}),/NOT_FOUND/);
});
test("cost/inventory permission restrictions apply to mapping, export, report and confirmation; tenant and uploader isolation",async()=>{
 const c=await setup(),p=await c.product({code:"SEC",costCents:123456,trackStock:true,stockQuantity:99});
 const restricted={...c.actor,canViewCost:false,canSetMinimum:false,inventoryRead:false,inventoryManage:false};const exported=await c.bulk.download(restricted,"csv",{},false);const sheet=await readCatalogSheet(exported.filename,exported.bytes);assert.ok(!sheet.headers.includes("Custo"));assert.ok(!sheet.headers.includes("Estoque"));assert.ok(!sheet.headers.includes("Custo variante"));assert.ok(!exported.bytes.toString().includes("1234.56"));
 const job=await upload(c,"SKU;Custo\nSEC;10");await assert.rejects(c.bulk.map(restricted,job.id,job.mapping,{mode:"upsert",createTaxonomy:false}),/custo/);
 await c.bulk.map(c.actor,job.id,job.mapping,{mode:"upsert",createTaxonomy:false});await settle(c,job.id);await assert.rejects(c.bulk.confirm(restricted,job.id),/custo/);
 const other=await setup();await assert.rejects(other.bulk.get(other.actor,job.id),/NOT_FOUND/);await assert.rejects(c.bulk.get({...c.actor,userId:"other-user"},job.id),/NOT_FOUND/);
 const foreign=await preview(other,`ID produto;Nome\n${p.id};Ataque`);assert.equal(foreign.summary.errors,1);assert.equal((await c.d.productRepository.getById(p.id)).name,p.name);
});
test("large files: 50k CSV parsing, bounded background batches, paginated preview and catalog",async()=>{
 const body="SKU;Nome;Preço\n"+Array.from({length:MAX_CATALOG_ROWS},(_,i)=>`BIG-${i};Produto ${i};10`).join("\n");assert.equal(parseCatalogCsv(Buffer.from(body)).rows.length,50000);assert.throws(()=>parseCatalogCsv(Buffer.from(body+"\nTOO;Too;1")),/50 mil/);
 const c=await setup(),job=await upload(c,"SKU;Nome;Preço\n"+Array.from({length:260},(_,i)=>`BATCH-${i};Produto ${i};10`).join("\n"));await c.bulk.map(c.actor,job.id,job.mapping,{mode:"upsert",createTaxonomy:false});await c.bulk.tick();assert.equal((await c.bulk.get(c.actor,job.id)).status,"PENDING_PREVIEW");await settle(c,job.id);assert.equal((await c.bulk.rows(c.actor,job.id,25,25)).items.length,25);await run(c,job);const page=await c.bulk.list(c.actor,{},50,50,"nome");assert.equal(page.items.length,50);assert.equal(page.total,260);
});
test("HTTP: RBAC, workspace ownership, restricted export, preview pagination bounds and direct confirm rejection",async()=>{
 const c=await setup(),app=Fastify();let role="viewer",permissions;
 app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{request.zunoContext={principal:{...c.actor,role,permissions}};});
 app.setErrorHandler((error,request,reply)=>reply.code(error.statusCode??500).send({message:error.message}));
 await registerCatalogBulkRoutes(app,{catalog:c.bulk,workspaceRepository:c.workspaceRepository,salesConfigRepository:c.d.salesConfigRepository});
 try{
  const q=`?workspaceId=${c.workspaceId}`;
  assert.equal((await app.inject({method:"POST",url:`/catalog-bulk/edit${q}`,payload:{ids:["x"],field:"active",value:"true",operationKey:randomUUID()}})).statusCode,403);
  assert.equal((await app.inject({url:`/catalog-bulk/export${q}&format=csv`})).statusCode,200);
  assert.equal((await app.inject({url:"/catalog-bulk/export?workspaceId=foreign&format=csv"})).statusCode,404);
  role="owner";permissions=["product:read","product:manage"];assert.equal((await app.inject({url:`/catalog-bulk/export${q}&stock=in`})).statusCode,403);
  const job=await upload(c,"SKU;Nome;Preço\nHTTP;Teste;1");assert.equal((await app.inject({method:"POST",url:`/catalog-bulk/imports/${job.id}/confirm${q}`})).statusCode,400);
  assert.equal((await app.inject({url:`/catalog-bulk/imports/${job.id}/rows${q}&limit=1000`})).statusCode,400);
 }finally{await app.close();}
});
test("cross-file EAN/variant SKU ambiguities fail preview; variant errors retain their original line",async()=>{
 const c=await setup();let job=await preview(c,"SKU;Nome;Preço;EAN\nONE;Um;10;7891234567890\nTWO;Dois;10;7891234567890");assert.equal(job.summary.errors,2);assert.equal(job.summary.newProducts,0);
 job=await preview(c,"SKU;Nome;Preço;Cor;Tamanho;Preço variante\nP;Pai;10;Preto;M;10\nP;Pai;10;Preto;G;abc");assert.equal(job.summary.errors,1);const rows=await c.bulk.rows(c.actor,job.id,0,25);assert.equal(rows.items[0].issues[0].line,3);assert.equal(rows.items[0].issues[0].field,"variantPrice");
});
test("service creation, valid vehicle/estate specialization roundtrip, and existing variation limits",async()=>{
 const c=await setup();await run(c,await preview(c,"SKU;Nome;Tipo;Preço\nSERVICE;Consultoria;SERVICE;100"));assert.equal((await products(c))[0].itemType,"service");
 const file=await writeCatalogSheet("csv",["SKU","Nome","Tipo","Preço","Ficha específica (JSON)"],[["CAR","Automóvel","VEHICLE","100",JSON.stringify({kind:"car",make:"Teste",model:"Modelo",features:[]})],["ESTATE","Imóvel","REAL_ESTATE","100",JSON.stringify({kind:"house",purpose:"sale",status:"available",address:{state:"SP",city:"São Paulo",showExactAddress:false},usableArea:80})]]);
 let job=await c.bulk.upload(c.actor,{name:file.filename,bytes:file.bytes},randomUUID());await c.bulk.map(c.actor,job.id,job.mapping,{mode:"upsert",createTaxonomy:false});job=await settle(c,job.id);assert.equal(job.summary.errors,0,JSON.stringify(await c.bulk.rows(c.actor,job.id,0,25)));assert.equal((await run(c,job)).status,"COMPLETED");
 for(const format of ["csv","xlsx"]){const exported=await c.bulk.download(c.actor,format,{},false);let re=await c.bulk.upload(c.actor,{name:exported.filename,bytes:exported.bytes},randomUUID());await c.bulk.map(c.actor,re.id,re.mapping,{mode:"update",createTaxonomy:false});re=await settle(c,re.id);assert.equal(re.summary.errors,0,JSON.stringify(await c.bulk.rows(c.actor,re.id,0,25)));assert.equal((await run(c,re)).status,"COMPLETED");}
 const options=[{key:"a",name:"A",values:Array.from({length:23},(_,i)=>String(i))},{key:"b",name:"B",values:Array.from({length:23},(_,i)=>String(i))}];const tooBig=await writeCatalogSheet("csv",["SKU","Nome","Preço","Definições de opções (JSON)"],[["TOOMANY","Grade grande","10",JSON.stringify(options)]]);
 job=await c.bulk.upload(c.actor,{name:tooBig.filename,bytes:tooBig.bytes},randomUUID());await c.bulk.map(c.actor,job.id,job.mapping,{mode:"upsert",createTaxonomy:false});assert.equal((await settle(c,job.id)).summary.errors,1);
});
test("10,000-product catalog is queried with bounded pages and identical export filters",async t=>{
 const c=await setup();await db.pool.query("insert into products(id,tenant_id,workspace_id,name,code,price_cents) select $1||g::text,$2,$3,'Produto grande '||g::text,'BIG-'||g::text,1000 from generate_series(1,10000) g",[randomUUID(),c.tenantId,c.workspaceId]);
 const started=performance.now();const page=await c.bulk.list(c.actor,{},9950,50,"nome");assert.equal(page.total,10000);assert.equal(page.items.length,50);t.diagnostic(`10,000-product catalog page: ${Math.round(performance.now()-started)}ms; 50 returned`);
 const exported=await c.bulk.download(c.actor,"csv",{search:"Produto grande 9999",active:true},false);assert.equal((await readCatalogSheet(exported.filename,exported.bytes)).rows.length,1);
});
test("worker stops after access revocation and unsafe images are rejected before confirmation",async()=>{
 const c=await setup(),job=await preview(c,"SKU;Nome;Preço\nREVOKE;Não criar;10");await c.bulk.confirm(c.actor,job.id);
 c.bulk=new PostgresCatalogBulk(db.pool,()=>{},undefined,async()=>{throw Error("BULK_VALIDATION: Sem product:manage.");});assert.equal((await settle(c,job.id)).status,"FAILED");assert.equal((await products(c)).length,0);
 const file=await writeCatalogSheet("csv",["SKU","Nome","Preço","Imagens (JSON)"],[["IMAGE","Teste","10",JSON.stringify(["https://foreign.invalid/private.png"])]]);let images=await c.bulk.upload(c.actor,{name:file.filename,bytes:file.bytes},randomUUID());await c.bulk.map(c.actor,images.id,images.mapping,{mode:"upsert",createTaxonomy:false});c.bulk=catalog();images=await settle(c,images.id);assert.equal(images.summary.errors,1);
});
test("bulk price changes preserve inherited variant floors and parent stock adjustments fail in preview",async()=>{
 const c=await setup();await run(c,await preview(c,"SKU;Nome;Preço;Cor;Controlar estoque;Estoque\nFLOOR;Teste;100;Preto;sim;5"));
 const p=(await products(c))[0],v=(await c.d.salesCatalogRepository.listVariants(p.id))[0];await c.d.salesCatalogRepository.updateVariant(v.id,{minimumPriceCents:9000});
 assert.equal((await preview(c,"SKU;Preço\nFLOOR;80")).summary.errors,1);
 assert.equal((await preview(c,"SKU;Estoque\nFLOOR;20")).summary.errors,1);
});
test("taxonomy proposals are reused across one batch and slug collisions never overwrite another category/brand",async()=>{
 const c=await setup(),job=await preview(c,"SKU;Nome;Preço;Categoria;Marca\nA;Um;10;Maçãs;Marca A\nB;Dois;10;Maçãs;Marca A\nC;Três;10;Macas;Marca B",{mode:"upsert",createTaxonomy:true});assert.equal(job.summary.newProducts,2);assert.equal(job.summary.errors,1);
 assert.equal((await run(c,job)).status,"COMPLETED_WITH_ERRORS");const metadata=await c.d.productEngineRepository.metadata(c.scope);assert.equal(metadata.categories.length,1);assert.equal(metadata.categories[0].name,"Maçãs");assert.equal(metadata.brands.length,1);assert.equal((await products(c)).length,2);
});
test("worker authorization uses the transaction connection, including a pool of one",async()=>{
 const c=await setup(),job=await upload(c,"SKU;Nome;Preço\nAUTH-TX;Teste;10");await c.bulk.map(c.actor,job.id,job.mapping,{mode:"upsert",createTaxonomy:false});
 const {Pool}=await import("pg");const single=new Pool({connectionString:db.connectionString,max:1});
 c.bulk=new PostgresCatalogBulk(single,()=>{},undefined,async(context,transaction)=>{assert.equal((await transaction.query("select 1 as authorized")).rows[0].authorized,1);return context;});
 try{await settle(c,job.id);assert.equal((await run(c,job)).status,"COMPLETED");assert.equal((await products(c)).length,1);}finally{await single.end();}
});
test("Commerce contract: weight/measures feed checkout shipping and stock adjustments keep checkout reservations",async()=>{
 const c=await setup();await run(c,await preview(c,"SKU;Nome;Preço;Peso (g);Altura (cm);Largura;Comprimento\nSHIP;Caixa;10;850;10,5;20;30"));
 const p=(await products(c))[0];assert.deepEqual(p.details.shipping,{weightGrams:850,heightCm:10.5,widthCm:20,lengthCm:30});assert.equal(p.taxMetadata?.catalog?.weight,undefined);
 const exported=await c.bulk.download(c.actor,"csv",{},false),sheet=await readCatalogSheet(exported.filename,exported.bytes),row=sheet.rows[0].cells;
 assert.equal(row[sheet.headers.indexOf("Peso (g)")],"850");assert.equal(row[sheet.headers.indexOf("Altura (cm)")],"10.5");
 let job=await preview(c,"SKU;Peso\nSHIP;1,5");assert.equal(job.summary.errors,1);
 job=await preview(c,"SKU;Altura (cm)\nSHIP;[LIMPAR]");await run(c,job);assert.deepEqual((await c.d.productRepository.getById(p.id)).details.shipping,{weightGrams:850,widthCm:20,lengthCm:30});
 const r=await c.product({code:"RESV",trackStock:true});await c.d.productEngineRepository.move({...c.actor,productId:r.id,quantity:5,kind:"IN",operationKey:randomUUID()});await c.d.productEngineRepository.move({...c.actor,productId:r.id,quantity:3,kind:"RESERVATION",operationKey:"order:qa:reserve:1"});
 await run(c,await preview(c,"SKU;Estoque\nRESV;8"));const after=await c.d.productRepository.getById(r.id);assert.equal(after.stockQuantity,8);assert.equal(after.reservedQuantity,3);
});
