import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import Fastify from "fastify";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {registerProductsRoutes} from "../dist/interfaces/api/routes/v1/products.route.js";
import {productMutation} from "../dist/infrastructure/storage/postgres/product-mutation.js";

// Cadastro em etapas: produto, fotos e combinações gravados num único envio, sem salvar e reabrir.
let db;before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(async()=>{await db?.stop();});
const storage={resolvePublicUrl:key=>`http://storage.invalid/${key}`};

async function api(role="owner"){
 const c=await productSiteContext(db.pool);const app=Fastify();app.decorateRequest("zunoContext",null);
 app.addHook("onRequest",async request=>{request.zunoContext={principal:{tenantId:c.tenantId,role,userId:c.actor.userId}};});
 await registerProductsRoutes(app,{withProductMutation:productMutation(db.pool),productRepository:c.d.productRepository,productEngineRepository:c.d.productEngineRepository,salesCatalogRepository:c.d.salesCatalogRepository,salesConfigRepository:c.d.salesConfigRepository,objectStorage:storage});
 const photo=name=>`http://storage.invalid/assets/${c.tenantId}/${c.workspaceId}/products/${name}.jpg`;
 const call=async(method,url,payload)=>{const response=await app.inject({method,url,payload:{workspaceId:c.workspaceId,...payload}});return {status:response.statusCode,body:response.json()};};
 const variants=async productId=>(await c.d.salesCatalogRepository.listVariants(productId)).sort((a,b)=>a.position-b.position);
 return {c,app,photo,call,variants};
}
const MARROM="#6B4423";
const details=(photo,colors=["Preto","Marrom — Logo Branca","Marrom — Logo Preta"],sizes=["P","M"])=>({type:"APPAREL",segment:"apparel",specs:[{key:"fit",label:"Modelagem",value:"Oversized"}],options:[
 {key:"size",name:"Tamanho",values:sizes},
 {key:"color",name:"Cor",values:colors,swatches:Object.fromEntries(colors.filter(c=>c.startsWith("Marrom")).map(c=>[c,MARROM])),images:Object.fromEntries(colors.filter(c=>c==="Preto").map(c=>[c,photo("preto")]))},
]});
const grid=(sizes,colors,extra=()=>({}))=>sizes.flatMap(size=>colors.map(color=>({optionValues:{size,color},active:true,...extra(size,color)})));

test("cria produto, fotos e combinações num único envio: foto por cor, mesma cor visual com nomes diferentes e estoque por combinação",async()=>{
 const {app,photo,call,variants}=await api();
 try{
  const colors=["Preto","Marrom — Logo Branca","Marrom — Logo Preta"];
  const created=await call("POST","/products",{name:"Camiseta Oversized Vorix",priceCents:7990,trackStock:true,imageUrls:[photo("preto"),photo("marrom-branca"),photo("marrom-preta")],details:details(photo),variants:grid(["P","M"],colors,(size,color)=>({stockQuantity:size==="P"?10:4,imageUrl:color==="Preto"?photo("preto"):color.endsWith("Branca")?photo("marrom-branca"):photo("marrom-preta")}))});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const product=created.body.data,list=await variants(product.id);
  assert.equal(list.length,6);
  assert.deepEqual(product.details.options[1].swatches,{"Marrom — Logo Branca":MARROM,"Marrom — Logo Preta":MARROM},"duas variações com a mesma cor visual continuam independentes");
  assert.equal(new Set(list.map(item=>item.optionValues.color)).size,3);
  assert.equal(list.find(item=>item.optionValues.color==="Marrom — Logo Preta").imageUrl,photo("marrom-preta"));
  assert.equal(list.filter(item=>item.optionValues.size==="P").every(item=>item.stockQuantity===10),true);
  assert.equal(product.stockQuantity,3*10+3*4,"saldo do produto soma as combinações");
  assert.deepEqual(product.details.specs,[{key:"fit",label:"Modelagem",value:"Oversized"}]);
 }finally{await app.close();}
});

