import {productSpecializationSummary} from "../../domain/products/product-summary.js";
import type {UpdateProductVariantInput} from "../ports/sales-engine-repository.port.js";
import type { Product } from "../../domain/crm/crm.model.js";
import type { BillingType } from "../../domain/sales/pricing.js";
import type { PriceBook, PriceBookItem, ProductVariant } from "../../domain/sales/sales.model.js";
import type { SalesEngineDeps } from "./sales-context.js";
import { optionCombinations, validateVariantSelection } from "../../domain/products/product-details.js";
import { stripObjectUrlSignature } from "../../shared/utils/object-url-signing.js";

export type CatalogDeps = Pick<SalesEngineDeps, "productRepository" | "salesCatalogRepository">;

export async function generateVariantGrid(deps:CatalogDeps,input:{tenantId:string;workspaceId:string;productId:string}):Promise<ProductVariant[]>{
 const product=await mustProductInWorkspace(deps,input.productId,input.tenantId,input.workspaceId);
 const options=product.details?.options??[];if(!options.length)throw Error("PRODUCT_VALIDATION: cadastre as opções antes de gerar combinações.");
 const existing=await deps.salesCatalogRepository.listVariants(product.id);
 const signature=(values:Record<string,string>)=>JSON.stringify(Object.entries(values).sort(([a],[b])=>a.localeCompare(b)));
 const known=new Set(existing.filter(variant=>Object.keys(variant.optionValues??{}).length).map(variant=>signature(variant.optionValues!)));
 const missing=optionCombinations(options).filter(values=>!known.has(signature(values)));
 return deps.salesCatalogRepository.createVariantGrid(missing.map((values,index)=>({...input,name:options.map(option=>`${option.name}: ${values[option.key]}`).join(" / "),code:product.code?`${product.code.slice(0,25)}-${Object.values(values).join("-").slice(0,25)}-${existing.length+index+1}`:undefined,listPriceCents:product.priceCents,priceOverride:false,optionValues:values,stockQuantity:0,position:existing.length+index})));
}

/** Regras do catálogo: preços nunca negativos e mínimo nunca acima da tabela (senão todo preço de
 * tabela já nasceria "abaixo do mínimo"). Custo acima da tabela é permitido (produto em prejuízo
 * existe) — só a aprovação comercial reage a isso. */
export function assertProductPricing(input: { priceCents?: number; minimumPriceCents?: number | null; costCents?: number | null }, existing?: Pick<Product, "priceCents" | "minimumPriceCents">): void {
  const list = input.priceCents ?? existing?.priceCents ?? 0;
  const minimum = input.minimumPriceCents === undefined ? existing?.minimumPriceCents : input.minimumPriceCents ?? undefined;
  if (minimum !== undefined && minimum !== null && minimum > list) {
    throw new Error("PRODUCT_PRICING_INVALID: o preço mínimo não pode ser maior que o preço de tabela.");
  }
}

/** Remove custo (e comissão, que revela margem) de quem não pode ver custo. */
export function redactProduct(product: Product, canViewCost: boolean): Product {
  if (canViewCost) return product;
  return { ...product, costCents: undefined };
}

export function redactVariant(variant: ProductVariant, canViewCost: boolean): ProductVariant {
  return canViewCost ? variant : { ...variant, costCents: undefined };
}

export async function mustProductInWorkspace(deps: Pick<CatalogDeps, "productRepository">, productId: string, tenantId: string, workspaceId: string): Promise<Product> {
  const product = await deps.productRepository.getById(productId);
  if (!product || product.tenantId !== tenantId || product.workspaceId !== workspaceId) throw new Error(`PRODUCT_NOT_FOUND: produto "${productId}" não existe.`);
  return product;
}

export async function mustVariantOfProduct(deps: Pick<CatalogDeps, "salesCatalogRepository">, variantId: string, product: Product): Promise<ProductVariant> {
  const variant = await deps.salesCatalogRepository.getVariant(variantId);
  if (!variant || variant.productId !== product.id || variant.tenantId !== product.tenantId) throw new Error(`PRODUCT_VARIANT_NOT_FOUND: variação "${variantId}" não existe.`);
  return variant;
}

export async function mustPriceBookInWorkspace(deps: Pick<CatalogDeps, "salesCatalogRepository">, priceBookId: string, tenantId: string, workspaceId: string): Promise<PriceBook> {
  const book = await deps.salesCatalogRepository.getPriceBook(priceBookId);
  if (!book || book.tenantId !== tenantId || book.workspaceId !== workspaceId) throw new Error(`PRICE_BOOK_NOT_FOUND: tabela "${priceBookId}" não existe.`);
  return book;
}

