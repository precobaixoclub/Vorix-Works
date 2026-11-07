import {Fragment} from "react";
import {siteText} from "@/features/sites/site-texts";
import type {SiteContent} from "@/features/sites/types";

/** Texto editável do modelo (aba "Textos do site"); quebras de linha viram <br/>. O atributo liga o clique na prévia ao campo. */
export function SiteText({content,id}:{content:Pick<SiteContent,"texts">;id:string}){
 return <span data-site-text={id}>{siteText(content,id).split("\n").map((line,index)=><Fragment key={index}>{index?<br/>:null}{line}</Fragment>)}</span>;
}
