// Servidor LOCAL de QA: banco PGlite efêmero, JWT normal, dados .invalid e nenhuma integração externa.
import {join} from "node:path";
import {tmpdir} from "node:os";
import {mkdtemp,mkdir,writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {startTestPostgres} from "../helpers/pglite-test-db.mjs";
import {applyMigrations} from "../../dist/infrastructure/storage/postgres/migration-runner.js";
import {buildApp} from "../../dist/interfaces/api/app.js";
import {loadApiConfig} from "../../dist/interfaces/api/config/api-config.js";
import {registerUser} from "../../dist/application/identity/index.js";
import {defaultProductDetails} from "../../dist/domain/products/product-details.js";
import {siteContentSchema,siteThemeSchema} from "../../dist/domain/sites/site.model.js";

if(process.env.NODE_ENV==="production")throw Error("FIXTURE_ONLY: nunca iniciar em produção.");
const port=3390,webOrigin="http://127.0.0.1:3391",root=await mkdtemp(join(tmpdir(),"vorix-product-site-fixture-"));
const realPg=process.env.VORIX_CAPACITY_FIXTURE_PG_URL;
if(realPg&&!/^\/vorix_capacity_fixture/.test(new URL(realPg).pathname))throw Error("CAPACITY_FIXTURE_DATABASE_REQUIRED");
if(process.argv.includes("--capacity")&&!realPg)throw Error("CAPACITY_BROWSER_REQUIRES_DISPOSABLE_POSTGRES");
const fixturePool=realPg?new pg.Pool({connectionString:realPg}):undefined;
const db=fixturePool?{pool:fixturePool,connectionString:realPg,stop:()=>fixturePool.end()}:await startTestPostgres({maxConnections:30});let app,closed=false;
async function close(){if(closed)return;closed=true;await app?.close();await db.stop();}
for(const signal of["SIGINT","SIGTERM"])process.on(signal,()=>void close().then(()=>process.exit(0)));
try{
 await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));
 app=await buildApp({config:loadApiConfig({AUTH_MODE:"jwt",JWT_SECRET:"public-fixture-only-product-site-jwt-key",DATABASE_URL:db.connectionString,PERSISTENCE_DRIVER:"postgres",BILLING_PROVIDER:"sandbox",API_CORS_ORIGIN:webOrigin,COOKIE_SECURE:"false",ZUNO_LOG_LEVEL:"silent",OPERATIONAL_RATE_LIMIT_DEFAULT:"10000",AI_GATEWAY_ENABLED:"false",OBJECT_STORAGE_ENABLED:"true",OBJECT_STORAGE_DRIVER:"local",OBJECT_STORAGE_LOCAL_DIR:root,OBJECT_STORAGE_PUBLIC_BASE_URL:`http://127.0.0.1:${port}/uploads`,MEETINGS_REAL_RECORDING_ENABLED:"false",SITE_PUBLIC_BASE_DOMAIN:"fixture.example.com"})});
 const tenantId="tenant-site-browser-"+randomUUID(),email="owner@product-site-fixture.invalid",password="Fixture-only-product-site-2026!";
 const info={fixtureOnly:true,database:realPg?"disposable-postgresql":"ephemeral-pglite",email,password,tenantId,workspaceId:"",slug:"product-site-fixture",productId:"",variantId:"",vehicleId:"",generalId:"",siteId:""};
 app.addHook("onError",async(request,_reply,error)=>{console.error("FIXTURE_API_ERROR",request.method,request.url.split("?")[0],error.message);});
 app.get("/fixture-only/scope",async()=>info);
 await registerUser({...app.zunoContainer.identity,passwordHasher:app.zunoContainer.identity.passwordHasher},{tenantId,email,password,name:"Administrador de fixture",role:"owner"});
 await app.zunoContainer.identity.platformBillingRepository.ensureTenantBilling({tenantId,now:new Date().toISOString()});
 await db.pool.query("update users set is_platform_admin=true where email=$1",[email]);
 await app.zunoContainer.solutionAccess.setEntitlement({tenantId,solutionKey:"site",enabled:true,source:"internal",reason:"Fixture local controlada — nunca produção"});
 const login=await app.inject({method:"POST",url:"/v1/auth/login",payload:{email,password}});if(login.statusCode!==200)throw Error(login.body);
 const headers={authorization:`Bearer ${login.json().data.accessToken}`};
 const api=async(method,url,payload)=>{const result=await app.inject({method,url,headers,payload});if(result.statusCode>=300)throw Error(`${method} ${url}: ${result.body}`);return result.json().data;};
 const workspace=await api("POST","/v1/workspaces",{name:"Empresa de fixture — Product e Site"});info.workspaceId=workspace.id;
 if(process.argv.includes("--capacity")){
  const repositories=app.zunoContainer.identity;
  if(app.zunoContainer.billingProvider.providerId!=="sandbox")throw Error("CAPACITY_FIXTURE_REQUIRES_SANDBOX");
  const plan=await repositories.planVersionRepository.getActiveVersion("START");
  const subscription=await repositories.subscriptionRepository.create({tenantId,planVersionId:plan.id,status:"active",billingProvider:"sandbox",billingInterval:"monthly",providerCustomerId:"fixture-customer",providerSubscriptionId:"fixture-subscription"});
  await repositories.subscriptionRepository.update(subscription.id,{currentPeriodEnd:new Date(Date.now()+20*86400000).toISOString()});
  for(const [addonCode,quantity,unitPriceUsd] of[["extra_user",2,39],["extra_whatsapp_connection",2,79]])await repositories.subscriptionItemRepository.create({subscriptionId:subscription.id,addonCode,quantity,unitPriceUsd,currency:"BRL",providerItemId:"fixture-item-"+addonCode});
  const code="site_capacity_fixture";await repositories.addonDefinitionRepository.saveModule({code,name:"Site de fixture",description:"Somente dados fictícios",resource:"site",increment:1,monthlyPriceUsd:29,yearlyPriceUsd:290,currency:"BRL",active:false});await repositories.subscriptionItemRepository.create({subscriptionId:subscription.id,addonCode:code,quantity:1,unitPriceUsd:29,currency:"BRL",providerItemId:"fixture-site"});
  info.capacityFixture=true;info.billingProvider="sandbox";info.fixtureAddonCode=code;
  const original=app.zunoContainer.billingProvider.setRecurringItems.bind(app.zunoContainer.billingProvider);app.zunoContainer.billingProvider.setRecurringItems=async input=>{const result=await original(input);if(result.ok)info.lastProviderAmount=input.amount;return result;};
 }
 const ws=`?workspaceId=${workspace.id}`;
 const category=await api("POST","/v1/product-metadata/categories"+ws,{name:"Vestuário",slug:"vestuario",active:true,siteVisible:true,position:0});
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWNYtfvMf2TMQLoAAL4eMwFtMcU2AAAAAElFTkSuQmCC","base64");
 const uploaded=await app.zunoContainer.objectStorage.put({key:`assets/${tenantId}/${workspace.id}/products/fixture-product.png`,body:png,contentType:"image/png"});
 const create=async(input)=>api("POST","/v1/products",{workspaceId:workspace.id,name:"Fixture",priceCents:10000,costCents:4000,minimumPriceCents:8000,details:defaultProductDetails(),...input});
 const general=await create({name:"Pulverizador de fixture",imageUrls:[uploaded.url],details:{...defaultProductDetails(),type:"GENERAL",siteVisible:true,slug:"pulverizador-fixture"}});info.generalId=general.id;
 const apparel=await create({name:"Camiseta de fixture",code:"CAM-FIX",trackStock:true,categoryId:category.id,imageUrls:[uploaded.url],details:{...defaultProductDetails(),type:"APPAREL",siteVisible:true,slug:"camiseta-fixture",apparel:{material:"Algodão",collection:"Coleção fixture"},options:[{key:"size",name:"Tamanho",values:["P","M"]},{key:"color",name:"Cor",values:["Preto","Branco"]}]}});info.productId=apparel.id;
 const variants=await api("POST",`/v1/products/${apparel.id}/variant-grid`,{workspaceId:workspace.id});info.variantId=variants[0].id;
 for(const variant of variants)await api("POST",`/v1/products/${apparel.id}/inventory${ws}`,{variantId:variant.id,kind:"IN",quantity:variant.optionValues.size==="P"?4:8,operationKey:randomUUID()});
 const vehicle=await create({name:"SUV de fixture",priceCents:12500000,costCents:9000000,minimumPriceCents:11500000,details:{...defaultProductDetails(),type:"VEHICLE",siteVisible:true,slug:"suv-fixture",vehicle:{make:"Montadora fixture",model:"Modelo de teste",version:"LX",manufactureYear:2024,modelYear:2025,mileage:18000,fuel:"Flex",transmission:"Automática",color:"Prata",doors:4,condition:"used",features:["Ar-condicionado"]}}});info.vehicleId=vehicle.id;
 await create({name:"PRODUTO PRIVADO DA FIXTURE",details:defaultProductDetails()});
 const content=siteContentSchema.parse({name:"Empresa de fixture",description:"Site local de teste",whatsapp:"5511999990000",seo:{title:"Empresa de fixture — catálogo",description:"Catálogo controlado do Product e Site Engine."},blocks:[{id:"hero",type:"hero",title:"Produtos para sua empresa",text:"Dados fictícios, apenas para validação local."},{id:"catalog",type:"catalog",title:"Nosso catálogo"},{id:"contact",type:"contact",title:"Fale com nossa equipe"}],pages:[{slug:"sobre",title:"Sobre a empresa",published:true,blocks:[{id:"about",type:"text",title:"Nossa história",text:"Empresa inteiramente fictícia."}]}]});
 let fixtureContent=content,fixtureTheme=siteThemeSchema.parse({});
 if(process.argv.includes("--site-builder")){
  const {createSiteBuilderContent}=await import("./site-builder-content.mjs");
  const visual=await createSiteBuilderContent({storage:app.zunoContainer.objectStorage,tenantId,workspaceId:workspace.id,create,apparel,content});
  await api("PATCH",`/v1/products/${apparel.id}`,{workspaceId:workspace.id,imageUrls:[visual.apparelImage]});
  fixtureContent=siteContentSchema.parse(visual.content);
  fixtureTheme=siteThemeSchema.parse({template:"catalog",primary:"#425B48",secondary:"#B97C5B",background:"#FFFEFA",foreground:"#283C30",surface:"#F1EEE5",headerBackground:"#FFFEFA",footerBackground:"#283C30",footerForeground:"#F7F3E9",headingFont:"editorial",bodyFont:"modern",headerLayout:"center",buttonStyle:"pill",sectionSpacing:"comfortable",rounded:true,catalog:{columns:4,mobileColumns:2,imageRatio:"portrait",cardStyle:"minimal",showPrice:true,showSku:false,showAvailability:false,showFilters:true,showSearch:true,sort:"manual",pageSize:12}});
  info.siteBuilderFixture=true;
 }
 if(process.argv.includes("--product-verticals")){
  const base={type:"REAL_ESTATE",siteVisible:true};
  const property={kind:"house",purpose:"sale",status:"available",address:{state:"SP",city:"Campinas",neighborhood:"Jardim das Flores",street:"RUA PRIVADA FIXTURE",number:"987",postalCode:"13000-000",showExactAddress:false},builtArea:120,landArea:250,bedrooms:3,suites:1,bathrooms:2,parkingSpaces:2,features:["Quintal"],condominiumFeatures:[],internalNotes:"NOTA INTERNA PRIVADA FIXTURE"};
  const house=await create({name:"Casa de fixture",priceCents:65000000,imageUrls:[uploaded.url],details:{...defaultProductDetails(),...base,slug:"casa-fixture",realEstate:property}});info.houseId=house.id;
  const rental=await create({name:"Apartamento de aluguel fixture",priceCents:250000,imageUrls:[uploaded.url],details:{...defaultProductDetails(),...base,slug:"apartamento-aluguel-fixture",realEstate:{...property,kind:"apartment",purpose:"rent",usableArea:70,bedrooms:2,parkingSpaces:1,condominiumCents:45000,propertyTaxCents:120000,propertyTaxPeriod:"yearly",furnishing:"furnished"}}});info.rentalId=rental.id;
  fixtureContent=siteContentSchema.parse({...fixtureContent,blocks:fixtureContent.blocks.map(block=>block.type==="catalog"?{...block,productIds:[]}:block)});
  info.productVerticalsFixture=true;
 }
 const site=await api("POST","/v1/sites"+ws,{slug:info.slug,draft:{content:fixtureContent,theme:fixtureTheme}});info.siteId=site.id;
 if(info.siteBuilderFixture)info.initialSiteSnapshot=site.draft;
 await api("POST",`/v1/sites/${site.id}/publish${ws}`,{revision:site.revision});
 await mkdir("tmp/product-site-browser",{recursive:true});await writeFile("tmp/product-site-browser/fixture.json",JSON.stringify(info,null,2));
 await app.listen({host:"127.0.0.1",port});console.log(`FIXTURE_READY http://127.0.0.1:${port} — banco efêmero; somente dados fictícios .invalid`);
}catch(error){console.error(error);await close();process.exitCode=1;}