test("editar: renomear valor preserva a combinação, remover valor apaga as dele, novo valor cria, estoque e preço são ajustados",async()=>{
 const {app,photo,call,variants}=await api();
 try{
  const colors=["Preto","Marrom — Logo Preta"];
  const product=(await call("POST","/products",{name:"Camiseta",priceCents:7990,trackStock:true,imageUrls:[photo("preto")],details:details(photo,colors),variants:grid(["P","M"],colors,()=>({stockQuantity:5}))})).body.data;
  const before=await variants(product.id);
  const keep=before.filter(item=>item.optionValues.size==="P");
  const renamed=keep.find(item=>item.optionValues.color==="Marrom — Logo Preta");
  const nextColors=["Preto","Marrom escuro"],nextSizes=["P","G"];
  const payload=[
   ...keep.map(item=>({id:item.id,optionValues:{size:"P",color:item.id===renamed.id?"Marrom escuro":item.optionValues.color},active:true,stockQuantity:item.id===renamed.id?12:5,priceCents:item.id===renamed.id?8990:null})),
   ...nextColors.map(color=>({optionValues:{size:"G",color},active:color==="Preto",stockQuantity:2})),
  ];
  const updated=await call("PATCH",`/products/${product.id}`,{details:details(photo,nextColors,nextSizes),imageUrls:[photo("preto")],variants:payload});
  assert.equal(updated.status,200,JSON.stringify(updated.body));
  const after=await variants(product.id);
  assert.equal(after.length,4);
  assert.equal(after.some(item=>item.optionValues.size==="M"),false,"tamanho removido leva as combinações dele");
  const kept=after.find(item=>item.id===renamed.id);
  assert.ok(kept,"renomear mantém o mesmo registro (vendas e histórico preservados)");
  assert.deepEqual(kept.optionValues,{size:"P",color:"Marrom escuro"});
  assert.equal(kept.name,"Tamanho: P / Cor: Marrom escuro");
  assert.equal(kept.stockQuantity,12,"estoque ajustado por movimento");
  assert.equal(kept.listPriceCents,8990);assert.equal(kept.priceOverride,true);
  assert.equal(after.find(item=>item.optionValues.size==="G"&&item.optionValues.color==="Marrom escuro").active,false);
  const movements=await c_movements(db.pool,product.id);
  assert.ok(movements.some(row=>row.movement_type==="ADJUSTMENT"),"o ajuste fica registrado no histórico de estoque");
 }finally{await app.close();}
});

test("envio inválido não altera nada: foto fora da galeria e combinação repetida",async()=>{
 const {app,photo,call,variants}=await api();
 try{
  const colors=["Preto"];
  const product=(await call("POST","/products",{name:"Boné",priceCents:5000,imageUrls:[photo("preto")],details:details(photo,colors,["Único"]),variants:grid(["Único"],colors)})).body.data;
  const before=await variants(product.id);
  const outside=await call("PATCH",`/products/${product.id}`,{details:details(photo,["Azul"],["Único"]),variants:[{optionValues:{size:"Único",color:"Azul"},imageUrl:photo("fora-da-galeria"),active:true}]});
  assert.equal(outside.status,400);
  const repeated=await call("PATCH",`/products/${product.id}`,{variants:[{optionValues:{size:"Único",color:"Preto"},active:true},{optionValues:{size:"Único",color:"Preto"},active:false}]});
  assert.equal(repeated.status,400);
  assert.deepEqual((await variants(product.id)).map(item=>[item.id,item.optionValues]),before.map(item=>[item.id,item.optionValues]));
 }finally{await app.close();}
});

