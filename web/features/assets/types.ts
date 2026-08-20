/** Espelha `src/domain/asset-library/asset-library.model.ts` (backend) — mesma forma, sem HTTP real ainda. */

export const ASSET_KINDS = [
  "logo",
  "photo",
  "video",
  "product",
  "mockup",
  "visual_identity",
  "font",
  "brand_book",
  "reference",
  "document",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  logo: "Logo",
  photo: "Foto",
  video: "Vídeo",
  product: "Produto",
  mockup: "Mockup",
  visual_identity: "Identidade Visual",
  font: "Fonte",
  brand_book: "Manual da Marca",
  reference: "Referência",
  document: "Documento",
};

export type AssetStatus = "active" | "archived";

export type AssetStorageRef = {
  provider: string;
  bucket?: string;
  objectKey: string;
  metadata?: Record<string, string>;
};

/** Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — classificação
 * semântica rica, separada de `AssetKind` (que continua existindo). É este campo que o motor GPT
 * usa para entender o papel real de cada material. */
export const ASSET_MATERIAL_TYPES = [
  "logo_principal",
  "logo_secundaria",
  "screenshot_site",
  "screenshot_app",
  "produto",
  "foto_institucional",
  "referencia_visual",
  "selo",
  "icone",
  "fundo",
  "campanha",
  "outro",
] as const;
export type AssetMaterialType = (typeof ASSET_MATERIAL_TYPES)[number];

export const ASSET_MATERIAL_TYPE_LABEL: Record<AssetMaterialType, string> = {
  logo_principal: "Logo principal",
  logo_secundaria: "Logo secundária",
  screenshot_site: "Screenshot do site",
  screenshot_app: "Screenshot do app",
  produto: "Produto",
  foto_institucional: "Foto institucional",
  referencia_visual: "Referência visual",
  selo: "Selo",
  icone: "Ícone",
  fundo: "Fundo",
  campanha: "Campanha",
  outro: "Outro",
};

export const ASSET_USAGE_PRIORITIES = ["required", "preferred", "automatic", "on_request"] as const;
export type AssetUsagePriority = (typeof ASSET_USAGE_PRIORITIES)[number];

export const ASSET_USAGE_PRIORITY_LABEL: Record<AssetUsagePriority, string> = {
  required: "Uso obrigatório",
  preferred: "Uso preferencial",
  automatic: "Uso automático",
  on_request: "Somente quando solicitado",
};

export type Asset = {
  id: string;
  libraryId: string;
  kind: AssetKind;
  name: string;
  status: AssetStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  storageRef?: AssetStorageRef;
  materialType?: AssetMaterialType;
  aiInstructions?: string;
  usageRule?: string;
  usagePriority?: AssetUsagePriority;
};
