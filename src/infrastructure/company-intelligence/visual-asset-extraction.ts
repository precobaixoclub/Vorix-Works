import * as cheerio from "cheerio";
import type { VisualIdentity } from "../../domain/company-intelligence/company-intelligence.model.js";

/**
 * Extração de identidade visual a partir do HTML (seção 5): logos/ícones/cores/fontes/imagens
 * publicamente referenciadas na página. Não baixa nenhum arquivo — apenas coleta URLs e
 * metadados; o download real (quando necessário) é responsabilidade do chamador, que decide se
 * quer persistir os bytes na Media Library (seção 9).
 */

export type DiscoveredImage = { url: string; alt: string; likelyLogo: boolean };

const HEX_COLOR_REGEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
const LOGO_HINTS = ["logo", "brand", "mark", "marca"];

export function extractImages(html: string, baseUrl: string): DiscoveredImage[] {
  const $ = cheerio.load(html);
  const images: DiscoveredImage[] = [];
  const seen = new Set<string>();

  $("img").each((_, el) => {
    const rawSrc = $(el).attr("src") ?? $(el).attr("data-src");
    if (!rawSrc) return;
    let resolved: string;
    try {
      resolved = new URL(rawSrc, baseUrl).toString();
    } catch {
      return;
    }
    if (seen.has(resolved)) return;
    seen.add(resolved);

    const alt = ($(el).attr("alt") ?? "").trim();
    const haystack = `${resolved} ${alt}`.toLowerCase();
    images.push({ url: resolved, alt, likelyLogo: LOGO_HINTS.some((hint) => haystack.includes(hint)) });
  });

  return images;
}

export function extractVisualIdentity(html: string, baseUrl: string): VisualIdentity {
  const $ = cheerio.load(html);
  const images = extractImages(html, baseUrl);

  const logoUrls = images.filter((img) => img.likelyLogo).map((img) => img.url);

  const iconUrls: string[] = [];
  $("link[rel*='icon' i]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      iconUrls.push(new URL(href, baseUrl).toString());
    } catch {
      // ignora href inválido
    }
  });

  const colorSet = new Set<string>();
  const themeColor = $("meta[name='theme-color' i]").attr("content");
  if (themeColor) colorSet.add(themeColor.toLowerCase());
  $("style").each((_, el) => {
    const css = $(el).html() ?? "";
    for (const match of css.match(HEX_COLOR_REGEX) ?? []) colorSet.add(match.toLowerCase());
  });
  $("[style]").each((_, el) => {
    const style = $(el).attr("style") ?? "";
    for (const match of style.match(HEX_COLOR_REGEX) ?? []) colorSet.add(match.toLowerCase());
  });
  const colors = Array.from(colorSet);

  const fontSet = new Set<string>();
  $("style").each((_, el) => {
    const css = $(el).html() ?? "";
    const fontMatches = css.matchAll(/font-family:\s*([^;}\n]+)/gi);
    for (const match of fontMatches) {
      const primary = match[1].split(",")[0].trim().replace(/["']/g, "");
      if (primary) fontSet.add(primary);
    }
  });
  $("link[href*='fonts.google' i], link[href*='fonts.' i]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const familyMatch = href.match(/family=([^&:]+)/);
    if (familyMatch) fontSet.add(decodeURIComponent(familyMatch[1]).replace(/\+/g, " "));
  });

  return {
    logoUrls,
    iconUrls: Array.from(new Set(iconUrls)),
    primaryColors: colors.slice(0, 6),
    secondaryColors: colors.slice(6, 12),
    fontFamilies: Array.from(fontSet),
  };
}

export function mergeVisualIdentities(identities: VisualIdentity[]): VisualIdentity {
  const merge = (values: string[][]) => Array.from(new Set(values.flat()));
  return {
    logoUrls: merge(identities.map((identity) => identity.logoUrls)),
    iconUrls: merge(identities.map((identity) => identity.iconUrls)),
    primaryColors: merge(identities.map((identity) => identity.primaryColors)).slice(0, 6),
    secondaryColors: merge(identities.map((identity) => identity.secondaryColors)).slice(0, 6),
    fontFamilies: merge(identities.map((identity) => identity.fontFamilies)),
  };
}
