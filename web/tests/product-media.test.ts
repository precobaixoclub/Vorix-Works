import {describe,expect,it} from "vitest";
import {isColorOption,productPhotoAlt,productPhotos,productOptionPhoto} from "@/features/sites/product-media";
import type {PublicSiteProduct} from "@/features/sites/types";

const product=(patch:Partial<PublicSiteProduct>={}):PublicSiteProduct=>({id:"shirt",slug:"shirt",type:"APPAREL",name:"Camisa",priceCents:6000,currency:"BRL",imageUrls:["gray","black","general"],media:[{url:"general",alt:"Detalhe do tecido"}],attributes:{},options:[{key:"color",name:"Cor",values:["Cinza","Preto"],images:{Cinza:"gray",Preto:"black"}},{key:"size",name:"Tamanho",values:["P","M"]}],seo:{},canPurchaseOnline:false,variants:[{id:"gp",name:"Cinza P",optionValues:{color:"Cinza",size:"P"},priceCents:6000,imageUrl:"gray-p"},{id:"gm",name:"Cinza M",optionValues:{color:"Cinza",size:"M"},priceCents:6000},{id:"bp",name:"Preto P",optionValues:{color:"Preto",size:"P"},priceCents:6000}],...patch});
describe("public product photo ordering",()=>{
 it("includes option and combination photos in the initial gallery without duplicates",()=>{expect(productPhotos(product())).toEqual(["gray","black","general","gray-p"]);});
 it("a choice with 2+ photos of its own shows only those: the combination, then its color",()=>{expect(productPhotos(product(),{color:"Cinza",size:"P"})).toEqual(["gray-p","gray"]);});
 it("a choice with a single photo shows it first, then the rest of the product to swipe through",()=>{expect(productPhotos(product(),{color:"Preto",size:"P"})).toEqual(["black","gray","general","gray-p"]);});
 it("partial color selection with several photos stays on that color",()=>{expect(productPhotos(product(),{color:"Cinza"})).toEqual(["gray","gray-p"]);});
 it("switching color leads with the new color's photo",()=>{expect(productPhotos(product(),{color:"Preto"})[0]).toBe("black");});
 it("a color with front and back shows only its own photos, in order",()=>{const p=product({imageUrls:["brown-f","black-f","brown-b","black-b"],media:[]});p.options[0]={key:"color",name:"Cor",values:["Marrom","Preto"],images:{Marrom:"brown-f",Preto:"black-f"},extraImages:{Marrom:["brown-b"],Preto:["black-b"]}};p.variants=[];
  expect(productPhotos(p)).toEqual(["brown-f","black-f","brown-b","black-b"]);
  expect(productPhotos(p,{color:"Preto"})).toEqual(["black-f","black-b"]);
  expect(productPhotos(p,{color:"Marrom",size:"M"})).toEqual(["brown-f","brown-b"]);});
 it("can use existing combination photos without option images",()=>{const p=product();p.options[0].images=undefined;expect(productPhotos(p,{color:"Cinza"})[0]).toBe("gray-p");});
 it("falls back to the main photo when no selected photo exists",()=>{const p=product({variants:[]});p.options[0].images=undefined;expect(productPhotos(p,{color:"Preto"})[0]).toBe("gray");});
 it("has no fabricated photos for an empty gallery",()=>{expect(productPhotos(product({imageUrls:[],media:[],options:[],variants:[]}))).toEqual([]);});
 it("keeps a single photo singular, even if linked multiple times",()=>{expect(productPhotos(product({imageUrls:["black"],media:[{url:"black",alt:""}],options:[{key:"color",name:"Cor",values:["Preto"],images:{Preto:"black"}}],variants:[]}))).toEqual(["black"]);});
 it("finds alt text by URL after reordering",()=>{expect(productPhotoAlt(product(),"general",0)).toBe("Detalhe do tecido");expect(productPhotoAlt(product(),"black",1)).toBe("Camisa — foto 2");});
 it("recognizes colors without swatch metadata and other custom visual options",()=>{expect(isColorOption({key:"color",name:"Cor",values:["Preto"]})).toBe(true);expect(isColorOption({key:"finish",name:"Acabamento",values:["Azul"],swatches:{Azul:"#00f"}})).toBe(true);expect(isColorOption({key:"size",name:"Tamanho",values:["P"]})).toBe(false);});
 it("does not mutate catalog, inventory, price or variant selection",()=>{const p=product();const before=structuredClone(p);productPhotos(p,{color:"Cinza",size:"P"});expect(p).toEqual(before);});
 it("color thumbnails use the linked color and the exact combination once a size is selected",()=>{const p=product(),option=p.options[0];expect(productOptionPhoto(p,option,"Cinza")).toBe("gray");expect(productOptionPhoto(p,option,"Cinza",{size:"P"})).toBe("gray-p");expect(productOptionPhoto(p,option,"Preto",{size:"P"})).toBe("black");});
 it("color thumbnails can use variant photos but never borrow another color's gallery image",()=>{const p=product();p.options[0].images=undefined;expect(productOptionPhoto(p,p.options[0],"Cinza")).toBe("gray-p");expect(productOptionPhoto(p,p.options[0],"Preto")).toBeUndefined();});
 it("preview resolution does not change the selected values or catalog",()=>{const p=product(),choice={size:"P",color:"Preto"},before=structuredClone(p);productOptionPhoto(p,p.options[0],"Cinza",choice);expect(choice).toEqual({size:"P",color:"Preto"});expect(p).toEqual(before);});
});
