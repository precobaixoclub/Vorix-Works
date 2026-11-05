import {describe,expect,it} from "vitest";
import {isColorOption,productPhotoAlt,productPhotos} from "@/features/sites/product-media";
import type {PublicSiteProduct} from "@/features/sites/types";

const product=(patch:Partial<PublicSiteProduct>={}):PublicSiteProduct=>({id:"shirt",slug:"shirt",type:"APPAREL",name:"Camisa",priceCents:6000,currency:"BRL",imageUrls:["gray","black","general"],media:[{url:"general",alt:"Detalhe do tecido"}],attributes:{},options:[{key:"color",name:"Cor",values:["Cinza","Preto"],images:{Cinza:"gray",Preto:"black"}},{key:"size",name:"Tamanho",values:["P","M"]}],seo:{},canPurchaseOnline:false,variants:[{id:"gp",name:"Cinza P",optionValues:{color:"Cinza",size:"P"},priceCents:6000,imageUrl:"gray-p"},{id:"gm",name:"Cinza M",optionValues:{color:"Cinza",size:"M"},priceCents:6000},{id:"bp",name:"Preto P",optionValues:{color:"Preto",size:"P"},priceCents:6000}],...patch});
describe("public product photo ordering",()=>{
 it("includes option and combination photos in the initial gallery without duplicates",()=>{expect(productPhotos(product())).toEqual(["gray","black","general","gray-p"]);});
 it("prioritizes a combination, then its color, then general photos",()=>{expect(productPhotos(product(),{color:"Cinza",size:"P"})).toEqual(["gray-p","gray","general"]);});
 it("falls back to the option photo when the combination has none",()=>{expect(productPhotos(product(),{color:"Preto",size:"P"})).toEqual(["black","general"]);});
 it("supports partial color selection and keeps general photos",()=>{expect(productPhotos(product(),{color:"Cinza"})).toEqual(["gray","gray-p","general"]);});
 it("switches colors without retaining photos from the previous color",()=>{expect(productPhotos(product(),{color:"Preto"})).toEqual(["black","general"]);});
 it("can use existing combination photos without option images",()=>{const p=product();p.options[0].images=undefined;expect(productPhotos(p,{color:"Cinza"})[0]).toBe("gray-p");});
 it("falls back to the main photo when no selected photo exists",()=>{const p=product({variants:[]});p.options[0].images=undefined;expect(productPhotos(p,{color:"Preto"})[0]).toBe("gray");});
 it("has no fabricated photos for an empty gallery",()=>{expect(productPhotos(product({imageUrls:[],media:[],options:[],variants:[]}))).toEqual([]);});
 it("keeps a single photo singular, even if linked multiple times",()=>{expect(productPhotos(product({imageUrls:["black"],media:[{url:"black",alt:""}],options:[{key:"color",name:"Cor",values:["Preto"],images:{Preto:"black"}}],variants:[]}))).toEqual(["black"]);});
 it("finds alt text by URL after reordering",()=>{expect(productPhotoAlt(product(),"general",0)).toBe("Detalhe do tecido");expect(productPhotoAlt(product(),"black",1)).toBe("Camisa — foto 2");});
 it("recognizes colors without swatch metadata and other custom visual options",()=>{expect(isColorOption({key:"color",name:"Cor",values:["Preto"]})).toBe(true);expect(isColorOption({key:"finish",name:"Acabamento",values:["Azul"],swatches:{Azul:"#00f"}})).toBe(true);expect(isColorOption({key:"size",name:"Tamanho",values:["P"]})).toBe(false);});
 it("does not mutate catalog, inventory, price or variant selection",()=>{const p=product();const before=structuredClone(p);productPhotos(p,{color:"Cinza",size:"P"});expect(p).toEqual(before);});
});
