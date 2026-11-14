import test from "node:test";
import assert from "node:assert/strict";
import { photographedVariants } from "../dist/application/sites/site-use-cases.js";

const options = [
  { key: "cor", name: "Cor", values: ["Preto", "Azul", "Verde"], images: { Preto: "https://x/preto.webp" } },
  { key: "tamanho", name: "Tamanho", values: ["P", "M"] },
];
const variant = (cor, tamanho, imageUrl) => ({ id: `${cor}-${tamanho}`, optionValues: { cor, tamanho }, ...(imageUrl ? { imageUrl } : {}) });

test("site shows only variations with a photo, by colour or by their own photo", () => {
  const all = [variant("Preto", "P"), variant("Preto", "M"), variant("Azul", "P"), variant("Azul", "M", "https://x/azul-m.webp"), variant("Verde", "P")];
  const { variants, options: shown } = photographedVariants(options, all);
  assert.deepEqual(variants.map((item) => item.id), ["Preto-P", "Preto-M", "Azul-M"]);
  assert.deepEqual(shown[0].values, ["Preto", "Azul"]);
  assert.deepEqual(shown[0].images, { Preto: "https://x/preto.webp" });
  assert.deepEqual(shown[1].values, ["P", "M"]);
});

test("a product without any photo link keeps every variation", () => {
  const bare = options.map(({ images, ...option }) => option);
  const all = [variant("Preto", "P"), variant("Azul", "M")];
  const result = photographedVariants(bare, all);
  assert.equal(result.variants, all);
  assert.equal(result.options, bare);
});

test("extra photos of a value (e.g. the back) are kept for shown values and dropped with hidden ones", async () => {
  const { productOptionSchema } = await import("../dist/domain/products/product-details.js");
  const option = { key: "cor", name: "Cor", values: ["Preto", "Azul"], images: { Preto: "https://x/f.webp" }, extraImages: { Preto: ["https://x/b.webp"] } };
  assert.equal(productOptionSchema.safeParse(option).success, true);
  assert.equal(productOptionSchema.safeParse({ ...option, extraImages: { Verde: ["https://x/v.webp"] } }).success, false);
  const { options: shown } = photographedVariants([option], [{ id: "p", optionValues: { cor: "Preto" } }, { id: "a", optionValues: { cor: "Azul" } }]);
  assert.deepEqual(shown[0].values, ["Preto"]);
  assert.deepEqual(shown[0].extraImages, { Preto: ["https://x/b.webp"] });
});
