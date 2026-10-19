import type {SiteBlock,SiteTheme,SiteSnapshot,SiteContent,SiteRichText} from "./types";
import {WEBSITE_TEMPLATES} from "./template-registry";
import {selectSiteTemplate} from "./template-state";

export const BLOCK_LABELS:Record<SiteBlock["type"],string>={hero:"Banner principal",text:"Texto formatado",catalog:"Catálogo de produtos",categories:"Categorias",contact:"Contato e formulário",image:"Imagem",faq:"Perguntas frequentes",features:"Diferenciais",image_text:"Imagem e texto",gallery:"Galeria de imagens",cta:"Chamada para ação",stats:"Números em destaque",testimonials:"Depoimentos",logos:"Marcas e parceiros",video:"Vídeo",divider:"Separador"};
export const FONT_OPTIONS=[{id:"modern",label:"Moderna",family:'Arial, Helvetica, sans-serif'},{id:"editorial",label:"Editorial",family:'"Vorix Editorial", Georgia, serif'},{id:"classic",label:"Clássica",family:'Georgia, "Times New Roman", serif'},{id:"rounded",label:"Arredondada",family:'"Trebuchet MS", Verdana, sans-serif'}] as const;
export const CATALOG_DEFAULTS:NonNullable<SiteTheme["catalog"]>={columns:4,mobileColumns:2,imageRatio:"square",cardStyle:"bordered",showPrice:true,showSku:false,showAvailability:true,showFilters:true,showSearch:true,sort:"manual",pageSize:12};
export const TEMPLATE_PRESETS=WEBSITE_TEMPLATES.map(template=>({id:template.id,name:template.name,description:template.description,eyebrow:template.description,theme:template.defaultTheme}));
export function newSiteBlock(type:SiteBlock["type"],id=crypto.randomUUID()):SiteBlock{
 const titles:Partial<Record<SiteBlock["type"],string>>={hero:"Bem-vindo à nossa seleção",catalog:"Nosso catálogo",contact:"Vamos conversar?",features:"Por que escolher a gente",image_text:"Uma história feita de cuidado",gallery:"Um pouco do nosso universo",cta:"Encontre o que combina com você",stats:"Nossa trajetória em números",testimonials:"Quem conhece, recomenda",faq:"Você pergunta, a gente responde",logos:"Marcas que fazem parte da nossa história"};
 const itemTypes=["features","stats","testimonials","faq"];
 return {id,type,title:titles[type]??BLOCK_LABELS[type],text:type==="hero"?"Explore nossos produtos e conheça de perto o que preparamos para você.":"",imageAlt:"",productIds:[],items:itemTypes.includes(type)?[{title:type==="faq"?"Como posso falar com a equipe?":"Escreva aqui seu destaque",text:type==="faq"?"Use nosso formulário de contato ou o WhatsApp. Será um prazer ajudar.":"Conte aos visitantes o que torna sua empresa especial.",...(type==="features"?{icon:"heart" as const}:{}),...(type==="stats"?{value:"Seu número"}:{}),...(type==="testimonials"?{rating:5}:{})}]:[],enabled:true,...(type==="hero"?{eyebrow:"Feito para você",buttonLabel:"Explorar catálogo",buttonUrl:"#catalogo"}:{}),...(type==="cta"?{buttonLabel:"Falar com a equipe",buttonUrl:"#contato"}:{}),...(type==="image_text"?{style:{imagePosition:"right" as const}}:{})};
}
export function initialSiteSnapshot(name:string,template:SiteTheme["template"]="catalog"):SiteSnapshot{
 const preset=TEMPLATE_PRESETS.find(item=>item.id===template)!;
 const hero=newSiteBlock("hero","hero");hero.eyebrow=preset.eyebrow;hero.title=template==="studio"?"Seu próximo passo começa com uma boa conversa.":template==="showcase"?"O extraordinário está nos detalhes.":"Boas escolhas começam por aqui.";
 return {theme:structuredClone(preset.theme),content:{name,description:"",footer:"Seu próximo encontro com algo especial começa aqui.",socials:[],seo:{title:name,description:""},header:{navigation:[{id:"home",label:"Início",url:"/",enabled:true,newTab:false},{id:"catalog",label:"Produtos",url:"#catalogo",enabled:true,newTab:false},{id:"contact",label:"Contato",url:"#contato",enabled:true,newTab:false}],showSearch:template==="catalog",sticky:false,announcement:{enabled:false,text:"Boas escolhas começam por aqui."}},footerColumns:[],footerNote:"",blocks:[hero,newSiteBlock("catalog","catalog"),newSiteBlock("contact","contact")],pages:[],contactForm:true}};
}
export const applySiteTemplate=selectSiteTemplate;
export function resolvedHeader(content:SiteContent):NonNullable<SiteContent["header"]>{return content.header??{navigation:[{id:"catalog",label:"Produtos",url:"#catalogo",enabled:true,newTab:false},...content.pages.filter(page=>page.published).map(page=>({id:page.slug,label:page.title,url:`/${page.slug}`,enabled:true,newTab:false})),{id:"contact",label:"Contato",url:"#contato",enabled:true,newTab:false}],showSearch:false,sticky:false};}
export function safeSiteHref(value:string|undefined):string|undefined{
 if(!value)return undefined;
 if(/^(?:\/(?!\/)[a-z0-9/_-]*(?:#[a-z0-9_-]+)?|#[a-z0-9_-]+)$/i.test(value))return value;
 try{const url=new URL(value);if(["https:","mailto:","tel:"].includes(url.protocol)&&!url.username&&!url.password)return value;}catch{}
 return undefined;
}
export function siteHref(value:string|undefined,basePath:string){const safe=safeSiteHref(value);if(!safe)return undefined;if(safe.startsWith("#"))return `${basePath||"/"}${safe}`;if(safe.startsWith("/"))return `${basePath}${safe==="/"?"/":safe}`;return safe;}
function luminance(hex:string){const channels=hex.replace("#","").match(/.{2}/g)?.map(value=>parseInt(value,16)/255)??[0,0,0];return channels.map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);}
export function contrastText(hex:string){return luminance(hex)>.179?"#111111":"#FFFFFF";}
export function mixColor(background:string,foreground:string,amount:number){const channel=(hex:string,i:number)=>parseInt(hex.slice(1+i*2,3+i*2),16);return "#"+[0,1,2].map(i=>Math.round(channel(background,i)*(1-amount)+channel(foreground,i)*amount).toString(16).padStart(2,"0")).join("");}
export function richTextPlainText(value:SiteRichText){return value.map(row=>row.children.map(child=>child.text).join("")).join("\n");}

export function siteContrastRatio(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
