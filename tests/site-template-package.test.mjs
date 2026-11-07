// Pacote de Modelo Vorix: validação (motivo, arquivo e linha de cada problema), importação só sem
// erros, aplicação no rascunho, entrega na vitrine e documentação cobrindo todos os códigos.
import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import AdmZip from "adm-zip";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import postcss from "postcss";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {readSiteTemplatePackage} from "../dist/infrastructure/sites/site-template-package-reader.js";
import {TEMPLATE_ISSUE_CODES} from "../dist/domain/sites/site-template-package.js";
import {registerSiteRoutes} from "../dist/interfaces/api/routes/v1/sites.route.js";
import {publicSite,publishSite} from "../dist/application/sites/site-use-cases.js";
import {siteContentSchema,siteThemeSchema} from "../dist/domain/sites/site.model.js";

const example=()=>readFile(join(process.cwd(),"web/public/site-assets/vorix-modelo-exemplo.zip"));
const jpeg=()=>sharp({create:{width:40,height:30,channels:3,background:"#caa"}}).jpeg().toBuffer();
const manifest=(home,extra={})=>JSON.stringify({format:"vorix-site-template",formatVersion:1,name:"Teste",version:"1.0.0",home,...extra});
async function pack(files){const zip=new AdmZip();for(const [name,body] of Object.entries(files))zip.addFile(name,Buffer.isBuffer(body)?body:Buffer.from(body));return zip.toBuffer();}
const codes=report=>report.errors.map(issue=>issue.code);

test("o pacote de exemplo da documentação passa sem erros nem avisos e vira conteúdo editável",async()=>{
 const {report,package:pkg}=await readSiteTemplatePackage(await example());
 assert.deepEqual([report.ok,report.errors,report.warnings],[true,[],[]]);
 assert.deepEqual(pkg.home.map(block=>block.type),["hero","features","catalog","image_text","stats","testimonials","faq","cta","contact"]);
 const hero=pkg.home[0];assert.equal(hero.title,"Peças feitas à mão para durar");assert.equal(hero.buttonLabel,"Ver coleção");assert.equal(hero.buttonUrl,"#catalogo");assert.match(hero.imageUrl,/^vorix-asset:assets\/hero\.jpg$/);
 assert.equal(pkg.home[1].items.length,3);assert.equal(pkg.home[4].items[0].value,"12 anos");
 assert.equal(pkg.pages[0].blocks[0].title,"Feito à mão desde 2012","o título do manifest substitui o do HTML");
 postcss.parse(pkg.css).walkRules(rule=>{if(!/keyframes/.test(rule.parent?.name??""))for(const selector of rule.selectors)assert.ok(selector.startsWith(".tenant-site-imported"),selector);});
 assert.equal(JSON.stringify(pkg.sections).includes("data-vorix"),false,"atributos de marcação não vão para a vitrine");
});

test("pacote com problemas: bloqueia e explica cada um com arquivo e linha",async()=>{
 const zip=await pack({
  "manifest.json":manifest([{type:"hero",file:"sections/hero.html"},{type:"catalog",file:"sections/catalog.html"},{type:"carrossel3d",file:"x.html"},{type:"cta"}]),
  "sections/hero.html":`<section data-vorix-block="hero">\n<h1 data-vorix-field="title" onclick="steal()">Oi</h1>\n<p style="color:red">x</p>\n<script>alert(1)</script>\n<img src="https://cdn.example.com/a.jpg" alt="a">\n<img src="assets/logo.svg" alt="b">\n<a href="javascript:alert(1)">x</a>\n<iframe src="https://example.com"></iframe>\n</section>`,
  "sections/catalog.html":"<section data-vorix-block=\"catalog\"></section>",
  "styles.css":"@import url(https://fonts.example.com/x.css);\n.a{background:url(https://example.com/b.png)}\n.b{width:expression(alert(1))}",
  "assets/logo.svg":"<svg onload=\"alert(1)\"></svg>",
 });
 const {report,package:pkg}=await readSiteTemplatePackage(zip);
 assert.equal(report.ok,false);assert.equal(pkg,undefined);
 for(const code of["HTML_EVENT_HANDLER","HTML_INLINE_STYLE","HTML_FORBIDDEN_TAG","ASSET_EXTERNAL","ASSET_FORMAT","HTML_UNSAFE_LINK","SECTION_NATIVE_WITH_FILE","SECTION_TYPE_UNKNOWN","SECTION_FILE_REQUIRED","CSS_FORBIDDEN_AT_RULE","CSS_EXTERNAL_URL","CSS_UNSAFE"])assert.ok(codes(report).includes(code),`${code} em ${codes(report)}`);
 const handler=report.errors.find(issue=>issue.code==="HTML_EVENT_HANDLER");assert.deepEqual([handler.file,handler.line],["sections/hero.html",2]);assert.ok(handler.hint);
 assert.equal(report.errors.find(issue=>issue.code==="ASSET_FORMAT").hint.includes("SVG"),true);
 assert.equal(report.errors.find(issue=>issue.code==="CSS_UNSAFE").line,3);
});

