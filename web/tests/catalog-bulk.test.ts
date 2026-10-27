import {afterEach,describe,expect,it,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {apiClient} from "../lib/api-client";
import {availableBulkFields,bulkPath,canConfirmBulk,type BulkJob} from "../features/product-engine/bulk-api";
import {CatalogBulkTools} from "../components/products/CatalogBulkTools";

afterEach(()=>vi.unstubAllGlobals());
describe("catalog operations",()=>{
 const job={status:"MAPPING",summary:{newProducts:1,updates:0}} as BulkJob;
 it("allows confirmation only after a successful preview and blocks double clicks",()=>{
  for(const status of ["MAPPING","PENDING_PREVIEW","PENDING","PROCESSING","COMPLETED","FAILED"])expect(canConfirmBulk({...job,status})).toBe(false);
  expect(canConfirmBulk({...job,status:"PREVIEW"})).toBe(true);expect(canConfirmBulk({...job,status:"PREVIEW"},true)).toBe(false);
  expect(canConfirmBulk({...job,status:"PREVIEW",summary:{...job.summary,newProducts:0}})).toBe(false);
 });
 it("hides protected fields while preserving variant column mapping",()=>{
  const restricted=availableBulkFields({canViewCost:false,isManager:false,inventoryManage:false}).map(([key])=>key);
  for(const field of ["cost","variantCost","minimumPrice","variantMinimumPrice","stock","trackStock"])expect(restricted).not.toContain(field);
  for(const field of ["sku","variantSku","options","color","size","ean"])expect(restricted).toContain(field);
 });
 it("encodes the current workspace on downloads and paginated preview",()=>{
  expect(bulkPath("a&b","export?format=xlsx")).toBe("/v1/catalog-bulk/export?format=xlsx&workspaceId=a%26b");
  expect(bulkPath("a b","imports/x")).toBe("/v1/catalog-bulk/imports/x?workspaceId=a%20b");
 });
 it("binary downloads keep authorization and return Blob instead of parsing JSON",async()=>{
  const expected=new Blob(["SKU;Nome"]);const fetch=vi.fn().mockResolvedValue({ok:true,blob:async()=>expected});vi.stubGlobal("fetch",fetch);
  expect(await apiClient.download("/v1/catalog-bulk/export?workspaceId=x")).toBe(expected);expect(fetch).toHaveBeenCalledOnce();
 });
 it("multipart uploads preserve idempotency headers without forcing JSON",async()=>{
  const fetch=vi.fn().mockResolvedValue({status:201,json:async()=>({ok:true,data:{id:"job"}})});vi.stubGlobal("fetch",fetch);
  const form=new FormData();form.append("file",new Blob(["SKU;Nome"]),"products.csv");
  await apiClient.upload("/v1/catalog-bulk/imports?workspaceId=x",form,{headers:{"idempotency-key":"repeat"}});
  const init=fetch.mock.calls[0][1];expect(init.headers["idempotency-key"]).toBe("repeat");expect(init.headers["Content-Type"]).toBeUndefined();
 });
 it("renders export for readers and import/preview controls for managers",()=>{
  const props={workspaceId:"w",selectedIds:[],filters:{active:"true"},canViewCost:false,isManager:false,inventoryManage:false,onSaved:()=>{}};
  const reader=renderToStaticMarkup(createElement(CatalogBulkTools,{...props,canManage:false}));expect(reader).toContain("Exportar produtos");expect(reader).not.toContain(">Importar produtos<");
  const manager=renderToStaticMarkup(createElement(CatalogBulkTools,{...props,canManage:true,selectedIds:["one","two"]}));expect(manager).toContain("Importar produtos");expect(manager).toContain("Revisar alterações");expect(manager).toContain("2 produtos selecionados");
 });
});
