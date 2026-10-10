// Brand Profiles SINTÉTICOS de homologação local (identidades fictícias de QA, não clientes reais).
// Mesma estrutura persistida por `PUT /v1/brand-identity` (`src/shared/utils/brand-identity.ts`).

export const PROFILE_1_PREMIUM_EDITORIAL = {
  colors: [
    { hex: "#6E2433", role: "PRIMARY", name: "vinho" },
    { hex: "#A8834B", role: "ACCENT", name: "dourado envelhecido" },
    { hex: "#F4EDE3", role: "NEUTRAL", name: "marfim" },
    { hex: "#24191A", role: "NEUTRAL", name: "café escuro" },
    { hex: "#E10600", role: "FORBIDDEN", name: "vermelho vivo" },
  ],
  logos: [],
  style: { primary: "PREMIUM", traits: ["EDITORIAL"] },
  density: "LOW",
  contrast: "SOFT",
  typography: { family: "SERIF", era: "CLASSIC", voice: "EDITORIAL", weight: "REGULAR", headlineCase: "SENTENCE" },
  shape: { corners: "SOFT", lines: "HAIRLINE", shadow: "SUBTLE" },
  imageStyles: ["EDITORIAL_PHOTOGRAPHY"],
  commercialIntensity: "LOW",
  forbiddenPatterns: ["NO_STRONG_SHADOWS", "NO_EMOJI"],
  preferredPatterns: ["HAIRLINE_DIVIDERS", "GENEROUS_WHITESPACE"],
  notes: "Elegância discreta; nada de linguagem de liquidação.",
};

export const PROFILE_2_TECH_BOLD = {
  colors: [
    { hex: "#2340FF", role: "PRIMARY", name: "azul elétrico" },
    { hex: "#7C3AED", role: "ACCENT", name: "violeta IA" },
    { hex: "#0B1020", role: "NEUTRAL", name: "grafite noturno" },
    { hex: "#F3F5FF", role: "NEUTRAL", name: "branco azulado" },
    { hex: "#FF7A00", role: "FORBIDDEN", name: "laranja" },
  ],
  logos: [],
  style: { primary: "TECH", traits: ["BOLD"] },
  density: "MEDIUM",
  contrast: "HIGH",
  typography: { family: "SANS", era: "MODERN", construction: "GEOMETRIC", voice: "COMMERCIAL", weight: "HEAVY", headlineCase: "UPPERCASE" },
  shape: { corners: "PILL", lines: "NONE", shadow: "PRONOUNCED" },
  imageStyles: ["GRADIENT", "MINIMAL_BACKGROUND"],
  commercialIntensity: "HIGH",
  forbiddenPatterns: ["NO_EMOJI"],
  preferredPatterns: ["DEPTH_LAYERS", "SOFT_GLOW"],
};

export const PROFILE_3_MINIMAL_CORPORATE = {
  colors: [
    { hex: "#0F766E", role: "PRIMARY", name: "verde-petróleo" },
    { hex: "#115E59", role: "ACCENT", name: "verde-petróleo profundo" },
    { hex: "#FFFFFF", role: "NEUTRAL", name: "branco" },
    { hex: "#111827", role: "NEUTRAL", name: "grafite" },
    { hex: "#E5E7EB", role: "SECONDARY", name: "cinza claro" },
    { hex: "#DC2626", role: "FORBIDDEN", name: "vermelho" },
  ],
  logos: [],
  style: { primary: "CORPORATE", traits: ["MINIMAL"] },
  density: "LOW",
  contrast: "BALANCED",
  typography: { family: "SANS", era: "MODERN", construction: "NEUTRAL", voice: "COMMERCIAL", weight: "BOLD", headlineCase: "SENTENCE" },
  shape: { corners: "SHARP", lines: "NONE", shadow: "NONE" },
  imageStyles: ["MINIMAL_BACKGROUND", "STUDIO_PRODUCT"],
  commercialIntensity: "MEDIUM",
  forbiddenPatterns: ["NO_GRADIENTS", "NO_DARK_BACKGROUNDS", "NO_ALL_CAPS", "NO_STRONG_SHADOWS"],
  preferredPatterns: ["GENEROUS_WHITESPACE"],
};

export const SYNTHETIC_PROFILES = {
  P1: PROFILE_1_PREMIUM_EDITORIAL,
  P2: PROFILE_2_TECH_BOLD,
  P3: PROFILE_3_MINIMAL_CORPORATE,
};
