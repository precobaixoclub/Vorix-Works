import { z } from "zod";
const text=z.string().trim().max(4000);
const safeLink=z.string().max(2000).refine(value=>{
 if(!value)return true;
 try{const url=new URL(value);return ["https:","mailto:","tel:"].includes(url.protocol)&&!url.username&&!url.password;}catch{return /^\/(?!\/)[a-z0-9/_-]*$/i.test(value);}
},"Use um link https, telefone ou e-mail válido.");
const image=z.string().max(2000);
export const siteBlockSchema=z.object({
 id:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), type:z.enum(["hero","text","catalog","categories","contact","image","faq","features"]),
 title:text.default(""),text:text.default(""),imageUrl:image.optional(),imageAlt:z.string().max(200).default(""),
 buttonLabel:z.string().max(100).optional(),buttonUrl:safeLink.optional(),
 productIds:z.array(z.string().max(160)).max(100).default([]),items:z.array(z.object({title:z.string().max(200),text}).strict()).max(30).default([]),enabled:z.boolean().default(true),
}).strict();
export const siteContentSchema=z.object({
 name:z.string().trim().min(1).max(160),logoUrl:image.optional(),faviconUrl:image.optional(),
 description:text.default(""),email:z.union([z.email(),z.literal("")]).optional(),phone:z.string().regex(/^[+\d ()-]{0,30}$/).optional(),
 whatsapp:z.string().regex(/^\d{8,15}$/).optional(),address:z.string().max(500).optional(),footer:text.default(""),
 socials:z.array(z.object({label:z.string().max(60),url:safeLink}).strict()).max(10).default([]),
 seo:z.object({title:z.string().max(160).default(""),description:z.string().max(320).default("")}).strict().default({title:"",description:""}),
 blocks:z.array(siteBlockSchema).max(40).default([]),
 pages:z.array(z.object({slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),title:z.string().min(1).max(160),seoDescription:z.string().max(320).default(""),published:z.boolean().default(true),blocks:z.array(siteBlockSchema).max(30)}).strict()).max(30).default([]),
 contactForm:z.boolean().default(true),
}).strict().superRefine((value,ctx)=>{
 const ids=value.blocks.map(block=>block.id);if(new Set(ids).size!==ids.length)ctx.addIssue({code:"custom",message:"Cada seção precisa de um identificador diferente.",path:["blocks"]});
 if(new Set(value.pages.map(page=>page.slug)).size!==value.pages.length)ctx.addIssue({code:"custom",message:"Cada página precisa de um endereço diferente.",path:["pages"]});
 for(const page of value.pages)if(new Set(page.blocks.map(block=>block.id)).size!==page.blocks.length)ctx.addIssue({code:"custom",message:"As seções da página não podem repetir identificadores.",path:["pages"]});
});
export const siteThemeSchema=z.object({template:z.enum(["catalog","studio","showcase"]).default("catalog"),primary:z.string().regex(/^#[0-9a-f]{6}$/i).default("#2563eb"),background:z.string().regex(/^#[0-9a-f]{6}$/i).default("#ffffff"),foreground:z.string().regex(/^#[0-9a-f]{6}$/i).default("#111827"),rounded:z.boolean().default(true)}).strict();
export type SiteContent=z.infer<typeof siteContentSchema>;
export type SiteTheme=z.infer<typeof siteThemeSchema>;
export type SiteSnapshot={content:SiteContent;theme:SiteTheme};
export type Site={id:string;tenantId:string;workspaceId:string;slug:string;draft:SiteSnapshot;published?:SiteSnapshot;revision:number;publishedAt?:string;updatedAt:string};
export type SiteDomain={id:string;siteId:string;tenantId:string;hostname:string;challenge:string;verifiedAt?:string;expiresAt:string};

export function normalizeSiteHostname(input:string):string{
 const hostname=input.trim().toLowerCase().replace(/\.$/,"");
 if(hostname.length>253||!hostname.includes(".")||!hostname.split(".").every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||/^(?:\d+\.){3}\d+$/.test(hostname)||/\.(?:localhost|local|internal|invalid|test)$/.test(hostname))throw Error("SITE_VALIDATION: informe um domínio público válido, sem protocolo ou caminho.");
 return hostname;
}
export function siteImageUrls(snapshot:SiteSnapshot):string[]{return [snapshot.content.logoUrl,snapshot.content.faviconUrl,...snapshot.content.blocks.map(block=>block.imageUrl),...snapshot.content.pages.flatMap(page=>page.blocks.map(block=>block.imageUrl))].filter((url):url is string=>Boolean(url));}
