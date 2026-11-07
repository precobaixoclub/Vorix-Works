import {SITE_TEXT_GUIDANCE,SITE_IMAGE_GUIDANCE,type SiteTextGuidanceKey,type SiteImageGuidanceKey,type TextGuideline} from "@/features/sites/editor-guidance";

export function TextGuidance({id,value,guidance}:{id:string;value:string;guidance:SiteTextGuidanceKey}){
 const rule:TextGuideline=SITE_TEXT_GUIDANCE[guidance],overLimit=rule.max!==undefined&&value.length>rule.max;
 return <div id={id} className="mt-1.5 space-y-1 text-xs leading-relaxed text-muted-foreground">
  <p>Recomendado: {rule.recommended} caracteres.{rule.max!==undefined?` Limite: ${rule.max} caracteres.`:""}</p>
  {rule.hint?<p>{rule.hint}</p>:null}
  <p className={overLimit?"font-medium text-destructive":"tabular-nums"} aria-live="polite" aria-atomic="true">{value.length} caracteres{overLimit?` · Acima do limite de ${rule.max}. Reduza o texto antes de salvar.`:value.length>rule.recommendedMax?" · Acima do recomendado; confira a prévia.":""}</p>
 </div>;
}

export function ImageGuidance({id,guidance}:{id:string;guidance:SiteImageGuidanceKey}){
 const rule=SITE_IMAGE_GUIDANCE[guidance];
 return <div id={id} className="space-y-1 text-xs leading-relaxed text-muted-foreground"><p>Tamanho recomendado: {rule.size} · proporção {rule.ratio}.</p><p>{rule.hint}</p><p>JPG, PNG ou WEBP · até 5 MB por imagem. As dimensões são uma recomendação.</p></div>;
}
