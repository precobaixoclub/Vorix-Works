import type {PublicTenantSite} from "./types";

type SiteCategory=PublicTenantSite["categories"][number];
type NavLink={url:string};

/** Main categories of the store (no visible parent), in the order set on the products screen. */
export function topLevelCategories(categories:readonly SiteCategory[]):SiteCategory[]{
 const ids=new Set(categories.map(category=>category.id));
 return categories.filter(category=>!category.parentId||!ids.has(category.parentId))
  .sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name,"pt-BR"));
}

/** The main category a category belongs to (itself when it is already a main one). */
export function rootCategoryId(categories:readonly SiteCategory[],id:string|undefined):string|undefined{
 const seen=new Set<string>();let current=categories.find(category=>category.id===id);
 while(current?.parentId&&!seen.has(current.id)){seen.add(current.id);const parent=categories.find(category=>category.id===current!.parentId);if(!parent)break;current=parent;}
 return current?.id;
}

export const categoryPath=(slug:string)=>`/categoria/${slug}`;

/** Menu entries for the main categories, skipping any the owner already put in the menu by hand. */
export function categoryMenuLinks(categories:readonly SiteCategory[],navigation:readonly NavLink[],limit=6):SiteCategory[]{
 const linked=new Set(navigation.map(link=>link.url.replace(/\/+$/,"")));
 return topLevelCategories(categories).filter(category=>!linked.has(categoryPath(category.slug))).slice(0,limit);
}
