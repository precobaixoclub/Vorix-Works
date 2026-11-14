import type {ProductOption} from "@/features/product-engine/types";
import type {PublicSiteProduct} from "./types";

export function isColorOption(option:ProductOption){
 return !!Object.keys(option.swatches??{}).length||/^(cor|cores|color|colour)$/i.test(option.key)||/^(cor|cores|color|colour)$/i.test(option.name);
}
const unique=(urls:(string|undefined)[])=>[...new Set(urls.filter((url):url is string=>!!url))];

/** A color preview must show a photo linked to that value, never an unrelated gallery image. */
export function productOptionPhoto(product:PublicSiteProduct,option:ProductOption,value:string,selected:Record<string,string>={}){
 const choice={...selected,[option.key]:value};
 const matching=product.variants.filter(variant=>Object.entries(choice).every(([key,v])=>!v||variant.optionValues[key]===v));
 const complete=product.options.filter(item=>item.values.length).every(item=>!!choice[item.key]);
 return (complete?matching.find(variant=>variant.imageUrl)?.imageUrl:undefined)??option.images?.[value]??matching.find(variant=>variant.imageUrl)?.imageUrl;
}

/** Every photo of an option value, the main one first (e.g. Preto: front, back). */
export function valueImages(option:ProductOption,value:string|undefined):string[]{
 return value?unique([option.images?.[value],...(option.extraImages?.[value]??[])]):[];
}

/**
 * The gallery for the current choice, the same in every site template. Nothing chosen: every photo.
 * A choice with 2+ photos of its own (front, back...): only those, so swiping stays on that colour.
 * A choice with a single photo: that one first, then the rest of the product, so swiping moves on
 * to the other variations. Unlinked photos are general.
 */
export function productPhotos(product:PublicSiteProduct,selected:Record<string,string>={}){
 const options=product.options.filter(option=>option.values.length);
 const linked=unique([...options.flatMap(option=>[...Object.values(option.images??{}),...Object.values(option.extraImages??{}).flat()]),...product.variants.map(variant=>variant.imageUrl)]);
 const all=unique([...product.imageUrls,...product.media.map(media=>media.url),...linked]);
 const choice=Object.entries(selected).filter(([,value])=>!!value);
 if(!choice.length)return all;
 const matching=product.variants.filter(variant=>choice.every(([key,value])=>variant.optionValues[key]===value));
 const complete=options.length>0&&options.every(option=>!!selected[option.key]);
 const exact=complete?matching[0]?.imageUrl:undefined;
 const optionPhotos=[...options].sort((a,b)=>Number(isColorOption(b))-Number(isColorOption(a))).flatMap(option=>valueImages(option,selected[option.key]));
 const specific=unique([exact,...optionPhotos,...matching.map(variant=>variant.imageUrl)]);
 if(specific.length>1)return specific;
 if(specific.length===1)return unique([...specific,...all]);
 const general=all.filter(url=>!linked.includes(url));
 return unique([product.imageUrls[0]??all[0],...general]);
}

export function productPhotoAlt(product:PublicSiteProduct,url:string,index:number){
 return product.media.find(media=>media.url===url)?.alt||`${product.name} — foto ${index+1}`;
}
