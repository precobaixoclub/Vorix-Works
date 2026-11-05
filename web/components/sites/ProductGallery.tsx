"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {ChevronLeft,ChevronRight,Package} from "lucide-react";
import type {PublicSiteProduct} from "@/features/sites/types";
import {productPhotoAlt,productPhotos} from "@/features/sites/product-media";
import {thumbUrl} from "@/lib/media";

export function ProductGallery({product,selected={},card=false,href,children}:{product:PublicSiteProduct;selected?:Record<string,string>;card?:boolean;href?:string;children?:ReactNode}){
 const photos=productPhotos(product,selected);
 // Remount navigation only when the product or its photo selection changes. A thumbnail
 // and the arrows always own the visible photo, even while a variant is selected.
 return <Gallery key={JSON.stringify([product.id,photos])} product={product} photos={photos} card={card} href={href}>{children}</Gallery>;
}
function Gallery({product,photos,card,href,children}:{product:PublicSiteProduct;photos:string[];card:boolean;href?:string;children?:ReactNode}){
 const [index,setIndex]=useState(0),[interacted,setInteracted]=useState(false);
 const gesture=useRef<{id:number;x:number;y:number;swiped:boolean}|null>(null),suppressClick=useRef(false);
 const thumbs=useRef<HTMLDivElement>(null),multiple=photos.length>1;
 const move=(delta:number)=>{setInteracted(true);setIndex(value=>(value+delta+photos.length)%photos.length);};
 useEffect(()=>{
  if(!multiple||!interacted)return;
  const next=new Image();next.src=card?thumbUrl(photos[(index+1)%photos.length],960):photos[(index+1)%photos.length];
 },[index,interacted,multiple,photos,card]);
 useEffect(()=>{
  const thumbnail=thumbs.current?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`);
  if(thumbnail&&thumbs.current){const row=thumbs.current;row.scrollLeft=Math.max(0,thumbnail.offsetLeft-row.offsetLeft-(row.clientWidth-thumbnail.clientWidth)/2);}
 },[index]);
 const url=photos[index],cardSource=card?thumbUrl(url,480):url;
 const srcSet=card&&cardSource!==url?`${cardSource} 480w, ${thumbUrl(url,960)} 960w`:undefined;
 const image=url?<img className="sp-photo" src={cardSource} srcSet={srcSet} sizes={srcSet?"(max-width: 700px) 100vw, (max-width: 1000px) 50vw, 900px":undefined} alt={productPhotoAlt(product,url,index)} width={800} height={1000} loading={card?"lazy":"eager"} decoding="async" draggable={false}/>:<div className="sp-empty"><Package aria-hidden="true"/><span>{product.name}</span></div>;
 return <div className={`sp-gallery ${card?"sp-card-gallery":"sp-detail-gallery"}`} data-product-gallery={card?"card":"detail"}>
  <div className="sp-stage" role={multiple?"group":undefined} aria-roledescription={multiple?"carrossel":undefined} aria-label={multiple?`Fotos de ${product.name}`:undefined} tabIndex={multiple?0:undefined}
   onKeyDown={event=>{if(event.target!==event.currentTarget||!multiple)return;if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();event.stopPropagation();move(event.key==="ArrowLeft"?-1:1);}}}
   onPointerDown={event=>{suppressClick.current=false;if(!multiple||!event.isPrimary||event.button!==0||(event.target as HTMLElement).closest("button"))return;gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,swiped:false};}}
   onPointerMove={event=>{const start=gesture.current;if(!start||event.pointerId!==start.id||start.swiped)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;if(Math.abs(dy)>24&&Math.abs(dy)>Math.abs(dx)){gesture.current=null;return;}if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.3){start.swiped=true;suppressClick.current=true;event.currentTarget.setPointerCapture(event.pointerId);move(dx<0?1:-1);}}}
   onPointerUp={()=>{gesture.current=null;}} onPointerCancel={()=>{gesture.current=null;}}
   onClickCapture={event=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=false;}}}>
   {href?<a className="sp-image-link" href={href} tabIndex={-1} aria-label={`Ver ${product.name}`}>{image}</a>:image}
   {children}
   {multiple?<><button type="button" className="sp-arrow sp-prev" aria-label="Foto anterior" onClick={event=>{event.preventDefault();event.stopPropagation();move(-1);}}><ChevronLeft size={20} aria-hidden="true"/></button><button type="button" className="sp-arrow sp-next" aria-label="Próxima foto" onClick={event=>{event.preventDefault();event.stopPropagation();move(1);}}><ChevronRight size={20} aria-hidden="true"/></button><span className="sp-counter" aria-live={interacted?"polite":"off"} aria-atomic="true">{index+1} / {photos.length}</span></>:null}
  </div>
  {!card&&multiple?<div className="sp-thumbnails" ref={thumbs} aria-label="Miniaturas do produto">{photos.map((url,i)=><button type="button" key={url} data-index={i} aria-label={`Ver foto ${i+1}`} aria-pressed={i===index} onClick={()=>{setIndex(i);setInteracted(true);}}><Thumbnail url={url} alt={productPhotoAlt(product,url,i)}/></button>)}</div>:null}
 </div>;
}

// Native image lazy loading eagerly fetches distant horizontal thumbnails in some
// browsers. Only attach a source once a thumbnail approaches its own scroll row.
function Thumbnail({url,alt}:{url:string;alt:string}){
 const ref=useRef<HTMLImageElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const node=ref.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{root:node.closest(".sp-thumbnails"),rootMargin:"80px"});observer.observe(node);return()=>observer.disconnect();},[]);
 return <img ref={ref} src={visible?thumbUrl(url,160):undefined} alt={alt} width={64} height={80} loading="lazy" decoding="async"/>;
}
