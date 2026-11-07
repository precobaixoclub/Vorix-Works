"use client";
import {createContext,useContext} from "react";
import type {SiteContent} from "@/features/sites/types";
export const SiteEditorContentContext=createContext<Pick<SiteContent,"blocks"|"pages">>({blocks:[],pages:[]});
export type SitePreviewFocus={selector:string;label:string;path:string[];blockId?:string;slideId?:string;itemIndex?:number;imageId?:string;linkId?:string;part?:string;device?:"desktop"|"mobile";field:string;token:number};
export const PreviewEditingContext=createContext<SitePreviewFocus|undefined>(undefined);
export type SitePreviewDestination=Omit<SitePreviewFocus,"token"|"field"|"path">&{path?:string[];field?:string};
export const SiteEditorFollowContext=createContext<(target:SitePreviewDestination)=>void>(()=>{});
export type SitePreviewSelection=SitePreviewDestination&{section:string;path:string[];fieldLabel?:string;columnId?:string;productId?:string;synthetic?:"fashion-editorial";token?:number};
export const SiteEditorSelectionContext=createContext<SitePreviewSelection|undefined>(undefined);
/** A preview-only carousel override; it never changes the draft or published content. */
export function useEditingSlide(blockId:string){const focus=useContext(PreviewEditingContext);return focus?.blockId===blockId?focus.slideId:undefined;}
