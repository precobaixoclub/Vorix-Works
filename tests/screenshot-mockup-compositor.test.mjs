import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { compositeScreenshotIntoDeviceMockup } from "../dist/infrastructure/media/screenshot-mockup-compositor.js";

async function makeSolidPng(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

test("compositeScreenshotIntoDeviceMockup: mantém as dimensões da imagem base e devolve JPEG válido", async () => {
  const imageBuffer = await makeSolidPng(1080, 1350, { r: 20, g: 20, b: 20, alpha: 1 });
  const screenshotBuffer = await makeSolidPng(1200, 2000, { r: 255, g: 255, b: 255, alpha: 1 });

  const result = await compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer });
  const meta = await sharp(result).metadata();

  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1350);
});

test("compositeScreenshotIntoDeviceMockup: o resultado difere do original (o screenshot foi de fato colado)", async () => {
  const imageBuffer = await makeSolidPng(1024, 1024, { r: 0, g: 0, b: 0, alpha: 1 });
  const screenshotBuffer = await makeSolidPng(800, 1600, { r: 255, g: 255, b: 255, alpha: 1 });

  const result = await compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer });
  assert.notEqual(Buffer.compare(result, imageBuffer), 0);

  // O mockup fica centralizado, na região central-inferior — o centro da imagem deveria ter
  // ficado bem mais claro (tela branca do screenshot) do que o fundo preto original.
  const centerPixel = await sharp(result).extract({ left: 512, top: 700, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(centerPixel[0] > 100, `esperava canal vermelho claro no centro (tela do mockup), veio ${centerPixel[0]}`);
});

test("compositeScreenshotIntoDeviceMockup: frame 'laptop' fica mais largo que o frame 'phone' padrão", async () => {
  const imageBuffer = await makeSolidPng(1600, 1000, { r: 0, g: 0, b: 0, alpha: 1 });
  const screenshotBuffer = await makeSolidPng(1600, 1000, { r: 255, g: 255, b: 255, alpha: 1 });

  const phoneResult = await compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, frame: "phone" });
  const laptopResult = await compositeScreenshotIntoDeviceMockup({ imageBuffer, screenshotBuffer, frame: "laptop" });

  // Conta pixels claros (tela do mockup) numa faixa horizontal no meio vertical do mockup — o
  // frame "laptop" deveria acender uma faixa mais larga.
  async function lightPixelSpan(buffer) {
    const meta = await sharp(buffer).metadata();
    const row = await sharp(buffer).extract({ left: 0, top: Math.round(meta.height * 0.5), width: meta.width, height: 1 }).raw().toBuffer();
    let count = 0;
    for (let i = 0; i < row.length; i += 3) if (row[i] > 200) count += 1;
    return count;
  }

  const phoneSpan = await lightPixelSpan(phoneResult);
  const laptopSpan = await lightPixelSpan(laptopResult);
  assert.ok(laptopSpan > phoneSpan, `esperava laptop mais largo que phone; phone=${phoneSpan} laptop=${laptopSpan}`);
});

test("compositeScreenshotIntoDeviceMockup: rejeita quando a imagem base não tem metadados de dimensão válidos", async () => {
  await assert.rejects(
    () => compositeScreenshotIntoDeviceMockup({ imageBuffer: Buffer.from("not an image"), screenshotBuffer: Buffer.from("also not an image") }),
  );
});
