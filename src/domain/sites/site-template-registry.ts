import templates from "./template-registry.json" with {type:"json"};
export const SITE_TEMPLATE_REGISTRY=templates;
export const SITE_TEMPLATE_IDS=templates.map(template=>template.id) as [string,...string[]];
export const siteTemplate=(id:string)=>templates.find(template=>template.id===id);
