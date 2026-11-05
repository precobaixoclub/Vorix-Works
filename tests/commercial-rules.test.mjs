import test from "node:test";
import assert from "node:assert/strict";
import {commercialRuleSchema,evaluateCommercialRules} from "../dist/domain/commerce/commercial-rules.js";
import {readFile} from "node:fs/promises";
const initial=JSON.parse(await readFile(new URL("../config/commercial-rules/bambilu-kids-progressive.json",import.meta.url),"utf8")).definition;
const rule=(patch={})=>({...commercialRuleSchema.parse({...initial,...patch}),id:"rule",revision:1,tenantId:"t",workspaceId:"w",siteId:"s",createdAt:"2026-11-04T00:00:00Z",updatedAt:"2026-11-04T00:00:00Z",...patch});
const line=(quantity=1,patch={})=>({key:"a:M",productId:"a",variantId:"M",categoryIds:["shirts","clothing"],collection:"Verão",quantity,unitPriceCents:6000,currency:"BRL",...patch});
const calc=(lines,rules=[rule()],extra={})=>evaluateCommercialRules({lines,rules,channel:"CHECKOUT",now:new Date("2026-11-04T12:00:00Z"),...extra});

for(const [quantity,expected] of [[1,6000],[2,12000],[3,16500],[4,22000],[5,25000],[6,30000],[10,50000]])test(`regra inicial: ${quantity} itens = ${expected} centavos`,()=>{const p=calc([line(quantity)]);assert.equal(p.totalCents,expected);assert.equal(p.items[0].unitPriceCents,expected/quantity);assert.equal(p.items[0].appliedRules[0].tier.minimum,quantity<3?1:quantity<5?3:5);});
test("produtos e variações diferentes contam juntos; toda a faixa é recalculada",()=>{
 const lines=[line(2),line(1,{key:"a:G",variantId:"G"}),line(2,{key:"b:P",productId:"b",variantId:"P"})],p=calc(lines);
 assert.equal(p.totalCents,25000);assert.ok(p.items.every(item=>item.unitPriceCents===5000));assert.equal(p.discountCents,5000);
 assert.equal(calc(lines.map((item,i)=>i===2?{...item,quantity:1}:item)).totalCents,22000);
 assert.equal(calc(lines.slice(0,2)).totalCents,16500);assert.equal(calc(lines.slice(0,1)).totalCents,12000);
});
test("mesmo produto soma suas variações mas não mistura produtos",()=>{
 const r=rule({trigger:{type:"QUANTITY",count:"SAME_PRODUCT",minimum:1}}),p=calc([line(2),line(1,{key:"a:G",variantId:"G"}),line(2,{key:"b",productId:"b"})],[r]);
 assert.equal(p.totalCents,28500);assert.equal(p.items[0].unitPriceCents,5500);assert.equal(p.items[2].unitPriceCents,6000);
});
test("escopos de produto, categoria ancestral e coleção excluem itens não elegíveis",()=>{
 for(const scope of [{type:"PRODUCTS",ids:["a"]},{type:"CATEGORIES",ids:["clothing"]},{type:"COLLECTIONS",ids:["Verão"]}]){
  const p=calc([line(3),line(9,{key:"b",productId:"b",categoryIds:["other"],collection:"Outra"})],[rule({scope})]);assert.equal(p.items[0].unitPriceCents,5500);assert.equal(p.items[1].discountCents,0);
 }
});
test("inativa, expirada, futura, canal e moeda não elegíveis preservam tabela",()=>{
 for(const patch of [{active:false},{endsAt:"2026-11-04T12:00:00Z"},{startsAt:"2026-11-05T00:00:00Z"},{channels:["WHATSAPP"]},{currency:"USD"}])assert.equal(calc([line(5)],[rule(patch)]).totalCents,30000);
});
test("carrinho vazio e sem regras preservam o comportamento anterior",()=>{assert.equal(calc([]).totalCents,0);const p=calc([line(5)],[]);assert.equal(p.totalCents,30000);assert.deepEqual(p.appliedRules,[]);});
test("gatilho por subtotal considera apenas produtos elegíveis, sem frete",()=>{
 const r=rule({scope:{type:"PRODUCTS",ids:["a"]},trigger:{type:"SUBTOTAL",minimumCents:30000},benefit:{type:"FIXED",amountCents:3000}});
 assert.equal(calc([line(4),line(10,{key:"b",productId:"b"})],[r]).discountCents,0);
 assert.equal(calc([line(5)],[r]).totalCents,27000);
});
test("desconto percentual e fixo distribuem centavos e nunca geram totais negativos",()=>{
 const lines=[line(1,{unitPriceCents:101}),line(2,{key:"b",unitPriceCents:102})];
 for(const benefit of [{type:"PERCENT",basisPoints:3333},{type:"FIXED",amountCents:101},{type:"FIXED",amountCents:9999}]){
  const p=calc(lines,[rule({benefit})]);assert.equal(p.totalCents,p.items.reduce((s,i)=>s+i.totalCents,0));assert.equal(p.originalSubtotalCents-p.discountCents,p.totalCents);assert.ok(p.items.every(i=>Number.isInteger(i.totalCents)&&i.totalCents>=0));
 }
 assert.equal(calc([line(3,{unitPriceCents:1})],[rule({benefit:{type:"FIXED",amountCents:1}})]).totalCents,2);
});
test("prioridade vence, empate usa melhor benefício; não acumula implicitamente",()=>{
 const a=rule(),b={...rule({benefit:{type:"PERCENT",basisPoints:2000}}),id:"b"};
 assert.equal(calc([line(5)],[a,b]).totalCents,24000);
 assert.equal(calc([line(5)],[{...a,priority:10},b]).totalCents,25000);
});
test("regras acumuláveis são aplicadas em ordem determinística",()=>{
 const a=rule({stackable:true}),b={...rule({stackable:true,benefit:{type:"PERCENT",basisPoints:1000}}),id:"z-percent"};
 assert.equal(calc([line(5)],[a,b]).totalCents,22500);assert.equal(calc([line(5)],[b,a]).totalCents,22500);
});
test("cupom acumula somente com permissão explícita; caso contrário escolhe condição permitida",()=>{
 const coupon={...rule({couponCode:"TESTE10",benefit:{type:"PERCENT",basisPoints:1000}}),id:"coupon"};
 assert.equal(calc([line(5)],[rule(),coupon],{couponCode:"teste10"}).totalCents,25000);
 assert.equal(calc([line(5)],[rule({allowCoupon:true}),coupon],{couponCode:"TESTE10"}).totalCents,22500);
 assert.equal(calc([line(5)],[rule(),{...coupon,benefit:{type:"PERCENT",basisPoints:5000}}],{couponCode:"TESTE10"}).totalCents,15000);
 assert.equal(calc([line(5)],[rule(),coupon],{couponCode:undefined}).totalCents,25000);
});
test("progresso aponta a próxima faixa e o cálculo não altera entradas",()=>{
 const lines=[line(2)],rules=[rule()],before=structuredClone({lines,rules}),p=calc(lines,rules);
 assert.deepEqual(p.progress.map(p=>[p.missing,p.unitPriceCents]),[[1,5500]]);assert.deepEqual({lines,rules},before);
 assert.deepEqual(calc([line(4)]).progress.map(p=>[p.missing,p.unitPriceCents]),[[1,5000]]);assert.deepEqual(calc([line(5)]).progress,[]);
});
test("a melhor condição considera todos os planos que podem acumular com o cupom",()=>{
 const a={...rule({benefit:{type:"PERCENT",basisPoints:2000}}),id:"exclusive"},b={...rule({allowCoupon:true,benefit:{type:"PERCENT",basisPoints:1500}}),id:"allows-coupon"},coupon={...rule({couponCode:"TEN",benefit:{type:"PERCENT",basisPoints:1000}}),id:"coupon"};
 const p=calc([line(1,{unitPriceCents:10000})],[a,b,coupon],{couponCode:"TEN"});assert.equal(p.totalCents,7650);assert.equal(p.couponStatus,"APPLIED");
});
test("validação rejeita faixas sobrepostas, lacunas, ordem inválida, validade inválida e escopo vazio",()=>{
 for(const patch of [{scope:{type:"PRODUCTS",ids:[]}},{startsAt:"2026-12-01T00:00:00Z",endsAt:"2026-11-01T00:00:00Z"},{benefit:{type:"UNIT_PRICE",tiers:[{minimum:1,maximum:4,unitPriceCents:6000},{minimum:3,unitPriceCents:5000}]}},{benefit:{type:"UNIT_PRICE",tiers:[{minimum:1,maximum:2,unitPriceCents:6000},{minimum:4,unitPriceCents:5000}]}},{trigger:{type:"SUBTOTAL",minimumCents:10000}}])assert.equal(commercialRuleSchema.safeParse({...initial,...patch}).success,false);
});
