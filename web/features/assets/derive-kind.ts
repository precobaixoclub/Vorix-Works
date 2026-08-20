import type { AssetKind, AssetMaterialType } from "./types";

/**
 * Migração "Marca & Materiais" — a interface deixa de expor `AssetKind` como um segundo seletor
 * técnico ao lado de `AssetMaterialType` (dois conceitos sobrepostos confundindo o usuário). O
 * campo continua existindo no backend (bibliotecas de preview/ícone dependem dele), só que agora é
 * derivado automaticamente: o tipo real do arquivo enviado tem prioridade (cobre vídeo/PDF/fonte,
 * que não têm um `AssetMaterialType` equivalente), com o "Tipo do material" escolhido pelo usuário
 * como resultado para os demais casos.
 */
export function deriveAssetKind(materialType: AssetMaterialType | "", contentType?: string, fallbackKind?: AssetKind): AssetKind {
  if (contentType) {
    if (contentType.startsWith("video/")) return "video";
    if (contentType === "application/pdf") return "brand_book";
    if (contentType.startsWith("font/") || contentType === "application/font-woff" || contentType === "application/x-font-ttf") return "font";
  }
  switch (materialType) {
    case "logo_principal":
    case "logo_secundaria":
      return "logo";
    case "screenshot_site":
    case "screenshot_app":
      return "mockup";
    case "produto":
      return "product";
    case "foto_institucional":
      return "photo";
    case "selo":
    case "icone":
    case "fundo":
      return "visual_identity";
    case "referencia_visual":
    case "campanha":
      return "reference";
    case "outro":
      return "document";
    default:
      // Material ainda "Não classificado" — preserva a categoria já existente (ex.: editar sem
      // reclassificar não pode rebaixar silenciosamente uma logo/foto para "document").
      return fallbackKind ?? "document";
  }
}

/** Tipos de material cujo envio de arquivo é obrigatório — os demais ("Referência visual",
 * "Campanha", "Não classificado") continuam podendo ser só metadado/texto, como já era possível
 * antes desta migração. */
export const FILE_REQUIRED_MATERIAL_TYPES = new Set<AssetMaterialType>([
  "logo_principal",
  "logo_secundaria",
  "screenshot_site",
  "screenshot_app",
  "produto",
  "foto_institucional",
  "selo",
  "icone",
  "fundo",
]);
