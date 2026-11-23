import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { brandLogoPlacement, mapProtectedAreas, renderArt, HEIGHT, WIDTH } from "../scripts/editorial/codex-social-render.mjs";

// Auditoria visual 22/11/2026: a logo ia sempre dentro de uma placa (caixa), usava só a versão PRIMARY,
// caía no avatar opaco (quadrado branco) e o véu do texto, opaco nos 36% de cima, escondia o rosto do
// modelo da CMKV. Estes testes fixam o comportamento novo com imagens sintéticas.

const PROFILE_DARK = { identity: { colors: [{ name: "Preto principal", hex: "#0A0A0A", role: "PRIMARY" }, { name: "Dourado", hex: "#C9A227", role: "ACCENT" }, { name: "Off-white", hex: "#F5F2EB" }], typography: { family: "SANS" }, notes: "Moda streetwear premium." } };
const PROFILE_LIGHT = { identity: { colors: [{ name: "Rosewood", hex: "#7E3B45", role: "PRIMARY" }, { name: "Creme quente", hex: "#F7EBE3" }, { name: "Dourado suave", hex: "#C7A06E", role: "ACCENT" }], typography: { family: "SERIF" }, notes: "Fundo sempre claro (nunca escuro)." } };
const TEXT = { headline: "Um look bom pode começar por uma camiseta certa.", body: "Encontre um modelo no catálogo", cta: "Ver catálogo" };

async function base(color, shapes = "") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1088" height="1360"><rect width="100%" height="100%" fill="${color}"/>${shapes}</svg>`;
  return (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
}
async function logo({ background = "none", ink = "#1A1A1A", width = 600, height = 200 } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${background === "none" ? "" : `<rect width="100%" height="100%" fill="${background}"/>`}<rect x="${width * 0.1}" y="${height * 0.25}" width="${width * 0.8}" height="${height * 0.5}" rx="20" fill="${ink}"/></svg>`;
  return (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
}
async function pixels(b64) {
  return sharp(Buffer.from(b64, "base64")).removeAlpha().raw().toBuffer();
}
function at(raw, x, y) {
  const index = (Math.round(y) * WIDTH + Math.round(x)) * 3;
  return [raw[index], raw[index + 1], raw[index + 2]];
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = (value) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));

test("logo transparente com bom contraste: aplicada sem caixa — o entorno da logo é a própria foto", async () => {
  const result = await renderArt({ ...TEXT, profile: PROFILE_DARK, base: await base("#8FA3B8"), layout: "top", logoPlacement: "bottom_right", logos: [{ data: await logo(), variant: "PRIMARY", backgrounds: ["LIGHT"] }] });
  assert.equal(result.quality.logo.treatment, "none");
  assert.ok(result.quality.logo.contrast >= 3);
  const raw = await pixels(result.image);
  const { rect } = result.quality.logo;
  for (const [x, y] of [[rect.x - 14, rect.y + rect.h / 2], [rect.x + rect.w / 2, rect.y - 14], [rect.x + rect.w + 10, rect.y + rect.h / 2]]) {
    assert.ok(distance(at(raw, x, y), hex("#8FA3B8")) < 18, `sem placa/caixa em (${x},${y}): ${at(raw, x, y)}`);
  }
  assert.ok(rect.w <= 250 && rect.h <= 140 && rect.w >= 120, `tamanho proporcional: ${rect.w}x${rect.h}`);
  assert.ok(rect.x + rect.w <= WIDTH - 64 && rect.y + rect.h <= HEIGHT - 64, "margem segura");
});

test("logo sem transparência (avatar com fundo branco): o fundo sólido é removido, sem quadrado branco", async () => {
  // avatar 512x512 com fundo branco e duas barras douradas separadas por um vão
  const avatarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="100%" height="100%" fill="#FFFFFF"/><rect x="60" y="156" width="170" height="200" fill="#C9A227"/><rect x="282" y="156" width="170" height="200" fill="#C9A227"/></svg>`;
  const avatar = (await sharp(Buffer.from(avatarSvg)).png().toBuffer()).toString("base64");
  const result = await renderArt({ ...TEXT, profile: PROFILE_DARK, base: await base("#15151C"), layout: "top", logoPlacement: "bottom_right", logos: [{ data: avatar, variant: "AVATAR", backgrounds: [] }] });
  assert.equal(result.quality.logo.knockedOut, true);
  const { rect } = result.quality.logo;
  assert.ok(Math.abs(rect.w / rect.h - 392 / 200) < 0.15, `recortada na marca, não no quadrado: ${rect.w}x${rect.h}`);
  const raw = await pixels(result.image);
  // o vão entre as barras (antes fundo branco) mostra a foto escura
  const gap = at(raw, rect.x + rect.w / 2, rect.y + rect.h / 2);
  assert.ok(gap.every((value) => value < 80), `vão escuro, não branco: ${gap}`);
  const outside = at(raw, rect.x - 12, rect.y + rect.h / 2);
  assert.ok(outside.every((value) => value < 80), `sem quadrado branco ao redor: ${outside}`);
});

