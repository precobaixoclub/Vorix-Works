import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { compositeScreenshotIntoDeviceMockup } from "../dist/infrastructure/media/screenshot-mockup-compositor.js";

async function makeSolidPng(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

// Área quadrada 20%-80% em ambos os eixos — mantém o teste legível independente do formato do
// canvas (a proporção resultante da área útil varia com o canvas, então cada teste escolhe um
// screenshot de proporção compatível, comentado com a conta).
const CENTER_PLACEMENT = { xPct: 20, yPct: 20, widthPct: 60, heightPct: 60 };

test("compositeScreenshotIntoDeviceMockup: mantém as dimensões da imagem base e devolve JPEG válido", async () => {
  const imageBuffer = await makeSolidPng(1080, 1350, { r: 20, g: 20, b: 20, alpha: 1 });
  // 1080x1350 + CENTER_PLACEMENT -> mockup 648x810, bezel 23 -> área útil 602x764 (proporção
  // ~0.788); screenshot 1200x1520 tem proporção ~0.789 (compatível).
  const screenshotBuffer = await makeSolidPng(1200, 1520, { r: 255, g: 255, b: 255, alpha: 1 });

  const result = await compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement: CENTER_PLACEMENT });
  const meta = await sharp(result).metadata();

  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1350);
});

test("compositeScreenshotIntoDeviceMockup: o resultado difere do original (o screenshot foi de fato colado na geometria pedida)", async () => {
  const imageBuffer = await makeSolidPng(1024, 1024, { r: 0, g: 0, b: 0, alpha: 1 });
  // Canvas quadrado + CENTER_PLACEMENT -> área útil também quadrada; screenshot quadrado é
  // sempre compatível.
  const screenshotBuffer = await makeSolidPng(900, 900, { r: 255, g: 255, b: 255, alpha: 1 });

  const result = await compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement: CENTER_PLACEMENT });
  assert.notEqual(Buffer.compare(result, imageBuffer), 0);

  // CENTER_PLACEMENT reserva 20%-80% em ambos os eixos — o centro geométrico da imagem
  // (512, 512 numa base 1024x1024) cai dentro dessa área e deveria ter ficado claro (tela branca
  // do mockup) em vez de preto.
  const centerPixel = await sharp(result).extract({ left: 512, top: 512, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(centerPixel[0] > 100, `esperava canal vermelho claro dentro da área reservada, veio ${centerPixel[0]}`);
});

test("compositeScreenshotIntoDeviceMockup: fora da área reservada, a imagem original permanece intocada", async () => {
  const imageBuffer = await makeSolidPng(1024, 1024, { r: 0, g: 0, b: 0, alpha: 1 });
  const screenshotBuffer = await makeSolidPng(900, 900, { r: 255, g: 255, b: 255, alpha: 1 });

  const result = await compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement: CENTER_PLACEMENT });
  const cornerPixel = await sharp(result).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer();
  assert.equal(cornerPixel[0], 0, "canto superior esquerdo (fora da área reservada) deveria continuar preto");
});

test("compositeScreenshotIntoDeviceMockup: frame 'phone' arredonda bem mais os cantos que 'laptop' (mesma geometria, mesmo placement)", async () => {
  // Migração "GPT como motor criativo único" (PR 4/9): a geometria (largura/altura do mockup)
  // agora vem inteiramente de `placement` (decidido pelo creative_plan) — `frame` não muda mais o
  // TAMANHO do mockup (isso seria geometria desconectada do plano, o problema que este PR corrige),
  // só o tratamento visual da moldura (`cornerRadius`: 12% da largura pra "phone", 4% pra
  // "laptop"). O teste verifica essa diferença de arredondamento, não de largura.
  // Base vermelho vivo (nunca preto) de propósito: a moldura do device é quase-preta (#0a0a0a) —
  // com fundo preto, o canto "cortado" pelo arredondamento (que deixa a base transparecer) fica
  // visualmente idêntico à própria moldura, mascarando a diferença que este teste quer provar.
  const imageBuffer = await makeSolidPng(1600, 1000, { r: 255, g: 0, b: 0, alpha: 1 });
  const screenshotBuffer = await makeSolidPng(1600, 1000, { r: 255, g: 255, b: 255, alpha: 1 });
  const placement = { xPct: 10, yPct: 10, widthPct: 80, heightPct: 80 };

  const phoneResult = await compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement, frame: "phone" });
  const laptopResult = await compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement, frame: "laptop" });

  // mockupWidth = 80% de 1600 = 1280px. cornerRadius: phone = round(1280*0.12) = 154;
  // laptop = round(1280*0.04) = 51. Um ponto a 20px (diagonal) do canto verdadeiro do mockup:
  // pra phone, a distância até o centro do arco (154,154) é ~189.5px > raio 154 -> FORA do
  // círculo -> região cortada (transparente, mostra o vermelho da base). Pra laptop, a distância
  // até (51,51) é ~43.8px < raio 51 -> DENTRO do círculo -> preenchido com a moldura escura.
  const mockupLeft = Math.round(0.10 * 1600);
  const mockupTop = Math.round(0.10 * 1000);
  const probeOffset = 20;
  const phonePixel = await sharp(phoneResult).extract({ left: mockupLeft + probeOffset, top: mockupTop + probeOffset, width: 1, height: 1 }).raw().toBuffer();
  const laptopPixel = await sharp(laptopResult).extract({ left: mockupLeft + probeOffset, top: mockupTop + probeOffset, width: 1, height: 1 }).raw().toBuffer();

  assert.ok(phonePixel[0] > 150, `phone: esperava vermelho da base transparecendo no canto cortado, veio R=${phonePixel[0]}`);
  assert.ok(laptopPixel[0] < 60, `laptop: esperava a moldura escura preenchendo o mesmo ponto, veio R=${laptopPixel[0]}`);
  assert.notEqual(Buffer.compare(phoneResult, laptopResult), 0, "os dois resultados completos devem diferir (frame realmente aplicado)");
});

