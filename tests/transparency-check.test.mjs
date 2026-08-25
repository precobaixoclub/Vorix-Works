import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { hasRealTransparency } from "../dist/infrastructure/image-processing/transparency-check.js";

async function makeJpeg() {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
}

async function makeOpaquePng() {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 200, b: 10 } } }).png().toBuffer();
}

async function makeTransparentPng() {
  return sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 0 } } }).png().toBuffer();
}

async function makeTransparentWebp() {
  return sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 0 } } }).webp().toBuffer();
}

test("hasRealTransparency: JPEG nunca tem canal alfa — sempre false, mesmo formalmente 'válido'", async () => {
  const jpeg = await makeJpeg();
  assert.equal(await hasRealTransparency(jpeg, "image/jpeg"), false);
});

test("hasRealTransparency: PNG sem canal alfa (3 canais, sem transparência real) é false", async () => {
  const opaquePng = await makeOpaquePng();
  assert.equal(await hasRealTransparency(opaquePng, "image/png"), false);
});

test("hasRealTransparency: PNG com canal alfa real é true", async () => {
  const transparentPng = await makeTransparentPng();
  assert.equal(await hasRealTransparency(transparentPng, "image/png"), true);
});

test("hasRealTransparency: WEBP com canal alfa real é true", async () => {
  const transparentWebp = await makeTransparentWebp();
  assert.equal(await hasRealTransparency(transparentWebp, "image/webp"), true);
});

test("hasRealTransparency: SVG é sempre considerado transparente (vetorial, nunca reprovado aqui)", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
  assert.equal(await hasRealTransparency(svg, "image/svg+xml"), true);
});

test("hasRealTransparency: bytes ilegíveis pelo sharp nunca lançam — devolve false (nunca deixa passar por segurança)", async () => {
  const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03]);
  assert.equal(await hasRealTransparency(garbage, "image/png"), false);
});
