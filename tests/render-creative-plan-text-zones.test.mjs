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

// Achado ao vivo em produção: `accentColor` veio "verde" — nome de cor livre em português
// (brandColors[0], pensado pro prompt do modelo de imagem, nunca hex) — e uma zona secondary
// usava essa string direto como fundo CSS sem validar. Resultado real: texto completamente
// invisível (max de brilho ~17/255 numa imagem de fundo escura, medido pixel a pixel na peça
// real). Precisa cair pro accentColor padrão (#FACC15, amarelo — visível e com texto escuro
// legível por cima) em vez de um fundo indefinido.

test("renderCreativePlanTextZones: accentColor não-hex (nome de cor livre, caso real de produção) cai pro padrão em vez de ficar invisível", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 0, g: 0, b: 0, alpha: 1 });
  const zones = [{ kind: "subheadline", text: "COMPRE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }];

  const result = await renderCreativePlanTextZones({ baseImageBuffer, zones, accentColor: "verde" });
  const zoneLeft = Math.round(0.10 * 1080);
  const zoneTop = Math.round(0.80 * 1350);
  const probePixel = await sharp(result.buffer).extract({ left: zoneLeft + 5, top: zoneTop + 5, width: 1, height: 1 }).raw().toBuffer();
  // Fundo amarelo padrão (#FACC15): vermelho e verde altos, azul baixo — nunca preto/indefinido.
  assert.ok(probePixel[0] > 200 && probePixel[1] > 150, `esperava o accentColor padrão (amarelo), veio R=${probePixel[0]} G=${probePixel[1]} B=${probePixel[2]}`);
});

// Achado ao vivo em produção: uma frase longa de subheadline ("Shopee + Mercado Livre.
// Promoções selecionadas para você economizar sem perder tempo.") saiu com fonte no piso mínimo
// de 10px — branco sobre preto, contraste de cor tecnicamente perfeito, mas ilegível de tão
// minúsculo. O cálculo antigo assumia texto de UMA linha só; a caixa na prática permite quebrar
// em várias linhas (sem whiteSpace:nowrap), então devia ter usado uma fonte bem maior.

test("renderCreativePlanTextZones: subheadline de frase longa usa fonte legível (quebra em várias linhas em vez de encolher até o piso mínimo)", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 255, g: 255, b: 255, alpha: 1 });
  const zones = [
    {
      kind: "subheadline",
      text: "Shopee + Mercado Livre. Promoções selecionadas para você economizar sem perder tempo.",
      rect: { xPct: 5, yPct: 70, widthPct: 90, heightPct: 10 },
      emphasis: "primary",
      renderedBy: "renderer",
    },
  ];
  const result = await renderCreativePlanTextZones({ baseImageBuffer, zones });
  assert.equal(result.renderedZones.length, 1);
  assert.ok(result.renderedZones[0].fontSizePx > 16, `esperava fonte legível (>16px), veio ${result.renderedZones[0].fontSizePx}px`);
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

// Auditoria "qualidade visual e direção de arte" — antes destes testes, `align`/`backingStyle`
// existiam no tipo `CreativePlanTextZone` mas eram completamente ignorados aqui: o renderer sempre
// aplicava o mesmo tratamento fixo por `emphasis` (scrim/solid/center), nunca a decisão real do
// plano. Estes testes travam o comportamento NOVO (plano decide) e confirmam que o comportamento
// HISTÓRICO (campo ausente) nunca muda — ver `resolveZoneBacking`/`resolveZoneAlignment`.

