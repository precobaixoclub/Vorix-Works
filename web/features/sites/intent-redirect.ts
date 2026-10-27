import {NextResponse} from "next/server";
import {getApiBaseUrl} from "@/lib/api-error";
/**
 * `/i/:reference` — valida a intenção no backend, registra o clique e manda para o WhatsApp.
 * O visitante nunca vê ids internos; referência inválida ou vencida mostra uma página simples.
 */
export async function salesIntentRedirect(reference:string,backHref:string){
 if(!/^[A-Za-z0-9-]{4,20}$/.test(reference))return page("Link inválido","Este link de atendimento não existe.",backHref,404);
 try{
  const response=await fetch(`${getApiBaseUrl()}/v1/public/sales-intents/${encodeURIComponent(reference)}`,{cache:"no-store",signal:AbortSignal.timeout(10000)});
  const data=(await response.json().catch(()=>undefined))?.data as {status:string;url?:string}|undefined;
  if(data?.status==="redirect"&&data.url&&/^https:\/\/wa\.me\/\d{8,15}\?text=/.test(data.url))return NextResponse.redirect(data.url,{status:302,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  if(data?.status==="expired")return page("Este link expirou","Volte ao site e clique novamente para falar com a gente.",backHref,410);
 }catch{return page("Não foi possível abrir o WhatsApp","Tente novamente em alguns instantes.",backHref,503);}
 return page("Link inválido","Este link de atendimento não existe.",backHref,404);
}
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char]!);
function page(title:string,text:string,backHref:string,status:number){
 const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;padding:16px}main{max-width:420px;text-align:center}a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:999px;background:#0f172a;color:#fff;text-decoration:none}a:focus-visible{outline:3px solid #2563eb;outline-offset:3px}@media(prefers-color-scheme:dark){body{background:#0b1120;color:#e2e8f0}a{background:#e2e8f0;color:#0b1120}}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(text)}</p><a href="${escape(backHref)}">Voltar ao site</a></main></body></html>`;
 return new NextResponse(html,{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
