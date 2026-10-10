/**
 * Brand Identity — identidade visual ESTRUTURADA da marca, por workspace (não um prompt livre).
 *
 * Persistida dentro de `brand_visual_profiles.profile.identity` (jsonb já existente, 1 linha por
 * workspace — migration 0059): sem tabela nova, retrocompatível (perfis antigos simplesmente não
 * têm `identity` e o motor usa SYSTEM_DEFAULT). Independe de provider de IA: o provider só recebe
 * instruções DERIVADAS por mapeadores (`describeBrandIdentityForDirector`/`ForImage`) e o renderer
 * determinístico recebe uma skin (`deriveBrandSkin`).
 *
 * Branding nunca é fonte de verdade comercial: nada aqui cria preço, desconto, urgência, claim,
 * headline ou CTA; nada aqui altera produto, screenshot ou texto autorizado.
 *
 * Precedência final de instruções no motor criativo (documentada aqui e em `docs/brand-profile.md`):
 *   1. segurança e fatos (fatos comerciais confirmados, fidelidade de assets, texto autorizado);
 *   2. Brand Profile estruturado (cores por papel, logos, proibições, estilo) — restrições
 *      explícitas da marca prevalecem sobre o pedido atual (o conflito fica registrado);
 *   3. diretrizes criativas / Prompt de Produção (texto livre permanente do workspace);
 *   4. pedido atual (objetivo/ideia);
 *   5. defaults do sistema (SYSTEM_DEFAULT).
 */

export const BRAND_COLOR_ROLES = ["PRIMARY", "SECONDARY", "ACCENT", "NEUTRAL", "FORBIDDEN"] as const;
export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number];

export const BRAND_PROVENANCES = ["USER_CONFIGURED", "ASSET_EXTRACTED", "AI_SUGGESTED", "SYSTEM_DEFAULT"] as const;
export type BrandProvenance = (typeof BRAND_PROVENANCES)[number];

export const BRAND_LOGO_VARIANTS = ["PRIMARY", "HORIZONTAL", "VERTICAL", "SYMBOL", "LIGHT", "DARK", "MONOCHROME"] as const;
export type BrandLogoVariant = (typeof BRAND_LOGO_VARIANTS)[number];

/** Fundo onde a versão da logo funciona: LIGHT = sobre fundo claro (logo escura), DARK = sobre
 * fundo escuro (logo clara), PHOTO = direto sobre fotografia. */
export const BRAND_LOGO_BACKGROUNDS = ["LIGHT", "DARK", "PHOTO"] as const;
export type BrandLogoBackground = (typeof BRAND_LOGO_BACKGROUNDS)[number];

export const BRAND_STYLES = ["MINIMAL", "PREMIUM", "EDITORIAL", "BOLD", "TECH", "ORGANIC", "LUXURY", "PLAYFUL", "CORPORATE"] as const;
export type BrandStyle = (typeof BRAND_STYLES)[number];

export const BRAND_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type BrandLevel = (typeof BRAND_LEVELS)[number];

export const BRAND_CONTRASTS = ["SOFT", "BALANCED", "HIGH"] as const;
export type BrandContrast = (typeof BRAND_CONTRASTS)[number];

export const BRAND_TYPE_FAMILIES = ["SERIF", "SANS"] as const;
export const BRAND_TYPE_ERAS = ["MODERN", "CLASSIC"] as const;
export const BRAND_TYPE_CONSTRUCTIONS = ["GEOMETRIC", "HUMANIST", "NEUTRAL"] as const;
export const BRAND_TYPE_VOICES = ["EDITORIAL", "COMMERCIAL"] as const;
export const BRAND_TYPE_WEIGHTS = ["LIGHT", "REGULAR", "BOLD", "HEAVY"] as const;
export const BRAND_TYPE_CASES = ["SENTENCE", "UPPERCASE"] as const;

export const BRAND_CORNERS = ["SHARP", "SOFT", "ROUNDED", "PILL"] as const;
export const BRAND_LINES = ["NONE", "HAIRLINE", "OUTLINED"] as const;
export const BRAND_SHADOWS = ["NONE", "SUBTLE", "PRONOUNCED"] as const;

export const BRAND_IMAGE_STYLES = ["EDITORIAL_PHOTOGRAPHY", "STUDIO_PRODUCT", "LIFESTYLE", "ILLUSTRATION", "THREE_D", "GRADIENT", "MINIMAL_BACKGROUND"] as const;
export type BrandImageStyle = (typeof BRAND_IMAGE_STYLES)[number];

