import {expect,it} from "vitest";
import {defaultRefundCents} from "@/features/commerce/multichannel";
it("sugere reembolso sobre o total pago e preserva os centavos entre devoluções",()=>{
 const item={id:"a",quantity:3,unitPriceCents:6000,totalCents:17900,pricingSnapshot:{}},returned={orderItemId:"a",quantity:1};
 expect(defaultRefundCents([item],[returned])).toBe(5966);
 expect(defaultRefundCents([item],[returned],[returned])).toBe(5967);
 expect(defaultRefundCents([item],[returned],[returned,returned])).toBe(5967);
 expect(defaultRefundCents([{id:"old",unitPriceCents:6000}],[{orderItemId:"old",quantity:2}])).toBe(12000);
});