export async function listVariants(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; productId: string; canViewCost: boolean }): Promise<ProductVariant[]> {
  const product=await mustProductInWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  return (await deps.salesCatalogRepository.listVariants(input.productId)).map((variant) => redactVariant({...variant,listPriceCents:variant.priceOverride===false?product.priceCents:variant.listPriceCents}, input.canViewCost));
}

export async function createVariant(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; productId: string; name: string; code?: string; costCents?: number; listPriceCents: number; minimumPriceCents?: number; position?: number; priceOverride?:boolean; optionValues?:Record<string,string>; stockQuantity?:number; imageUrl?:string }): Promise<ProductVariant> {
  const product=await mustProductInWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  validateVariantSelection(product.details?.options??[],input.optionValues??{});
  if(input.imageUrl){input.imageUrl=stripObjectUrlSignature(input.imageUrl);if(!product.imageUrls.includes(input.imageUrl))throw Error("PRODUCT_VALIDATION: use uma foto da galeria do produto.");}
  assertProductPricing({ priceCents: input.listPriceCents, minimumPriceCents: input.minimumPriceCents, costCents: input.costCents });
  return deps.salesCatalogRepository.createVariant(input);
}

export async function updateVariant(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; productId: string; variantId: string; patch: UpdateProductVariantInput }): Promise<ProductVariant> {
  const product = await mustProductInWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  const variant = await mustVariantOfProduct(deps, input.variantId, product);
  if(input.patch.optionValues)validateVariantSelection(product.details?.options??[],input.patch.optionValues);
  if(input.patch.imageUrl){input.patch.imageUrl=stripObjectUrlSignature(input.patch.imageUrl);if(!product.imageUrls.includes(input.patch.imageUrl))throw Error("PRODUCT_VALIDATION: use uma foto da galeria do produto.");}
  const override=input.patch.priceOverride??variant.priceOverride??true;
  const effectivePrice=override?(input.patch.listPriceCents??variant.listPriceCents):product.priceCents;
  assertProductPricing({priceCents:effectivePrice,minimumPriceCents:input.patch.minimumPriceCents===null?product.minimumPriceCents:input.patch.minimumPriceCents??variant.minimumPriceCents??product.minimumPriceCents});
  return deps.salesCatalogRepository.updateVariant(variant.id, input.patch);
}

export async function deleteVariant(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; productId: string; variantId: string }): Promise<void> {
  const product = await mustProductInWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  const variant = await mustVariantOfProduct(deps, input.variantId, product);
  try{await deps.salesCatalogRepository.deleteVariant(variant.id);}catch(error){if(["23503","23001"].includes(String((error as {code?:string}).code)))throw Error("PRODUCT_VALIDATION: esta combinação possui histórico ou anúncio em marketplace. Desative-a para preservar os registros.");throw error;}
}

export async function listPriceBooks(deps: CatalogDeps, input: { tenantId: string; workspaceId: string }): Promise<PriceBook[]> {
  return deps.salesCatalogRepository.listPriceBooks(input);
}

export async function createPriceBook(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; name: string; description?: string; currency?: string }): Promise<PriceBook> {
  return deps.salesCatalogRepository.createPriceBook(input);
}

export async function updatePriceBook(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; priceBookId: string; patch: Partial<Pick<PriceBook, "name" | "description" | "active">> }): Promise<PriceBook> {
  await mustPriceBookInWorkspace(deps, input.priceBookId, input.tenantId, input.workspaceId);
  return deps.salesCatalogRepository.updatePriceBook(input.priceBookId, input.patch);
}

export async function deletePriceBook(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; priceBookId: string }): Promise<void> {
  await mustPriceBookInWorkspace(deps, input.priceBookId, input.tenantId, input.workspaceId);
  await deps.salesCatalogRepository.deletePriceBook(input.priceBookId);
}

export async function listPriceBookItems(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; priceBookId: string }): Promise<PriceBookItem[]> {
  await mustPriceBookInWorkspace(deps, input.priceBookId, input.tenantId, input.workspaceId);
  return deps.salesCatalogRepository.listPriceBookItems(input.priceBookId);
}

