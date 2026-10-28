import {describe,expect,it} from "vitest";
import {base64ToBlob,buildReturnItems,canReceiveReturn,canRefundReturn,channelShare,clampQuantity,defaultRefundCents,providerSlug,refundStatusLabel,returnableQuantity,returnStatusActions,returnStatusLabel,shipmentStatusLabel,sourceLabel,splitCapabilities,STOCK_STATE_LABELS,validateReceipt} from "@/features/commerce/multichannel";

const item={id:"i1",name:"Camiseta",quantity:3,unitPriceCents:5000};
const ret=(status:string,quantity:number,orderItemId="i1")=>({id:status+quantity,status,refundStatus:"NONE",items:[{orderItemId,quantity,receivedQuantity:0,restockedQuantity:0}]});

describe("devolução: quantidade disponível",()=>{
 it("desconta somente devoluções ativas",()=>{
  expect(returnableQuantity(item,[])).toBe(3);
  expect(returnableQuantity(item,[ret("REQUESTED",1),ret("COMPLETED",1)])).toBe(1);
  expect(returnableQuantity(item,[ret("REJECTED",2),ret("CANCELLED",3)])).toBe(3);
  expect(returnableQuantity(item,[ret("RECEIVED",5)])).toBe(0);
  expect(returnableQuantity(item,[ret("REQUESTED",2,"other")])).toBe(3);
 });
 it("valida a nova devolução contra o máximo",()=>{
  expect(buildReturnItems([item],[ret("REQUESTED",2)],{i1:2}).error).toBe("Camiseta: pode devolver até 1.");
  expect(buildReturnItems([item],[],{}).error).toMatch(/pelo menos um item/);
  expect(buildReturnItems([item],[],{i1:2})).toEqual({items:[{orderItemId:"i1",quantity:2}]});
 });
 it("normaliza quantidades digitadas",()=>{expect(clampQuantity("5",3)).toBe(3);expect(clampQuantity("-1",3)).toBe(0);expect(clampQuantity("abc",3)).toBe(0);expect(clampQuantity("2.7",3)).toBe(2);});
});

describe("recebimento e reposição",()=>{
 const items=[{orderItemId:"i1",quantity:2,receivedQuantity:0,restockedQuantity:0}];
 it("reposto ≤ recebido ≤ solicitado",()=>{
  expect(validateReceipt(items,{i1:{received:2,restock:1}})).toBeUndefined();
  expect(validateReceipt(items,{i1:{received:3,restock:0}})).toMatch(/solicitado/);
  expect(validateReceipt(items,{i1:{received:1,restock:2}})).toMatch(/Reposto/);
  expect(validateReceipt(items,{i1:{received:0,restock:0}})).toMatch(/recebido/);
 });
});

describe("reembolso",()=>{
 it("sugere preço unitário × quantidade devolvida",()=>{
  expect(defaultRefundCents([item,{id:"i2",unitPriceCents:1990}],[{orderItemId:"i1",quantity:2},{orderItemId:"i2",quantity:1}])).toBe(11990);
  expect(defaultRefundCents([item],[{orderItemId:"missing",quantity:4}])).toBe(0);
 });
 it("nunca oferece reembolso de devolução do marketplace, já reembolsada ou encerrada",()=>{
  expect(canRefundReturn({status:"RECEIVED",refundStatus:"NONE"},true)).toBe(true);
  expect(canRefundReturn({status:"RECEIVED",refundStatus:"FAILED"},true)).toBe(true);
  expect(canRefundReturn({status:"RECEIVED",refundStatus:"NONE"},false)).toBe(false);
  expect(canRefundReturn({status:"RECEIVED",refundStatus:"MARKETPLACE"},true)).toBe(false);
  expect(canRefundReturn({status:"COMPLETED",refundStatus:"REFUNDED"},true)).toBe(false);
  expect(canRefundReturn({status:"REJECTED",refundStatus:"NONE"},true)).toBe(false);
 });
});

describe("status e rótulos",()=>{
 it("espelha as transições do domínio sem expor RECEIVED como botão",()=>{
  expect(returnStatusActions("REQUESTED")).toEqual(["APPROVED","IN_TRANSIT","REJECTED","CANCELLED"]);
  expect(returnStatusActions("RECEIVED")).toEqual(["COMPLETED"]);
  expect(returnStatusActions("COMPLETED")).toEqual([]);
  expect(canReceiveReturn("IN_TRANSIT")).toBe(true);expect(canReceiveReturn("RECEIVED")).toBe(false);
 });
 it("traduz status e cai no valor bruto quando desconhecido",()=>{
  expect(returnStatusLabel("IN_TRANSIT")).toBe("Em trânsito");expect(refundStatusLabel("MARKETPLACE")).toBe("Reembolso feito pelo marketplace");
  expect(shipmentStatusLabel("READY_TO_SHIP")).toBe("Pronto para envio");expect(shipmentStatusLabel("FOO")).toBe("FOO");
  expect(STOCK_STATE_LABELS.CONFLICT).toBe("Venda sem saldo central");expect(STOCK_STATE_LABELS.EXTERNAL).toBe("Estoque do marketplace");
  expect(sourceLabel("TIKTOK_SHOP")).toBe("TikTok Shop");expect(providerSlug("MERCADO_LIVRE")).toBe("mercado-livre");expect(providerSlug("TIKTOK_SHOP")).toBe("tiktok-shop");
 });
 it("separa capacidades liberadas e bloqueadas",()=>{
  const {supported,blocked}=splitCapabilities({orders:"SUPPORTED",labels:"SUPPORTED",cancelOrder:"BLOCKED_EXTERNAL_CAPABILITY"});
  expect(supported).toEqual(["orders","labels"]);expect(blocked).toContain("cancelOrder");expect(blocked).toContain("webhooks");
 });
});

describe("vendas por canal",()=>{
 const row=(source:string,revenueCents:number)=>({source,orders:1,sales:1,revenueCents,refundsCents:0,averageTicketCents:revenueCents,cancellations:0,returns:0});
 it("barra relativa ao maior canal",()=>{const rows=[row("SITE",10000),row("SHOPEE",2500)];expect(channelShare(rows,rows[0])).toBe(100);expect(channelShare(rows,rows[1])).toBe(25);expect(channelShare([row("SITE",0)],row("SITE",0))).toBe(0);});
 it("decodifica a etiqueta em base64",async()=>{const blob=base64ToBlob(btoa("%PDF-1"),"application/pdf");expect(blob.type).toBe("application/pdf");expect(await blob.text()).toBe("%PDF-1");});
});
