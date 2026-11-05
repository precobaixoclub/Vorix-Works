"use client";
import {createContext,useContext,useState,type ReactNode} from "react";
import type {PublicSiteProduct} from "@/features/sites/types";
import {isColorOption} from "@/features/sites/product-media";
import {ProductCommercialInfo} from "./storefront/CommercialPricingInfo";
import {ProductGallery} from "./ProductGallery";

const CardContext=createContext<{product:PublicSiteProduct;href:string;selected:Record<string,string>}> (null!);
export function ProductCard({product,href,className,children}:{product:PublicSiteProduct;href:string;className:string;children:ReactNode}){
 const [selected,setSelected]=useState<Record<string,string>>({});
 const colors=product.options.filter(option=>option.values.length&&isColorOption(option));
 const others=product.options.filter(option=>option.values.length&&!isColorOption(option));
 return <CardContext.Provider value={{product,href,selected}}><article className={`${className} sp-card`} data-product-card={product.id}>{children}
  {colors.length||others.length?<div className="sp-variants" aria-label={`Opções de ${product.name}`}>
   {colors.map(option=><div className="sp-color-options" key={option.key}><div className="sp-swatches" role="group" aria-label={option.name}>{option.values.slice(0,5).map(value=><button type="button" key={value} className="sp-swatch" aria-label={`Prévia: ${option.name} ${value}`} title={value} aria-pressed={selected[option.key]===value}
    onPointerEnter={event=>{if(event.pointerType==="mouse")setSelected({[option.key]:value});}} onFocus={()=>setSelected({[option.key]:value})} onClick={event=>{event.preventDefault();event.stopPropagation();setSelected({[option.key]:value});}}>
    <span style={{background:option.swatches?.[value]??"var(--site-line)"}}>{option.swatches?.[value]?null:value.slice(0,2)}</span></button>)}{option.values.length>5?<span className="sp-more" aria-label={`${option.values.length-5} outras opções`}>+{option.values.length-5}</span>:null}</div><small>{option.values.length} {option.values.length===1?"cor disponível":"cores disponíveis"}</small></div>)}
   {others.map(option=><small key={option.key}>{option.name}: {option.values.slice(0,4).join(" · ")}{option.values.length>4?` +${option.values.length-4}`:""}</small>)}
  </div>:null}
 <ProductCommercialInfo product={product}/></article></CardContext.Provider>;
}
export function ProductCardTitle(){const {product,href}=useContext(CardContext);return <a className="sp-card-title" href={href}><h3>{product.name}</h3></a>;}
export function ProductCardMedia({children}:{children?:ReactNode}){const {product,href,selected}=useContext(CardContext);return <ProductGallery product={product} selected={selected} href={href} card>{children}</ProductGallery>;}