/** Padrões proibidos ESTRUTURADOS (texto livre só complementa em `notes`). */
export const BRAND_FORBIDDEN_PATTERNS = ["NO_GRADIENTS", "NO_EMOJI", "NO_THICK_BORDERS", "NO_STRONG_SHADOWS", "NO_DARK_BACKGROUNDS", "NO_ROUNDED_CARDS", "NO_ALL_CAPS"] as const;
export type BrandForbiddenPattern = (typeof BRAND_FORBIDDEN_PATTERNS)[number];

/** Elementos recorrentes desejados. */
export const BRAND_PREFERRED_PATTERNS = ["HAIRLINE_DIVIDERS", "GENEROUS_WHITESPACE", "DEPTH_LAYERS", "SOFT_GLOW", "FRAMED_PHOTO"] as const;
export type BrandPreferredPattern = (typeof BRAND_PREFERRED_PATTERNS)[number];

export type BrandColor = { hex: string; role: BrandColorRole; name?: string; provenance: BrandProvenance };

export type BrandLogo = {
  assetId: string;
  variant: BrandLogoVariant;
  backgrounds: BrandLogoBackground[];
  /** 1 = preferida. */
  priority: number;
  provenance: BrandProvenance;
};

export type BrandTypography = {
  family: (typeof BRAND_TYPE_FAMILIES)[number];
  era?: (typeof BRAND_TYPE_ERAS)[number];
  construction?: (typeof BRAND_TYPE_CONSTRUCTIONS)[number];
  voice?: (typeof BRAND_TYPE_VOICES)[number];
  weight?: (typeof BRAND_TYPE_WEIGHTS)[number];
  headlineCase?: (typeof BRAND_TYPE_CASES)[number];
};

export type BrandShape = {
  corners: (typeof BRAND_CORNERS)[number];
  lines?: (typeof BRAND_LINES)[number];
  shadow?: (typeof BRAND_SHADOWS)[number];
};

export type BrandIdentity = {
  schemaVersion: 1;
  /** Incrementa a cada gravação — vai para a provenance de cada peça gerada. */
  version: number;
  updatedAt: string;
  colors: BrandColor[];
  logos: BrandLogo[];
  style?: { primary: BrandStyle; traits: BrandStyle[] };
  density?: BrandLevel;
  contrast?: BrandContrast;
  typography?: BrandTypography;
  shape?: BrandShape;
  imageStyles: BrandImageStyle[];
  commercialIntensity?: BrandLevel;
  forbiddenPatterns: BrandForbiddenPattern[];
  preferredPatterns: BrandPreferredPattern[];
  notes?: string;
  /** Origem por grupo de campos (colors/logos têm provenance por item). */
  fieldProvenance: Partial<Record<"style" | "density" | "contrast" | "typography" | "shape" | "imageStyles" | "commercialIntensity" | "forbiddenPatterns" | "preferredPatterns" | "notes", BrandProvenance>>;
};

export type BrandIdentityValidation = { ok: true; identity: Omit<BrandIdentity, "version" | "updatedAt" | "schemaVersion"> } | { ok: false; errors: string[] };

export const BRAND_IDENTITY_LIMITS = { colors: 12, logos: 8, traits: 3, imageStyles: 4, notes: 1000 } as const;

const HEX = /^#[0-9A-Fa-f]{6}$/;
export function isBrandHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/**
 * Valida e normaliza a entrada do usuário (API/UI). Nunca aceita valor inválido silenciosamente:
 * hex fora de #RRGGBB, papel/variante/estilo desconhecido, mesma cor em papel permitido E proibido,
 * duplicatas, listas acima do limite. Sugestões de IA (`AI_SUGGESTED`) só entram como sugestão: ao
 * gravar, o próprio usuário confirma — a API converte para USER_CONFIGURED (ver rota).
 */
