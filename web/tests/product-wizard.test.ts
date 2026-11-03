import { describe, expect, it } from "vitest";
import { effectiveImage, optionsFromDetails, rowLabel, rowsFromVariants, syncRows, toDetailsOptions, toVariantDrafts, variationProblems, type DraftOption } from "@/features/product-engine/wizard";
import { PRODUCT_SEGMENTS, segmentOf } from "@/features/product-engine/segments";

const option = (name: string, labels: string[], extra: Partial<DraftOption> = {}): DraftOption => ({ id: `opt-${name}`, name, values: labels.map((label) => ({ id: `${name}-${label}`, label })), ...extra });
const access = { trackStock: true, canViewCost: true, isManager: true };

describe("cadastro em etapas: variações e combinações", () => {
  it("gera todas as combinações e preserva o que foi preenchido ao adicionar um valor", () => {
    const size = option("Tamanho", ["P", "M"]), color = option("Cor", ["Preto"]);
    const rows = syncRows([size, color], []);
    expect(rows.map((row) => rowLabel(row, [size, color]))).toEqual(["P / Preto", "M / Preto"]);
    rows[0].price = "79,90";
    const grown = syncRows([size, { ...color, values: [...color.values, { id: "Cor-Branco", label: "Branco" }] }], rows);
    expect(grown).toHaveLength(4);
    expect(grown.find((row) => row.valueIds[size.id] === "Tamanho-P" && row.valueIds[color.id] === "Cor-Preto")?.price).toBe("79,90");
  });

  it("renomear um valor mantém a combinação e o id da variante já salva", () => {
    const color = option("Cor", ["Marrom"], { key: "color" });
    const [row] = syncRows([color], []);
    const saved = [{ ...row, variantId: "variant-1" }];
    const renamed: DraftOption = { ...color, values: [{ ...color.values[0], label: "Marrom — Logo Branca" }] };
    const [kept] = syncRows([renamed], saved);
    expect(kept.variantId).toBe("variant-1");
    expect(toVariantDrafts([renamed], [kept], access)[0]).toMatchObject({ id: "variant-1", optionValues: { color: "Marrom — Logo Branca" } });
  });

  it("dois valores com a mesma cor visual continuam variações diferentes", () => {
    const color = option("Cor", ["Marrom — Logo Branca", "Marrom — Logo Preta"], { key: "color" });
    color.values.forEach((value) => { value.swatch = "#6B4423"; });
    const [saved] = toDetailsOptions([color]);
    expect(saved.values).toEqual(["Marrom — Logo Branca", "Marrom — Logo Preta"]);
    expect(saved.swatches).toEqual({ "Marrom — Logo Branca": "#6B4423", "Marrom — Logo Preta": "#6B4423" });
    expect(syncRows([color], [])).toHaveLength(2);
  });

  it("foto: combinação → valor (cor) → capa, e a foto vai limpa (sem assinatura) para a API", () => {
    const size = option("Tamanho", ["P"]), color = option("Cor", ["Preto"]);
    color.values[0].image = "https://cdn/preto.jpg?sig=1";
    const [row] = syncRows([size, color], []);
    expect(effectiveImage(row, [size, color], "https://cdn/capa.jpg")).toBe("https://cdn/preto.jpg?sig=1");
    expect(toVariantDrafts([size, color], [row], access)[0].imageUrl).toBe("https://cdn/preto.jpg");
    expect(effectiveImage({ ...row, image: "https://cdn/p.jpg" }, [size, color])).toBe("https://cdn/p.jpg");
    expect(effectiveImage(row, [size, { ...color, values: [{ ...color.values[0], image: undefined }] }], "https://cdn/capa.jpg")).toBe("https://cdn/capa.jpg");
  });

  it("reabre um produto salvo: valores, cores, fotos e combinações voltam para a tela", () => {
    const options = optionsFromDetails({ options: [{ key: "color", name: "Cor", values: ["Preto", "Branco"], swatches: { Preto: "#111111" }, images: { Preto: "https://cdn/preto.jpg" } }] });
    const rows = rowsFromVariants(options, [
      { id: "v1", productId: "p", name: "Cor: Preto", listPriceCents: 7990, priceOverride: false, active: true, position: 0, optionValues: { color: "Preto" }, stockQuantity: 3, imageUrl: "https://cdn/preto.jpg?sig=2" },
      { id: "v2", productId: "p", name: "Cor: Branco", code: "CAM-BR", listPriceCents: 8990, priceOverride: true, active: false, position: 1, optionValues: { color: "Branco" }, stockQuantity: 1 },
    ]);
    expect(options[0].values[0]).toMatchObject({ label: "Preto", swatch: "#111111", image: "https://cdn/preto.jpg" });
    expect(rows[0]).toMatchObject({ variantId: "v1", price: "", stock: "3", image: undefined, active: true });
    expect(rows[1]).toMatchObject({ variantId: "v2", sku: "CAM-BR", price: "89,90", active: false });
  });

  it("editar preço ou nome preserva vendas feitas enquanto o cadastro estava aberto", () => {
    const options = optionsFromDetails({options:[{key:"size",name:"Tamanho",values:["P"]}]});
    const [row] = rowsFromVariants(options,[{id:"v1",productId:"p",name:"P",listPriceCents:7990,active:true,position:0,optionValues:{size:"P"},stockQuantity:3}]);
    expect(toVariantDrafts(options,[{...row,price:"89,90"}],access)[0]).not.toHaveProperty("stockQuantity");
    expect(toVariantDrafts(options,[{...row,stock:"7"}],access)[0]).toHaveProperty("stockQuantity",7);
  });

  it("sem permissão, custo e preço mínimo não são enviados; sem estoque, o saldo também não", () => {
    const [row] = syncRows([option("Cor", ["Preto"])], []);
    const [draft] = toVariantDrafts([option("Cor", ["Preto"])], [{ ...row, cost: "10,00", minimum: "5,00" }], { trackStock: false, canViewCost: false, isManager: false });
    expect(draft).not.toHaveProperty("costCents");
    expect(draft).not.toHaveProperty("minimumPriceCents");
    expect(draft).not.toHaveProperty("stockQuantity");
  });

  it("aponta variação sem nome, sem valores, valores repetidos e excesso de combinações", () => {
    expect(variationProblems([option("", ["P"])])).toContain("Dê um nome a cada variação (ex.: Cor, Tamanho).");
    expect(variationProblems([option("Cor", [])])).toContain("Adicione ao menos um valor em Cor.");
    expect(variationProblems([option("Cor", ["Preto", "preto"])])).toContain("Há valores repetidos em Cor.");
    expect(variationProblems([option("A", Array.from({ length: 30 }, (_, i) => `a${i}`)), option("B", Array.from({ length: 20 }, (_, i) => `b${i}`))])[0]).toMatch(/limite é 500/);
  });
});

describe("segmentos", () => {
  it("cada segmento é coerente e produtos antigos encontram o seu", () => {
    for (const segment of PRODUCT_SEGMENTS) {
      if (segment.family === "VEHICLE" || segment.family === "REAL_ESTATE") expect(segment.variations).toBe(false);
      expect(new Set(segment.fields.map((field) => field.key)).size).toBe(segment.fields.length);
    }
    expect(segmentOf({ type: "APPAREL" }).id).toBe("apparel");
    expect(segmentOf({ type: "GENERAL" }, "service").id).toBe("service");
    expect(segmentOf({ type: "GENERAL", segment: "food" }).id).toBe("food");
  });
});
