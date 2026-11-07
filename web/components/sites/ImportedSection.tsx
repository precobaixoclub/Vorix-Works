import {createElement,type ReactNode} from "react";
import {siteHref} from "@/features/sites/customization";
import type {TemplateNode,TemplateSection} from "@/features/sites/imported-template";
import type {SiteBlock} from "@/features/sites/types";

type Item=SiteBlock["items"][number];
const VOID=new Set(["img","br","hr"]);
// O editor de texto do Vorix pode gravar o texto formatado (richText): no desenho importado ele vira texto corrido.
const plainText=(block:SiteBlock)=>block.richText?.length?block.richText.map(paragraph=>paragraph.children.map(child=>child.text).join("")).filter(Boolean).join("\n"):block.text;
const TEXT_FIELDS:Record<string,(block:SiteBlock)=>string|undefined>={title:block=>block.title,text:plainText,eyebrow:block=>block.eyebrow};
const ITEM_FIELDS:Record<string,(item:Item)=>string|undefined>={title:item=>item.title,text:item=>item.text,value:item=>item.value};

/**
 * Seção desenhada por um modelo importado. A árvore já chega validada e sem scripts; aqui ela vira
 * elementos React e os campos marcados recebem o conteúdo atual do bloco (o que a pessoa edita no
 * Vorix). Campo vazio some, como nas seções do Vorix.
 */
export function ImportedSection({block,section,basePath}:{block:SiteBlock;section:TemplateSection;basePath:string}){
 let key=0;
 const attributes=(node:Extract<TemplateNode,{t:"el"}>)=>{
  const props:Record<string,string|number|undefined>={key:key++};
  for(const [name,value] of Object.entries(node.attrs)){
   if(name==="class")props.className=value;
   else if(name==="href")props.href=siteHref(value,basePath);
   else props[name]=value;
  }
  return props;
 };
 function render(node:TemplateNode,item?:Item):ReactNode{
  if(node.t==="text")return node.v;
  const props=attributes(node);
  if(node.field){
   if(node.field==="image"){const src=item?item.imageUrl:block.imageUrl;if(!src)return null;return createElement("img",{...props,src,alt:(item?item.imageAlt:block.imageAlt)??"",loading:props.loading??"lazy",decoding:"async"});}
   if(node.field==="button"){const href=siteHref(block.buttonUrl,basePath);if(!block.buttonLabel||!href)return null;const external=/^https:/.test(href);return createElement("a",{...props,href,...(external?{target:"_blank",rel:"noopener noreferrer"}:{})},block.buttonLabel);}
   const value=item?ITEM_FIELDS[node.field]?.(item):TEXT_FIELDS[node.field]?.(block);
   return value?createElement(node.tag,{...props,style:node.field==="text"&&value.includes("\n")?{whiteSpace:"pre-line"}:undefined},value):null;
  }
  if(node.repeat){const template=node.children[0];return createElement(node.tag,props,template?block.items.map(entry=>render(template,entry)):null);}
  return VOID.has(node.tag)?createElement(node.tag,props):createElement(node.tag,props,...node.children.map(child=>render(child,item)));
 }
 const root=section.tree;
 if(root.t!=="el")return null;
 return createElement(root.tag,{...attributes(root),id:`secao-${block.id}`,"data-vorix-block":block.type,"aria-label":block.title||undefined},...root.children.map(child=>render(child)));
}
