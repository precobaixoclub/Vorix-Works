import type {PublicTenantSite, SiteTheme} from "./types";

/** Presentation only: the published catalog and commerce settings remain authoritative. */
export function isFashionKidsSite(site: Pick<PublicTenantSite, "slug" | "theme">) {
  return site.slug === "bambilu-kids" && site.theme.template === "nexus";
}

/** The catalog can omit hex values for basic names. This changes the preview dot only. */
export function fashionColorSwatch(value: string) {
  const basic: Record<string, string> = {preto: "#252825", black: "#252825", branco: "#FFFFFF", white: "#FFFFFF"};
  return basic[value.toLocaleLowerCase("pt-BR").trim()];
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
