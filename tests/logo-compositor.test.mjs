import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { compositeLogoOntoImage } from "../dist/infrastructure/media/logo-compositor.js";

async function makeSolidPng(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

test("compositeLogoOntoImage: mantém as dimensões da imagem original e devolve PNG válido", async () => {
  const imageBuffer = await makeSolidPng(1024, 1024, { r: 20, g: 20, b: 20, alpha: 1 });
  const logoBuffer = await makeSolidPng(300, 120, { r: 10, g: 200, b: 80, alpha: 1 });

  const result = await compositeLogoOntoImage({ imageBuffer, logoBuffer });
  const meta = await sharp(result).metadata();

  assert.equal(meta.format, "png");
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
});

test("compositeLogoOntoImage: funciona com logo em proporção retrato (mais alta que larga)", async () => {
  const imageBuffer = await makeSolidPng(1080, 1350, { r: 240, g: 240, b: 240, alpha: 1 });
  const logoBuffer = await makeSolidPng(150, 400, { r: 5, g: 60, b: 200, alpha: 1 });

  const result = await compositeLogoOntoImage({ imageBuffer, logoBuffer });
  const meta = await sharp(result).metadata();

  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1350);
});

test("compositeLogoOntoImage: o resultado difere do original (a logo foi de fato colada)", async () => {
  const imageBuffer = await makeSolidPng(800, 800, { r: 0, g: 0, b: 0, alpha: 1 });
  const logoBuffer = await makeSolidPng(200, 200, { r: 255, g: 255, b: 255, alpha: 1 });

  const result = await compositeLogoOntoImage({ imageBuffer, logoBuffer });
  assert.notEqual(Buffer.compare(result, imageBuffer), 0);

  // Padrão é "top-left" — o canto superior esquerdo deveria ter ficado mais claro (cartão branco +
  // logo), não mais preto.
  const cornerPixel = await sharp(result)
    .extract({ left: 50, top: 50, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.ok(cornerPixel[0] > 100, `esperava canal vermelho claro no canto, veio ${cornerPixel[0]}`);
});

test("compositeLogoOntoImage: respeita o canto pedido (bottom-right)", async () => {
  const imageBuffer = await makeSolidPng(800, 800, { r: 0, g: 0, b: 0, alpha: 1 });
  const logoBuffer = await makeSolidPng(200, 200, { r: 255, g: 255, b: 255, alpha: 1 });

  const result = await compositeLogoOntoImage({ imageBuffer, logoBuffer, corner: "bottom-right" });

  const bottomRightPixel = await sharp(result).extract({ left: 750, top: 750, width: 1, height: 1 }).raw().toBuffer();
  const topLeftPixel = await sharp(result).extract({ left: 50, top: 50, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(bottomRightPixel[0] > 100, `esperava canal vermelho claro no canto inferior direito, veio ${bottomRightPixel[0]}`);
  assert.equal(topLeftPixel[0], 0, "canto superior esquerdo deveria continuar preto (sem logo)");
});

test("compositeLogoOntoImage: rejeita quando a imagem base não tem metadados de dimensão válidos", async () => {
  await assert.rejects(
    () => compositeLogoOntoImage({ imageBuffer: Buffer.from("not an image"), logoBuffer: Buffer.from("also not an image") }),
  );
});