export async function upsertPriceBookItem(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; priceBookId: string; productId: string; variantId?: string; listPriceCents: number; minimumPriceCents?: number }): Promise<PriceBookItem> {
  await mustPriceBookInWorkspace(deps, input.priceBookId, input.tenantId, input.workspaceId);
  const product = await mustProductInWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  if (input.variantId) await mustVariantOfProduct(deps, input.variantId, product);
  assertProductPricing({ priceCents: input.listPriceCents, minimumPriceCents: input.minimumPriceCents });
  return deps.salesCatalogRepository.upsertPriceBookItem(input);
}

export async function deletePriceBookItem(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; priceBookId: string; itemId: string }): Promise<void> {
  await mustPriceBookInWorkspace(deps, input.priceBookId, input.tenantId, input.workspaceId);
  const items = await deps.salesCatalogRepository.listPriceBookItems(input.priceBookId);
  if (!items.some((item) => item.id === input.itemId)) throw new Error(`PRICE_BOOK_NOT_FOUND: item "${input.itemId}" não existe nesta tabela.`);
  await deps.salesCatalogRepository.deletePriceBookItem(input.itemId);
}

export type ResolvedPricing = {
  productContext?: import("../../domain/sales/sales.model.js").DealItem["productContextSnapshot"];
  productId: string;
  variantId?: string;
  name: string;
  code?: string;
  unit?: string;
  billingType: BillingType;
  costCents?: number;
  listPriceCents: number;
  minimumPriceCents?: number;
  commissionType?: "percent" | "fixed";
  commissionValue?: number;
  currency: string;
  /** De onde veio o preço — explica divergência entre catálogo e tabela de preço. */
  priceSource: "product" | "variant" | "price_book";
};

/** Resolve o preço vigente: tabela de preço (se a oportunidade usa uma e ela tem o item) >
 * variação > produto. Sem tabela, vale o preço de tabela do produto/variação. */
export async function resolveProductPricing(deps: CatalogDeps, input: { tenantId: string; workspaceId: string; productId: string; variantId?: string; priceBookId?: string }): Promise<ResolvedPricing> {
  const product = await mustProductInWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  if (!product.active) throw new Error("PRODUCT_INACTIVE: este produto está inativo e não pode ser adicionado.");
  if(product.details?.type==="REAL_ESTATE"&&product.details.realEstate&&["sold","rented","inactive"].includes(product.details.realEstate.status))throw Error("PRODUCT_INACTIVE: este imóvel não está disponível para novas negociações.");
  const variant = input.variantId ? await mustVariantOfProduct(deps, input.variantId, product) : undefined;
  if(product.details?.options.length&&!variant)throw Error("PRODUCT_VARIANT_REQUIRED: escolha a combinação deste produto.");
  if(product.details?.options.length&&variant)validateVariantSelection(product.details.options,variant.optionValues??{});
  if(variant&&!variant.active)throw Error("PRODUCT_INACTIVE: esta variante está inativa.");
  let resolved: ResolvedPricing = {
    productContext:{type:product.details?.type,summary:productSpecializationSummary(product.details),attributes:product.details?.attributes,options:variant?.optionValues,optionLabels:Object.fromEntries((product.details?.options??[]).map(item=>[item.key,item.name])),imageUrl:variant?.imageUrl??product.imageUrls[0]},
    productId: product.id,
    variantId: variant?.id,
    name: variant ? `${product.name} — ${variant.name}` : product.name,
    code: variant?.code ?? product.code,
    unit: product.unit,
    billingType: product.billingType,
    costCents: variant?.costCents ?? product.costCents,
    listPriceCents: variant&&variant.priceOverride!==false?variant.listPriceCents:product.priceCents,
    minimumPriceCents: variant?.minimumPriceCents ?? product.minimumPriceCents,
    commissionType: product.commissionType,
    commissionValue: product.commissionValue,
    currency: product.currency,
    priceSource: variant&&variant.priceOverride!==false ? "variant" : "product",
  };
  if (input.priceBookId) {
    const book = await mustPriceBookInWorkspace(deps, input.priceBookId, input.tenantId, input.workspaceId);
    const item = book.active ? await deps.salesCatalogRepository.resolvePriceBookItem(book.id, product.id, variant?.id) : undefined;
    if (item) resolved = { ...resolved, listPriceCents: item.listPriceCents, minimumPriceCents: item.minimumPriceCents ?? resolved.minimumPriceCents, priceSource: "price_book" };
  }
  return resolved;
}
