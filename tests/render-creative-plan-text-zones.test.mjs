import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { renderCreativePlanTextZones } from "../dist/infrastructure/rendering/render-creative-plan-text-zones.js";

async function makeSolidPng(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

test("renderCreativePlanTextZones: sem zonas, devolve a imagem base intocada", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 255, g: 255, b: 255, alpha: 1 });
  const result = await renderCreativePlanTextZones({ baseImageBuffer, zones: [] });
  assert.equal(Buffer.compare(result.buffer, baseImageBuffer), 0);
  assert.deepEqual(result.renderedZones, []);
});

test("renderCreativePlanTextZones: rejeita quando a imagem base não tem metadados de dimensão válidos", async () => {
  await assert.rejects(
    () => renderCreativePlanTextZones({ baseImageBuffer: Buffer.from("not an image"), zones: [{ kind: "cta", text: "x", rect: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" }] }),
  );
});

test("renderCreativePlanTextZones: zona emphasis=primary desenha um scrim escuro + texto branco (legível sobre qualquer fundo)", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 255, g: 255, b: 255, alpha: 1 });
  const zones = [{ kind: "headline", text: "OFERTA IMPERDÍVEL", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }];

  const result = await renderCreativePlanTextZones({ baseImageBuffer, zones });
  assert.equal(result.renderedZones.length, 1);
  assert.equal(result.renderedZones[0].kind, "headline");
  assert.notEqual(Buffer.compare(result.buffer, baseImageBuffer), 0);

  // Ponto perto da borda esquerda da caixa (mas além do raio de arredondamento do cartão) e no
  // meio vertical — dentro do retângulo preenchido, longe do texto centralizado e do canto
  // arredondado, deveria mostrar o scrim escuro em vez do fundo branco original.
  const zoneLeft = Math.round(0.10 * 1080);
  const zoneTop = Math.round(0.10 * 1350);
  const zoneWidthPx = Math.round(0.80 * 1080);
  const zoneHeightPx = Math.round(0.15 * 1350);
  const probePixel = await sharp(result.buffer)
    .extract({ left: zoneLeft + Math.round(zoneWidthPx * 0.1), top: zoneTop + Math.round(zoneHeightPx / 2), width: 1, height: 1 })
    .raw()
    .toBuffer();
  // rgba(0,0,0,0.55) sobre fundo branco (255) resulta em ~255*0.45 = 114.75 — bem mais escuro
  // que o branco original (255), mesmo sem opacidade total.
  assert.ok(probePixel[0] < 150, `esperava scrim escuro (fundo original era branco 255), veio R=${probePixel[0]}`);
});

test("renderCreativePlanTextZones: zona emphasis=secondary usa a cor de destaque da marca como fundo", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 255, g: 255, b: 255, alpha: 1 });
  const zones = [{ kind: "cta", text: "COMPRE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }];

  const result = await renderCreativePlanTextZones({ baseImageBuffer, zones, accentColor: "#0000FF" });
  const zoneLeft = Math.round(0.10 * 1080);
  const zoneTop = Math.round(0.80 * 1350);
  const probePixel = await sharp(result.buffer).extract({ left: zoneLeft + 5, top: zoneTop + 5, width: 1, height: 1 }).raw().toBuffer();
  // Fundo azul puro: canal azul dominante, vermelho/verde baixos.
  assert.ok(probePixel[2] > 150, `esperava canal azul dominante (accentColor), veio B=${probePixel[2]}`);
  assert.ok(probePixel[0] < 60, `esperava canal vermelho baixo, veio R=${probePixel[0]}`);
});

test("renderCreativePlanTextZones: múltiplas zonas são todas compostas e reportadas em renderedZones", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 255, g: 255, b: 255, alpha: 1 });
  const zones = [
    { kind: "headline", text: "TÍTULO", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" },
    { kind: "price", text: "R$ 39,99", rect: { xPct: 5, yPct: 60, widthPct: 40, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
    { kind: "cta", text: "COMPRE", rect: { xPct: 5, yPct: 80, widthPct: 40, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
  ];

  const result = await renderCreativePlanTextZones({ baseImageBuffer, zones });
  assert.equal(result.renderedZones.length, 3);
  assert.deepEqual(result.renderedZones.map((zone) => zone.kind), ["headline", "price", "cta"]);
  for (const zone of result.renderedZones) {
    assert.ok(zone.fontSizePx > 0);
  }
});
