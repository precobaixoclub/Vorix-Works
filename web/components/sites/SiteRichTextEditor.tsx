"use client";
import {useEffect,useId,useRef,useState} from "react";
import {Bold,Italic,List,Heading3,Link as LinkIcon} from "lucide-react";
import {Button} from "@/components/Button";
import {Input,Label} from "@/components/Field";
import {safeSiteHref,richTextPlainText} from "@/features/sites/customization";
import type {SiteRichText} from "@/features/sites/types";

function readDocument(root:HTMLElement):SiteRichText{
 const rows:SiteRichText=[];
 function inline(node:Node,marks:{bold?:boolean;italic?:boolean;url?:string}={}):SiteRichText[number]["children"]{
  if(node.nodeType===Node.TEXT_NODE)return node.textContent?[{text:node.textContent,...marks}]:[];
  if(!(node instanceof HTMLElement))return [];
  if(["SCRIPT","STYLE","IFRAME","IMG","SVG"].includes(node.tagName))return [];
  const next={...marks,...(["B","STRONG"].includes(node.tagName)?{bold:true}:{}),...(["I","EM"].includes(node.tagName)?{italic:true}:{}),...(node.tagName==="A"&&safeSiteHref(node.getAttribute("href")??"")?{url:node.getAttribute("href")!}:{})};
  return Array.from(node.childNodes).flatMap(child=>inline(child,next));
 }
 function add(node:Node){if(node instanceof HTMLElement&&["UL","OL"].includes(node.tagName)){Array.from(node.children).forEach(add);return;}const children=inline(node);if(children.length)rows.push({type:node instanceof HTMLElement&&node.tagName==="LI"?"bullet":node instanceof HTMLElement&&/^H[1-6]$/.test(node.tagName)?"heading":"paragraph",children});}
 Array.from(root.childNodes).forEach(add);return rows;
}
function writeDocument(root:HTMLElement,value:SiteRichText){
 root.replaceChildren();for(const row of value){const block=document.createElement(row.type==="heading"?"h3":row.type==="bullet"?"li":"p");for(const node of row.children){let child:Node=document.createTextNode(node.text);if(node.bold){const wrap=document.createElement("strong");wrap.append(child);child=wrap;}if(node.italic){const wrap=document.createElement("em");wrap.append(child);child=wrap;}if(safeSiteHref(node.url)){const wrap=document.createElement("a");wrap.href=node.url!;wrap.append(child);child=wrap;}block.append(child);}root.append(block);}
}
export function SiteRichTextEditor({label,value,text,onChange,disabled=false}:{label:string;value?:SiteRichText;text:string;onChange:(value:SiteRichText,text:string)=>void;disabled?:boolean}){
 const id=useId(),root=useRef<HTMLDivElement>(null),range=useRef<Range|undefined>(undefined),[linkOpen,setLinkOpen]=useState(false),[url,setUrl]=useState("");
 useEffect(()=>{if(root.current&&!root.current.contains(document.activeElement))writeDocument(root.current,value?.length?value:text.split("\n").map(line=>({type:"paragraph",children:[{text:line}]})));},[JSON.stringify(value),text]);
 const changed=()=>{if(root.current&&!disabled){const parsed=readDocument(root.current);onChange(parsed,richTextPlainText(parsed));}};
 const command=(name:string,value?:string)=>{if(disabled)return;root.current?.focus();if(range.current){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range.current);}document.execCommand(name,false,value);range.current=undefined;changed();};
 return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><div className="overflow-hidden rounded-lg border border-border"><div className="flex flex-wrap gap-1 border-b border-border bg-muted/40 p-1.5" role="toolbar" aria-label={`Formatar ${label.toLowerCase()}`}>{([{name:"bold",label:"Negrito",Icon:Bold},{name:"italic",label:"Itálico",Icon:Italic},{name:"insertUnorderedList",label:"Lista",Icon:List},{name:"formatBlock",value:"h3",label:"Subtítulo",Icon:Heading3}] as const).map(item=><Button key={item.name} size="sm" variant="ghost" aria-label={item.label} onMouseDown={event=>event.preventDefault()} onClick={()=>command(item.name,"value" in item?item.value:undefined)}><item.Icon size={15}/></Button>)}<Button size="sm" variant="ghost" aria-label="Inserir link" onMouseDown={event=>{event.preventDefault();const selection=window.getSelection();range.current=selection?.rangeCount?selection.getRangeAt(0).cloneRange():undefined;}} onClick={()=>setLinkOpen(!linkOpen)}><LinkIcon size={15}/></Button></div><div id={id} ref={root} contentEditable={!disabled} aria-readonly={disabled} role="textbox" aria-label={label} aria-multiline="true" suppressContentEditableWarning className="min-h-36 max-h-96 overflow-y-auto bg-background p-3 text-sm leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_h3]:text-base [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-2" onInput={changed} onBlur={changed} onPaste={event=>{event.preventDefault();document.execCommand("insertText",false,event.clipboardData.getData("text/plain"));changed();}}/></div>{linkOpen?<div className="flex gap-2"><Input aria-label="Endereço do link" value={url} placeholder="https://... ou /sobre" onChange={event=>setUrl(event.target.value)}/><Button size="sm" disabled={!safeSiteHref(url)} onClick={()=>{command("createLink",url);setLinkOpen(false);setUrl("");}}>Aplicar link</Button></div>:null}</div>;
}
