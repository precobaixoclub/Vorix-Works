import type {PublicTenantSite} from "@/features/sites/types";
import {BLOCK_LABELS,resolvedHeader} from "@/features/sites/customization";
import {FASHION_EDITORIAL_ID,isFashionKidsSite} from "@/features/sites/fashion-kids";
import type {SitePreviewSelection} from "./SiteEditorContext";

export type PreviewHit={element:HTMLElement;selection:SitePreviewSelection};
export function previewSelection(node:Element,site:PublicTenantSite,path:string[],mobile:boolean):PreviewHit|undefined {
 if(!node.closest?.(".tenant-site"))return;
 const closest=(selector:string)=>node.closest<HTMLElement>(selector);
 let field=closest(".ts-stat strong")?"value":closest("img,picture,.nexus-hero-art,.aura-hero-visual,.pulse-hero-visual,.ts-hero-media,.fk-hero-visual,.ts-hero-background-image,.nexus-grid")?"image":closest("h1,h2,h3,summary,.ts-person strong")?"title":closest("a,button")?"button":closest(".ts-eyebrow,.fk-kicker,.nexus-signal")?"eyebrow":closest("figcaption")?"caption":closest("p,blockquote,.ts-rich")?"text":undefined;
 const hit=closest("img,h1,h2,h3,p,blockquote,summary,a,button,figcaption,.ts-eyebrow,.fk-kicker,.ts-rich")??closest("[data-site-block],.fk-editorial,header,footer,section,.tenant-site")!;
 const select=(selection:Omit<SitePreviewSelection,"path">,element=hit):PreviewHit=>({element,selection:{...selection,path}});
 if(closest(".ts-announcement"))return select({section:"menu",selector:".ts-announcement,header",label:"Faixa de aviso",fieldLabel:"Texto da faixa de aviso"});
 const brand=closest(".premium-brand,.ts-brand,.fk-brand,.ts-footer-brand>strong,.ts-footer-brand>img");
 if(brand)return select({section:"geral",selector:closest("footer")?"footer":"header",label:field==="image"?"Logo":"Nome do site",fieldLabel:field==="image"?"Logo":"Nome do site",part:field==="image"?"image":"brand"},brand);
 const header=closest("header");
 if(header){
  const linkId=closest("[data-site-link]")?.dataset.siteLink,link=resolvedHeader(site.content).navigation.find(link=>link.id===linkId);
  return select({section:"menu",selector:"header",label:link?`Link: ${link.label}`:"Cabeçalho e menu",linkId:link?.id,part:field,fieldLabel:link?`Nome do link ${resolvedHeader(site.content).navigation.indexOf(link)+1}`:closest(".premium-header-cta,.ts-header-tools>a")?"Texto do botão do cabeçalho":closest('[aria-label="Buscar no site"],[aria-label="Buscar na coleção"]')?"Mostrar busca no cabeçalho":undefined},link?hit:header);
 }
 const contact=closest("#contato,.ts-contact,footer");
 if(contact){
  if(closest("form"))return select({section:"contato",selector:"#contato",label:"Formulário de contato",fieldLabel:"Permitir formulário de contato"});
  const link=closest("a"),href=link?.getAttribute("href")??"";
  if(closest("address,.ts-socials")||/^(mailto:|tel:|https:\/\/wa\.me\/)/.test(href))return select({section:"contato",selector:closest("footer")?"footer":"#contato",label:"Contato e redes sociais",fieldLabel:href.startsWith("mailto:")?"E-mail de contato":href.startsWith("tel:")?"Telefone":href.includes("wa.me/")?"WhatsApp (país, DDD e número)":closest("address")?"Endereço":undefined});
  if(closest("footer")){
   const columnId=closest("[data-site-footer-column]")?.dataset.siteFooterColumn,column=site.content.footerColumns?.find(column=>column.id===columnId),linkId=closest("[data-site-link]")?.dataset.siteLink;
   if(column)return select({section:"rodape",selector:`[data-site-footer-column="${CSS.escape(column.id)}"]`,label:`Rodapé: ${column.title}`,columnId:column.id,linkId,part:field,fieldLabel:linkId?`Nome do link ${column.links.findIndex(link=>link.id===linkId)+1}`:undefined});
   if(linkId&&resolvedHeader(site.content).navigation.some(link=>link.id===linkId))return select({section:"menu",selector:"header",label:"Link do menu",linkId,fieldLabel:`Nome do link ${resolvedHeader(site.content).navigation.findIndex(link=>link.id===linkId)+1}`});
   return select({section:"rodape",selector:"footer",label:"Rodapé",fieldLabel:closest(".ts-footer-bottom")?"Aviso final do rodapé":"Texto do rodapé",part:field});
  }
 }
 if(closest("[data-site-page-title]"))return select({section:"paginas",selector:"[data-site-page-title]",label:"Título da página",fieldLabel:"Título da página",part:"title"});
 const productId=closest("[data-product-card]")?.dataset.productCard??(path[0]==="produto"?site.products.find(product=>product.slug===path[1])?.id:undefined);
 if(productId)return select({section:"catalogo",selector:"#catalogo,.ts-product-detail",label:`Produto: ${site.products.find(product=>product.id===productId)?.name??"Catálogo"}`,productId},closest("[data-product-card],.ts-product-detail")??hit);
 const blockId=closest("[data-site-block]")?.dataset.siteBlock,blocks=path.length?site.content.pages.find(page=>page.slug===path[0])?.blocks:site.content.blocks,block=blocks?.find(block=>block.id===blockId);
 if(block){
  if(block.type==="hero"&&!field&&closest(".nexus-hero"))field="image";
  const itemIndex=closest("[data-site-item]")?.dataset.siteItem,imageId=closest("[data-site-image]")?.dataset.siteImage;
  const selection:SitePreviewSelection={section:path.length?"paginas":block.type==="hero"?"banners":"secoes",selector:`[data-site-block="${CSS.escape(block.id)}"]`,label:block.title||BLOCK_LABELS[block.type],path,blockId:block.id,part:field,itemIndex:itemIndex!==undefined?Number(itemIndex):undefined,imageId};
  if(block.type==="hero"){
   const activeId=closest("[data-site-active-slide]")?.dataset.siteActiveSlide??closest("[data-site-block]")?.querySelector<HTMLElement>("[data-site-active-slide]")?.dataset.siteActiveSlide,slide=block.slides?.find(slide=>slide.id===activeId)??block.slides?.find(slide=>slide.enabled);
   if(field==="image"){
    selection.device=mobile?"mobile":"desktop";
    selection.fieldLabel=mobile&&site.layoutConfig?.heroMobileImageUrl?"Imagem exclusiva para celular":site.layoutConfig?.heroImageUrl?"Imagem exclusiva deste modelo":slide?`Banner ${block.slides!.indexOf(slide)+1} para ${mobile&&slide.mobileImageUrl?"celular":"computador"}`:block.imageUrl?"Imagem da seção":"Produto em destaque no banner";
    if(slide&&!site.layoutConfig?.heroImageUrl&&!site.layoutConfig?.heroMobileImageUrl)selection.slideId=slide.id;
   }else if(slide){selection.slideId=slide.id;}
  }
  return {element:field?hit:closest("[data-site-block]")!,selection};
 }
 if(isFashionKidsSite(site)&&closest(".fk-editorial"))return select({section:"secoes",selector:".fk-editorial",label:"Nosso olhar",blockId:FASHION_EDITORIAL_ID,synthetic:"fashion-editorial",part:field});
 if(closest(".fk-featured,.fk-explore,.fk-details,.ts-product-detail,#catalogo"))return select({section:"catalogo",selector:"#catalogo",label:"Catálogo de produtos"},closest(".fk-featured,.fk-explore,.fk-details,.ts-product-detail,#catalogo")!);
 return select({section:"aparencia",selector:"main",label:"Cores, fontes e composição"},closest("section,.tenant-site")!);
}
