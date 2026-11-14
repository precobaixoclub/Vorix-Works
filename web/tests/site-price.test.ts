import {describe,expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SitePrice,SaleBadge,discountPercent} from "@/components/sites/SitePrice";
import {ADD_SECTION_ITEMS,newSectionOfKind} from "@/features/sites/customization";
import {catalogSource} from "@/components/sites/SiteEditorFields";

describe("site price and automatic sections",()=>{
 it("shows de/por with the discount only when the price is below the list price",()=>{
  expect(discountPercent(8000,10000)).toBe(20);expect(discountPercent(10000,10000)).toBe(0);expect(discountPercent(10000)).toBe(0);
  const sale=renderToStaticMarkup(createElement(SitePrice,{product:{priceCents:8000,originalPriceCents:10000,currency:"BRL"}}));
  expect(sale).toContain("sp-price-was");expect(sale).toContain("-20%");expect(sale).toMatch(/100,00/);expect(sale).toMatch(/80,00/);
  const plain=renderToStaticMarkup(createElement(SitePrice,{product:{priceCents:10000,originalPriceCents:10000,currency:"BRL"}}));
  expect(plain).not.toContain("sp-sale-badge");
  expect(renderToStaticMarkup(createElement(SaleBadge,{product:{priceCents:10000,currency:"BRL"}}))).toBe("");
 });
 it("'Adicionar seção' offers the automatic product sections",()=>{
  expect(ADD_SECTION_ITEMS.map(item=>item.id)).toEqual(expect.arrayContaining(["catalog:featured","catalog:sale","catalog:category"]));
  const featured=newSectionOfKind("catalog:featured");expect([featured.type,featured.source,featured.title]).toEqual(["catalog","featured","Destaques"]);
  expect(newSectionOfKind("faq").type).toBe("faq");
 });
 it("old sections keep working: chosen products mean manual, none means all",()=>{
  expect(catalogSource({productIds:["a"]})).toBe("manual");expect(catalogSource({productIds:[]})).toBe("all");expect(catalogSource({source:"sale",productIds:[]})).toBe("sale");
 });
});
