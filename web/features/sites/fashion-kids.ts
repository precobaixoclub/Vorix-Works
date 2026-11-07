import type {PublicTenantSite, SiteTheme} from "./types";

/** Presentation only: the published catalog and commerce settings remain authoritative. */
export function isFashionKidsSite(site: Pick<PublicTenantSite, "slug"> & {theme: Pick<SiteTheme, "template">}) {
  return site.slug === "bambilu-kids" && site.theme.template === "nexus";
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
