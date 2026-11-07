import type {SiteBlock,SiteContent} from "./types";
import {BLOCK_LABELS} from "./customization";

export type SiteLinkKind="page"|"section"|"external"|"whatsapp"|"email"|"phone"|"custom";
export function siteLinkKind(value:string):SiteLinkKind {
 if(!value)return "page";
 if(value.startsWith("mailto:"))return "email";
 if(value.startsWith("tel:"))return "phone";
 if(/^https:\/\/wa\.me\/\d+$/i.test(value))return "whatsapp";
 if(value.startsWith("#")||value.startsWith("/")&&!value.startsWith("//")&&value.includes("#"))return "section";
 if(value.startsWith("/")&&!value.startsWith("//"))return "page";
 if(/^https:\/\//i.test(value))return "external";
 return "custom";
}
export function sectionLink(block:SiteBlock,prefix=""){
 return `${prefix}#${block.type==="catalog"?"catalogo":block.type==="contact"?"contato":`secao-${block.id}`}`;
}
export function siteSectionOptions(content:Pick<SiteContent,"blocks"|"pages">){
 const options=(blocks:SiteBlock[],prefix:string,page:string)=>blocks.filter(block=>block.enabled&&!["hero","divider"].includes(block.type)).map(block=>({value:sectionLink(block,prefix),label:`${page} · ${block.title||BLOCK_LABELS[block.type]}`}));
 const seen=new Set<string>();
 return [...options(content.blocks,"","Página inicial"),...content.pages.flatMap(page=>options(page.blocks,`/${page.slug}`,page.title+(page.published?"":" (rascunho)")))].filter(option=>{if(seen.has(option.value))return false;seen.add(option.value);return true;});
}
export function normalizeExternalSiteLink(value:string){
 const trimmed=value.trim();
 // Only add a scheme to an apparent hostname. Preserve paths and explicit protocols.
 return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(trimmed)?`https://${trimmed}`:trimmed;
}