test("versão oficial compatível com o fundo: fundo escuro usa a versão para DARK; fundo claro, a PRIMARY", async () => {
  const logos = [
    { data: await logo({ ink: "#1A1A1A" }), variant: "PRIMARY", backgrounds: ["LIGHT"] },
    { data: await logo({ ink: "#F4F4F4" }), variant: "LIGHT", backgrounds: ["DARK"] },
  ];
  const dark = await renderArt({ ...TEXT, profile: PROFILE_DARK, base: await base("#101018"), layout: "top", logoPlacement: "bottom_right", logos });
  assert.equal(dark.quality.logo.variant, "LIGHT");
  assert.equal(dark.quality.logo.treatment, "none");
  const light = await renderArt({ ...TEXT, profile: PROFILE_LIGHT, base: await base("#EFE6DC"), layout: "top", logoPlacement: "bottom_right", logos });
  assert.equal(light.quality.logo.variant, "PRIMARY");
});

test("contraste insuficiente e sem versão alternativa: sombra/halo suave na silhueta, nunca placa", async () => {
  const result = await renderArt({ ...TEXT, profile: PROFILE_DARK, base: await base("#141414"), layout: "top", logoPlacement: "bottom_right", logos: [{ data: await logo({ ink: "#222222" }), variant: "PRIMARY", backgrounds: ["LIGHT"] }] });
  assert.ok(["shadow", "halo"].includes(result.quality.logo.treatment), result.quality.logo.treatment);
  assert.ok(result.quality.logo.contrast > result.quality.logo.rawContrast);
});

test("rosto na área de respiro pedida: o texto muda de lugar e o rosto não recebe véu", async () => {
  // "rosto" claro no alto, centro-direita (como a CMKV): x 60–78%, y 12–28% da base.
  const face = `<ellipse cx="${1088 * 0.69}" cy="${1360 * 0.2}" rx="${1088 * 0.09}" ry="${1360 * 0.08}" fill="#E0B090"/>`;
  const result = await renderArt({
    ...TEXT, profile: PROFILE_DARK, base: await base("#A08060", face), layout: "top", logoPlacement: "bottom_right",
    logos: [{ data: await logo({ ink: "#F4F4F4" }), variant: "PRIMARY", backgrounds: ["DARK"] }],
    protectedAreas: [{ kind: "face", x: 60, y: 12, width: 18, height: 16 }],
  });
  assert.notEqual(result.quality.layout, "top", "o layout pedido cobriria o rosto");
  const raw = await pixels(result.image);
  const [area] = result.quality.protectedAreas;
  const center = at(raw, area.x + area.w / 2, area.y + area.h / 2);
  assert.ok(distance(center, hex("#E0B090")) < 22, `rosto intacto: ${center}`);
});

