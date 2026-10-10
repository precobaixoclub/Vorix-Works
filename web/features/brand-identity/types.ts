/** Espelha `src/shared/utils/brand-identity.ts` (backend) — identidade visual ESTRUTURADA da marca.
 * A UI fala linguagem de negócio/design; os códigos abaixo são o contrato persistido. */

export const COLOR_ROLES = ["PRIMARY", "SECONDARY", "ACCENT", "NEUTRAL", "FORBIDDEN"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
export const COLOR_ROLE_LABEL: Record<ColorRole, string> = {
  PRIMARY: "Principal — pode dominar a peça",
  SECONDARY: "Apoio",
  ACCENT: "Destaque — botões e detalhes",
  NEUTRAL: "Neutra — fundos e textos",
  FORBIDDEN: "Proibida — nunca usar",
};

export type Provenance = "USER_CONFIGURED" | "ASSET_EXTRACTED" | "AI_SUGGESTED" | "SYSTEM_DEFAULT";

export const LOGO_VARIANTS = ["PRIMARY", "HORIZONTAL", "VERTICAL", "SYMBOL", "LIGHT", "DARK", "MONOCHROME"] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];
export const LOGO_VARIANT_LABEL: Record<LogoVariant, string> = {
  PRIMARY: "Principal",
  HORIZONTAL: "Horizontal",
  VERTICAL: "Vertical",
  SYMBOL: "Símbolo",
  LIGHT: "Versão clara",
  DARK: "Versão escura",
  MONOCHROME: "Monocromática",
};

export const LOGO_BACKGROUNDS = ["LIGHT", "DARK", "PHOTO"] as const;
export type LogoBackground = (typeof LOGO_BACKGROUNDS)[number];
export const LOGO_BACKGROUND_LABEL: Record<LogoBackground, string> = { LIGHT: "Fundo claro", DARK: "Fundo escuro", PHOTO: "Sobre fotografia" };

export const STYLES = ["MINIMAL", "PREMIUM", "EDITORIAL", "BOLD", "TECH", "ORGANIC", "LUXURY", "PLAYFUL", "CORPORATE"] as const;
export type Style = (typeof STYLES)[number];
export const STYLE_LABEL: Record<Style, string> = {
  MINIMAL: "Minimalista",
  PREMIUM: "Premium",
  EDITORIAL: "Editorial",
  BOLD: "Ousada",
  TECH: "Tecnológica",
  ORGANIC: "Orgânica",
  LUXURY: "Luxuosa",
  PLAYFUL: "Descontraída",
  CORPORATE: "Corporativa",
};

export type Level = "LOW" | "MEDIUM" | "HIGH";
export const DENSITY_LABEL: Record<Level, string> = { LOW: "Mais respiro", MEDIUM: "Equilibrada", HIGH: "Mais elementos" };
export const COMMERCIAL_LABEL: Record<Level, string> = { LOW: "Institucional", MEDIUM: "Benefício + chamada", HIGH: "Oferta / promocional" };
export type Contrast = "SOFT" | "BALANCED" | "HIGH";
export const CONTRAST_LABEL: Record<Contrast, string> = { SOFT: "Suave", BALANCED: "Equilibrado", HIGH: "Alto" };

export const IMAGE_STYLES = ["EDITORIAL_PHOTOGRAPHY", "STUDIO_PRODUCT", "LIFESTYLE", "ILLUSTRATION", "THREE_D", "GRADIENT", "MINIMAL_BACKGROUND"] as const;
export type ImageStyle = (typeof IMAGE_STYLES)[number];
export const IMAGE_STYLE_LABEL: Record<ImageStyle, string> = {
  EDITORIAL_PHOTOGRAPHY: "Fotografia editorial",
  STUDIO_PRODUCT: "Produto em estúdio",
  LIFESTYLE: "Lifestyle",
  ILLUSTRATION: "Ilustração",
  THREE_D: "3D",
  GRADIENT: "Gradiente",
  MINIMAL_BACKGROUND: "Fundo minimalista",
};

export const FORBIDDEN_PATTERNS = ["NO_GRADIENTS", "NO_EMOJI", "NO_THICK_BORDERS", "NO_STRONG_SHADOWS", "NO_DARK_BACKGROUNDS", "NO_ROUNDED_CARDS", "NO_ALL_CAPS"] as const;
export type ForbiddenPattern = (typeof FORBIDDEN_PATTERNS)[number];
export const FORBIDDEN_PATTERN_LABEL: Record<ForbiddenPattern, string> = {
  NO_GRADIENTS: "Gradientes",
  NO_EMOJI: "Emojis",
  NO_THICK_BORDERS: "Bordas grossas",
  NO_STRONG_SHADOWS: "Sombras fortes",
  NO_DARK_BACKGROUNDS: "Fundos escuros",
  NO_ROUNDED_CARDS: "Cards arredondados",
  NO_ALL_CAPS: "Texto todo em maiúsculas",
};

