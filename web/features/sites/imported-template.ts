import {newSiteBlock} from "./customization";
import {websiteTemplate} from "./template-registry";
import type {SiteBlock,SiteSnapshot} from "./types";

/** Espelha `src/domain/sites/site-template-package.ts` (Pacote de Modelo Vorix). */
export type TemplateNode={t:"text";v:string}|{t:"el";tag:string;attrs:Record<string,string>;children:TemplateNode[];field?:string;repeat?:true};
export type TemplateSection={type:string;tree:TemplateNode};
export type ImportedTemplateView={id:string;name:string;css:string;sections:TemplateSection[];sectionMap:Record<string,number>};
export type TemplateIssue={code:string;severity:"error"|"warning";message:string;hint?:string;file?:string;line?:number};
export type TemplateReport={ok:boolean;errors:TemplateIssue[];warnings:TemplateIssue[];summary:{files:number;sections:number;pages:number;assets:number}};
export type TemplateSampleBlock={type:SiteBlock["type"];title:string;text:string;eyebrow?:string;buttonLabel?:string;buttonUrl?:string;imageUrl?:string;imageAlt:string;videoUrl?:string;items:{title:string;text:string;value?:string;imageUrl?:string;imageAlt?:string}[];images?:{url:string;alt:string}[];section?:number};
export type ImportedTemplatePackage={name:string;version:string;author?:string;description?:string;previewUrl?:string;theme:Partial<SiteSnapshot["theme"]>;css:string;sections:TemplateSection[];home:TemplateSampleBlock[];pages:{slug:string;title:string;blocks:TemplateSampleBlock[]}[];navigation:{label:string;url:string}[];assetUrls:string[]};
export type ImportedTemplateSummary={id:string;name:string;version:string;author?:string;description?:string;previewUrl?:string;sections:number;pages:number;createdAt:string};
export type ImportedTemplateDetail=ImportedTemplateSummary&{report:TemplateReport;package:ImportedTemplatePackage;signedPackage:{css:string;sections:TemplateSection[]}};

/** Base do Vorix por baixo do modelo importado: cabeçalho, rodapé, catálogo e páginas padrão. */
export const IMPORTED_TEMPLATE_BASE="catalog";

/** Índice do desenho de uma seção: o escolhido na importação ou o primeiro do mesmo tipo. */
export function importedSectionFor(view:ImportedTemplateView|undefined,block:Pick<SiteBlock,"id"|"type">):TemplateSection|undefined{
 if(!view)return undefined;
 const mapped=view.sectionMap[block.id];
 if(mapped!==undefined&&view.sections[mapped]?.type===block.type)return view.sections[mapped];
 return view.sections.find(section=>section.type===block.type);
}

function blockFrom(sample:TemplateSampleBlock,id:string):SiteBlock{
 const base=newSiteBlock(sample.type,id);
 return {
  ...base,title:sample.title||base.title,text:sample.text,eyebrow:sample.eyebrow||undefined,
  imageUrl:sample.imageUrl,imageAlt:sample.imageAlt??"",buttonLabel:sample.buttonLabel||undefined,buttonUrl:sample.buttonUrl||undefined,
  items:sample.items.length?sample.items.map(item=>({title:item.title,text:item.text,...(item.value?{value:item.value}:{}),...(item.imageUrl?{imageUrl:item.imageUrl,imageAlt:item.imageAlt??""}:{})})):sample.type==="features"||sample.type==="stats"||sample.type==="testimonials"||sample.type==="faq"||sample.type==="logos"?[]:base.items,
  ...(sample.videoUrl?{videoUrl:sample.videoUrl}:{}),
  ...(sample.images?{images:sample.images.map((image,index)=>({id:`${id}-img-${index}`,url:image.url,alt:image.alt}))}:{}),
  slides:undefined,
 };
}

/**
 * Aplica um modelo importado ao rascunho. Com `withContent`, a página inicial, as páginas e o menu do
 * pacote entram no lugar dos atuais (páginas com outro endereço são mantidas); sem ele, só muda a
 * aparência e cada seção usa o desenho do pacote do mesmo tipo, quando existir.
 */
export function applyImportedTemplate(snapshot:SiteSnapshot,template:{id:string;package:ImportedTemplatePackage},withContent:boolean):SiteSnapshot{
 const pkg=template.package,prefix=`imp-${template.id.slice(4,12)}`;
 const theme={...structuredClone(websiteTemplate(IMPORTED_TEMPLATE_BASE).defaultTheme),...pkg.theme,template:IMPORTED_TEMPLATE_BASE,importedTemplateId:template.id,importedSections:{} as Record<string,number>};
 if(!withContent)return {...snapshot,activeTemplateId:IMPORTED_TEMPLATE_BASE,theme};
 const build=(samples:TemplateSampleBlock[],scope:string)=>samples.map((sample,index)=>{const id=`${prefix}-${scope}-${index}`;if(sample.section!==undefined)theme.importedSections[id]=sample.section;return blockFrom(sample,id);});
 const blocks=build(pkg.home,"home");
 const imported=pkg.pages.map((page,index)=>({slug:page.slug,title:page.title,seoDescription:"",published:true,blocks:build(page.blocks,`p${index}`)}));
 const pages=[...snapshot.content.pages.filter(page=>!imported.some(item=>item.slug===page.slug)),...imported].slice(0,30);
 const header=pkg.navigation.length?{...(snapshot.content.header??{showSearch:false,sticky:false}),navigation:pkg.navigation.map((link,index)=>({id:`${prefix}-nav-${index}`,label:link.label,url:link.url,enabled:true,newTab:/^https:/.test(link.url)}))}:snapshot.content.header;
 return {...snapshot,activeTemplateId:IMPORTED_TEMPLATE_BASE,theme,content:{...snapshot.content,blocks,pages,...(header?{header}:{})}};
}

/** Trocar para um modelo do Vorix desliga o modelo importado. */
export function withoutImportedTemplate(snapshot:SiteSnapshot):SiteSnapshot{
 if(!snapshot.theme.importedTemplateId&&!snapshot.theme.importedSections)return snapshot;
 const {importedTemplateId:_id,importedSections:_sections,...theme}=snapshot.theme;
 return {...snapshot,theme};
}
