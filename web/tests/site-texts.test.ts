import {describe,expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
import {initialSiteSnapshot,newSiteBlock} from "@/features/sites/customization";
import {templateDemo} from "@/features/sites/demo-content";
import {SITE_TEXTS,siteText,siteTextsFor} from "@/features/sites/site-texts";

const render=(template:string,texts?:Record<string,string>,slug="loja")=>{const base=initialSiteSnapshot("Loja",template);const site={...templateDemo(template),...base,slug,content:{...base.content,texts,blocks:[...base.content.blocks.filter(block=>block.type!=="contact"),newSiteBlock("contact","contato")],contactForm:true}};return renderToStaticMarkup(createElement(TenantSiteRenderer,{site,basePath:`/s/${slug}`}));};

describe("textos do site",()=>{
 it("padrão do modelo, texto trocado pela pessoa e vazio voltando ao padrão",()=>{
  expect(siteText({},"nexus.signal")).toBe("NOVAS PERSPECTIVAS");
  expect(siteText({texts:{"nexus.signal":"LANÇAMENTOS"}},"nexus.signal")).toBe("LANÇAMENTOS");
  expect(siteText({texts:{"nexus.signal":"  "}},"nexus.signal")).toBe("NOVAS PERSPECTIVAS");
 });
 it("o modelo mostra os textos editáveis com a marcação de clique na prévia",()=>{
  const html=render("nexus",{"nexus.signal":"LANÇAMENTOS","form.submit":"Quero falar com vocês","form.name":"Nome completo"});
  expect(html).toContain('data-site-text="nexus.signal">LANÇAMENTOS<');
  expect(html).not.toContain("NOVAS PERSPECTIVAS");
  expect(html).toContain("Quero falar com vocês");expect(html).toContain('aria-label="Nome completo"');
  expect(html).toContain("O e-mail é opcional.");expect(html).not.toContain("e-mail ? opcional");
 });
 it("cada modelo lista só os textos que usa",()=>{
  const keys=(template:string,fashion=false)=>siteTextsFor(template,fashion).map(text=>text.key);
  expect(keys("aura")).toContain("aura.edition");expect(keys("aura")).not.toContain("nexus.signal");expect(keys("aura")).toContain("premium.noImage");
  expect(keys("nexus",true)).toContain("fk.headerNote");expect(keys("nexus",true)).not.toContain("nexus.signal");
  expect(keys("catalog")).toEqual(SITE_TEXTS.filter(text=>text.scope==="all").map(text=>text.key));
 });
 it("Bambilu: a frase do cabeçalho é editável e mantém a quebra de linha",()=>{
  const html=render("nexus",{"fk.headerNote":"Moda que acompanha.\nCada fase."},"bambilu-kids");
  expect(html).toContain('data-site-text="fk.headerNote">Moda que acompanha.<br/>Cada fase.<');
  expect(html).not.toContain("Pequenos momentos.");
 });
});