test("sem lugar para o texto fora dos rostos: a verificação de qualidade recusa a arte", async () => {
  await assert.rejects(async () => renderArt({
    ...TEXT, profile: PROFILE_DARK, base: await base("#808080"), layout: "top", logoPlacement: "bottom_right",
    logos: [{ data: await logo({ ink: "#F4F4F4" }), variant: "PRIMARY", backgrounds: ["DARK"] }],
    protectedAreas: [{ kind: "face", x: 0, y: 0, width: 100, height: 100 }],
  }), /QUALITY_COMPOSITION/);
});

test("posição da logo definida pela marca: notas do Perfil da Marca ou configuração do workspace", async () => {
  assert.equal(brandLogoPlacement({ identity: { notes: "Paleta quente. Logo oficial no topo, centralizada; divisor fino." } }), "top_center");
  assert.equal(brandLogoPlacement({ identity: { notes: "Logo oficial na parte inferior direita." } }), "bottom_right");
  assert.equal(brandLogoPlacement({ identity: { notes: "Logo no topo, centralizada" } }, { placement: "bottom_left" }), "bottom_left", "configuração do workspace prevalece");
  assert.equal(brandLogoPlacement({ identity: { notes: "Sem regra de logo." } }), undefined);
  const result = await renderArt({ ...TEXT, profile: { identity: { ...PROFILE_LIGHT.identity, notes: "Fundo sempre claro. Logo oficial no topo, centralizada." } }, base: await base("#EFE6DC"), layout: "top", logoPlacement: "bottom_right", logos: [{ data: await logo(), variant: "PRIMARY", backgrounds: ["LIGHT"] }] });
  assert.equal(result.quality.logo.placement, "top_center");
  assert.equal(result.quality.logo.fixedByBrand, true);
  assert.ok(result.quality.textRect.y > result.quality.logo.rect.y + result.quality.logo.rect.h, "texto começa abaixo da logo");
});

test("véu proporcional: área limpa recebe véu leve e o texto mantém contraste ≥ 4.5", async () => {
  const result = await renderArt({ ...TEXT, profile: PROFILE_DARK, base: await base("#1C1C24"), layout: "top", logoPlacement: "bottom_right", logos: [{ data: await logo({ ink: "#F4F4F4" }), variant: "PRIMARY", backgrounds: ["DARK"] }] });
  assert.ok(result.quality.veilAlpha <= 0.35, `véu ${result.quality.veilAlpha}`);
  assert.ok(result.quality.textContrast >= 4.5, `contraste ${result.quality.textContrast}`);
});

test("áreas protegidas em % da base são convertidas para o canvas considerando o recorte 4:5", () => {
  // base 1092x1440 (mais alta que 4:5): escala 1080/1092 e corta ~37px em cima e embaixo
  const [face] = mapProtectedAreas([{ kind: "face", x: 50, y: 10, width: 10, height: 10 }], 1092, 1440);
  const scale = 1080 / 1092;
  assert.ok(Math.abs(face.x - 546 * scale) < 1);
  assert.ok(Math.abs(face.y - (144 * scale - (1440 * scale - HEIGHT) / 2)) < 1);
  assert.deepEqual(mapProtectedAreas([{ kind: "unknown", x: 1, y: 1, width: 5, height: 5 }], 1092, 1440), []);
});

test("cadastro incoerente: versão 'para fundo escuro' que é escura não é tratada como compatível e gera aviso", async () => {
  const result = await renderArt({
    ...TEXT, profile: PROFILE_DARK, base: await base("#101018"), layout: "top", logoPlacement: "bottom_right",
    logos: [{ data: await logo({ ink: "#1A1A1A" }), variant: "PRIMARY", backgrounds: ["LIGHT"] }, { data: await logo({ ink: "#202024" }), variant: "LIGHT", backgrounds: ["DARK"] }],
  });
  assert.ok(result.quality.warnings.some((warning) => /LIGHT.*fundo escuro, mas é escura/.test(warning)), result.quality.warnings.join(" | "));
  assert.ok(result.quality.warnings.some((warning) => /falta uma versão oficial/.test(warning)));
  assert.notEqual(result.quality.logo.treatment, "plate", "sem caixa mesmo assim");
});
