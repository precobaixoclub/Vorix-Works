import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import Fastify from "fastify";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {SITE_TEMPLATE_REGISTRY} from "../dist/domain/sites/site-template-registry.js";
import {siteImageUrls} from "../dist/domain/sites/site.model.js";
import {validateSiteSnapshot,publicSite,publishSite} from "../dist/application/sites/site-use-cases.js";
import {registerSiteRoutes} from "../dist/interfaces/api/routes/v1/sites.route.js";
import {updateProduct} from "../dist/application/crm/product-use-cases.js";
import sharp from "sharp";
import {uploadWorkspaceImage} from "../dist/interfaces/api/http/workspace-images.js";
let db;before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(()=>db.stop());
const descriptor=id=>SITE_TEMPLATE_REGISTRY.find(t=>t.id===id);
const block=(id,type)=>({id,type,title:`Seção ${id}`,text:"Conteúdo central",imageAlt:"",productIds:[],items:[],enabled:true});
const snapshot=(id="nexus")=>validateSiteSnapshot({theme:descriptor(id).defaultTheme,content:{name:"Marca de fixture",description:"Apresentação central",socials:[],seo:{title:"SEO central",description:"Descrição preservada"},blocks:[block("hero","hero"),block("catalog","catalog"),block("contact","contact")],pages:[]}});
const config=(id,blocks)=>({templateVersion:1,themeConfig:descriptor(id).defaultTheme,sectionConfig:{home:blocks.map(({id,enabled})=>({id,enabled})),pages:{}},layoutConfig:{heroVariant:"signature",productGallery:"split"}});
async function api(c){const app=Fastify();app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{const [tenantId,role]=String(request.headers.authorization??`${c.tenantId}:owner`).split(":");request.zunoContext={principal:{tenantId,role,userId:c.actor.userId}};});await registerSiteRoutes(app,{...c.siteDeps,workspaceRepository:c.workspaceRepository,objectStorage:{resolvePublicUrl:key=>`https://media.fixture.invalid/${key}`}});return app;}
test("registro canônico é o mesmo no frontend e backend; modelos/versões são validados",()=>{assert.deepEqual(SITE_TEMPLATE_REGISTRY,JSON.parse(readFileSync("web/features/sites/template-registry.generated.json","utf8")));assert.deepEqual(SITE_TEMPLATE_REGISTRY.filter(t=>!t.legacy).map(t=>t.id),["nexus","aura","pulse"]);const s=snapshot();assert.throws(()=>validateSiteSnapshot({...s,activeTemplateId:"aura"}));assert.throws(()=>validateSiteSnapshot({...s,templateConfigs:{nexus:{...s.templateConfigs.nexus,templateVersion:999}}}));assert.throws(()=>validateSiteSnapshot({...s,templateConfigs:{bad:s.templateConfigs.nexus}}));});
test("site legado preserva conteúdo e aparência sem troca automática",()=>{const old=snapshot("catalog");assert.equal(old.activeTemplateId,undefined);assert.equal(old.templateConfigs,undefined);assert.equal(validateSiteSnapshot(old).theme.template,"catalog");});
test("configurações não repetem conteúdo; ordem e referências de mídia alternativas têm validação",()=>{const s=snapshot();const c={...s.templateConfigs.nexus,layoutConfig:{...s.layoutConfig,heroImageUrl:"https://media.fixture.invalid/hero.webp",heroMobileImageUrl:"https://media.fixture.invalid/mobile.webp"}};const next=validateSiteSnapshot({...s,templateConfigs:{...s.templateConfigs,aura:{...c,themeConfig:descriptor("aura").defaultTheme}}});assert.equal(next.templateConfigs.aura.sectionConfig.home.length,3);assert.ok(siteImageUrls(next).includes("https://media.fixture.invalid/mobile.webp"));assert.throws(()=>validateSiteSnapshot({...s,templateConfigs:{aura:{...c,themeConfig:descriptor("aura").defaultTheme,content:{name:"Duplicado"}}}}));assert.throws(()=>validateSiteSnapshot({...s,templateConfigs:{aura:{...c,themeConfig:descriptor("aura").defaultTheme,sectionConfig:{home:[{id:"hero",enabled:true},{id:"hero",enabled:false}],pages:{}}}}}));});
test("salvar três modelos e publicar um mantém os outros privados e preservados",async()=>{
 const c=await productSiteContext(db.pool),app=await api(c);try{
  let draft=snapshot();draft.theme.primary="#88CCAA";draft.templateConfigs={nexus:{...config("nexus",draft.content.blocks),themeConfig:{...descriptor("nexus").defaultTheme,primary:"#88CCAA"}},aura:config("aura",draft.content.blocks),pulse:{...config("pulse",draft.content.blocks),layoutConfig:{heroVariant:"compact",productGallery:"stacked"}}};
  let response=await app.inject({method:"POST",url:`/sites?workspaceId=${c.workspaceId}`,payload:{slug:"fixture-"+randomUUID(),draft}});assert.equal(response.statusCode,200,response.body);let site=response.json().data;
  draft={...site.draft,activeTemplateId:"aura",theme:descriptor("aura").defaultTheme};response=await app.inject({method:"PUT",url:`/sites/${site.id}?workspaceId=${c.workspaceId}`,payload:{revision:site.revision,draft}});assert.equal(response.statusCode,200,response.body);site=response.json().data;
  response=await app.inject({method:"POST",url:`/sites/${site.id}/publish?workspaceId=${c.workspaceId}`,payload:{revision:site.revision}});assert.equal(response.statusCode,200,response.body);site=response.json().data;
  const view=await publicSite(c.siteDeps,{slug:site.slug});assert.equal(view.activeTemplateId,"aura");assert.equal(view.templateConfigs,undefined);assert.equal(site.draft.templateConfigs.pulse.layoutConfig.heroVariant,"compact");assert.equal(view.content.seo.title,"SEO central");
  draft={...site.draft,activeTemplateId:"nexus",theme:site.draft.templateConfigs.nexus.themeConfig};response=await app.inject({method:"PUT",url:`/sites/${site.id}?workspaceId=${c.workspaceId}`,payload:{revision:site.revision,draft}});assert.equal(response.statusCode,200,response.body);const saved=response.json().data;assert.equal((await publicSite(c.siteDeps,{slug:site.slug})).activeTemplateId,"aura");
  await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:saved.revision,actorUserId:c.actor.userId});assert.equal((await publicSite(c.siteDeps,{slug:site.slug})).activeTemplateId,"nexus");const recovered=await c.siteDeps.repository.get(site.id);assert.equal(recovered.previousPublished.theme.template,"aura");assert.equal(recovered.publishedByUserId,c.actor.userId);assert.equal(recovered.draft.templateConfigs.nexus.themeConfig.primary,"#88CCAA");assert.deepEqual((await c.siteDeps.repository.get(site.id)).draft.content,site.draft.content);
 }finally{await app.close();}
});
test("modelo oculto não aceita imagem de outro tenant; RBAC, workspace e conflito de revisão são aplicados",async()=>{
 const c=await productSiteContext(db.pool),other=await productSiteContext(db.pool),app=await api(c),site=await c.siteDeps.repository.create({...c.scope,slug:"fixture-"+randomUUID(),draft:snapshot()});try{
  c.allowed.add(other.tenantId);const url=`/sites/${site.id}?workspaceId=${c.workspaceId}`,draft=snapshot();draft.templateConfigs.aura={...config("aura",draft.content.blocks),layoutConfig:{heroVariant:"signature",productGallery:"split",heroImageUrl:`https://media.fixture.invalid/assets/${other.tenantId}/${other.workspaceId}/products/foreign.webp`}};
  let response=await app.inject({method:"PUT",url,payload:{revision:site.revision,draft}});assert.equal(response.statusCode,400,response.body);
  response=await app.inject({method:"PUT",url,headers:{authorization:`${c.tenantId}:viewer`},payload:{revision:site.revision,draft:snapshot()}});assert.equal(response.statusCode,403);
  response=await app.inject({method:"POST",url:`/sites/${site.id}/publish?workspaceId=${c.workspaceId}`,headers:{authorization:`${c.tenantId}:editor`},payload:{revision:site.revision}});assert.equal(response.statusCode,403);
  for(const path of[`/sites/${site.id}/preview?workspaceId=${other.workspaceId}`,`/sites/${site.id}?workspaceId=${other.workspaceId}`]){response=await app.inject({method:path.includes("preview")?"GET":"PUT",url:path,headers:{authorization:`${other.tenantId}:owner`},...(!path.includes("preview")?{payload:{revision:site.revision,draft:snapshot()}}:{})});assert.equal(response.statusCode,404,response.body);}
  assert.equal((await app.inject({method:"PUT",url,headers:{authorization:`${c.tenantId}:editor`},payload:{revision:site.revision,draft:snapshot()}})).statusCode,403,"Atendente não altera a estrutura do site por padrão");
  response=await app.inject({method:"PUT",url,headers:{authorization:`${c.tenantId}:admin`},payload:{revision:site.revision,draft:snapshot()}});assert.equal(response.statusCode,200,response.body);
  response=await app.inject({method:"PUT",url,payload:{revision:site.revision,draft:snapshot()}});assert.equal(response.statusCode,409,response.body);
 }finally{await app.close();}
});
test("a fonte de produto é única e muda em todos os modelos; URLs e SEO permanecem",async()=>{
 const c=await productSiteContext(db.pool),p=await c.product({name:"Produto compartilhado",details:{type:"GENERAL",siteVisible:true}});let site=await c.siteDeps.repository.create({...c.scope,slug:"fixture-"+randomUUID(),draft:snapshot()});
 for(const id of["nexus","aura","pulse"]){site=await c.siteDeps.repository.saveDraft({id:site.id,tenantId:c.tenantId,revision:site.revision,draft:snapshot(id)});site=await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});const view=await publicSite(c.siteDeps,{slug:site.slug});assert.equal(view.products[0].id,p.id);assert.equal(view.content.seo.title,"SEO central");}
 await updateProduct(c.d,{...c.scope,productId:p.id,patch:{name:"Novo nome da fonte",priceCents:25000}});assert.equal((await publicSite(c.siteDeps,{slug:site.slug})).products[0].priceCents,25000);assert.equal((await c.d.productRepository.listByWorkspace(c.scope)).length,1);
});
test("upload do site aplica orientação, remove metadados e gera WebP limitado; arquivo inválido é recusado",async()=>{
 const source=await sharp({create:{width:3000,height:1000,channels:3,background:"#aabbcc"}}).jpeg().withMetadata({orientation:6}).toBuffer();let stored;
 const storage={put:async input=>{stored=input;return {url:`https://media.fixture.invalid/${input.key}`};}};
 const request=body=>({file:async()=>({mimetype:"image/jpeg",file:{truncated:false},toBuffer:async()=>body})});
 const result=await uploadWorkspaceImage(request(source),storage,{tenantId:"fixture-tenant",workspaceId:"fixture-workspace"},5_000_000,true);
 const metadata=await sharp(stored.body).metadata();assert.equal(metadata.format,"webp");assert.equal(Math.max(metadata.width,metadata.height),1920);assert.equal(metadata.orientation,undefined);assert.equal(metadata.exif,undefined);assert.equal(stored.contentType,"image/webp");assert.match(result.url,/assets\/fixture-tenant\/fixture-workspace\/products\/.+\.webp$/);assert.ok(stored.body.length<source.length);
 await assert.rejects(uploadWorkspaceImage(request(Buffer.from("not an image")),storage,{tenantId:"fixture-tenant",workspaceId:"fixture-workspace"},5_000_000,true),/Não foi possível abrir/);
});
test("retirar do ar preserva a última publicação e autoria; recuperação não altera a publicação sozinha",async()=>{
 const c=await productSiteContext(db.pool);let site=await c.siteDeps.repository.create({...c.scope,slug:"fixture-"+randomUUID(),draft:snapshot("nexus")});site=await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});
 site=await c.siteDeps.repository.saveDraft({id:site.id,tenantId:c.tenantId,revision:site.revision,actorUserId:c.actor.userId,draft:snapshot("aura")});assert.equal(site.updatedByUserId,c.actor.userId);site=await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});assert.equal(site.previousPublished.theme.template,"nexus");
 site=await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId,unpublish:true});assert.equal(site.published,undefined);assert.equal(site.previousPublished.theme.template,"aura");assert.equal(site.publishedByUserId,c.actor.userId);
});
