import {describe,it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {initialSiteSnapshot,applySiteTemplate,TEMPLATE_PRESETS,safeSiteHref,siteHref,contrastText,newSiteBlock} from "@/features/sites/customization";
import {siteDraftReducer,emptySiteDraft} from "@/features/sites/draft-history";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
import type {PublicTenantSite,SiteSnapshot} from "@/features/sites/types";
const site=(draft:SiteSnapshot):PublicTenantSite=>({id:"fixture",slug:"fixture",...draft,products:[],categories:[],brands:[],commerceEnabled:false});

describe("personalização do Site",()=>{
 it("trocar modelo preserva textos, imagens, páginas, catálogo e links já escolhidos",()=>{
  const original=initialSiteSnapshot("Empresa de teste");original.content.blocks[0].title="Meu título";original.content.blocks[0].imageUrl="https://media.fixture.invalid/image.png";original.content.blocks[1].productIds=["product-1"];original.content.pages=[{slug:"sobre",title:"Sobre",seoDescription:"Minha história",published:true,blocks:[newSiteBlock("text")]}];
  for(const preset of TEMPLATE_PRESETS){const changed=applySiteTemplate(original,preset.id);expect(changed.content).toEqual(original.content);expect(changed.theme.template).toBe(preset.id);expect(changed.theme.primary).toBe(preset.theme.primary);}
  expect(original.theme.template).toBe("catalog");
 });
 it("paletas e composições dos três modelos são diferentes, sem criar afirmações comerciais fictícias",()=>{
  expect(TEMPLATE_PRESETS).toHaveLength(6);expect(new Set(TEMPLATE_PRESETS.map(item=>item.theme.primary)).size).toBe(6);expect(new Set(TEMPLATE_PRESETS.map(item=>item.theme.headerLayout)).size).toBe(3);
  for(const preset of TEMPLATE_PRESETS){const snapshot=initialSiteSnapshot("Minha empresa",preset.id);expect(snapshot.content.name).toBe("Minha empresa");expect(snapshot.content.blocks.some(block=>block.type==="testimonials"||block.type==="stats")).toBe(false);}
 });
 it("desfazer e refazer mantêm o estado salvo e descartam o futuro após nova edição",()=>{
  const first=initialSiteSnapshot("Primeiro nome");let state=siteDraftReducer(emptySiteDraft,{type:"reset",value:first});const changed={...first,content:{...first.content,name:"Segundo nome"}};
  state=siteDraftReducer(state,{type:"change",value:changed});expect(JSON.stringify(state.present)).not.toBe(state.baseline);state=siteDraftReducer(state,{type:"undo"});expect(JSON.stringify(state.present)).toBe(state.baseline);state=siteDraftReducer(state,{type:"redo"});expect(state.present?.content.name).toBe("Segundo nome");state=siteDraftReducer(state,{type:"undo"});state=siteDraftReducer(state,{type:"change",value:{...first,content:{...first.content,name:"Terceiro nome"}}});expect(state.future).toEqual([]);
 });
 it("histórico tem limite e um evento repetido não duplica estados",()=>{
  const first=initialSiteSnapshot("Teste");let state=siteDraftReducer(emptySiteDraft,{type:"reset",value:first});expect(siteDraftReducer(state,{type:"change",value:first})).toBe(state);for(let i=0;i<50;i++)state=siteDraftReducer(state,{type:"change",value:{...first,content:{...first.content,name:`Empresa ${i}`}}});expect(state.past).toHaveLength(30);
 });
 it("links locais permanecem no site do tenant e protocolos executáveis são rejeitados também na prévia",()=>{
  expect(siteHref("/sobre","/s/empresa")).toBe("/s/empresa/sobre");expect(siteHref("#catalogo","/s/empresa")).toBe("/s/empresa#catalogo");for(const input of["javascript:alert(1)","//evil.invalid","data:text/html,<script>bad</script>","https://user:secret@evil.invalid"]){expect(safeSiteHref(input)).toBeUndefined();}
 });
 it("botões selecionam texto claro ou escuro conforme a cor principal",()=>{
  expect(contrastText("#FFFFFF")).toBe("#111111");expect(contrastText("#ADDB46")).toBe("#111111");expect(contrastText("#162443")).toBe("#FFFFFF");
 });
 it("uma página chamada produto não se confunde com a ficha de um produto",()=>{
  const draft=initialSiteSnapshot("Empresa de exemplo");draft.content.pages=[{slug:"produto",title:"Conheça nossa linha",seoDescription:"",published:true,blocks:[{...newSiteBlock("text"),title:"Uma página personalizada"}]}];
  const html=renderToStaticMarkup(createElement(TenantSiteRenderer,{site:site(draft),basePath:"/s/fixture",path:["produto"]}));expect(html).toContain("Conheça nossa linha");expect(html).toContain("Uma página personalizada");expect(html).not.toContain("Página não encontrada");
 });
 it("conteúdo renderizado não executa HTML, links perigosos ou estilos fornecidos como texto",()=>{
  const draft=initialSiteSnapshot("Empresa <script>não executar</script>");draft.content.header!.navigation.push({id:"evil",label:"Link perigoso",url:"javascript:alert(1)",enabled:true,newTab:false});draft.content.blocks.push({...newSiteBlock("text"),text:'<img src="x" onerror="alert(1)">',title:"Texto seguro",richText:[{type:"paragraph",children:[{text:"Nossa página",url:"/sobre",bold:true}]}]});
  const html=renderToStaticMarkup(createElement(TenantSiteRenderer,{site:site(draft),basePath:"/s/fixture"}));expect(html).not.toContain("javascript:alert");expect(html).not.toContain("<script>não executar");expect(html).toContain("&lt;script&gt;");expect(html).toContain('href="/s/fixture/sobre"');expect(html).toContain("ts-hero");
 });
});
