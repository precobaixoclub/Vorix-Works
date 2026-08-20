/** Espelha `src/shared/utils/production-settings.types.ts` (backend) — mesma forma. */

export const TEXT_DENSITY_OPTIONS = ["minimal", "balanced", "rich"] as const;
export type TextDensity = (typeof TEXT_DENSITY_OPTIONS)[number];

export const TEXT_DENSITY_LABEL: Record<TextDensity, string> = {
  minimal: "Mínima — priorizar impacto visual sobre texto",
  balanced: "Equilibrada",
  rich: "Rica — mais texto/informação quando o conteúdo pedir",
};

export const CREATIVE_FREEDOM_OPTIONS = ["low", "medium", "high"] as const;
export type CreativeFreedom = (typeof CREATIVE_FREEDOM_OPTIONS)[number];

export const CREATIVE_FREEDOM_LABEL: Record<CreativeFreedom, string> = {
  low: "Baixa — seguir as diretrizes de forma conservadora",
  medium: "Média",
  high: "Alta — explorar direções criativas mais ousadas",
};

export type ProductionSettings = {
  workspaceId: string;
  productionPrompt?: string;
  version: number;
  preferRealAssets: boolean;
  allowFictionalInterfaces: boolean;
  allowGeneratedPeople: boolean;
  textDensity: TextDensity;
  creativeFreedom: CreativeFreedom;
  createdAt: string;
  updatedAt: string;
};

export type ProductionSettingsPatch = Partial<Omit<ProductionSettings, "workspaceId" | "version" | "createdAt" | "updatedAt">>;
