"use client";
import {useEffect,type RefObject} from "react";
import type {SitePreviewSelection} from "./SiteEditorContext";

export function usePreviewFieldSelection(selection:SitePreviewSelection|undefined,section:string,grid:RefObject<HTMLDivElement|null>){
 useEffect(()=>{
  const root=grid.current;if(!root||!selection||selection.section!==section)return;
  let done=false,frame=0;
  const open=(element:HTMLElement)=>{let parent:HTMLElement|null=element;while(parent&&parent!==root){if(parent.tagName==="DETAILS")(parent as HTMLDetailsElement).open=true;parent=parent.parentElement;}};
  const find=(scope:HTMLElement,attribute:string,value:string)=>scope.getAttribute(attribute)===value?scope:Array.from(scope.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(element=>element.getAttribute(attribute)===value);
  const focus=()=>{
   if(done)return;
   let scope=root.querySelector<HTMLElement>("fieldset");if(!scope)return;
   const named=selection.fieldLabel?find(scope,"data-site-field-label",selection.fieldLabel):undefined,blockId=named&&!named.closest("[data-site-block-form]")?undefined:selection.blockId;
   for(const [attribute,value] of [["data-site-block-form",blockId],["data-site-preview-footer-column",selection.columnId],["data-site-preview-link",selection.linkId],["data-site-preview-slide",selection.slideId],["data-site-preview-item",selection.itemIndex!==undefined?String(selection.itemIndex):undefined],["data-site-preview-image",selection.imageId],["data-site-product-row",selection.productId]] as const){
    if(value===undefined)continue;const next=find(scope,attribute,value);if(!next)return;scope=next;open(scope);
   }
   let field=selection.fieldLabel?find(scope,"data-site-field-label",selection.fieldLabel):selection.part?find(scope,"data-site-preview-part",selection.part):undefined;
   if(selection.fieldLabel&&!field)return;
   field??=scope.querySelector<HTMLElement>("[data-site-field-label]")??scope;
   open(field);
   const candidates=Array.from(field.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="file"]),textarea,[contenteditable="true"],select,button,[tabindex]'));
   const available=candidates.filter(element=>element.getClientRects().length&&!element.hasAttribute("disabled"));
   const control=available.find(element=>element.matches("input,textarea,select,[contenteditable]"))??available[0]??(field===scope&&selection.productId?scope:undefined);
   if(!control)return;
   done=true;observer.disconnect();root.querySelectorAll("[data-site-editor-selected]").forEach(element=>element.removeAttribute("data-site-editor-selected"));
   field.dataset.siteEditorSelected="true";if(!control.hasAttribute("tabindex")&&control===scope)control.tabIndex=-1;
   field.scrollIntoView({block:"center",behavior:"instant"});control.focus({preventScroll:true});
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(focus);};
  const observer=new MutationObserver(schedule);observer.observe(root,{childList:true,subtree:true});schedule();
  return()=>{observer.disconnect();cancelAnimationFrame(frame);};
 },[selection?.token,section,grid]);
}
