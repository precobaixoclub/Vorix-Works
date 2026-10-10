import { describe, expect, it } from "vitest";
import { EMPTY_IDENTITY, validateIdentityDraft } from "../features/brand-identity/types";

describe("validateIdentityDraft (Identidade Visual)", () => {
  it("rascunho vazio é válido — o Vorix usa o padrão até salvar", () => {
    expect(validateIdentityDraft(EMPTY_IDENTITY)).toEqual([]);
  });

  it("recusa hex inválido, cor repetida e cor proibida igual a uma permitida", () => {
    const errors = validateIdentityDraft({
      ...EMPTY_IDENTITY,
      colors: [
        { hex: "vermelho", role: "PRIMARY" },
        { hex: "#123456", role: "SECONDARY" },
        { hex: "#123456", role: "ACCENT" },
        { hex: "#E10600", role: "ACCENT" },
        { hex: "#E20501", role: "FORBIDDEN" },
      ],
    });
    expect(errors.some((error) => /#RRGGBB/.test(error))).toBe(true);
    expect(errors.some((error) => /repetida/.test(error))).toBe(true);
    expect(errors.some((error) => /proibida/.test(error))).toBe(true);
  });

  it("logo precisa de arquivo da biblioteca e de ao menos um fundo compatível", () => {
    const errors = validateIdentityDraft({ ...EMPTY_IDENTITY, logos: [{ assetId: "", variant: "PRIMARY", backgrounds: [], priority: 1 }] });
    expect(errors).toEqual(["Logo 1: escolha um arquivo da biblioteca.", "Logo 1: marque ao menos um fundo onde ela funciona."]);
  });

  it("gradiente como estilo de imagem conflita com 'evitar gradientes'", () => {
    expect(validateIdentityDraft({ ...EMPTY_IDENTITY, imageStyles: ["GRADIENT"], forbiddenPatterns: ["NO_GRADIENTS"] })).toEqual(["Estilo de imagem 'Gradiente' conflita com 'evitar gradientes'."]);
  });
});
