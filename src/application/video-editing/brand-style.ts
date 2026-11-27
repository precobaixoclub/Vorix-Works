/**
 * Perfil da Marca (identidade estruturada) → estilo do vídeo. Puro.
 * Cores por papel, família tipográfica, tom e a versão de logo certa para o fundo do cartão final.
 * Sem perfil cadastrado: estilo neutro (nunca inventa uma identidade).
 */

import type { CreativeBrandIdentity } from "../../shared/utils/brand-identity.js";
import { selectBrandLogoForSurface } from "../../shared/utils/brand-identity.js";
import type { BrandStyle } from "./build-plan-from-draft.js";
import type { BrandGlossary } from "./transcript-tools.js";

const NEUTRAL: Omit<BrandStyle, "name"> = { primaryHex: "#1F2937", accentHex: "#2563EB", lightHex: "#F5F5F4", darkHex: "#111111" };

const STYLE_TONE: Record<string, string> = {
  MINIMAL: "minimalista", PREMIUM: "premium", EDITORIAL: "editorial", BOLD: "ousada", TECH: "tecnológica", ORGANIC: "orgânica", LUXURY: "luxuosa", PLAYFUL: "descontraída", CORPORATE: "corporativa",
};

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export type VideoBrandResolution = { style: BrandStyle; logo?: { url: string; assetId: string } };

export function videoBrandStyle(input: { brandName: string; toneOfVoice?: string; identity?: CreativeBrandIdentity }): VideoBrandResolution {
  const identity = input.identity?.identity;
  const valid = (hex: string | undefined) => (hex && /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex.toUpperCase() : undefined);
  const byRole = (role: string) => identity?.colors.filter((color) => color.role === role).map((color) => valid(color.hex)).filter((hex): hex is string => Boolean(hex)) ?? [];
  const primary = byRole("PRIMARY")[0] ?? byRole("SECONDARY")[0] ?? NEUTRAL.primaryHex;
  const accent = byRole("ACCENT")[0] ?? byRole("SECONDARY")[0] ?? primary;
  const neutrals = byRole("NEUTRAL").sort((a, b) => luminance(b) - luminance(a));
  const light = neutrals.find((hex) => luminance(hex) > 0.7) ?? NEUTRAL.lightHex;
  const dark = [...neutrals].reverse().find((hex) => luminance(hex) < 0.08) ?? NEUTRAL.darkHex;
  const serif = identity?.typography?.family === "SERIF";
  const styleWord = identity?.style?.primary ? STYLE_TONE[identity.style.primary] : undefined;
  const glossary: BrandGlossary = input.brandName.trim().length >= 3 ? [{ from: input.brandName.trim().toLowerCase(), to: input.brandName.trim() }] : [];
  const style: BrandStyle = {
    name: input.brandName,
    tone: [styleWord, input.toneOfVoice].filter(Boolean).join(" · ").slice(0, 200) || undefined,
    primaryHex: primary,
    accentHex: accent,
    lightHex: light,
    darkHex: dark,
    displayFont: serif ? "DM Serif Display" : "Barlow Condensed",
    glossary,
  };
  // O cartão final usa a cor primária com a logo feita para esse fundo (claro/escuro; cruzamento do WCAG
  // em 0,179). Sem logo para a cor primária, o cartão passa para a cor neutra da marca que tem logo
  // (ex.: CMKV preta com logo só para fundo claro → cartão branco com a logo oficial), em vez de sair sem marca.
  const surface = luminance(primary) > 0.179 ? "light" : "dark";
  let logo = input.identity ? selectBrandLogoForSurface(input.identity.logos, surface) : undefined;
  const fitsSurface = (candidate: typeof logo, wanted: "light" | "dark") => Boolean(candidate?.backgrounds?.some((background) => background.toLowerCase() === wanted));
  if (input.identity && logo && !fitsSurface(logo, surface)) {
    const other = surface === "dark" ? "light" : "dark";
    const alternative = selectBrandLogoForSurface(input.identity.logos, other);
    if (alternative && fitsSurface(alternative, other)) {
      logo = alternative;
      style.cardHex = other === "light" ? light : dark;
    }
  } else if (input.identity && !logo) {
    const alternative = selectBrandLogoForSurface(input.identity.logos, surface === "dark" ? "light" : "dark");
    if (alternative) {
      logo = alternative;
      style.cardHex = surface === "dark" ? light : dark;
    }
  }
  return { style, ...(logo ? { logo: { url: logo.url, assetId: logo.assetId } } : {}) };
}
