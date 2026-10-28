"use client";
import type {PublicCart} from "./types";
/**
 * Vorix Commerce, Fase 1 — estado do visitante na vitrine pública. Nada aqui decide regra comercial
 * (isso vem do backend em `product.commerce`); só guarda identificadores anônimos, UTMs e o token do
 * carrinho, e fala com a API pela rota proxy do próprio site.
 * Armazenamento sempre em try/catch: aba anônima ou bloqueio de cookies nunca quebra a página.
 */
const UTM_KEYS=["source","medium","campaign","content","term"] as const;
export type StorefrontUtm=Partial<Record<(typeof UTM_KEYS)[number],string>>;
const read=(storage:"local"|"session",key:string)=>{try{return (storage==="local"?window.localStorage:window.sessionStorage).getItem(key)??undefined;}catch{return undefined;}};
const write=(storage:"local"|"session",key:string,value:string|undefined)=>{try{const target=storage==="local"?window.localStorage:window.sessionStorage;if(value===undefined)target.removeItem(key);else target.setItem(key,value);}catch{}};
const randomId=()=>{const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");};

/** Identificador anônimo do visitante neste site (sem dado pessoal). */
export function visitorSessionId(slug:string):string{const key=`vx_sid:${slug}`;let id=read("local",key);if(!id||!/^[A-Za-z0-9_-]{8,64}$/.test(id)){id=randomId();write("local",key,id);}return id;}
/** Guarda as UTMs da entrada e mantém durante a navegação da sessão (a última campanha com UTM vence). */
export function captureUtm(slug:string):StorefrontUtm{
 const key=`vx_utm:${slug}`;const params=new URLSearchParams(window.location.search);
 const fresh=Object.fromEntries(UTM_KEYS.map(name=>[name,params.get(`utm_${name}`)?.trim().slice(0,name==="source"||name==="medium"?120:200)]).filter(([,value])=>value)) as StorefrontUtm;
 if(Object.keys(fresh).length){write("session",key,JSON.stringify(fresh));return fresh;}
 try{return JSON.parse(read("session",key)??"{}") as StorefrontUtm;}catch{return {};}
}
export const cartToken=(slug:string)=>read("local",`vx_cart:${slug}`);
export const storeCartToken=(slug:string,token:string|undefined)=>write("local",`vx_cart:${slug}`,token);
export function visitorContext(slug:string){return {sessionId:visitorSessionId(slug),pageUrl:window.location.href,utm:captureUtm(slug)};}

async function call<T>(slug:string,action:string,body:Record<string,unknown>):Promise<T>{
 const response=await fetch(`/api/tenant-site/commerce/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug,...body}),cache:"no-store"});
 if(response.status===204)return undefined as T;
 const data=await response.json().catch(()=>({}));
 // `status` deixa a tela distinguir recusa da loja (4xx) de falha de rede/servidor.
 if(!response.ok)throw Object.assign(Error(data?.error?.message||"Não foi possível concluir agora. Tente novamente."),{status:response.status});
 return data.data as T;
}
export type WhatsappIntent={reference:string;redirectPath:string;whatsappUrl:string};
/** Abre a aba antes do await (senão o navegador bloqueia como pop-up) e redireciona quando a intenção existe. */
export async function openWhatsapp(start:()=>Promise<WhatsappIntent>,basePath:string){
 const popup=window.open("","_blank");
 try{
  const intent=await start();const target=new URL(`${basePath}/i/${encodeURIComponent(intent.reference)}`,window.location.href).href;
  if(popup&&!popup.closed){popup.opener=null;popup.location.href=target;}else window.location.assign(target);
  return intent;
 }catch(error){popup?.close();throw error;}
}
export const startProductWhatsapp=(slug:string,input:{productId:string;variantId?:string;quantity?:number})=>call<WhatsappIntent>(slug,"whatsapp-intents",{...input,requestKey:crypto.randomUUID(),...visitorContext(slug)});
export const fetchCart=(slug:string)=>call<PublicCart>(slug,"cart",{token:cartToken(slug)});
export async function setCartItem(slug:string,input:{productId:string;variantId?:string;quantity:number}){
 const cart=await call<PublicCart>(slug,"cart-items",{...input,token:cartToken(slug),...visitorContext(slug)});
 if(cart.token)storeCartToken(slug,cart.token);
 return cart;
}
export async function checkoutCart(slug:string,requestKey:string){
 const token=cartToken(slug);if(!token)throw Error("Seu carrinho está vazio.");
 return call<WhatsappIntent>(slug,"checkout",{token,requestKey,...visitorContext(slug)});
}
export function trackSiteEvent(slug:string,type:"SITE_VIEW"|"PRODUCT_VIEW",productId?:string){
 const device=window.matchMedia("(max-width: 600px)").matches?"mobile":window.matchMedia("(max-width: 1024px)").matches?"tablet":"desktop";
 let referrer:string|undefined;try{const url=new URL(document.referrer);if(url.hostname!==window.location.hostname)referrer=url.origin;}catch{}
 call(slug,"events",{type,productId,...visitorContext(slug),eventKey:crypto.randomUUID(),referrer,device}).catch(()=>undefined);
}

// ------------------------------------------------------------------ Fase 2: checkout e pedido
export const quoteCheckout=(slug:string,postalCode?:string)=>{const token=cartToken(slug);if(!token)throw Error("Seu carrinho está vazio.");return call<import("./types").CheckoutQuote>(slug,"checkout-quote",{token,...(postalCode?{postalCode}:{}),...visitorContext(slug)});};
export function placeOrder(slug:string,input:{requestKey:string;customer:Record<string,string|undefined>;address?:Record<string,string|undefined>;deliveryOptionId:string;payment:{method:"PIX"|"CARD"|"SANDBOX";cardToken?:string;cardPaymentMethodId?:string;installments?:number}}){
 const token=cartToken(slug);if(!token)throw Error("Seu carrinho está vazio.");
 return call<import("./types").PublicOrder>(slug,"checkout-orders",{token,...input,...visitorContext(slug)});
}
export async function fetchPublicOrder(token:string){
 const response=await fetch(`/api/tenant-site/orders/${encodeURIComponent(token)}`,{cache:"no-store"});const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data?.error?.message||"Não foi possível consultar o pedido.");return data.data as import("./types").PublicOrder;
}
export async function fetchCatalogPage(slug:string,query:{offset:number;limit:number;search?:string;category?:string;brand?:string;sort?:string}){
 const params=new URLSearchParams({slug,offset:String(query.offset),limit:String(query.limit)});for(const key of ["search","category","brand","sort"] as const){const value=query[key];if(value)params.set(key,value);}
 const response=await fetch(`/api/tenant-site/catalog?${params}`);const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data?.error?.message||"Não foi possível carregar mais produtos.");return data.data as {products:import("./types").PublicSiteProduct[];total:number};
}
