import type {SiteSnapshot,SiteTemplateConfig,SiteBlock,TemplateSectionLayout,SiteLayoutConfig} from "./types";
import {websiteTemplate} from "./template-registry";
export const DEFAULT_SITE_LAYOUT:SiteLayoutConfig={heroVariant:"signature",productGallery:"split"};
const sectionLayout=(blocks:SiteBlock[]):TemplateSectionLayout[]=>blocks.map(({id,enabled,style})=>({id,enabled,...(style?{style:structuredClone(style)}:{})}));
export function captureTemplateConfig(snapshot:SiteSnapshot):SiteSnapshot{
 const id=snapshot.theme.template;
 const config:SiteTemplateConfig={templateVersion:snapshot.templateConfigs?.[id]?.templateVersion??websiteTemplate(id).version,themeConfig:structuredClone(snapshot.theme),sectionConfig:{home:sectionLayout(snapshot.content.blocks),pages:Object.fromEntries(snapshot.content.pages.map(page=>[page.slug,sectionLayout(page.blocks)]))},layoutConfig:structuredClone(snapshot.layoutConfig??DEFAULT_SITE_LAYOUT)};
 return {...snapshot,activeTemplateId:id,templateConfigs:{...snapshot.templateConfigs,[id]:config},layoutConfig:config.layoutConfig};
}
function arrange(blocks:SiteBlock[],layout:TemplateSectionLayout[]){
 const remaining=new Map(blocks.map(block=>[block.id,block]));const ordered:SiteBlock[]=[];
 for(const section of layout){const block=remaining.get(section.id);if(block){ordered.push({...block,enabled:section.enabled,style:section.style});remaining.delete(section.id);}}
 return [...ordered,...remaining.values()];
}
export function selectSiteTemplate(snapshot:SiteSnapshot,id:string):SiteSnapshot{
 const captured=captureTemplateConfig(snapshot),template=websiteTemplate(id),config=captured.templateConfigs?.[id];
 const next:SiteSnapshot={...captured,activeTemplateId:id,theme:structuredClone(config?.themeConfig??template.defaultTheme),layoutConfig:structuredClone(config?.layoutConfig??DEFAULT_SITE_LAYOUT),content:config?{...captured.content,blocks:arrange(captured.content.blocks,config.sectionConfig.home),pages:captured.content.pages.map(page=>({...page,blocks:arrange(page.blocks,config.sectionConfig.pages[page.slug]??[])}))}:captured.content};
 return captureTemplateConfig(next);
}
export function resetSiteTemplateAppearance(snapshot:SiteSnapshot){const id=snapshot.theme.template;return captureTemplateConfig({...snapshot,theme:structuredClone(websiteTemplate(id).defaultTheme),layoutConfig:{...DEFAULT_SITE_LAYOUT}});}
export function restoreSiteSnapshot(restored:SiteSnapshot,current:SiteSnapshot):SiteSnapshot{
 return captureTemplateConfig({...structuredClone(restored),templateConfigs:{...restored.templateConfigs,...current.templateConfigs}});
}