test("50 combinações gravadas de uma vez e produto sem variação continua simples",async()=>{
 const {app,photo,call,variants}=await api();
 try{
  const sizes=["PP","P","M","G","GG","XG","XGG","EG","EGG","G1"],colors=["Preto","Branco","Cinza","Azul","Verde"];
  const big=await call("POST","/products",{name:"Grade grande",priceCents:9900,trackStock:true,imageUrls:[],details:{type:"APPAREL",options:[{key:"size",name:"Tamanho",values:sizes},{key:"color",name:"Cor",values:colors}]},variants:grid(sizes,colors,()=>({stockQuantity:1}))});
  assert.equal(big.status,201,JSON.stringify(big.body));
  assert.equal((await variants(big.body.data.id)).length,50);
  const simple=await call("POST","/products",{name:"Consultoria",priceCents:30000,itemType:"service",details:{type:"GENERAL",segment:"service"}});
  assert.equal(simple.status,201);assert.equal((await variants(simple.body.data.id)).length,0);
 }finally{await app.close();}
});

test("falha de preço em uma combinação desfaz o produto novo inteiro",async()=>{
 const {c,app,call}=await api();
 try{
  const created=await call("POST","/products",{name:"Cadastro que deve falhar",priceCents:7990,minimumPriceCents:5000,details:{type:"APPAREL",options:[{key:"size",name:"Tamanho",values:["P","M"]}]},variants:[{optionValues:{size:"P"},priceCents:7990},{optionValues:{size:"M"},priceCents:1000}]});
  assert.equal(created.status,400,JSON.stringify(created.body));
  assert.equal((await c.d.productRepository.listByWorkspace(c.scope)).length,0);
 }finally{await app.close();}
});

test("falha depois de renomear e ajustar estoque restaura produto, combinações e movimentos",async()=>{
 const {c,app,photo,call,variants}=await api();
 try{
  const created=await call("POST","/products",{name:"Camiseta",priceCents:7990,minimumPriceCents:5000,trackStock:true,imageUrls:[photo("preto")],details:details(photo,["Preto"]),variants:grid(["P","M"],["Preto"],()=>({stockQuantity:5}))});
  assert.equal(created.status,201,JSON.stringify(created.body));const product=await c.d.productRepository.getById(created.body.data.id),before=await variants(product.id);
  const changed=await call("PATCH",`/products/${product.id}`,{name:"Não deve persistir",details:details(photo,["Azul"]),variants:before.map((variant,index)=>({id:variant.id,optionValues:{size:variant.optionValues.size,color:"Azul"},stockQuantity:9,priceCents:index===0?7990:1000}))});
  assert.equal(changed.status,400,JSON.stringify(changed.body));
  assert.deepEqual(await variants(product.id),before);
  assert.deepEqual(await c.d.productRepository.getById(product.id),product);
  assert.equal((await c_movements(db.pool,product.id)).length,0);
 }finally{await app.close();}
});

test("uma combinação com histórico bloqueia a remoção sem apagar as outras",async()=>{
 const {c,app,call,variants}=await api();
 try{
  const created=await call("POST","/products",{name:"Histórico protegido",priceCents:7990,trackStock:true,details:{type:"APPAREL",options:[{key:"size",name:"Tamanho",values:["P","M"]}]},variants:grid(["P","M"],["Preto"]).map(draft=>({optionValues:{size:draft.optionValues.size}}))});
  assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.data.id;
  const second=(await variants(id))[1];await c.d.productEngineRepository.move({...c.scope,productId:id,variantId:second.id,kind:"IN",quantity:1,operationKey:"fixture-existing-history",userId:c.actor.userId});
  const before=await variants(id);
  const removed=await call("PATCH",`/products/${id}`,{details:{type:"APPAREL",options:[]},variants:[]});
  assert.equal(removed.status,400,JSON.stringify(removed.body));assert.match(JSON.stringify(removed.body),/histórico/);
  assert.deepEqual(await variants(id),before);
 }finally{await app.close();}
});

const c_movements=async(pool,productId)=>(await pool.query("select movement_type from product_stock_movements where product_id=$1",[productId])).rows;
