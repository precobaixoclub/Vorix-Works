"use client";
import type {CSSProperties,MouseEvent} from "react";
import {ArrowRight} from "lucide-react";
import type {PublicTenantSite} from "@/features/sites/types";
import {categoryPath,rootCategoryId,topLevelCategories} from "@/features/sites/site-categories";

/** Fired by the category chooser; the catalog on the page switches without reloading. */
export const SITE_CATEGORY_EVENT="vorix:site-category";

/** A plain left click we can take over (new tab, middle click etc. keep the real link). */
const plainClick=(event:MouseEvent<HTMLAnchorElement>)=>!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey;

/**
 * "Todos · Feminino · Masculino" above the catalog. Each tab is a real link to the category page,
 * so it can be shared and indexed; with `onSelect` the catalog switches in place instead (it returns
 * false to let the link navigate). Shown only when the store has two or more main categories.
 */
export function SiteCategoryTabs({site,basePath,activeId,onSelect}:{site:PublicTenantSite;basePath:string;activeId?:string;onSelect?:(categoryId:string)=>boolean}){
 const main=topLevelCategories(site.categories);
 if(main.length<2)return null;
 const active=rootCategoryId(site.categories,activeId);
 const pick=(event:MouseEvent<HTMLAnchorElement>,id:string)=>{if(onSelect&&plainClick(event)&&onSelect(id))event.preventDefault();};
 return <nav className="ts-category-tabs" aria-label="Categorias">
  <a href={`${basePath||"/"}#catalogo`} aria-current={!active?"page":undefined} onClick={event=>pick(event,"")}>Todos</a>
  {main.map(category=><a key={category.id} href={`${basePath}${categoryPath(category.slug)}`} aria-current={active===category.id?"page":undefined} onClick={event=>pick(event,category.id)}>{category.name}</a>)}
 </nav>;
}

export const hasCategoryTabs=(site:PublicTenantSite)=>topLevelCategories(site.categories).length>=2;

/** The category's own picture, or the first product photo found in it. */
function categoryPicture(site:PublicTenantSite,categoryId:string,imageUrl?:string){
 return imageUrl??site.products.find(product=>product.imageUrls[0]&&rootCategoryId(site.categories,product.categoryId)===categoryId)?.imageUrls[0];
}

/**
 * Big "Feminino | Masculino" tiles right after the home banner, so the visitor picks a side the
 * moment the site opens. On the home page it switches the catalog below and scrolls to it; the
 * link still opens the category page in a new tab or without JavaScript.
 */
export function CategoryChooser({site,basePath}:{site:PublicTenantSite;basePath:string}){
 const main=topLevelCategories(site.categories).slice(0,4);
 if(main.length<2)return null;
 const choose=(event:MouseEvent<HTMLAnchorElement>,id:string)=>{
  const catalog=event.currentTarget.ownerDocument.getElementById("catalogo");
  if(!catalog||!plainClick(event))return;
  event.preventDefault();
  window.dispatchEvent(new CustomEvent(SITE_CATEGORY_EVENT,{detail:id}));
  catalog.scrollIntoView({behavior:"smooth",block:"start"});
 };
 return <section className="ts-chooser" aria-label="Escolha a coleção"><div className="ts-container">
  <p className="ts-chooser-kicker">Escolha sua coleção</p>
  <div className="ts-chooser-grid" style={{"--chooser-count":main.length} as CSSProperties}>
   {main.map((category,index)=>{const picture=categoryPicture(site,category.id,category.imageUrl);return <a key={category.id} className="ts-chooser-card" href={`${basePath}${categoryPath(category.slug)}`} onClick={event=>choose(event,category.id)}>
    {picture?<img src={picture} alt="" loading={index<2?"eager":"lazy"} decoding="async"/>:null}
    <span className="ts-chooser-shade" aria-hidden="true"/>
    <span className="ts-chooser-copy"><small>Coleção</small><strong>{category.name}</strong><span className="ts-chooser-cta">Ver {category.name.toLowerCase()} <ArrowRight size={16} aria-hidden="true"/></span></span>
   </a>;})}
  </div>
 </div></section>;
}

export const CATEGORY_TAB_STYLES=String.raw`
.ts-category-tabs{display:flex;gap:8px;overflow-x:auto;margin:0 0 22px;padding:2px 0 6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.ts-category-tabs::-webkit-scrollbar{display:none}
.ts-category-tabs a{flex:0 0 auto;display:inline-flex;align-items:center;min-height:44px;padding:0 22px;border:1px solid var(--site-line);border-radius:999px;color:var(--site-fg);font-size:15px;font-weight:600;text-decoration:none;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.ts-category-tabs a:hover{border-color:var(--site-primary)}
.ts-category-tabs a[aria-current="page"]{background:var(--site-primary);border-color:var(--site-primary);color:var(--site-on-primary)}
.ts-category-tabs a:focus-visible{outline:2px solid var(--site-primary);outline-offset:2px}
.ts-nav-category{font-weight:600}
.ts-catalog-page-title{margin-bottom:26px}
.ts-product-grid[data-loading="true"]{opacity:.55;transition:opacity .15s}
.ts-chooser{padding-block:clamp(28px,4.5vw,64px)}
.ts-chooser-kicker{margin:0 0 18px;text-align:center;font-size:.74em;font-weight:600;letter-spacing:.2em;text-transform:uppercase;opacity:.6}
.ts-chooser-grid{display:grid;grid-template-columns:repeat(var(--chooser-count,2),minmax(0,1fr));gap:clamp(10px,1.6vw,22px)}
.ts-chooser-card{position:relative;isolation:isolate;display:block;overflow:hidden;aspect-ratio:4/5;max-height:640px;border-radius:var(--site-radius);background:linear-gradient(140deg,var(--site-primary),var(--site-fg));color:#fff;text-decoration:none}
.ts-chooser-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .8s cubic-bezier(.2,.7,.2,1)}
.ts-chooser-card:hover img{transform:scale(1.05)}
.ts-chooser-shade{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(0,0,0,0) 38%,rgba(0,0,0,.72) 100%)}
.ts-chooser-copy{position:absolute;inset:auto 0 0 0;z-index:2;display:grid;justify-items:start;gap:6px;padding:clamp(16px,3vw,38px)}
.ts-chooser-copy small{font-size:.7em;font-weight:600;letter-spacing:.22em;text-transform:uppercase;opacity:.85}
.ts-chooser-copy strong{font:var(--site-heading-weight,600) clamp(1.75em,4.6vw,3.8em)/1 var(--site-heading-font);letter-spacing:-.035em;text-shadow:0 2px 24px rgba(0,0,0,.25)}
.ts-chooser-cta{display:inline-flex;align-items:center;gap:8px;margin-top:10px;padding:11px 20px;border-radius:999px;background:#fff;color:#111;font-size:.8em;font-weight:600;transition:gap .2s}
.ts-chooser-card:hover .ts-chooser-cta{gap:13px}
.ts-chooser-card:focus-visible{outline:3px solid var(--site-primary);outline-offset:3px}
@media(max-width:640px){.ts-chooser-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ts-chooser-card{aspect-ratio:3/4}.ts-chooser-cta{padding:8px 12px;font-size:.72em}.ts-chooser-cta svg{display:none}}
@media(prefers-reduced-motion:reduce){.ts-chooser-card img,.ts-chooser-cta,.ts-product-grid[data-loading="true"]{transition:none}}
`;
