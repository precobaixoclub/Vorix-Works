import {describe,expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
import {initialSiteSnapshot} from "@/features/sites/customization";
import {templateDemo} from "@/features/sites/demo-content";
import {applyImportedTemplate,importedSectionFor,type ImportedTemplatePackage,type TemplateSection} from "@/features/sites/imported-template";
import {selectSiteTemplate} from "@/features/sites/template-state";
import {reportAsText} from "@/components/sites/TemplateImportPanel";

const hero:TemplateSection={type:"hero",tree:{t:"el",tag:"section",attrs:{class:"at-hero"},children:[
 {t:"el",tag:"span",attrs:{class:"at-eyebrow"},children:[],field:"eyebrow"},
 {t:"el",tag:"h1",attrs:{},children:[],field:"title"},
 {t:"el",tag:"a",attrs:{class:"at-button"},children:[],field:"button"},
 {t:"el",tag:"img",attrs:{alt:"x"},children:[],field:"image"},
 {t:"el",tag:"a",attrs:{href:"#contato",class:"at-link"},children:[{t:"text",v:"Fale conosco"}]},
]}};
const features:TemplateSection={type:"features",tree:{t:"el",tag:"section",attrs:{},children:[{t:"el",tag:"ul",attrs:{},repeat:true,children:[{t:"el",tag:"li",attrs:{class:"card"},children:[{t:"el",tag:"h3",attrs:{},children:[],field:"title"},{t:"el",tag:"p",attrs:{},children:[],field:"text"}]}]}]}};
const pkg:ImportedTemplatePackage={name:"Atelier",version:"1.0.0",theme:{primary:"#8a4b2a",headingFont:"editorial"},css:".tenant-site-imported .at-hero{color:red}",sections:[hero,features],
 home:[{type:"hero",title:"Feito à mão",text:"",eyebrow:"Outono",buttonLabel:"Ver coleção",buttonUrl:"#catalogo",imageUrl:"https://storage.test/a.webp",imageAlt:"Mesa",items:[],section:0},{type:"features",title:"Diferenciais",text:"",imageAlt:"",items:[{title:"Feito à mão",text:"Peça única"},{title:"Envio",text:"Rastreio"}],section:1},{type:"catalog",title:"Peças da semana",text:"",imageAlt:"",items:[]}],
 pages:[{slug:"sobre",title:"Sobre",blocks:[{type:"hero",title:"Nossa história",text:"",imageAlt:"",items:[],section:0}]}],navigation:[{label:"Sobre",url:"/sobre"}],assetUrls:[]};
const id="tpl-12345678-1234-1234-1234-123456789012";

describe("modelo importado",()=>{
 it("aplicar com conteúdo: blocos do Vorix editáveis, páginas, menu, tema e o desenho de cada seção",()=>{
  const base=initialSiteSnapshot("Loja","nexus");
  const next=applyImportedTemplate(base,{id,package:pkg},true);
  expect(next.content.blocks.map(block=>block.type)).toEqual(["hero","features","catalog"]);
  expect(next.content.blocks[0]).toMatchObject({title:"Feito à mão",eyebrow:"Outono",buttonLabel:"Ver coleção",imageUrl:"https://storage.test/a.webp"});
  expect(next.content.blocks[1].items).toHaveLength(2);
  expect(next.content.blocks[2].title).toBe("Peças da semana");
  expect(next.content.pages.find(page=>page.slug==="sobre")?.blocks[0].title).toBe("Nossa história");
  expect(next.content.header?.navigation.map(link=>link.label)).toEqual(["Sobre"]);
  expect(next.theme).toMatchObject({template:"catalog",importedTemplateId:id,primary:"#8a4b2a"});
  expect(Object.values(next.theme.importedSections??{})).toEqual([0,1,0]);
  const appearance=applyImportedTemplate(base,{id,package:pkg},false);
  expect(appearance.content).toEqual(base.content);expect(appearance.theme.importedTemplateId).toBe(id);
 });

 it("a vitrine desenha as seções do pacote com o conteúdo atual do bloco e aplica o CSS restrito",()=>{
  const snapshot=applyImportedTemplate(initialSiteSnapshot("Loja","nexus"),{id,package:pkg},true);
  snapshot.content.blocks[0]={...snapshot.content.blocks[0],title:"Título editado no Vorix",eyebrow:undefined};
  const site={...templateDemo("nexus"),...snapshot,slug:"loja",importedTemplate:{id,name:"Atelier",css:pkg.css,sections:pkg.sections,sectionMap:snapshot.theme.importedSections??{}}};
  const html=renderToStaticMarkup(createElement(TenantSiteRenderer,{site,basePath:"/s/loja"}));
  expect(html).toContain("tenant-site-imported");
  expect(html).toContain(".tenant-site-imported .at-hero{color:red}");
  expect(html).toContain('<h1>Título editado no Vorix</h1>');
  expect(html).not.toContain("at-eyebrow");
  expect(html).toContain('href="/s/loja#catalogo"');expect(html).toContain('href="/s/loja#contato"');
  expect(html).toContain('<li class="card"><h3>Feito à mão</h3><p>Peça única</p></li><li class="card"><h3>Envio</h3><p>Rastreio</p></li>');
  expect(html).toContain('data-vorix-block="hero"');
  expect(html).not.toContain("<script>alert");
 });

 it("bloco novo do mesmo tipo usa o desenho do pacote; tipo sem desenho usa a seção do Vorix",()=>{
  const view={id,name:"A",css:"",sections:[hero,features],sectionMap:{}};
  expect(importedSectionFor(view,{id:"novo",type:"hero"})).toBe(hero);
  expect(importedSectionFor(view,{id:"x",type:"catalog"})).toBeUndefined();
  expect(importedSectionFor(undefined,{id:"x",type:"hero"})).toBeUndefined();
 });

 it("trocar para um modelo do Vorix desliga o modelo importado",()=>{
  const imported=applyImportedTemplate(initialSiteSnapshot("Loja","nexus"),{id,package:pkg},true);
  const switched=selectSiteTemplate(imported,"nexus");
  expect(switched.theme.importedTemplateId).toBeUndefined();expect(switched.theme.importedSections).toBeUndefined();
  expect(selectSiteTemplate(switched,"catalog").theme.importedTemplateId).toBeUndefined();
 });

 it("o relatório em texto traz código, arquivo, linha e como corrigir",()=>{
  const text=reportAsText("modelo.zip",{ok:false,errors:[{code:"HTML_FORBIDDEN_TAG",severity:"error",message:"a tag <script> não é permitida.",hint:"Remova scripts.",file:"sections/hero.html",line:4}],warnings:[],summary:{files:3,sections:1,pages:0,assets:0}});
  expect(text).toContain("não pode ser importado");expect(text).toContain("[HTML_FORBIDDEN_TAG] sections/hero.html, linha 4");expect(text).toContain("Como corrigir: Remova scripts.");
 });
});