export function validateBrandIdentityInput(raw: unknown): BrandIdentityValidation {
  const errors: string[] = [];
  const input = (raw ?? {}) as Record<string, unknown>;
  const colors: BrandColor[] = [];
  const rawColors = Array.isArray(input.colors) ? input.colors : [];
  if (rawColors.length > BRAND_IDENTITY_LIMITS.colors) errors.push(`no máximo ${BRAND_IDENTITY_LIMITS.colors} cores`);
  for (const [index, item] of rawColors.entries()) {
    const color = (item ?? {}) as Record<string, unknown>;
    if (!isBrandHex(color.hex)) { errors.push(`cor ${index + 1}: hex inválido (use #RRGGBB)`); continue; }
    if (!oneOf(BRAND_COLOR_ROLES, color.role)) { errors.push(`cor ${index + 1}: função inválida`); continue; }
    const hex = color.hex.toUpperCase();
    if (colors.some((existing) => existing.hex === hex)) { errors.push(`cor ${hex} repetida`); continue; }
    const name = typeof color.name === "string" && color.name.trim() ? color.name.trim().slice(0, 40) : undefined;
    colors.push({ hex, role: color.role, ...(name ? { name } : {}), provenance: oneOf(BRAND_PROVENANCES, color.provenance) ? color.provenance : "USER_CONFIGURED" });
  }
  const logos: BrandLogo[] = [];
  const rawLogos = Array.isArray(input.logos) ? input.logos : [];
  if (rawLogos.length > BRAND_IDENTITY_LIMITS.logos) errors.push(`no máximo ${BRAND_IDENTITY_LIMITS.logos} logos`);
  for (const [index, item] of rawLogos.entries()) {
    const logo = (item ?? {}) as Record<string, unknown>;
    if (typeof logo.assetId !== "string" || !logo.assetId.trim()) { errors.push(`logo ${index + 1}: asset da biblioteca obrigatório`); continue; }
    if (!oneOf(BRAND_LOGO_VARIANTS, logo.variant)) { errors.push(`logo ${index + 1}: tipo inválido`); continue; }
    const backgrounds = Array.isArray(logo.backgrounds) ? [...new Set(logo.backgrounds.filter((value): value is BrandLogoBackground => oneOf(BRAND_LOGO_BACKGROUNDS, value)))] : [];
    if (backgrounds.length === 0) { errors.push(`logo ${index + 1}: informe ao menos um fundo compatível`); continue; }
    if (logos.some((existing) => existing.assetId === logo.assetId)) { errors.push(`logo ${index + 1}: asset repetido`); continue; }
    const priority = typeof logo.priority === "number" && Number.isInteger(logo.priority) && logo.priority >= 1 && logo.priority <= 99 ? logo.priority : index + 1;
    logos.push({ assetId: logo.assetId, variant: logo.variant, backgrounds, priority, provenance: oneOf(BRAND_PROVENANCES, logo.provenance) ? logo.provenance : "USER_CONFIGURED" });
  }
  const styleRaw = input.style as Record<string, unknown> | undefined;
  let style: BrandIdentity["style"];
  if (styleRaw) {
    if (!oneOf(BRAND_STYLES, styleRaw.primary)) errors.push("estilo principal inválido");
    else {
      const traits = Array.isArray(styleRaw.traits) ? [...new Set(styleRaw.traits.filter((value): value is BrandStyle => oneOf(BRAND_STYLES, value) && value !== styleRaw.primary))] : [];
      if (traits.length > BRAND_IDENTITY_LIMITS.traits) errors.push(`no máximo ${BRAND_IDENTITY_LIMITS.traits} traços de estilo`);
      style = { primary: styleRaw.primary, traits: traits.slice(0, BRAND_IDENTITY_LIMITS.traits) };
    }
  }
  const optionalEnum = <T extends string>(key: string, values: readonly T[], label: string): T | undefined => {
    if (input[key] === undefined || input[key] === null || input[key] === "") return undefined;
    if (oneOf(values, input[key])) return input[key] as T;
    errors.push(`${label} inválido`);
    return undefined;
  };
  const density = optionalEnum("density", BRAND_LEVELS, "densidade");
  const contrast = optionalEnum("contrast", BRAND_CONTRASTS, "contraste");
  const commercialIntensity = optionalEnum("commercialIntensity", BRAND_LEVELS, "intensidade comercial");
  let typography: BrandTypography | undefined;
  if (input.typography) {
    const t = input.typography as Record<string, unknown>;
    if (!oneOf(BRAND_TYPE_FAMILIES, t.family)) errors.push("família tipográfica inválida");
    else {
      typography = { family: t.family };
      const opt = <K extends keyof BrandTypography>(key: K, values: readonly string[]): void => {
        if (t[key] === undefined || t[key] === null || t[key] === "") return;
        if (oneOf(values, t[key])) (typography as Record<string, unknown>)[key] = t[key];
        else errors.push(`tipografia: ${String(key)} inválido`);
      };
      opt("era", BRAND_TYPE_ERAS);
      opt("construction", BRAND_TYPE_CONSTRUCTIONS);
      opt("voice", BRAND_TYPE_VOICES);
      opt("weight", BRAND_TYPE_WEIGHTS);
      opt("headlineCase", BRAND_TYPE_CASES);
    }
  }
  let shape: BrandShape | undefined;
  if (input.shape) {
    const s = input.shape as Record<string, unknown>;
    if (!oneOf(BRAND_CORNERS, s.corners)) errors.push("formato de cantos inválido");
    else {
      shape = { corners: s.corners };
      if (s.lines !== undefined && s.lines !== null && s.lines !== "") { if (oneOf(BRAND_LINES, s.lines)) shape.lines = s.lines; else errors.push("estilo de linha inválido"); }
      if (s.shadow !== undefined && s.shadow !== null && s.shadow !== "") { if (oneOf(BRAND_SHADOWS, s.shadow)) shape.shadow = s.shadow; else errors.push("estilo de sombra inválido"); }
    }
  }
  const list = <T extends string>(key: string, values: readonly T[], label: string, max?: number): T[] => {
    if (!Array.isArray(input[key])) return [];
    const items = input[key] as unknown[];
    const invalid = items.filter((value) => !oneOf(values, value));
    if (invalid.length > 0) errors.push(`${label}: valor inválido`);
    const unique = [...new Set(items.filter((value): value is T => oneOf(values, value)))];
    if (max !== undefined && unique.length > max) errors.push(`${label}: no máximo ${max}`);
    return unique;
  };
  const imageStyles = list("imageStyles", BRAND_IMAGE_STYLES, "estilo de imagem", BRAND_IDENTITY_LIMITS.imageStyles);
  const forbiddenPatterns = list("forbiddenPatterns", BRAND_FORBIDDEN_PATTERNS, "padrões proibidos");
  const preferredPatterns = list("preferredPatterns", BRAND_PREFERRED_PATTERNS, "padrões preferidos");
  const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : undefined;
  if (notes && notes.length > BRAND_IDENTITY_LIMITS.notes) errors.push(`notas: no máximo ${BRAND_IDENTITY_LIMITS.notes} caracteres`);
  if (forbiddenPatterns.includes("NO_GRADIENTS") && imageStyles.includes("GRADIENT")) errors.push("estilo de imagem 'gradiente' conflita com a proibição de gradientes");
  const permitted = colors.filter((color) => color.role !== "FORBIDDEN");
  for (const forbidden of colors.filter((color) => color.role === "FORBIDDEN")) {
    const clash = permitted.find((color) => rgbDistance(hexToRgb(color.hex), hexToRgb(forbidden.hex)) < 40);
    if (clash) errors.push(`a cor proibida ${forbidden.hex} é praticamente igual à cor permitida ${clash.hex}`);
  }
  const fp = (input.fieldProvenance ?? {}) as Record<string, unknown>;
  const fieldProvenance: BrandIdentity["fieldProvenance"] = {};
  for (const key of ["style", "density", "contrast", "typography", "shape", "imageStyles", "commercialIntensity", "forbiddenPatterns", "preferredPatterns", "notes"] as const) {
    const present = key === "imageStyles" ? imageStyles.length > 0 : key === "forbiddenPatterns" ? forbiddenPatterns.length > 0 : key === "preferredPatterns" ? preferredPatterns.length > 0 : ({ style, density, contrast, typography, shape, commercialIntensity, notes } as Record<string, unknown>)[key] !== undefined;
    if (present) fieldProvenance[key] = oneOf(BRAND_PROVENANCES, fp[key]) ? (fp[key] as BrandProvenance) : "USER_CONFIGURED";
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    identity: {
      colors,
      logos: logos.sort((a, b) => a.priority - b.priority),
      ...(style ? { style } : {}),
      ...(density ? { density } : {}),
      ...(contrast ? { contrast } : {}),
      ...(typography ? { typography } : {}),
      ...(shape ? { shape } : {}),
      imageStyles,
      ...(commercialIntensity ? { commercialIntensity } : {}),
      forbiddenPatterns,
      preferredPatterns,
      ...(notes ? { notes } : {}),
      fieldProvenance,
    },
  };
}

