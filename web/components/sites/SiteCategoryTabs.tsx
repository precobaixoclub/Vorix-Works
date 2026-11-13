import type {PublicTenantSite} from "@/features/sites/types";
import {categoryPath,rootCategoryId,topLevelCategories} from "@/features/sites/site-categories";

/**
 * "Todos · Feminino · Masculino" above the catalog. Each tab is a real link to the category page,
 * so it can be shared and indexed. Shown only when the store has two or more main categories.
 */
export function SiteCategoryTabs({site,basePath,activeId}:{site:PublicTenantSite;basePath:string;activeId?:string}){
 const main=topLevelCategories(site.categories);
 if(main.length<2)return null;
 const active=rootCategoryId(site.categories,activeId);
 return <nav className="ts-category-tabs" aria-label="Categorias">
  <a href={`${basePath||"/"}#catalogo`} aria-current={!active?"page":undefined}>Todos</a>
  {main.map(category=><a key={category.id} href={`${basePath}${categoryPath(category.slug)}`} aria-current={active===category.id?"page":undefined}>{category.name}</a>)}
 </nav>;
}

export const hasCategoryTabs=(site:PublicTenantSite)=>topLevelCategories(site.categories).length>=2;

export const CATEGORY_TAB_STYLES=String.raw`
.ts-category-tabs{display:flex;gap:8px;overflow-x:auto;margin:0 0 22px;padding:2px 0 6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.ts-category-tabs::-webkit-scrollbar{display:none}
.ts-category-tabs a{flex:0 0 auto;display:inline-flex;align-items:center;min-height:42px;padding:0 20px;border:1px solid var(--site-line);border-radius:999px;color:var(--site-fg);font-size:15px;font-weight:600;text-decoration:none;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.ts-category-tabs a:hover{border-color:var(--site-primary)}
.ts-category-tabs a[aria-current="page"]{background:var(--site-primary);border-color:var(--site-primary);color:var(--site-on-primary)}
.ts-category-tabs a:focus-visible{outline:2px solid var(--site-primary);outline-offset:2px}
.ts-nav-category{font-weight:600}
`;
