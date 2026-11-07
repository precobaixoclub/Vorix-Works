"use client";
import {useEffect} from "react";
import type {PublicTenantSite} from "@/features/sites/types";
import type {SitePreviewSelection} from "./SiteEditorContext";
import {previewSelection} from "./site-preview-selection";

export function usePreviewClickEditing(mount:HTMLElement|null,enabled:boolean,site:PublicTenantSite,path:string[],mobile:boolean,onSelect?:((selection:SitePreviewSelection)=>void)){
 useEffect(()=>{
  if(!mount||!enabled||!onSelect)return;
  const doc=mount.ownerDocument,root=mount;root.dataset.siteClickEditing="true";
  const style=doc.createElement("style");style.textContent='[data-site-click-editing="true"]{cursor:pointer}[data-site-click-editing="true"] *{cursor:pointer!important}[data-site-click-editing="true"] iframe{pointer-events:none}[data-site-preview-hover]{outline:2px dashed #65a30d!important;outline-offset:-2px!important}';doc.head.append(style);
  const label=doc.createElement("div");label.setAttribute("aria-hidden","true");label.style.cssText="position:fixed;z-index:2147483647;pointer-events:none;background:#26382f;color:#fff;padding:7px 10px;border-radius:5px;font:500 13px/1.4 sans-serif;max-width:300px;display:none;box-shadow:0 2px 10px #0003";doc.body.append(label);
  let hovered:HTMLElement|undefined;
  const clear=()=>{hovered?.removeAttribute("data-site-preview-hover");hovered=undefined;label.style.display="none";};
  const hit=(event:Event)=>{const element=event.target as Element|null;return element?.nodeType===1?previewSelection(element,site,path,mobile):undefined;};
  const hover=(event:Event)=>{const target=hit(event);if(!target){clear();return;}event.stopPropagation();if(hovered!==target.element){clear();hovered=target.element;hovered.dataset.sitePreviewHover="true";}const rect=hovered.getBoundingClientRect(),frame=doc.defaultView?.frameElement,scale=Math.max(.1,frame?frame.getBoundingClientRect().width/frame.clientWidth:1);label.textContent=`Editar: ${target.selection.label}`;label.style.display="block";label.style.fontSize=`${12/scale}px`;label.style.padding=`${6/scale}px ${10/scale}px`;label.style.maxWidth=`${300/scale}px`;label.style.top=`${Math.max(4/scale,rect.top-35/scale)}px`;label.style.left=`${Math.max(4/scale,Math.min(rect.left,(doc.defaultView?.innerWidth??1440)-310/scale))}px`;};
  const click=(event:Event)=>{const target=hit(event);if(!target)return;event.preventDefault();event.stopImmediatePropagation();clear();onSelect(target.selection);};
  const down=(event:Event)=>{if(hit(event))event.stopImmediatePropagation();};
  const key=(event:KeyboardEvent)=>{if(event.key==="Enter"||event.key===" ")click(event);if(event.key==="Escape")clear();};
  const focusables=Array.from(root.querySelectorAll<HTMLElement>("[data-site-block],header,footer,.fk-editorial,.fk-featured,[data-site-page-title]")),previous=focusables.map(element=>[element,element.getAttribute("tabindex")] as const);
  focusables.forEach(element=>{if(!element.hasAttribute("tabindex"))element.tabIndex=0;});
  doc.addEventListener("mouseover",hover,true);doc.addEventListener("pointerover",hover,true);doc.addEventListener("click",click,true);doc.addEventListener("pointerdown",down,true);doc.addEventListener("submit",click,true);doc.addEventListener("keydown",key,true);doc.addEventListener("scroll",clear,true);doc.documentElement.addEventListener("mouseleave",clear);
  return()=>{clear();delete root.dataset.siteClickEditing;style.remove();label.remove();for(const[element,value]of previous){if(value===null)element.removeAttribute("tabindex");else element.setAttribute("tabindex",value);}doc.removeEventListener("mouseover",hover,true);doc.removeEventListener("pointerover",hover,true);doc.removeEventListener("click",click,true);doc.removeEventListener("pointerdown",down,true);doc.removeEventListener("submit",click,true);doc.removeEventListener("keydown",key,true);doc.removeEventListener("scroll",clear,true);doc.documentElement.removeEventListener("mouseleave",clear);};
 },[mount,enabled,site,path.join("/"),mobile,onSelect]);
}
