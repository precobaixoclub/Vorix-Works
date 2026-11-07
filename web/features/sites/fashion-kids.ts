import type {PublicTenantSite, SiteTheme, SiteBlock} from "./types";

export const FASHION_EDITORIAL_ID="fashion-editorial-default";
export function fashionEditorialDefaults():SiteBlock {
 return {id:FASHION_EDITORIAL_ID,type:"image_text",enabled:true,title:"Para brincar, descobrir e crescer.",eyebrow:"O NOSSO OLHAR",text:"A infância acontece nos pequenos momentos. Nas cores preferidas, nas novas descobertas e na liberdade de ser quem se é.",buttonLabel:"Encontre sua próxima escolha",buttonUrl:"#catalogo",imageAlt:"",productIds:[],items:[]};
}

/** Presentation only: the published catalog and commerce settings remain authoritative. */
export function isFashionKidsSite(site: Pick<PublicTenantSite, "slug"> & {theme: Pick<SiteTheme, "template"|"storefrontVariant">}) {
  return (site.slug === "bambilu-kids" || site.theme.storefrontVariant === "fashion-kids") && site.theme.template === "nexus";
}

export function fashionKidsTheme(theme: SiteTheme): SiteTheme {
  return {
    ...theme,
    background: "#FBFAF7", foreground: "#26382F", surface: "#F1F0EA",
    primary: theme.primary, secondary: "#637366", headerBackground: "#FBFAF7",
    footerBackground: "#EAEDE5", footerForeground: "#26382F",
    headingFont: "editorial", bodyFont: "modern", buttonStyle: "square",
    rounded: false, contentWidth: "standard", sectionSpacing: "spacious",
    catalog: {...theme.catalog!, columns: 4, mobileColumns: 2, imageRatio: "portrait", cardStyle: "minimal"},
  };
}
