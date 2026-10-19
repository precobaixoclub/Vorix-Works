import definitions from "./template-registry.generated.json";
import type {SiteTheme} from "./types";
export type WebsiteTemplate=Omit<typeof definitions[number],"defaultTheme">&{defaultTheme:SiteTheme};
export const WEBSITE_TEMPLATES=definitions as WebsiteTemplate[];
export const PREMIUM_TEMPLATES=WEBSITE_TEMPLATES.filter(template=>!template.legacy);
export function websiteTemplate(id:string){const template=WEBSITE_TEMPLATES.find(template=>template.id===id);if(!template)throw Error("Modelo de site não encontrado.");return template;}