export const PREFERRED_PATTERNS = ["HAIRLINE_DIVIDERS", "GENEROUS_WHITESPACE", "DEPTH_LAYERS", "SOFT_GLOW", "FRAMED_PHOTO"] as const;
export type PreferredPattern = (typeof PREFERRED_PATTERNS)[number];
export const PREFERRED_PATTERN_LABEL: Record<PreferredPattern, string> = {
  HAIRLINE_DIVIDERS: "Fios finos",
  GENEROUS_WHITESPACE: "Muito respiro",
  DEPTH_LAYERS: "Camadas com profundidade",
  SOFT_GLOW: "Brilho suave",
  FRAMED_PHOTO: "Foto emoldurada",
};

export type Typography = {
  family: "SERIF" | "SANS";
  era?: "MODERN" | "CLASSIC";
  construction?: "GEOMETRIC" | "HUMANIST" | "NEUTRAL";
  voice?: "EDITORIAL" | "COMMERCIAL";
  weight?: "LIGHT" | "REGULAR" | "BOLD" | "HEAVY";
  headlineCase?: "SENTENCE" | "UPPERCASE";
};
export type Shape = { corners: "SHARP" | "SOFT" | "ROUNDED" | "PILL"; lines?: "NONE" | "HAIRLINE" | "OUTLINED"; shadow?: "NONE" | "SUBTLE" | "PRONOUNCED" };

export type BrandColor = { hex: string; role: ColorRole; name?: string; provenance?: Provenance };
export type BrandLogo = { assetId: string; variant: LogoVariant; backgrounds: LogoBackground[]; priority: number; provenance?: Provenance };

export type BrandIdentityInput = {
  colors: BrandColor[];
  logos: BrandLogo[];
  style?: { primary: Style; traits: Style[] };
  density?: Level;
  contrast?: Contrast;
  typography?: Typography;
  shape?: Shape;
  imageStyles: ImageStyle[];
  commercialIntensity?: Level;
  forbiddenPatterns: ForbiddenPattern[];
  preferredPatterns: PreferredPattern[];
  notes?: string;
};

export type BrandIdentity = BrandIdentityInput & { schemaVersion: 1; version: number; updatedAt: string };
export type BrandIdentityView = { profileId?: string; identity: BrandIdentity | null };
export type BrandColorSuggestion = BrandColor & { status: "SUGGESTION"; share: number; reason: string };

export const EMPTY_IDENTITY: BrandIdentityInput = { colors: [], logos: [], imageStyles: [], forbiddenPatterns: [], preferredPatterns: [] };

const HEX = /^#[0-9A-Fa-f]{6}$/;
function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Mesmas regras do backend (validação final é sempre do servidor). */
export function validateIdentityDraft(draft: BrandIdentityInput): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  draft.colors.forEach((color, index) => {
    if (!HEX.test(color.hex)) errors.push(`Cor ${index + 1}: use o formato #RRGGBB.`);
    else if (seen.has(color.hex.toUpperCase())) errors.push(`Cor ${color.hex.toUpperCase()} repetida.`);
    seen.add(color.hex.toUpperCase());
  });
  if (draft.colors.length > 12) errors.push("No máximo 12 cores.");
  const valid = draft.colors.filter((color) => HEX.test(color.hex));
  for (const forbidden of valid.filter((color) => color.role === "FORBIDDEN")) {
    const clash = valid.find((color) => color.role !== "FORBIDDEN" && Math.hypot(...rgb(color.hex).map((v, i) => v - rgb(forbidden.hex)[i]!)) < 40);
    if (clash) errors.push(`A cor proibida ${forbidden.hex} é praticamente igual à cor ${clash.hex}.`);
  }
  draft.logos.forEach((logo, index) => {
    if (!logo.assetId) errors.push(`Logo ${index + 1}: escolha um arquivo da biblioteca.`);
    if (logo.backgrounds.length === 0) errors.push(`Logo ${index + 1}: marque ao menos um fundo onde ela funciona.`);
  });
  if (draft.style && draft.style.traits.length > 3) errors.push("No máximo 3 traços de estilo.");
  if (draft.imageStyles.length > 4) errors.push("No máximo 4 estilos de imagem.");
  if (draft.forbiddenPatterns.includes("NO_GRADIENTS") && draft.imageStyles.includes("GRADIENT")) errors.push("Estilo de imagem 'Gradiente' conflita com 'evitar gradientes'.");
  if ((draft.notes ?? "").length > 1000) errors.push("Observações: no máximo 1000 caracteres.");
  return errors;
}