test("estrutura: manifest ausente/inválido, campos obrigatórios, listas e zip inválido",async()=>{
 assert.deepEqual(codes((await readSiteTemplatePackage(Buffer.from("não é zip"))).report),["PACKAGE_INVALID_ZIP"]);
 assert.deepEqual(codes((await readSiteTemplatePackage(await pack({"styles.css":"a{}"}))).report),["MANIFEST_MISSING"]);
 assert.deepEqual(codes((await readSiteTemplatePackage(await pack({"manifest.json":"{ nome: 1 }"}))).report),["MANIFEST_INVALID_JSON"]);
 const image=await jpeg();
 const {report}=await readSiteTemplatePackage(await pack({
  "modelo/manifest.json":manifest([{type:"cta",file:"sections/cta.html"},{type:"features",file:"sections/features.html"},{type:"stats",file:"sections/stats.html"},{type:"text",file:"sections/text.html"}],{theme:"theme.json"}),
  "modelo/theme.json":JSON.stringify({primary:"vermelho",shadow:true}),
  "modelo/sections/cta.html":`<section data-vorix-block="cta"><h2 data-vorix-field="title">A</h2><h2 data-vorix-field="title">B</h2><span data-vorix-field="button">não é link</span></section>`,
  "modelo/sections/features.html":`<section data-vorix-block="features"><h2 data-vorix-field="title">X</h2></section>`,
  "modelo/sections/stats.html":`<section data-vorix-block="stats"><ul data-vorix-repeat="items"><li><b data-vorix-field="value">1</b></li></ul></section>`,
  "modelo/sections/text.html":`<section data-vorix-block="text"><p data-vorix-field="text">x</p></section>\n<p>fora</p>`,
  "modelo/assets/sobra.jpg":image,
 }));
 for(const code of["THEME_INVALID","FIELD_DUPLICATED","FIELD_WRONG_ELEMENT","FIELD_REQUIRED","REPEAT_REQUIRED","SECTION_ROOT_INVALID"])assert.ok(codes(report).includes(code),`${code} em ${codes(report)}`);
 assert.ok(report.warnings.some(issue=>issue.code==="ASSET_UNUSED"&&issue.file==="assets/sobra.jpg"),"pasta raiz única é aceita e arquivos sobrando viram aviso");
});

test("a documentação pública explica todos os códigos de validação",async()=>{
 const docs=await readFile(join(process.cwd(),"web/features/sites/template-package-docs.ts"),"utf8");
 for(const code of TEMPLATE_ISSUE_CODES)assert.ok(docs.includes(`"${code}"`),`${code} não está documentado`);
});

let db;before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(async()=>{await db?.stop();});
const storage={health:async()=>({ok:true}),resolvePublicUrl:key=>`https://storage.test/${key}`,put:async({key})=>({url:`https://storage.test/${key}`}),delete:async()=>{}};
function upload(name,body){const boundary="----vorixtemplate";return {headers:{"content-type":`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/zip\r\n\r\n`),body,Buffer.from(`\r\n--${boundary}--\r\n`)])};}

