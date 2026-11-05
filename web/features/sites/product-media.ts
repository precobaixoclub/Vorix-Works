import type {ProductOption} from "@/features/product-engine/types";
import type {PublicSiteProduct} from "./types";

export function isColorOption(option:ProductOption){
 return !!Object.keys(option.swatches??{}).length||/^(cor|cores|color|colour)$/i.test(option.key)||/^(cor|cores|color|colour)$/i.test(option.name);
}
const unique=(urls:(string|undefined)[])=>[...new Set(urls.filter((url):url is string=>!!url))];

/** Uses the existing option/value and combination photo links; unlinked photos are general. */
export function productPhotos(product:PublicSiteProduct,selected:Record<string,string>={}){
 const options=product.options.filter(option=>option.values.length);
 const linked=unique([...options.flatMap(option=>Object.values(option.images??{})),...product.variants.map(variant=>variant.imageUrl)]);
 const all=unique([...product.imageUrls,...product.media.map(media=>media.url),...linked]);
 const choice=Object.entries(selected).filter(([,value])=>!!value);
 if(!choice.length)return all;
 const matching=product.variants.filter(variant=>choice.every(([key,value])=>variant.optionValues[key]===value));
 const complete=options.length>0&&options.every(option=>!!selected[option.key]);
 const exact=complete?matching[0]?.imageUrl:undefined;
 const optionPhotos=[...options].sort((a,b)=>Number(isColorOption(b))-Number(isColorOption(a))).map(option=>option.images?.[selected[option.key]]);
 const specific=unique([exact,...optionPhotos,...matching.map(variant=>variant.imageUrl)]);
 const general=all.filter(url=>!linked.includes(url));
 return unique([...specific,...(!specific.length?[product.imageUrls[0]??all[0]]:[]),...general]);
}

export function productPhotoAlt(product:PublicSiteProduct,url:string,index:number){
 return product.media.find(media=>media.url===url)?.alt||`${product.name} — foto ${index+1}`;
}
