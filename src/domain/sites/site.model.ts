import { z } from "zod";
import {SITE_TEMPLATE_IDS,siteTemplate} from "./site-template-registry.js";
const text=z.string().trim().max(4000);
const safeLink=z.string().max(2000).refine(value=>{
 if(!value)return true;
 try{const url=new URL(value);return ["https:","mailto:","tel:"].includes(url.protocol)&&!url.username&&!url.password;}catch{return /^(?:\/(?!\/)[a-z0-9/_-]*(?:#[a-z0-9_-]+)?|#[a-z0-9_-]+)$/i.test(value);}
},"Use um link https, telefone ou e-mail válido.");
const image=z.string().max(2000);
const color=z.string().regex(/^#[0-9a-f]{6}$/i);
const link=z.object({id:z.string().max(100),label:z.string().max(100),url:safeLink,enabled:z.boolean().default(true),newTab:z.boolean().default(false)}).strict();
export const siteRichTextSchema=z.array(z.object({type:z.enum(["paragraph","heading","bullet"]),children:z.array(z.object({text:z.string().max(4000),bold:z.boolean().optional(),italic:z.boolean().optional(),url:safeLink.optional()}).strict()).max(30)}).strict()).max(40);
const slide=z.object({id:z.string().max(100),title:z.string().max(200).default(""),text:text.default(""),imageUrl:image.optional(),mobileImageUrl:image.optional(),imageAlt:z.string().max(200).default(""),buttonLabel:z.string().max(100).optional(),buttonUrl:safeLink.optional(),enabled:z.boolean().default(true),startsAt:z.iso.datetime().optional(),endsAt:z.iso.datetime().optional()}).strict().refine(value=>!value.startsAt||!value.endsAt||Date.parse(value.endsAt)>Date.parse(value.startsAt),"O fim do banner deve ser depois do início.");
export const siteBlockSchema=z.object({
 id:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), type:z.enum(["hero","text","catalog","categories","contact","image","faq","features","image_text","gallery","cta","stats","testimonials","logos","video","divider"]),
 title:text.default(""),text:text.default(""),imageUrl:image.optional(),imageAlt:z.string().max(200).default(""),
 buttonLabel:z.string().max(100).optional(),buttonUrl:safeLink.optional(),
 productIds:z.array(z.string().max(160)).max(100).default([]),items:z.array(z.object({title:z.string().max(200),text,value:z.string().max(80).optional(),imageUrl:image.optional(),imageAlt:z.string().max(200).optional(),url:safeLink.optional(),icon:z.enum(["check","truck","shield","heart","sparkles","leaf","clock","star","pin","gift"]).optional(),rating:z.number().int().min(1).max(5).optional()}).strict()).max(30).default([]),enabled:z.boolean().default(true),
 eyebrow:z.string().max(100).optional(),richText:siteRichTextSchema.optional(),slides:z.array(slide).max(10).optional(),
 images:z.array(z.object({id:z.string().max(100),url:image,alt:z.string().max(200),caption:z.string().max(300).optional(),href:safeLink.optional()}).strict()).max(24).optional(),
 videoUrl:z.string().max(2000).refine(value=>{if(!value)return true;try{const url=new URL(value);return url.protocol==="https:"&&["www.youtube.com","youtube.com","youtu.be","vimeo.com","www.vimeo.com"].includes(url.hostname)&&!url.username&&!url.password;}catch{return false;}},"Use um vídeo público do YouTube ou Vimeo.").optional(),
 style:z.object({background:color.optional(),foreground:color.optional(),alignment:z.enum(["left","center"]).optional(),spacing:z.enum(["compact","comfortable","spacious"]).optional(),imagePosition:z.enum(["left","right","background"]).optional(),imageFit:z.enum(["cover","contain"]).optional(),overlay:z.number().int().min(0).max(80).optional(),columns:z.number().int().min(1).max(4).optional()}).strict().optional(),
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
 header:z.object({navigation:z.array(link).max(20).default([]),announcement:z.object({enabled:z.boolean(),text:z.string().max(200),url:safeLink.optional()}).strict().optional(),showSearch:z.boolean().default(false),sticky:z.boolean().default(false),buttonLabel:z.string().max(80).optional(),buttonUrl:safeLink.optional()}).strict().optional(),
 footerColumns:z.array(z.object({id:z.string().max(100),title:z.string().max(100),links:z.array(link).max(12)}).strict()).max(4).optional(),
 footerNote:z.string().max(300).optional(),
}).strict().superRefine((value,ctx)=>{
 const ids=value.blocks.map(block=>block.id);if(new Set(ids).size!==ids.length)ctx.addIssue({code:"custom",message:"Cada seção precisa de um identificador diferente.",path:["blocks"]});
 if(new Set(value.pages.map(page=>page.slug)).size!==value.pages.length)ctx.addIssue({code:"custom",message:"Cada página precisa de um endereço diferente.",path:["pages"]});
 for(const page of value.pages)if(new Set(page.blocks.map(block=>block.id)).size!==page.blocks.length)ctx.addIssue({code:"custom",message:"As seções da página não podem repetir identificadores.",path:["pages"]});
});
export const siteThemeSchema=z.object({template:z.enum(SITE_TEMPLATE_IDS).default("catalog"),primary:color.default("#2563eb"),background:color.default("#ffffff"),foreground:color.default("#111827"),rounded:z.boolean().default(true),secondary:color.optional(),surface:color.optional(),headerBackground:color.optional(),footerBackground:color.optional(),footerForeground:color.optional(),bodyFont:z.enum(["modern","classic","rounded","editorial"]).optional(),headingFont:z.enum(["modern","classic","rounded","editorial"]).optional(),fontSize:z.enum(["normal","large"]).optional(),headerLayout:z.enum(["split","center","compact"]).optional(),logoWidth:z.number().int().min(80).max(260).optional(),buttonStyle:z.enum(["rounded","pill","square"]).optional(),contentWidth:z.enum(["standard","wide"]).optional(),sectionSpacing:z.enum(["compact","comfortable","spacious"]).optional(),catalog:z.object({columns:z.number().int().min(2).max(4),mobileColumns:z.union([z.literal(1),z.literal(2)]),imageRatio:z.enum(["square","portrait","landscape"]),cardStyle:z.enum(["minimal","bordered","elevated"]),showPrice:z.boolean(),showSku:z.boolean(),showAvailability:z.boolean(),showFilters:z.boolean(),showSearch:z.boolean(),sort:z.enum(["manual","name","price_asc","price_desc"]),pageSize:z.union([z.literal(8),z.literal(12),z.literal(24)])}).strict().optional()}).strict();
export type SiteContent=z.infer<typeof siteContentSchema>;
export type SiteTheme=z.infer<typeof siteThemeSchema>;
const sectionLayout=z.object({id:z.string().max(100),enabled:z.boolean(),style:siteBlockSchema.shape.style}).strict();
export const siteLayoutSchema=z.object({heroVariant:z.enum(["signature","compact"]).default("signature"),productGallery:z.enum(["split","stacked"]).default("split"),heroImageUrl:image.optional(),heroMobileImageUrl:image.optional(),featuredProductId:z.string().max(160).optional()}).strict();
export const siteTemplateConfigSchema=z.object({templateVersion:z.number().int().positive(),themeConfig:siteThemeSchema,sectionConfig:z.object({home:z.array(sectionLayout).max(40),pages:z.record(z.string().max(120),z.array(sectionLayout).max(30)).default({})}).strict(),layoutConfig:siteLayoutSchema}).strict();
export const siteSnapshotSchema=z.object({content:siteContentSchema,theme:siteThemeSchema,activeTemplateId:z.enum(SITE_TEMPLATE_IDS).optional(),templateConfigs:z.record(z.string().max(80),siteTemplateConfigSchema).optional(),layoutConfig:siteLayoutSchema.optional()}).strict().superRefine((value,ctx)=>{
 if(value.activeTemplateId&&value.activeTemplateId!==value.theme.template)ctx.addIssue({code:"custom",path:["activeTemplateId"],message:"O modelo selecionado não corresponde à aparência do rascunho."});
 if(Object.keys(value.templateConfigs??{}).length>50)ctx.addIssue({code:"custom",message:"Limite de modelos configurados excedido."});
 for(const [id,config] of Object.entries(value.templateConfigs??{})){
  const template=siteTemplate(id);
  if(!template||config.themeConfig.template!==id||config.templateVersion!==template.version)ctx.addIssue({code:"custom",path:["templateConfigs",id],message:"Modelo ou versão de configuração não suportado."});
  for(const entries of[config.sectionConfig.home,...Object.values(config.sectionConfig.pages)])if(new Set(entries.map(entry=>entry.id)).size!==entries.length)ctx.addIssue({code:"custom",path:["templateConfigs",id],message:"A ordem das seções não pode repetir identificadores."});
 }
});
export type SiteSnapshot=z.infer<typeof siteSnapshotSchema>;
export type Site={id:string;tenantId:string;workspaceId:string;slug:string;draft:SiteSnapshot;published?:SiteSnapshot;previousPublished?:SiteSnapshot;updatedByUserId?:string;publishedByUserId?:string;revision:number;publishedAt?:string;updatedAt:string};
export type SiteDomain={id:string;siteId:string;tenantId:string;hostname:string;challenge:string;verifiedAt?:string;expiresAt:string};

export function normalizeSiteHostname(input:string):string{
 const hostname=input.trim().toLowerCase().replace(/\.$/,"");
 if(hostname.length>253||!hostname.includes(".")||!hostname.split(".").every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||/^(?:\d+\.){3}\d+$/.test(hostname)||/\.(?:localhost|local|internal|invalid|test)$/.test(hostname))throw Error("SITE_VALIDATION: informe um domínio público válido, sem protocolo ou caminho.");
 return hostname;
}
export function siteImageUrls(snapshot:SiteSnapshot):string[]{const blocks=[...snapshot.content.blocks,...snapshot.content.pages.flatMap(page=>page.blocks)];return [...new Set([snapshot.content.logoUrl,snapshot.content.faviconUrl,snapshot.layoutConfig?.heroImageUrl,snapshot.layoutConfig?.heroMobileImageUrl,...Object.values(snapshot.templateConfigs??{}).flatMap(config=>[config.layoutConfig.heroImageUrl,config.layoutConfig.heroMobileImageUrl]),...blocks.flatMap(block=>[block.imageUrl,...(block.slides??[]).flatMap(slide=>[slide.imageUrl,slide.mobileImageUrl]),...(block.images??[]).map(image=>image.url),...block.items.map(item=>item.imageUrl)])].filter((url):url is string=>Boolean(url)))];}

export function captureSiteTemplateConfig(snapshot:SiteSnapshot):SiteSnapshot{
 const template=siteTemplate(snapshot.theme.template)!;
 if(template.legacy&&!snapshot.activeTemplateId&&!snapshot.templateConfigs)return snapshot;
 const sections=(blocks:SiteSnapshot["content"]["blocks"])=>blocks.map(({id,enabled,style})=>({id,enabled,...(style?{style}:{})}));
 const layoutConfig=snapshot.layoutConfig??{heroVariant:"signature" as const,productGallery:"split" as const};
 return {...snapshot,activeTemplateId:template.id,layoutConfig,templateConfigs:{...snapshot.templateConfigs,[template.id]:{templateVersion:template.version,themeConfig:snapshot.theme,sectionConfig:{home:sections(snapshot.content.blocks),pages:Object.fromEntries(snapshot.content.pages.map(page=>[page.slug,sections(page.blocks)]))},layoutConfig}}};
}
