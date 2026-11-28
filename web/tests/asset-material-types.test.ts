import { describe, expect, it } from "vitest";
import { deriveAssetKind, FILE_REQUIRED_MATERIAL_TYPES } from "@/features/assets/derive-kind";
import { ASSET_MATERIAL_TYPE_LABEL, materialTypesFor, VIDEO_MATERIAL_TYPES } from "@/features/assets/types";

describe("tipos de material de vídeo", () => {
  it("arquivo de vídeo só oferece tipos de vídeo; imagem nunca oferece tipo de vídeo", () => {
    expect(materialTypesFor("video/mp4")).toEqual(["video_produto", "video_institucional", "gravacao_tela", "video_referencia"]);
    expect(materialTypesFor("image/png").some((t) => VIDEO_MATERIAL_TYPES.has(t))).toBe(false);
    expect(materialTypesFor(undefined)).toContain("produto");
  });
  it("tipo de vídeo vira categoria vídeo, exige arquivo e tem rótulo em português", () => {
    expect(deriveAssetKind("gravacao_tela")).toBe("video");
    expect(deriveAssetKind("video_referencia", "video/quicktime")).toBe("video");
    for (const t of VIDEO_MATERIAL_TYPES) {
      expect(FILE_REQUIRED_MATERIAL_TYPES.has(t)).toBe(true);
      expect(ASSET_MATERIAL_TYPE_LABEL[t]).toMatch(/Vídeo|Gravação/);
    }
  });
});
