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

export type Asset = {
  id: string;
  workspaceId: string;
  kind: AssetKind;
  name: string;
  status: AssetStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};