test("renderCreativePlanTextZones: backingStyle='none' desenha o texto direto sobre a imagem, sem nenhuma caixa de fundo", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 20, g: 20, b: 20, alpha: 1 });
  const zones = [{ kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer", backingStyle: "none" }];

  const result = await renderCreativePlanTextZones({ baseImageBuffer, zones });
  const zoneLeft = Math.round(0.10 * 1080);
  const zoneTop = Math.round(0.10 * 1350);
  const zoneWidthPx = Math.round(0.80 * 1080);
  const zoneHeightPx = Math.round(0.15 * 1350);
  // Mesmo ponto de prova usado no teste de scrim (fundo original, longe do texto centralizado) —
  // sem caixa nenhuma, deveria continuar exatamente a cor de fundo original (20,20,20), nunca o
  // escurecimento do scrim (~9 sobre um fundo já escuro).
  const probePixel = await sharp(result.buffer)
    .extract({ left: zoneLeft + Math.round(zoneWidthPx * 0.1), top: zoneTop + Math.round(zoneHeightPx / 2), width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.equal(probePixel[0], 20, `backingStyle="none" nunca deveria desenhar uma caixa de fundo, veio R=${probePixel[0]}`);
});

test("renderCreativePlanTextZones: backingStyle='scrim' força a faixa escura mesmo numa zona emphasis=secondary", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 255, g: 255, b: 255, alpha: 1 });
  const zones = [{ kind: "cta", text: "COMPRE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer", backingStyle: "scrim" }];

  const result = await renderCreativePlanTextZones({ baseImageBuffer, zones, accentColor: "#0000FF" });
  const zoneLeft = Math.round(0.10 * 1080);
  const zoneTop = Math.round(0.80 * 1350);
  const probePixel = await sharp(result.buffer).extract({ left: zoneLeft + 5, top: zoneTop + 5, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(probePixel[0] < 150, `backingStyle="scrim" deveria vencer o accentColor de "secondary", veio R=${probePixel[0]} B=${probePixel[2]}`);
});

test("renderCreativePlanTextZones: backingStyle='solid' força a cor de destaque mesmo numa zona emphasis=primary", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 255, g: 255, b: 255, alpha: 1 });
  const zones = [{ kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer", backingStyle: "solid" }];

  const result = await renderCreativePlanTextZones({ baseImageBuffer, zones, accentColor: "#0000FF" });
  const zoneLeft = Math.round(0.10 * 1080);
  const zoneTop = Math.round(0.10 * 1350);
  const zoneWidthPx = Math.round(0.80 * 1080);
  const zoneHeightPx = Math.round(0.15 * 1350);
  const probePixel = await sharp(result.buffer)
    .extract({ left: zoneLeft + Math.round(zoneWidthPx * 0.1), top: zoneTop + Math.round(zoneHeightPx / 2), width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.ok(probePixel[2] > 150 && probePixel[0] < 60, `backingStyle="solid" deveria vencer o scrim de "primary", veio R=${probePixel[0]} B=${probePixel[2]}`);
});

test("renderCreativePlanTextZones: sem backingStyle definido, o comportamento histórico por emphasis nunca muda", async () => {
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 255, g: 255, b: 255, alpha: 1 });
  const zonesWithField = [{ kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer", backingStyle: undefined }];
  const zonesWithoutField = [{ kind: "headline", text: "OFERTA", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }];

  const [withField, withoutField] = await Promise.all([
    renderCreativePlanTextZones({ baseImageBuffer, zones: zonesWithField }),
    renderCreativePlanTextZones({ baseImageBuffer, zones: zonesWithoutField }),
  ]);
  assert.equal(Buffer.compare(withField.buffer, withoutField.buffer), 0);
});

test("renderCreativePlanTextZones: align='left' produz uma imagem diferente de align='center' (mesma zona, mesmo texto)", async () => {
  // Fundo ESCURO de propósito: `backingStyle: "none"` sempre desenha texto branco (ver
  // `resolveZoneBacking`) — sobre um fundo branco o texto fica invisível (branco sobre branco) e
  // QUALQUER alinhamento produziria o mesmo PNG em branco, mascarando um bug real de alinhamento.
  const baseImageBuffer = await makeSolidPng(1080, 1350, { r: 10, g: 10, b: 10, alpha: 1 });
  const rect = { xPct: 5, yPct: 40, widthPct: 90, heightPct: 15 };

  const [leftAligned, centerAligned] = await Promise.all([
    renderCreativePlanTextZones({ baseImageBuffer, zones: [{ kind: "headline", text: "OFERTA IMPERDÍVEL", rect, emphasis: "secondary", renderedBy: "renderer", backingStyle: "none", align: "left" }] }),
    renderCreativePlanTextZones({ baseImageBuffer, zones: [{ kind: "headline", text: "OFERTA IMPERDÍVEL", rect, emphasis: "secondary", renderedBy: "renderer", backingStyle: "none", align: "center" }] }),
  ]);
  assert.notEqual(Buffer.compare(leftAligned.buffer, centerAligned.buffer), 0, "align deveria mudar a posição real do texto renderizado");
});