test("API: valida sem gravar, importa, aplica no rascunho, aparece na vitrine e protege o modelo em uso",async()=>{
 const c=await productSiteContext(db.pool);const app=Fastify();app.decorateRequest("zunoContext",null);await app.register(multipart);
 app.addHook("onRequest",async request=>{const [tenantId,role]=(request.headers.authorization??"").replace("Bearer ","").split(":");request.zunoContext={principal:tenantId?{tenantId,role,userId:c.actor.userId}:undefined};});
 await registerSiteRoutes(app,{...c.siteDeps,workspaceRepository:c.workspaceRepository,objectStorage:storage});
 try{
  let site=await c.siteDeps.repository.create({...c.scope,slug:"modelo-"+Date.now(),draft:{content:siteContentSchema.parse({name:"Loja",blocks:[]}),theme:siteThemeSchema.parse({})}});
  const base=`/sites/${site.id}/template-packages`,query=`?workspaceId=${c.workspaceId}`,owner={authorization:`Bearer ${c.tenantId}:owner`};
  const bad=await pack({"manifest.json":manifest([{type:"hero",file:"h.html"}]),"h.html":"<section data-vorix-block=\"hero\"><h1 data-vorix-field=\"title\">x</h1><script>1</script></section>"});
  let response=await app.inject({method:"POST",url:base+query,...upload("ruim.zip",bad),headers:{...upload("ruim.zip",bad).headers,...owner}});
  assert.equal(response.statusCode,200,response.body);assert.equal(response.json().data.imported,false);assert.equal(response.json().data.report.errors[0].code,"HTML_FORBIDDEN_TAG");
  assert.equal((await app.inject({url:base+query,headers:owner})).json().data.length,0,"pacote com erro não é gravado");
  const zip=await example();
  response=await app.inject({method:"POST",url:`${base}/validate${query}`,payload:upload("atelier.zip",zip).payload,headers:{...upload("atelier.zip",zip).headers,...owner}});
  assert.equal(response.json().data.report.ok,true);assert.equal((await app.inject({url:base+query,headers:owner})).json().data.length,0,"validar não grava");
  assert.equal((await app.inject({method:"POST",url:base+query,payload:upload("atelier.zip",zip).payload,headers:{...upload("atelier.zip",zip).headers,authorization:`Bearer ${c.tenantId}:viewer`}})).statusCode,403);
  assert.equal((await app.inject({method:"POST",url:base+query,payload:upload("atelier.txt",zip).payload,headers:{...upload("atelier.txt",zip).headers,...owner}})).statusCode,400);
  response=await app.inject({method:"POST",url:base+query,payload:upload("atelier.zip",zip).payload,headers:{...upload("atelier.zip",zip).headers,...owner}});
  assert.equal(response.json().data.imported,true,response.body);const template=response.json().data.template;assert.equal(template.name,"Atelier Exemplo");assert.equal(template.sections,8);
  const full=(await app.inject({url:`${base}/${template.id}${query}`,headers:owner})).json().data;
  assert.match(full.package.home[0].imageUrl,/^https:\/\/storage\.test\/assets\/.+\/products\/[0-9a-f-]+\.webp$/,"imagens gravadas no espaço do workspace");
  // Aplicar: os blocos do pacote entram no rascunho como blocos comuns do Vorix.
  const blocks=full.package.home.map((block,index)=>({id:`imp-${index}`,type:block.type,title:block.title,text:block.text,imageUrl:block.imageUrl,imageAlt:block.imageAlt,buttonLabel:block.buttonLabel,buttonUrl:block.buttonUrl,eyebrow:block.eyebrow,items:block.items.map(item=>({title:item.title,text:item.text,...(item.value?{value:item.value}:{}),...(item.imageUrl?{imageUrl:item.imageUrl,imageAlt:item.imageAlt??""}:{})})),productIds:[],enabled:true}));
  const sectionMap=Object.fromEntries(full.package.home.flatMap((block,index)=>block.section===undefined?[]:[[`imp-${index}`,block.section]]));
  const draft={...site.draft,content:{...site.draft.content,blocks},theme:{...site.draft.theme,importedTemplateId:template.id,importedSections:sectionMap}};
  response=await app.inject({method:"PUT",url:`/sites/${site.id}${query}`,headers:owner,payload:{revision:site.revision,draft}});assert.equal(response.statusCode,200,response.body);site=response.json().data;
  assert.equal((await app.inject({method:"PUT",url:`/sites/${site.id}${query}`,headers:owner,payload:{revision:site.revision,draft:{...draft,theme:{...draft.theme,importedTemplateId:"tpl-00000000-0000-0000-0000-000000000000"}}}})).statusCode,400,"não aceita modelo inexistente");
  site=await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});
  const pub=await publicSite(c.siteDeps,{slug:site.slug});
  assert.equal(pub.importedTemplate.id,template.id);assert.equal(pub.importedTemplate.sections.length,8);assert.match(pub.importedTemplate.css,/\.tenant-site-imported \.at-hero/);assert.equal(pub.importedTemplate.sectionMap["imp-0"],0);
  assert.equal(pub.content.blocks.find(block=>block.id==="imp-0").title,"Peças feitas à mão para durar");
  assert.equal((await app.inject({method:"DELETE",url:`${base}/${template.id}${query}`,headers:owner})).statusCode,409,"modelo em uso não é removido");
 }finally{await app.close();}
});
