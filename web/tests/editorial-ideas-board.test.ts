import { describe, expect, it } from "vitest";
import { editorialBucketOf } from "../features/editorial-ideas/api";
import { blueprintToIdeaInput } from "../features/editorial-ideas/local-tank-migration";
import { referenceThumb } from "../features/editorial-ideas/reference-images";
import type { ContentBlueprint } from "../features/production-line/types";

const blueprint = (overrides: Partial<ContentBlueprint> = {}): ContentBlueprint => ({
  id: "bp-1",
  name: "Promoção de inverno infantil",
  format: "single_image",
  ideaText: "Criar uma imagem publicitária para Instagram de uma promoção de inverno",
  objective: "",
  theme: "",
  captionDirection: "",
  creativeDirection: "",
  mediaCount: 1,
  channels: ["instagram"],
  approvalMode: "manual",
  sourceLinks: [],
  referenceImages: ["https://api.vorixworks.com/uploads/t/w/a.jpg"],
  status: "available",
  ...overrides,
});

describe("bolsão: pendente, usada ou inativa", () => {
  it("disponível é Pendente, inativada é Inativa e o resto já virou post (Usada)", () => {
    expect(editorialBucketOf("available")).toBe("pending");
    expect(editorialBucketOf("archived")).toBe("inactive");
    for (const status of ["in_production", "produced", "approved", "published"] as const) expect(editorialBucketOf(status)).toBe("used");
  });
});

describe("ideias antigas da Produção (navegador) → bolsão", () => {
  it("leva título, texto e imagens de referência", () => {
    const input = blueprintToIdeaInput(blueprint(), true);
    expect(input.title).toBe("Promoção de inverno infantil");
    expect(input.format).toBe("single_image");
    expect(input.keyMessage).toContain("promoção de inverno");
    expect(input.referenceImages).toEqual(["https://api.vorixworks.com/uploads/t/w/a.jpg"]);
    expect(blueprintToIdeaInput(blueprint(), false).referenceImages).toBeUndefined();
  });

  it("carrossel antigo sem telas vira imagem única com o pedido de carrossel na direção de arte", () => {
    const input = blueprintToIdeaInput(blueprint({ format: "carousel" }), true);
    expect(input.format).toBe("single_image");
    expect(input.creativePrompt).toMatch(/carrossel/);
  });

  it("sem nome, o título vem do texto da ideia", () => {
    expect(blueprintToIdeaInput(blueprint({ name: "  " }), true).title).toMatch(/^Criar uma imagem/);
  });
});

describe("miniatura da referência", () => {
  it("pede a versão leve só de URL assinada do storage", () => {
    expect(referenceThumb("https://api.vorixworks.com/uploads/k.jpg?exp=1&sig=x", 480)).toBe("https://api.vorixworks.com/uploads/k.jpg?exp=1&sig=x&w=480");
    expect(referenceThumb("https://example.com/foto.jpg", 480)).toBe("https://example.com/foto.jpg");
  });
});