/** Grava: confirma tudo que o usuário salvou (sugestões viram USER_CONFIGURED só aqui, por ato
 * consciente do usuário), incrementa a versão. */
export function commitBrandIdentity(validated: Extract<BrandIdentityValidation, { ok: true }>["identity"], previous: BrandIdentity | undefined, now: string): BrandIdentity {
  const confirm = <T extends { provenance: BrandProvenance }>(item: T): T => (item.provenance === "AI_SUGGESTED" || item.provenance === "SYSTEM_DEFAULT" ? { ...item, provenance: "USER_CONFIGURED" } : item);
  const fieldProvenance = Object.fromEntries(Object.entries(validated.fieldProvenance).map(([key, value]) => [key, value === "AI_SUGGESTED" || value === "SYSTEM_DEFAULT" ? "USER_CONFIGURED" : value]));
  return {
    schemaVersion: 1,
    version: (previous?.version ?? 0) + 1,
    updatedAt: now,
    ...validated,
    colors: validated.colors.map(confirm),
    logos: validated.logos.map(confirm),
    fieldProvenance,
  };
}

// ----------------------------------------------------------------- cor -------------------------

export type Rgb = { r: number; g: number; b: number };
export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
}
export function rgbToHex(c: Rgb): string {
  return `#${[c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
export function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}
export function relativeLuminance(c: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function hueSatLight(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** Nome de cor em português e inglês — para o diretor (pt) e para a base (en), e para detectar
 * conflito do pedido ("faça tudo vermelho") com uma cor proibida. */
export function describeColor(hex: string): { pt: string; en: string; words: string[] } {
  const { h, s, l } = hueSatLight(hexToRgb(hex));
  if (l >= 0.93) return { pt: "branco", en: "white", words: ["branco", "branca"] };
  if (l <= 0.1) return { pt: "preto", en: "black", words: ["preto", "preta"] };
  if (s < 0.12) return l > 0.6 ? { pt: "cinza claro", en: "light grey", words: ["cinza"] } : { pt: "grafite", en: "graphite", words: ["cinza", "grafite", "chumbo"] };
  const named: [number, string, string, string[]][] = [
    [15, "vermelho", "red", ["vermelho", "vermelha"]],
    [40, "laranja", "orange", ["laranja"]],
    [65, "amarelo", "yellow", ["amarelo", "amarela", "dourado", "dourada"]],
    [165, "verde", "green", ["verde"]],
    [200, "turquesa", "teal", ["turquesa", "ciano", "azul-turquesa"]],
    [255, "azul", "blue", ["azul"]],
    [290, "violeta", "violet", ["violeta", "roxo", "roxa", "lilás"]],
    [335, "rosa", "pink", ["rosa", "magenta", "pink"]],
    [361, "vermelho", "red", ["vermelho", "vermelha"]],
  ];
  const [, pt, en, words] = named.find(([limit]) => h < limit)!;
  if (pt === "laranja" && l < 0.35) return { pt: "marrom", en: "brown", words: ["marrom", "terroso"] };
  if (pt === "amarelo" && s < 0.5 && l > 0.4) return { pt: "bege dourado", en: "warm beige", words: ["bege", "dourado", "dourada"] };
  return { pt, en, words };
}

// ------------------------------------------------------------- contexto -------------------------

/** Identidade já resolvida para uma execução (logos com URL da Asset Library do mesmo workspace). */
export type CreativeBrandIdentity = {
  profileId: string;
  workspaceId: string;
  version: number;
  updatedAt: string;
  identity: BrandIdentity;
  logos: (BrandLogo & { url: string })[];
};

export type AppliedBrandRule = { code: string; detail: string; outcome?: "APPLIED" | "PROFILE_PREVAILED" | "SKIPPED" };

const STYLE_WORDS: Record<BrandStyle, { pt: string; en: string }> = {
  MINIMAL: { pt: "minimalista", en: "minimal, restrained" },
  PREMIUM: { pt: "premium", en: "premium, refined" },
  EDITORIAL: { pt: "editorial", en: "editorial, magazine-like" },
  BOLD: { pt: "ousada", en: "bold, high-impact" },
  TECH: { pt: "tecnológica", en: "modern tech, crisp" },
  ORGANIC: { pt: "orgânica", en: "organic, natural textures" },
  LUXURY: { pt: "luxuosa", en: "luxurious, elegant" },
  PLAYFUL: { pt: "descontraída", en: "playful, cheerful" },
  CORPORATE: { pt: "corporativa", en: "corporate, trustworthy, clean" },
};
const IMAGE_STYLE_WORDS: Record<BrandImageStyle, { pt: string; en: string }> = {
  EDITORIAL_PHOTOGRAPHY: { pt: "fotografia editorial", en: "editorial photography" },
  STUDIO_PRODUCT: { pt: "estúdio de produto", en: "clean studio setting" },
  LIFESTYLE: { pt: "lifestyle", en: "lifestyle photography" },
  ILLUSTRATION: { pt: "ilustração", en: "illustrated scene" },
  THREE_D: { pt: "3D", en: "soft 3D render look" },
  GRADIENT: { pt: "gradiente", en: "smooth color gradient backdrop" },
  MINIMAL_BACKGROUND: { pt: "fundo minimalista", en: "minimal uncluttered backdrop" },
};
const FORBIDDEN_PATTERN_WORDS: Record<BrandForbiddenPattern, { pt: string; en?: string }> = {
  NO_GRADIENTS: { pt: "não usar gradientes", en: "no color gradients" },
  NO_EMOJI: { pt: "não usar emojis" },
  NO_THICK_BORDERS: { pt: "não usar bordas grossas", en: "no thick borders or frames" },
  NO_STRONG_SHADOWS: { pt: "não usar sombras fortes", en: "no harsh heavy shadows" },
  NO_DARK_BACKGROUNDS: { pt: "não usar fundos escuros", en: "no dark or moody backgrounds, keep the scene light and airy" },
  NO_ROUNDED_CARDS: { pt: "não usar cards arredondados" },
  NO_ALL_CAPS: { pt: "não usar texto todo em maiúsculas" },
};

export const BRAND_DENSITY_TO_PLAN: Record<BrandLevel, "clean" | "balanced" | "dense"> = { LOW: "clean", MEDIUM: "balanced", HIGH: "dense" };

function colorsByRole(identity: BrandIdentity, role: BrandColorRole): BrandColor[] {
  return identity.colors.filter((color) => color.role === role);
}

/** Linhas (pt) para o diretor criativo — contexto estruturado resumido, nunca o JSON inteiro. */
export function describeBrandIdentityForDirector(brand: CreativeBrandIdentity): string[] {
  const { identity } = brand;
  const lines: string[] = ["", "IDENTIDADE VISUAL ESTRUTURADA DA MARCA (prioridade 2 — restrições explícitas prevalecem sobre o pedido atual; nunca é fonte de fato comercial):"];
  const role = (r: BrandColorRole, label: string): void => {
    const items = colorsByRole(identity, r);
    if (items.length > 0) lines.push(`- ${label}: ${items.map((color) => `${color.name ?? describeColor(color.hex).pt} (${color.hex})`).join(", ")}`);
  };
  role("PRIMARY", "Cores principais (podem dominar)");
  role("SECONDARY", "Cores de apoio");
  role("ACCENT", "Cores de destaque (só destaque: CTA, detalhes)");
  role("NEUTRAL", "Neutros (fundos, texto)");
  role("FORBIDDEN", "Cores PROIBIDAS (nunca usar)");
  if (identity.style) lines.push(`- Estilo: ${STYLE_WORDS[identity.style.primary].pt}${identity.style.traits.length ? ` com traços ${identity.style.traits.map((trait) => STYLE_WORDS[trait].pt).join(", ")}` : ""}`);
  if (identity.density) lines.push(`- Densidade visual: ${{ LOW: "baixa (muito respiro)", MEDIUM: "média", HIGH: "alta (mais elementos)" }[identity.density]}`);
  if (identity.commercialIntensity) lines.push(`- Intensidade comercial: ${{ LOW: "baixa (institucional)", MEDIUM: "média (benefício + CTA)", HIGH: "alta (oferta) — só com fatos confirmados, nunca inventar preço/desconto/urgência" }[identity.commercialIntensity]}`);
  if (identity.imageStyles.length > 0) lines.push(`- Estilo de imagem: ${identity.imageStyles.map((style) => IMAGE_STYLE_WORDS[style].pt).join(", ")}`);
  if (identity.typography) lines.push(`- Tipografia: ${identity.typography.family === "SERIF" ? "serifada" : "sem serifa"}${identity.typography.era ? `, ${identity.typography.era === "CLASSIC" ? "clássica" : "moderna"}` : ""}${identity.typography.voice ? `, ${identity.typography.voice === "EDITORIAL" ? "editorial" : "comercial"}` : ""}`);
  if (identity.forbiddenPatterns.length > 0) lines.push(`- Proibido: ${identity.forbiddenPatterns.map((pattern) => FORBIDDEN_PATTERN_WORDS[pattern].pt).join("; ")}`);
  if (identity.notes) lines.push(`- Observações da marca: ${identity.notes}`);
  return lines;
}

/** Linhas (en) para a BASE gerada por IA — só direção visual relevante. Nunca nome da marca, texto
 * de logo, CTA, preço, headline ou claim. */
export function describeBrandIdentityForImage(brand: CreativeBrandIdentity): string[] {
  const { identity } = brand;
  const lines: string[] = [];
  if (identity.style) lines.push(`Brand visual language (non-textual): ${[identity.style.primary, ...identity.style.traits].map((style) => STYLE_WORDS[style].en).join("; ")}.`);
  const dominant = [...colorsByRole(identity, "PRIMARY"), ...colorsByRole(identity, "NEUTRAL")].map((color) => describeColor(color.hex).en);
  const support = [...colorsByRole(identity, "SECONDARY"), ...colorsByRole(identity, "ACCENT")].map((color) => describeColor(color.hex).en);
  if (dominant.length > 0 || support.length > 0) lines.push(`Brand palette as color mood only: ${[...new Set(dominant)].join(", ") || "neutral"}${support.length ? `, with small touches of ${[...new Set(support)].join(", ")}` : ""}.`);
  const forbidden = [...new Set(colorsByRole(identity, "FORBIDDEN").map((color) => describeColor(color.hex).en))];
  if (forbidden.length > 0) lines.push(`Avoid these colors entirely: ${forbidden.join(", ")}.`);
  if (identity.imageStyles.length > 0) lines.push(`Preferred image style: ${identity.imageStyles.map((style) => IMAGE_STYLE_WORDS[style].en).join(", ")}.`);
  if (identity.contrast) lines.push(`Contrast: ${{ SOFT: "soft, low-contrast light", BALANCED: "balanced", HIGH: "crisp high contrast" }[identity.contrast]}.`);
  const patterns = identity.forbiddenPatterns.map((pattern) => FORBIDDEN_PATTERN_WORDS[pattern].en).filter((value): value is string => Boolean(value));
  if (patterns.length > 0) lines.push(`Avoid: ${patterns.join("; ")}.`);
  return lines;
}

/** Conflitos entre o pedido atual e restrições EXPLÍCITAS da marca — a marca prevalece (até o
 * usuário mudar conscientemente o perfil) e o conflito fica registrado na provenance. */
export function detectBrandRequestConflicts(brand: CreativeBrandIdentity, requestText: string): AppliedBrandRule[] {
  const text = requestText.toLocaleLowerCase("pt-BR");
  const rules: AppliedBrandRule[] = [];
  for (const color of colorsByRole(brand.identity, "FORBIDDEN")) {
    const words = describeColor(color.hex).words;
    const hit = words.find((word) => new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, "u").test(text));
    if (hit) rules.push({ code: "FORBIDDEN_COLOR_REQUESTED", detail: `pedido menciona "${hit}", proibido pela marca (${color.hex})`, outcome: "PROFILE_PREVAILED" });
  }
  if (brand.identity.forbiddenPatterns.includes("NO_GRADIENTS") && /\bgradiente|degrad[eê]/u.test(text)) rules.push({ code: "FORBIDDEN_PATTERN_REQUESTED", detail: "pedido menciona gradiente, proibido pela marca", outcome: "PROFILE_PREVAILED" });
  if (brand.identity.forbiddenPatterns.includes("NO_DARK_BACKGROUNDS") && /fundo (escuro|preto)/u.test(text)) rules.push({ code: "FORBIDDEN_PATTERN_REQUESTED", detail: "pedido menciona fundo escuro, proibido pela marca", outcome: "PROFILE_PREVAILED" });
  return rules;
}

// ------------------------------------------------------------- skin -----------------------------

/** O que o renderer determinístico aplica. Todo campo ausente = comportamento atual (SYSTEM_DEFAULT). */
export type BrandSkin = {
  /** Cor de destaque (CTA, preço, fios) — ACCENT, senão PRIMARY; já ajustada para contraste. */
  accent?: string;
  primary?: string;
  /** Neutro escuro (texto/superfície escura) e neutro claro (superfície clara). */
  darkNeutral?: string;
  lightNeutral?: string;
  forbidden: string[];
  ctaCorners?: "SHARP" | "SOFT" | "ROUNDED" | "PILL";
  lines?: "NONE" | "HAIRLINE" | "OUTLINED";
  shadow?: "NONE" | "SUBTLE" | "PRONOUNCED";
  headlineSerif: boolean;
  headlineUppercase: boolean;
  /** `false` quando NO_ALL_CAPS. */
  ctaUppercase: boolean;
  headlineWeight?: "LIGHT" | "REGULAR" | "BOLD" | "HEAVY";
  flat: boolean;
  forceLight: boolean;
  noRoundedCards: boolean;
  commercialIntensity?: BrandLevel;
};

export function deriveBrandSkin(brand: CreativeBrandIdentity | undefined): BrandSkin | undefined {
  if (!brand) return undefined;
  const { identity } = brand;
  const first = (role: BrandColorRole): string | undefined => colorsByRole(identity, role)[0]?.hex;
  const neutrals = colorsByRole(identity, "NEUTRAL").map((color) => color.hex).sort((a, b) => relativeLuminance(hexToRgb(a)) - relativeLuminance(hexToRgb(b)));
  const darkNeutral = neutrals.find((hex) => relativeLuminance(hexToRgb(hex)) < 0.2);
  const lightNeutral = [...neutrals].reverse().find((hex) => relativeLuminance(hexToRgb(hex)) > 0.6);
  return {
    accent: first("ACCENT") ?? first("PRIMARY"),
    primary: first("PRIMARY"),
    darkNeutral,
    lightNeutral,
    forbidden: colorsByRole(identity, "FORBIDDEN").map((color) => color.hex),
    ...(identity.shape ? { ctaCorners: identity.shape.corners, lines: identity.shape.lines, shadow: identity.forbiddenPatterns.includes("NO_STRONG_SHADOWS") && identity.shape.shadow === "PRONOUNCED" ? "SUBTLE" : identity.shape.shadow } : identity.forbiddenPatterns.includes("NO_STRONG_SHADOWS") ? { shadow: "SUBTLE" as const } : {}),
    headlineSerif: identity.typography?.family === "SERIF",
    headlineUppercase: identity.typography?.headlineCase === "UPPERCASE" && !identity.forbiddenPatterns.includes("NO_ALL_CAPS"),
    ctaUppercase: !identity.forbiddenPatterns.includes("NO_ALL_CAPS"),
    ...(identity.typography?.weight ? { headlineWeight: identity.typography.weight } : {}),
    flat: identity.forbiddenPatterns.includes("NO_GRADIENTS"),
    forceLight: identity.forbiddenPatterns.includes("NO_DARK_BACKGROUNDS"),
    noRoundedCards: identity.forbiddenPatterns.includes("NO_ROUNDED_CARDS"),
    ...(identity.commercialIntensity ? { commercialIntensity: identity.commercialIntensity } : {}),
  };
}

/** Uma cor derivada (base/screenshot) perto demais de uma cor proibida não pode ser usada. */
export function isNearForbiddenColor(hex: string, forbidden: readonly string[], threshold = 70): boolean {
  const rgb = hexToRgb(hex);
  return forbidden.some((value) => rgbDistance(rgb, hexToRgb(value)) < threshold);
}

/** Escolha da versão de logo pelo fundo real: só versões FORNECIDAS e marcadas como compatíveis. */
export function selectBrandLogoForSurface<T extends { backgrounds: BrandLogoBackground[]; priority: number }>(logos: readonly T[], surface: "light" | "dark" | "photo"): T | undefined {
  const wanted: BrandLogoBackground = surface === "light" ? "LIGHT" : surface === "dark" ? "DARK" : "PHOTO";
  return [...logos].filter((logo) => logo.backgrounds.includes(wanted)).sort((a, b) => a.priority - b.priority)[0];
}
