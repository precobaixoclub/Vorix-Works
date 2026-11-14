import type {ReactNode} from "react";
import {formatCurrencyCents} from "@/lib/format";

type Priced={priceCents:number;originalPriceCents?:number;currency:string};

/** Whole-percent discount between the list price and the price shown; 0 when not on sale. */
export function discountPercent(price:number,original?:number){
 return original&&original>price&&original>0?Math.round((1-price/original)*100):0;
}

/**
 * The price on every site template: on sale, "de" (struck) and "por" with a "-20%" badge; otherwise
 * just the price. The list price comes from the API, so a product promotion and a store rule show
 * the same way.
 */
export function SitePrice({product,suffix}:{product:Priced;suffix?:ReactNode}){
 const off=discountPercent(product.priceCents,product.originalPriceCents);
 const now=formatCurrencyCents(product.priceCents,product.currency);
 if(!off)return <>{now}{suffix}</>;
 return <span className="sp-price" data-on-sale="true">
  <s className="sp-price-was"><span className="sp-vh">De </span>{formatCurrencyCents(product.originalPriceCents!,product.currency)}</s>
  <span className="sp-price-now"><span className="sp-vh">por </span>{now}{suffix}</span>
  <span className="sp-sale-badge">-{off}%</span>
 </span>;
}

/** Badge over the product photo in cards ("-20%"). */
export function SaleBadge({product}:{product:Priced}){
 const off=discountPercent(product.priceCents,product.originalPriceCents);
 return off?<span className="sp-sale-flag" aria-hidden="true">-{off}%</span>:null;
}

export const SITE_PRICE_STYLES=String.raw`
.sp-price{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:.15em .5em}
.sp-price-was{font-size:.82em;font-weight:400;opacity:.6}
.sp-price-now{font-weight:inherit}
.sp-sale-badge{align-self:center;padding:.15em .55em;border-radius:999px;background:var(--site-primary,currentColor);color:var(--site-on-primary,#fff);font-size:.72em;font-weight:700;line-height:1.4;letter-spacing:.02em}
.sp-sale-flag{position:absolute;left:10px;top:10px;z-index:2;padding:3px 9px;border-radius:999px;background:var(--site-primary,#111);color:var(--site-on-primary,#fff);font-size:12px;font-weight:700;line-height:1.4;pointer-events:none}
.sp-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
