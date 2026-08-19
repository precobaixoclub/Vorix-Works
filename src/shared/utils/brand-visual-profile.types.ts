/**
 * Brand Visual Profile (Rodada 2, Fatia 2, Prioridade 5) — linguagem visual persistente por
 * workspace, não só cores. Investigação prévia confirmou: nenhuma tabela Postgres hoje persiste
 * algo assim por workspace (`IdentityContext`/`BrandContext` da Clara são reais mas ficam num
 * arquivo JSON por TENANT, não Postgres nem por workspace; `Workspace.settings` é jsonb real mas
 * hoje só tem 3 campos escalares sem nada de marca). Tabela nova (`brand_visual_profiles`,
 * `db/migrations`), seguindo o padrão de `asset_libraries` (1 linha por workspace, FK cascade).
 *
 * `src/shared` não é uma Skill — importar daqui não viola ADR 0002.
 */

export type BrandVisualProfileFoundation = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textPrimary: string;
  textSecondary: string;
};

export const TYPOGRAPHY_PERSONALITIES = ["moderna_direta", "elegante_editorial", "amigavel_arredondada", "tecnica_precisa"] as const;
export type TypographyPersonality = (typeof TYPOGRAPHY_PERSONALITIES)[number];

export type BrandVisualProfileTypography = {
  personality: TypographyPersonality;
  preferredWeight: "regular" | "medium" | "bold" | "black";
  casingPreference: "sentence_case" | "uppercase" | "title_case";
};

export const BORDER_RADIUS_STYLES = ["sharp", "soft", "rounded", "pill"] as const;
export type BorderRadiusStyle = (typeof BORDER_RADIUS_STYLES)[number];

export type BrandVisualProfileShapeLanguage = {
  borderRadius: BorderRadiusStyle;
  shadowStyle: "none" | "subtle" | "pronounced";
  cardStyle: "flat" | "outlined" | "elevated";
};

export const ENERGY_LEVELS = ["calm", "moderate", "high"] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];
export const DENSITY_PREFERENCES = ["minimal", "moderate", "dense"] as const;
export type DensityPreference = (typeof DENSITY_PREFERENCES)[number];

/** O núcleo que realmente diferencia duas marcas usando a mesma `layoutFamily` — consumido por
 * Component Skins (Prioridade 6) e Visual Grammar (Prioridade 7). */
export type BrandVisualProfilePersonality = {
  visualEnergy: EnergyLevel;
  commercialAggressiveness: "subtle" | "moderate" | "aggressive";
  sophistication: "casual" | "balanced" | "premium";
  graphicDensityPreference: DensityPreference;
  contrastPreference: "soft" | "balanced" | "high";
};

export const COMPONENT_SKINS = ["clean", "bold", "premium", "editorial", "outlined", "marketplace"] as const;
export type ComponentSkin = (typeof COMPONENT_SKINS)[number];

export type BrandVisualProfileComponents = {
  priceSkin: ComponentSkin;
  discountSkin: ComponentSkin;
  ctaSkin: ComponentSkin;
  badgeSkin: ComponentSkin;
};

export type BrandVisualProfileImagery = {
  backgroundComplexity: "minimal" | "moderate" | "rich";
  productTreatment: "isolated" | "lifestyle" | "editorial";
};

export type BrandVisualProfileLogo = {
  preferredPlacement: "top_left" | "top_right" | "bottom_left" | "bottom_right";
};

export type BrandVisualProfileSource = "bootstrap_conservative" | "bootstrap_from_logo" | "manual";

export type BrandVisualProfile = {
  workspaceId: string;
  foundation: BrandVisualProfileFoundation;
  typography: BrandVisualProfileTypography;
  shapeLanguage: BrandVisualProfileShapeLanguage;
  personality: BrandVisualProfilePersonality;
  components: BrandVisualProfileComponents;
  imagery: BrandVisualProfileImagery;
  logo: BrandVisualProfileLogo;
  source: BrandVisualProfileSource;
  createdAt: string;
  updatedAt: string;
};

/**
 * Perfil conservador padrão — usado quando não há informação de marca suficiente (sem logo
 * cadastrado). Deliberadamente neutro (nunca uma identidade "exagerada" inventada): tons neutros
 * de indigo/cinza já usados como fallback de `ensureHouseIdentityContext`
 * (`src/interfaces/api/di/container.ts`), densidade/energia moderadas, sem afirmar nada que a
 * marca não confirmou.
 */
export function buildConservativeDefaultProfile(workspaceId: string, now: string): BrandVisualProfile {
  return {
    workspaceId,
    foundation: {
      primaryColor: "#4338CA",
      secondaryColor: "#F5F5F4",
      accentColor: "#4338CA",
      backgroundColor: "#FFFFFF",
      surfaceColor: "#F5F5F4",
      textPrimary: "#111827",
      textSecondary: "#4B5563",
    },
    typography: { personality: "moderna_direta", preferredWeight: "bold", casingPreference: "sentence_case" },
    shapeLanguage: { borderRadius: "soft", shadowStyle: "subtle", cardStyle: "flat" },
    personality: {
      visualEnergy: "moderate",
      commercialAggressiveness: "moderate",
      sophistication: "balanced",
      graphicDensityPreference: "moderate",
      contrastPreference: "balanced",
    },
    components: { priceSkin: "clean", discountSkin: "bold", ctaSkin: "clean", badgeSkin: "bold" },
    imagery: { backgroundComplexity: "moderate", productTreatment: "lifestyle" },
    logo: { preferredPlacement: "top_left" },
    source: "bootstrap_conservative",
    createdAt: now,
    updatedAt: now,
  };
}
