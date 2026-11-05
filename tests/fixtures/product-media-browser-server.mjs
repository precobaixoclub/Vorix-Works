// Local read-only fixture. No database, authentication or production service is used.
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import sharp from "sharp";
const templates=JSON.parse(await readFile(new URL("../../web/features/sites/template-registry.generated.json",import.meta.url),"utf8"));
const origin="http://127.0.0.1:3394";
const colors={Cinza:"#a7a9ab",Preto:"#25282b",Verde:"#637956",Azul:"#284561",Areia:"#d7bd94",Marrom:"#845a44",Branco:"#f2f0e9"};
const photo=name=>`${origin}/photos/${name}.webp`;
const colorImages=Object.fromEntries(Object.keys(colors).map((name,index)=>[name,photo(`color-${index}`)]));
const general=photo("general"),combination=photo("combination");
const base={type:"APPAREL",description:"Algodão, conforto e opções para todos os dias. Imagens e produtos fictícios para revisão local.",priceCents:6000,currency:"BRL",categoryId:"clothes",attributes:{material:"100% algodão"},attributeLabels:{material:"Material"},seo:{},canPurchaseOnline:false,availableQuantity:25,variants:[],options:[]};
const shirt={...base,id:"shirt",slug:"camisa",name:"Camisa essencial",sku:"000001",imageUrls:[...Object.values(colorImages),general],media:[{url:general,alt:"Vista geral do acabamento da camisa"}],options:[{key:"size",name:"Tamanho",values:["P","M","G","GG","XG","XGG"]},{key:"color",name:"Cor",values:Object.keys(colors),swatches:colors,images:colorImages}],variants:Object.keys(colors).flatMap(color=>["P","M","G","GG","XG","XGG"].map(size=>({id:`${color}-${size}`,name:`${color} / ${size}`,optionValues:{color,size},priceCents:6000,availableQuantity:4,...(color==="Cinza"&&size==="P"?{imageUrl:combination}:{})}))) };
const single={...base,id:"single",slug:"camisa-verde",name:"Camisa verde",imageUrls:[colorImages.Verde],media:[],options:[{key:"color",name:"Cor",values:["Verde"],swatches:{Verde:colors.Verde},images:{Verde:colorImages.Verde}}]};
const landscape={...base,type:"GENERAL",id:"landscape",slug:"horizontal",name:"Produto horizontal",imageUrls:[photo("landscape")],media:[]};
const square={...base,type:"GENERAL",id:"square",slug:"quadrado",name:"Produto quadrado",imageUrls:[photo("square"),photo("landscape")],media:[],options:[{key:"capacity",name:"Capacidade",values:["250 ml","500 ml"]}]};
const empty={...base,type:"GENERAL",id:"empty",slug:"sem-foto",name:"Produto sem foto",imageUrls:[],media:[]};
function site(template){return {id:`media-${template.id}`,slug:`media-${template.id}`,theme:{...template.defaultTheme,catalog:{...template.defaultTheme.catalog,showSearch:true,showFilters:true}},layoutConfig:{heroVariant:"compact",productGallery:"split",featuredProductId:"shirt"},content:{name:"Essencial",description:"Revisão de imagens e variações",seo:{title:"Essencial — revisão local",description:"Catálogo fictício"},footer:"Feito para o seu dia.",socials:[],pages:[],contactForm:false,header:{showSearch:true,sticky:false,navigation:[{id:"catalog",label:"Produtos",url:"#catalogo",enabled:true,newTab:false}]},blocks:[{id:"hero",type:"hero",enabled:true,title:"O essencial, em cada cor.",text:"Escolha sua próxima favorita.",imageAlt:"Camisa essencial",productIds:[],items:[],buttonLabel:"Ver coleção",buttonUrl:"#catalogo"},{id:"catalog",type:"catalog",enabled:true,eyebrow:"NOSSA SELEÇÃO",title:"Encontre a sua combinação",text:"Explore as fotos e descubra as opções.",imageAlt:"",items:[],productIds:[]}]},products:[shirt,single,landscape,square,empty],categories:[{id:"clothes",name:"Vestuário",slug:"vestuario",position:0}],brands:[],commerceEnabled:false};}
const cache=new Map();
async function image(name){
 if(cache.has(name))return cache.get(name);
 const horizontal=name==="landscape",square=name==="square",w=horizontal?1200:square?800:700,h=horizontal?600:square?800:1000;
 const index=Number(name.split("-")[1]??0),color=Object.values(colors)[index]??colors.Cinza;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f4f2ec"/><rect x="4" y="4" width="${w-8}" height="${h-8}" rx="12" stroke="#d7d2c8" stroke-width="8" fill="none"/><g transform="translate(${(w-700)/2} ${(h-840)/2})"><ellipse cx="350" cy="730" rx="180" ry="20" fill="#000" opacity=".07"/><path d="M260 180L175 210 90 350 180 406 220 340 220 690Q350 725 480 690L480 340 520 406 610 350 525 210 440 180Q350 225 260 180Z" fill="${horizontal?"#c78e71":color}"/><path d="M290 198Q350 285 410 198" fill="none" stroke="#fff" stroke-width="10" opacity=".55"/><path d="M235 670Q350 695 465 670" stroke="#fff" stroke-width="3" fill="none" opacity=".4"/><text x="350" y="390" font-family="sans-serif" font-size="${name==="combination"?24:18}" letter-spacing="3" text-anchor="middle" fill="${index===1?"#fff":"#354438"}">${name==="combination"?"CINZA / P":"ESSENCIAL"}</text></g><text x="${w/2}" y="${h-27}" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#655e52">${name==="general"?"ACABAMENTO · FOTO GERAL":horizontal?"FORMATO HORIZONTAL":square?"FORMATO QUADRADO":"COLEÇÃO ESSENCIAL"}</text></svg>`;
 const buffer=await sharp(Buffer.from(svg)).webp({quality:80}).toBuffer();cache.set(name,buffer);return buffer;
}
createServer(async(req,res)=>{
 const url=new URL(req.url,origin);
 res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Content-Type","application/json");
 if(url.pathname==="/health"){res.end('{"fixtureOnly":true}');return;}
 if(url.pathname.startsWith("/photos/")){res.setHeader("Content-Type","image/webp");res.setHeader("Cache-Control","public,max-age=3600");res.end(await image(url.pathname.split("/").pop().replace(".webp","")));return;}
 if(url.pathname==="/v1/public/sites/bambilu-kids"){
  const payload=site(templates.find(template=>template.id==="nexus"));
  payload.slug="bambilu-kids";payload.content.name="Bambilu Kids";payload.categories=[];
  payload.content.blocks[0].title="Boas escolhas começam por aqui.";
  payload.content.contactForm=true;payload.content.blocks.push({id:"contact",type:"contact",title:"Vamos conversar?",text:"",imageAlt:"",enabled:true,productIds:[],items:[]});
  payload.commerce={mode:"SHOWCASE",cartEnabled:false,whatsappEnabled:false,checkoutAvailable:false,showcaseCta:"Tenho interesse"};
  payload.products[0]={...payload.products[0],commerce:{saleMode:"SHOW_ONLY",requestedSaleMode:"INHERIT_SITE_DEFAULT",allowedActions:["inquiry"],ctaLabel:"Tenho interesse",availability:"untracked",checkoutAvailable:false},quantityOffers:[{id:"fixture-rule",name:"Preço progressivo",count:"ELIGIBLE",currency:"BRL",tiers:[{minimum:1,maximum:2,unitPriceCents:6000},{minimum:3,maximum:4,unitPriceCents:5500},{minimum:5,unitPriceCents:5000}]}]};
  payload.products[0].options=payload.products[0].options.map(option=>({...option,...(option.swatches?{swatches:Object.fromEntries(Object.entries(option.swatches).filter(([name])=>name!=="Preto"))}:{})}));
  res.end(JSON.stringify({ok:true,data:payload}));return;
 }
 const match=url.pathname.match(/^\/v1\/public\/sites\/media-([^/]+)(?:\/(.*))?$/),template=templates.find(template=>template.id===match?.[1]);
 if(template){const payload=site(template);if(url.searchParams.get("path")==="produto/album")payload.products.push({...landscape,id:"album",slug:"album",name:"Galeria extensa",imageUrls:Array.from({length:24},(_,i)=>photo(`album-${i}`))});res.end(JSON.stringify({ok:true,data:match[2]?{}:payload}));return;}
 res.statusCode=404;res.end('{"ok":false}');
}).listen(3394,"127.0.0.1",()=>console.log("PRODUCT_MEDIA_FIXTURE_READY http://127.0.0.1:3394"));
