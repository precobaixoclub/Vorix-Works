"use client";
import {useState} from "react";
import type {ProductOption} from "@/features/product-engine/types";
import type {PublicSiteProduct} from "@/features/sites/types";
import {productOptionPhoto} from "@/features/sites/product-media";
import {thumbUrl} from "@/lib/media";

export function ColorOptionPhoto({product,option,value,selected={}}:{product:PublicSiteProduct;option:ProductOption;value:string;selected?:Record<string,string>}){
 const url=productOptionPhoto(product,option,value,selected);
 return <OptionPhoto key={url??"no-photo"} url={url} name={product.name} value={value}/>;
}

export function CardColorPhotos({product,option,selected,onSelect}:{product:PublicSiteProduct;option:ProductOption;selected:Record<string,string>;onSelect:(value:string)=>void}){
 const [expanded,setExpanded]=useState(false),limit=4,values=expanded?option.values:option.values.slice(0,limit);
 return <div className="sp-color-options"><div className="sp-color-photo-list" role="group" aria-label={option.name} data-expanded={expanded}>
  {values.map(value=><button type="button" key={value} className="sp-color-photo-button" aria-label={`Prévia: ${option.name} ${value}`} title={value} aria-pressed={selected[option.key]===value}
   onPointerMove={event=>{if(event.pointerType==="mouse"&&selected[option.key]!==value)onSelect(value);}} onFocus={()=>onSelect(value)} onClick={event=>{event.preventDefault();event.stopPropagation();onSelect(value);}}>
   <ColorOptionPhoto product={product} option={option} value={value} selected={selected}/>
  </button>)}
  {option.values.length>limit?<button type="button" className="sp-more sp-color-more" aria-expanded={expanded} aria-label={expanded?"Mostrar menos cores":`Mostrar mais ${option.values.length-limit} cores`} onClick={event=>{event.preventDefault();event.stopPropagation();setExpanded(!expanded);}}>{expanded?"−":`+${option.values.length-limit}`}</button>:null}
 </div></div>;
}

function OptionPhoto({url,name,value}:{url?:string;name:string;value:string}){
 const [failed,setFailed]=useState(false);
 return url&&!failed?<img className="sp-color-photo" src={thumbUrl(url,160)} alt={`${name} — ${value}`} width={64} height={80} loading="lazy" decoding="async" draggable={false} onError={()=>setFailed(true)}/>:<span className="sp-color-photo-missing">{value}<small>Sem foto</small></span>;
}

/** Uses the existing availability/selection callbacks; no variant or price decisions live here. */
export function ProductColorChoices({product,option,selected,ready,available,onChoose}:{product:PublicSiteProduct;option:ProductOption;selected:Record<string,string>;ready:boolean;available:(value:string)=>boolean;onChoose:(value:string)=>void}){
 return <div className="sp-color-choices" role="radiogroup" aria-label={option.name}>
  <span>{option.name}{selected[option.key]?`: ${selected[option.key]}`:""}</span>
  <div className="sp-color-choice-list">{option.values.map(value=>{
   const enabled=available(value),on=selected[option.key]===value;
   return <button key={value} type="button" className="sp-color-choice" role="radio" aria-checked={on} aria-label={enabled?value:`${value} (indisponível)`} title={value} disabled={!ready||!enabled} onClick={()=>onChoose(on?"":value)}>
    <span className="sp-color-choice-photo"><ColorOptionPhoto product={product} option={option} value={value} selected={selected}/></span>
    <span className="sp-color-choice-label">{value}</span>
   </button>;
  })}</div>
 </div>;
}

export const COLOR_CHOICE_STYLES=String.raw`
.sp-color-photo-list{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;align-items:start;width:100%;max-width:216px;pointer-events:auto}
.sp-color-photo-button{display:grid;place-items:center;min-width:0;width:100%;height:52px;padding:2px;border:1px solid var(--site-line);border-radius:0;background:var(--site-surface);color:inherit;cursor:pointer}
.sp-color-photo-button[aria-pressed=true]{border-color:var(--site-fg);box-shadow:inset 0 0 0 1px var(--site-fg)}
.tenant-site .sp-color-photo{display:block;width:100%;height:100%;object-fit:contain;object-position:center;transform:none}
.sp-color-photo-list>.sp-color-more{min-width:0;width:100%;min-height:44px;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:10px;cursor:pointer}
.sp-color-photo-list[data-expanded=true]{max-width:none;grid-template-columns:repeat(auto-fill,minmax(28px,40px))}
.sp-color-choices{min-width:0}.sp-color-choice-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));gap:10px;margin-top:10px}
.sp-color-choice{display:flex;flex-direction:column;gap:7px;align-items:center;min-width:0;padding:5px;border:1px solid var(--site-line);border-radius:0;background:var(--site-bg);color:inherit;cursor:pointer}
.sp-color-choice[aria-checked=true]{border-color:var(--site-fg);box-shadow:inset 0 0 0 1px var(--site-fg)}
.sp-color-choice:disabled{opacity:.4;cursor:not-allowed}.sp-color-choice-photo{display:block;width:100%;height:74px;background:var(--site-surface)}
.sp-color-choice-label{font-size:10px;line-height:1.4;overflow-wrap:anywhere;text-align:center}.sp-color-photo-missing{display:grid;align-content:center;justify-items:center;gap:3px;min-width:0;height:100%;font-size:9px;line-height:1.3;padding:2px;overflow-wrap:anywhere;text-align:center}.sp-color-photo-missing small{font-size:8px;opacity:.65}
@media(max-width:700px){.sp-color-photo-button{height:46px}.sp-color-choice-list{grid-template-columns:repeat(auto-fill,minmax(65px,1fr));gap:8px}.sp-color-choice-photo{height:72px}}
`;