test("compositeScreenshotIntoDeviceMockup: rejeita quando a imagem base não tem metadados de dimensão válidos", async () => {
  await assert.rejects(
    () => compositeScreenshotIntoDeviceMockup({ imageBuffer: Buffer.from("not an image"), screenshotBuffer: Buffer.from("also not an image"), placement: CENTER_PLACEMENT }),
  );
});

// ---------------------------------------------------------------------------------------------
// PR 4/9 (migração "GPT como motor criativo único") — hard failures, nunca degradação silenciosa
// ---------------------------------------------------------------------------------------------

test("HARD FAIL: placement fora dos limites do canvas (x+width > 100)", async () => {
  const imageBuffer = await makeSolidPng(1080, 1350, { r: 0, g: 0, b: 0, alpha: 1 });
  const screenshotBuffer = await makeSolidPng(800, 1600, { r: 255, g: 255, b: 255, alpha: 1 });

  await assert.rejects(
    () => compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement: { xPct: 90, yPct: 10, widthPct: 30, heightPct: 20 } }),
    /SCREENSHOT_COMPOSITE_PLACEMENT_OUT_OF_BOUNDS/,
  );
});

test("HARD FAIL: placement com largura/altura zero ou negativa", async () => {
  const imageBuffer = await makeSolidPng(1080, 1350, { r: 0, g: 0, b: 0, alpha: 1 });
  const screenshotBuffer = await makeSolidPng(800, 1600, { r: 255, g: 255, b: 255, alpha: 1 });

  await assert.rejects(
    () => compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement: { xPct: 10, yPct: 10, widthPct: 0, heightPct: 20 } }),
    /SCREENSHOT_COMPOSITE_PLACEMENT_OUT_OF_BOUNDS/,
  );
});

test("HARD FAIL: área útil final abaixo do mínimo legível (200px)", async () => {
  const imageBuffer = await makeSolidPng(400, 400, { r: 0, g: 0, b: 0, alpha: 1 });
  const screenshotBuffer = await makeSolidPng(800, 1600, { r: 255, g: 255, b: 255, alpha: 1 });

  // 10% de 400px = 40px de mockup — bem abaixo de qualquer leitura de interface real.
  await assert.rejects(
    () => compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement: { xPct: 10, yPct: 10, widthPct: 10, heightPct: 10 } }),
    /SCREENSHOT_COMPOSITE_PLACEMENT_TOO_SMALL/,
  );
});

test("HARD FAIL: screenshot real com proporção muito diferente da área reservada (>40% de desvio)", async () => {
  const imageBuffer = await makeSolidPng(1000, 1000, { r: 0, g: 0, b: 0, alpha: 1 });
  // Área reservada 50%x50% de 1000x1000 -> proporção ~1.0; screenshot extremamente panorâmico
  // (proporção 5:1) desvia muito além do tolerado.
  const screenshotBuffer = await makeSolidPng(2500, 500, { r: 255, g: 255, b: 255, alpha: 1 });

  await assert.rejects(
    () => compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement: { xPct: 10, yPct: 10, widthPct: 50, heightPct: 50 } }),
    /SCREENSHOT_COMPOSITE_SOURCE_ASPECT_MISMATCH/,
  );
});

test("regressão: proporção do screenshot compatível com a área reservada (dentro de 40%) não falha", async () => {
  const imageBuffer = await makeSolidPng(1080, 1350, { r: 0, g: 0, b: 0, alpha: 1 });
  // Mesma conta do primeiro teste: área útil ~602x764 (proporção ~0.788); screenshot 630x800 tem
  // proporção ~0.7875 (compatível).
  const screenshotBuffer = await makeSolidPng(630, 800, { r: 255, g: 255, b: 255, alpha: 1 });

  await assert.doesNotReject(
    () => compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, placement: CENTER_PLACEMENT }),
  );
});
