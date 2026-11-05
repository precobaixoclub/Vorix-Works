"use client";
import {useRef,useState} from "react";
import {ArrowRight,Search,ShoppingBag,X} from "lucide-react";
import {useStorefront} from "./storefront/SiteCommerce";

export function SiteHeaderSearch({query,onQuery,onSearch,onOpen}:{query:string;onQuery:(value:string)=>void;onSearch:(document:Document)=>void;onOpen?:()=>void}){
 const [open,setOpen]=useState(false),input=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const close=()=>{setOpen(false);trigger.current?.focus();};
 const search=(document:Document)=>{onSearch(document);setOpen(false);};
 return <div className="ts-search-control">
  <button type="button" ref={trigger} className="ts-icon-button" aria-label="Buscar no site" aria-expanded={open} onClick={()=>{if(open)close();else {onOpen?.();setOpen(true);requestAnimationFrame(()=>input.current?.focus());}}}><Search size={19}/></button>
  {open?<form className="ts-search-popover" role="search" aria-label="Busca do site" onSubmit={event=>{event.preventDefault();search(event.currentTarget.ownerDocument);}} onKeyDown={event=>{if(event.key==="Escape")close();}}>
   <input ref={input} aria-label="Buscar no site" placeholder="O que você procura?" value={query} onChange={event=>onQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();search(event.currentTarget.ownerDocument);}}}/>
   <button type="button" className="ts-icon-button" aria-label="Pesquisar produtos" onClick={event=>search(event.currentTarget.ownerDocument)}><ArrowRight size={18}/></button>
   <button type="button" className="ts-icon-button" aria-label="Fechar busca" onClick={close}><X size={18}/></button>
  </form>:null}
 </div>;
}

export function SiteHeaderCart({className="ts-icon-button"}:{className?:string}={}){
 const store=useStorefront();if(!store?.site.commerce?.cartEnabled||store.preview)return null;
 const count=store.cart?.itemCount??0;
 return <button type="button" className={`ts-header-cart ${className}`} aria-label="Carrinho de compras" aria-description={`${count} ${count===1?"item":"itens"}`} aria-haspopup="dialog" onClick={store.openCart}><ShoppingBag size={19}/>{count?<span aria-hidden="true">{count}</span>:null}</button>;
}

export const HEADER_ACTION_STYLES=String.raw`
.ts-header-actions{display:flex;align-items:center;gap:12px;min-width:0;margin-left:auto}.ts-search-control{display:flex;align-items:center}.ts-header-cart{position:relative;flex-shrink:0}.ts-header-cart>span{position:absolute;top:-3px;right:-3px;min-width:17px;border-radius:20px;font-size:10px;background:var(--site-primary);color:var(--site-on-primary);padding:0 4px;line-height:17px}
.ts-search-popover{position:absolute;left:50%;transform:translateX(-50%);top:100%;width:min(680px,calc(100% - 36px));z-index:40;display:flex;align-items:center;gap:8px;padding:14px 18px;background:var(--site-header);color:var(--site-header-fg);border:1px solid var(--site-line);box-shadow:0 12px 30px #00000010}
.ts-search-popover input{min-width:0;flex:1;background:transparent;color:inherit;border:0;padding:10px 2px;font:inherit;font-size:14px}.ts-search-popover .ts-icon-button{flex-shrink:0;border:0}.ts-search-control>.ts-icon-button{border:0;background:transparent}
@media(max-width:767px){.ts-header-actions{gap:4px}.ts-search-popover{padding:10px}.ts-header-actions .ts-icon-button{width:36px;height:42px}.ts-header-actions>.premium-header-cta{display:none}}
`;
