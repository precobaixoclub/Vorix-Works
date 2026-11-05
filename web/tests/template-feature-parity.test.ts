import {describe,it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
import {templateDemo} from "@/features/sites/demo-content";
import {initialSiteSnapshot} from "@/features/sites/customization";
import {WEBSITE_TEMPLATES} from "@/features/sites/template-registry";
import {selectSiteTemplate} from "@/features/sites/template-state";

describe("recursos comuns dos modelos padrão",()=>{
 it("todos os seis modelos mostram fotos de cores e condições comerciais sem depender da Bambilu",()=>{
  for(const template of WEBSITE_TEMPLATES){
   const site={...templateDemo("nexus"),...initialSiteSnapshot("Marca independente",template.id),slug:`independente-${template.id}`};
   site.products[0]={...site.products[0],options:[{key:"color",name:"Cor",values:["Preto","Branco"],images:{Preto:"/preto.webp",Branco:"/branco.webp"}}],quantityOffers:[{id:"rule",name:"Quantidade",count:"ELIGIBLE",currency:"BRL",tiers:[{minimum:3,unitPriceCents:5000}]}]};
   const before=structuredClone(site),home=renderToStaticMarkup(createElement(TenantSiteRenderer,{site,basePath:`/s/${site.slug}`,preview:true}));
   expect(home).toContain(`tenant-site-${template.id} tenant-site-standard`);expect(home).toContain('class="sp-color-photo-button"');expect(home).toContain('src="/preto.webp"');expect(home).toContain('class="sp-card-offer"');expect(home).toContain('aria-label="Buscar no site"');
   const detail=renderToStaticMarkup(createElement(TenantSiteRenderer,{site,basePath:`/s/${site.slug}`,path:["produto",site.products[0].slug],preview:true}));
   expect(detail).toContain('class="sp-color-choices"');expect(detail).toContain('class="sp-color-photo"');expect(detail).toContain("50,00");expect(site).toEqual(before);
  }
 });
 it("novos sites recebem categorias e editorial editáveis, sem promessas comerciais inventadas",()=>{
  for(const template of WEBSITE_TEMPLATES){const snapshot=initialSiteSnapshot("Marca",template.id);expect(snapshot.content.header?.showSearch).toBe(true);expect(snapshot.content.blocks.map(block=>block.type)).toEqual(["hero","categories","catalog","image_text","contact"]);expect(JSON.stringify(snapshot.content)).not.toMatch(/frete grátis|compra segura|mais vendidos|troca grátis/i);}
 });
 it("trocar modelos mantém as escolhas salvas da revisão 1 e não repõe seções removidas",()=>{
  const snapshot=initialSiteSnapshot("Legado","nexus");snapshot.theme.primary="#123456";snapshot.theme.catalog!.mobileColumns=1;snapshot.content.blocks=snapshot.content.blocks.filter(b=>b.type!=="categories"&&b.type!=="image_text");
  snapshot.templateConfigs={nexus:{templateVersion:1,themeConfig:structuredClone(snapshot.theme),layoutConfig:{heroVariant:"compact",productGallery:"stacked"},sectionConfig:{home:[],pages:{}}}};
  const aura=selectSiteTemplate(snapshot,"aura"),back=selectSiteTemplate(aura,"nexus");expect(back.theme.primary).toBe("#123456");expect(back.theme.catalog?.mobileColumns).toBe(1);expect(back.templateConfigs?.nexus.templateVersion).toBe(1);expect(back.content.blocks).toEqual(snapshot.content.blocks);
 });
});
