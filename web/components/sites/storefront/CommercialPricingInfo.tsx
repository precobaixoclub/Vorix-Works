"use client";
import {useState} from "react";
import type {PublicCart,PublicSiteProduct} from "@/features/sites/types";
import {formatCurrencyCents} from "@/lib/format";
import {applyCartCoupon} from "@/features/sites/storefront";

export function ProductCommercialInfo({product}:{product:PublicSiteProduct}){
 const offer=product.quantityOffers?.[0];if(!offer)return null;
 const tiers=offer.tiers.filter(tier=>tier.minimum>1||tier.unitPriceCents!==product.priceCents);
 if(!tiers.length)return null;
 return <div className="sc-quantity-offer" aria-label="Preços por quantidade"><div>{tiers.slice(0,4).map(tier=><small key={tier.minimum}><strong>{tier.minimum} ou mais:</strong> {formatCurrencyCents(tier.unitPriceCents,offer.currency)} cada</small>)}</div><small>{offer.count==="SAME_PRODUCT"?"Some tamanhos e cores deste produto.":"Some os produtos elegíveis no carrinho."}</small></div>;
}
export function CartCommercialInfo({cart}:{cart:PublicCart}){
 return <div className="sc-commercial-info" aria-live="polite">
  {!!cart.discountCents?<><div><span>Subtotal original</span><span>{formatCurrencyCents(cart.originalSubtotalCents??cart.subtotalCents,cart.currency)}</span></div><div><span>Descontos aplicados</span><span>− {formatCurrencyCents(cart.discountCents,cart.currency)}</span></div></>:null}
  {(cart.appliedRules??[]).filter((entry,index,all)=>all.findIndex(other=>other.id===entry.id&&other.tier?.minimum===entry.tier?.minimum)===index).map(entry=><small key={`${entry.id}-${entry.tier?.minimum??0}`}>{entry.tier?`Preço especial aplicado: ${formatCurrencyCents(entry.tier.unitPriceCents,cart.currency)} por unidade.`:entry.name}</small>)}
  {cart.progress?.map((progress,index)=><p key={`${progress.ruleId}-${index}`}>Adicione mais {progress.missing} {progress.missing===1?"item elegível":"itens elegíveis"}{progress.productId?" deste produto":""} e pague {formatCurrencyCents(progress.unitPriceCents,progress.currency)} por unidade.</p>)}
  {cart.couponCode&&cart.couponStatus!=="APPLIED"?<small>O cupom {cart.couponCode} não está sendo aplicado à condição atual.</small>:null}
 </div>;
}
export function CartCoupon({slug,cart,onRefresh}:{slug:string;cart:PublicCart;onRefresh:()=>Promise<void>}){
 const [code,setCode]=useState(cart.couponCode??""),[busy,setBusy]=useState(false),[error,setError]=useState<string>();
 async function apply(value:string){setBusy(true);setError(undefined);try{await applyCartCoupon(slug,value||undefined);await onRefresh();setCode(value);}catch(error){setError(error instanceof Error?error.message:"Não foi possível aplicar o cupom.");}finally{setBusy(false);}}
 return <div className="sc-coupon"><label htmlFor="cart-coupon">Cupom de desconto</label><div><input id="cart-coupon" maxLength={40} value={code} onChange={event=>setCode(event.target.value.toUpperCase())}/><button type="button" disabled={busy||!code.trim()} onClick={()=>void apply(code.trim())}>{busy?"Aplicando...":"Aplicar"}</button>{cart.couponCode?<button type="button" disabled={busy} onClick={()=>void apply("")}>Remover</button>:null}</div>{error?<small role="alert">{error}</small>:null}</div>;
}

export const COMMERCIAL_PRICING_STYLES=`
.sc-quantity-offer{position:relative;z-index:3;pointer-events:none;display:grid;gap:5px;padding-block:10px;font:inherit}.sc-quantity-offer>div{display:grid;gap:4px}.sc-quantity-offer small{font-size:11px;line-height:1.6}.sc-quantity-offer>small{opacity:.7}.ts-detail-copy .sc-quantity-offer{padding:12px 0;border-block:1px solid var(--site-line)}.ts-detail-copy .sc-quantity-offer small{font-size:13px}.ts-card-bordered>.sc-quantity-offer,.ts-card-elevated>.sc-quantity-offer,.pulse-product>.sc-quantity-offer{padding-inline:18px}.sc-commercial-info{display:grid;gap:8px;font-size:13px}.sc-commercial-info>div{display:flex;justify-content:space-between;gap:12px}.sc-commercial-info p{padding:10px;border:1px solid var(--site-line);border-radius:var(--site-radius);line-height:1.6}.sc-commercial-info small{font-size:12px;line-height:1.6}.sc-commercial-info:empty{display:none}.sc-coupon{display:grid;gap:6px;font-size:12px}.sc-coupon>div{display:flex;gap:6px;min-width:0;flex-wrap:wrap}.sc-coupon input{min-width:0;flex:1;width:100px;border:1px solid var(--site-line);border-radius:var(--site-radius);padding:8px;background:var(--site-bg);color:var(--site-fg)}.sc-coupon button{padding:8px;min-height:44px;border:1px solid var(--site-line);border-radius:var(--site-radius);background:var(--site-bg);color:var(--site-fg);cursor:pointer}.sc-coupon small{color:var(--site-fg);line-height:1.6}
`;
