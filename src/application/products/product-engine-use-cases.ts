import { productDetailsSchema, validateAttributeValues, validateVariantSelection } from "../../domain/products/product-details.js";
import type { Product } from "../../domain/crm/crm.model.js";
import type { ProductUseCaseDeps } from "../crm/product-use-cases.js";
import type { CreateProductInput } from "../ports/product-repository.port.js";
import {stripObjectUrlSignature} from "../../shared/utils/object-url-signing.js";

export async function validateProductExtension(deps: ProductUseCaseDeps, input: Partial<CreateProductInput>, scope: {tenantId:string;workspaceId:string}, existing?: Product): Promise<void> {
 if(input.details){
  const parsed=productDetailsSchema.safeParse(input.details);
  if(!parsed.success)throw Error(`PRODUCT_VALIDATION: ${parsed.error.issues.map(issue=>issue.message).join(" ")}`);
  input.details=parsed.data;
  input.details.media=input.details.media.map(media=>({...media,url:stripObjectUrlSignature(media.url)}));
  const images=input.imageUrls??existing?.imageUrls??[];
  if(input.details.media.some(media=>!images.includes(media.url)))throw Error("PRODUCT_VALIDATION: a mídia precisa estar na galeria do produto.");
  if(deps.salesCatalogRepository&&existing){
   for(const variant of await deps.salesCatalogRepository.listVariants(existing.id)){
    if(Object.keys(variant.optionValues??{}).length)validateVariantSelection(input.details.options,variant.optionValues!);
   }
  }
 }
 const effectiveDetails=input.details??existing?.details;
 if(effectiveDetails?.type==="REAL_ESTATE"){
  input.itemType="product";input.trackStock=false;input.billingType=effectiveDetails.realEstate?.purpose==="rent"?"monthly":"one_time";
 }
 if(!deps.productEngineRepository)return;
 const metadata=await deps.productEngineRepository.metadata(scope);
 const categoryId=input.categoryId===undefined?existing?.categoryId:input.categoryId;
 const brandId=input.brandId===undefined?existing?.brandId:input.brandId;
 if(categoryId&&!metadata.categories.some(category=>category.id===categoryId))throw Error("PRODUCT_NOT_FOUND: categoria não encontrada.");
 if(input.categoryId){input.category=metadata.categories.find(category=>category.id===input.categoryId)?.name??input.category;}
 if(brandId&&!metadata.brands.some(brand=>brand.id===brandId))throw Error("PRODUCT_NOT_FOUND: marca não encontrada.");
 const ancestors=new Set<string>();let parent=categoryId;
 while(parent&&!ancestors.has(parent)){ancestors.add(parent);parent=metadata.categories.find(category=>category.id===parent)?.parentId;}
 if(input.details)validateAttributeValues(metadata.attributes.map(attribute=>attribute.categoryId&&!ancestors.has(attribute.categoryId)?{...attribute,required:false}:attribute),input.details.attributes);
 if((input.details??existing?.details)?.options.length&&input.stockQuantity!==undefined&&existing)throw Error("PRODUCT_VALIDATION: ajuste o estoque de cada variante, não o saldo agregado.");
}
