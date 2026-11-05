/** Public API contract. This package builds independently of the backend source tree. */
export type CommercialRuleInput={
 name:string;active:boolean;priority:number;stackable:boolean;allowCoupon:boolean;
 startsAt?:string;endsAt?:string;channels:("CHECKOUT"|"WHATSAPP")[];currency:string;
 scope:{type:"STORE"|"PRODUCTS"|"CATEGORIES"|"COLLECTIONS";ids:string[]};
 trigger:{type:"QUANTITY";count:"ELIGIBLE"|"SAME_PRODUCT";minimum:number}|{type:"SUBTOTAL";minimumCents:number};
 benefit:{type:"PERCENT";basisPoints:number}|{type:"FIXED";amountCents:number}|{type:"UNIT_PRICE";tiers:{minimum:number;maximum?:number;unitPriceCents:number}[]};
 couponCode?:string;
};
export type CommercialRule=CommercialRuleInput&{id:string;tenantId:string;workspaceId:string;siteId:string;revision:number;createdAt:string;updatedAt:string};
export type AppliedCommercialRule={id:string;revision:number;name:string;priority:number;benefit:CommercialRuleInput["benefit"];tier?:{minimum:number;maximum?:number;unitPriceCents:number};discountCents:number;coupon:boolean};
export type RuleProgress={ruleId:string;name:string;productId?:string;missing:number;unitPriceCents:number;currency:string};
