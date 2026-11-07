import {describe,it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {initialSiteSnapshot,newSiteBlock,safeSiteHref} from "@/features/sites/customization";
import {normalizeExternalSiteLink,sectionLink,siteLinkKind,siteSectionOptions} from "@/features/sites/editor-links";
import {PreviewEditingContext} from "@/components/sites/SiteEditorContext";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";

describe("editor: destinos compreensíveis e acompanhamento sem publicar",()=>{
 it("reconhece destinos existentes sem alterar links com parâmetros",()=>{
  for(const [value,kind] of [["/sobre","page"],["#catalogo","section"],["/sobre#secao-equipe","section"],["https://example.com/?q=1#info","external"],["https://wa.me/5511999999999","whatsapp"],["https://wa.me/5511999999999?text=Oi","external"],["mailto:contato@example.com","email"],["tel:+551133334444","phone"],["//example.com","custom"]])expect(siteLinkKind(value)).toBe(kind);
 });
 it("completa apenas domínios e mantém protocolos inseguros sujeitos à validação",()=>{
  expect(normalizeExternalSiteLink(" www.example.com/loja?q=1 ")).toBe("https://www.example.com/loja?q=1");
  for(const value of ["/sobre","#catalogo","https://example.com","mailto:a@example.com","javascript:alert(1)","//example.com"])expect(normalizeExternalSiteLink(value)).toBe(value);
  expect(safeSiteHref(normalizeExternalSiteLink("javascript:alert(1)"))).toBeUndefined();
 });
 it("oferece seções com âncoras reais, inclusive nas páginas internas",()=>{
  const snapshot=initialSiteSnapshot("Empresa");snapshot.content.blocks.push({...newSiteBlock("text","hidden"),enabled:false});snapshot.content.pages=[{slug:"sobre",title:"Sobre nós",published:false,seoDescription:"",blocks:[newSiteBlock("text","equipe")]}];
  snapshot.content.blocks.push(newSiteBlock("catalog","another-catalog"));const options=siteSectionOptions(snapshot.content);
  expect(options.some(option=>option.value==="#catalogo")).toBe(true);expect(options.some(option=>option.value==="#contato")).toBe(true);expect(options.some(option=>option.value==="/sobre#secao-equipe"&&option.label.includes("rascunho"))).toBe(true);expect(options.some(option=>option.value.includes("hidden"))).toBe(false);
  expect(sectionLink(newSiteBlock("text","outro"))).toBe("#secao-outro");
  expect(options.filter(option=>option.value==="#catalogo")).toHaveLength(1);
 });
 it("mostra o banner em edição nos seis modelos sem modificar o conteúdo",()=>{
  for(const template of ["nexus","aura","pulse","catalog","showcase","studio"]){
   const snapshot=initialSiteSnapshot("Empresa",template),block=snapshot.content.blocks[0];block.slides=[{id:"one",enabled:true,title:"Primeiro banner",text:"Primeira mensagem",imageAlt:""},{id:"two",enabled:true,title:"Segundo banner em edição",text:"Segunda mensagem",imageAlt:""}];
   const before=JSON.stringify(snapshot),site={...snapshot,id:"fixture",slug:"fixture",products:[],categories:[],brands:[],commerceEnabled:false as const};
   const regular=renderToStaticMarkup(createElement(TenantSiteRenderer,{site,basePath:"/s/fixture",preview:true}));expect(regular).toMatch(/<h1[^>]*>Primeiro banner/);
   const focused=renderToStaticMarkup(createElement(PreviewEditingContext.Provider,{value:{blockId:block.id,slideId:"two",selector:`[data-site-block="${block.id}"]`,label:"Banner",path:[],field:"title",token:1}},createElement(TenantSiteRenderer,{site,basePath:"/s/fixture",preview:true})));expect(focused).toMatch(/<h1[^>]*>Segundo banner em edição/);expect(JSON.stringify(snapshot)).toBe(before);
  }
 });
});
