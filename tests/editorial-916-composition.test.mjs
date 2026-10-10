import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  renderEditorialCreative,
  storySafeInsets,
  isVerticalCanvas,
  checkEditorialSafeArea,
  VERTICAL_STORY_SAFE,
} from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

// 9:16 com os artefatos REAIS aprovados dos cenários A (produto), B (institucional) e C (digital):
// composição vertical própria (nunca o 4:5 esticado), texto/logo dentro da safe area vertical, e o
// 4:5 aprovado intocado. Zero OpenAI.

const FX = "tests/fixtures/editorial";
const SCENARIO_FILES = {
  a: { base: "916/a-base.webp", assets: [["product_photo", "916/a-product.webp"]] },
  b: { base: "916/b-base.webp", assets: [] },
  c: { base: "916/c-base.webp", assets: [["screenshot", "screenshot-desktop-presentes.png"]] },
};

async function scenario(key, baseFile) {
  const files = SCENARIO_FILES[key];
  const { plan, context } = JSON.parse(await readFile(join(FX, `916/${key}-plan.json`), "utf8"));
  const assets = [
    ...(await Promise.all(files.assets.map(async ([role, file]) => ({ role, url: `fixture://${file}`, buffer: await readFile(join(FX, file)) })))),
    { role: "logo", url: "fixture://logo.png", buffer: await readFile(join(FX, "logo-rumo-ao-altar.png")) },
  ];
  return { base: await readFile(join(FX, baseFile ?? files.base)), plan, context, assets };
}

async function render(key, format, extra = {}) {
  const fx = await scenario(key, extra.baseFile);
  const plan = { ...fx.plan, ...(extra.plan ?? {}) };
  if (extra.plan) plan.allowedRenderedTexts = [plan.headline, plan.subheadline, plan.cta].filter(Boolean);
  return renderEditorialCreative({ baseImageBuffer: fx.base, context: { ...fx.context, format }, plan, assets: fx.assets, ...(extra.variant ? { qaVariantOverride: extra.variant } : {}) });
}

const CANVAS_916 = { width: 1080, height: 1920, format: "9:16" };

function assertInsideStorySafe(result, label) {
  const inset = storySafeInsets(CANVAS_916);
  for (const box of result.geometry.boxes.filter((item) => item.kind === "text" || item.role === "logo")) {
    const y = (box.rect.yPct / 100) * 1920;
    const bottom = y + (box.rect.heightPct / 100) * 1920;
    const x = (box.rect.xPct / 100) * 1080;
    const right = x + (box.rect.widthPct / 100) * 1080;
    assert.ok(y >= inset.top - 1 && bottom <= 1920 - inset.bottom + 1 && x >= inset.side - 1 && right <= 1080 - inset.side + 1, `${label}: ${box.id} fora da safe area vertical (${JSON.stringify(box.rect)})`);
  }
}

test("9:16 safe area vertical: só para canvas vertical; texto no topo é violação no 9:16, não no 4:5", () => {
  assert.equal(isVerticalCanvas({ width: 1080, height: 1920 }), true);
  assert.equal(isVerticalCanvas({ width: 1080, height: 1350 }), false);
  assert.deepEqual(storySafeInsets({ width: 1080, height: 1350 }), { top: 0, bottom: 0, side: 0 });
  assert.deepEqual(storySafeInsets(CANVAS_916), { top: Math.round(1920 * VERTICAL_STORY_SAFE.topPct / 100), bottom: Math.round(1920 * VERTICAL_STORY_SAFE.bottomPct / 100), side: Math.round(1080 * VERTICAL_STORY_SAFE.sidePct / 100) });
  const headlineAtTop = [{ id: "headline", kind: "text", rect: { xPct: 10, yPct: 4, widthPct: 60, heightPct: 5 } }];
  const photoAtTop = [{ id: "screenshot", kind: "asset", role: "screenshot", rect: { xPct: 3, yPct: 3, widthPct: 94, heightPct: 40 } }];
  assert.ok(checkEditorialSafeArea(headlineAtTop, CANVAS_916, "digital_service").some((issue) => /safe area vertical/.test(issue.message)));
  assert.equal(checkEditorialSafeArea(headlineAtTop, { width: 1080, height: 1350, format: "4:5" }, "digital_service").length, 0);
  assert.equal(checkEditorialSafeArea(photoAtTop, CANVAS_916, "digital_service").length, 0, "imagem/asset não crítico pode ocupar as bordas");
});

test("9:16 usa os compositores adaptativos aprovados (nunca os templates antigos) com geometria válida e assets provados", async () => {
  const expected = { a: ["product_offer", "OVERLAY_EDITORIAL"], b: ["premium_institutional", "MINIMAL_PREMIUM"], c: ["digital_service", "FLOATING_PRODUCT"] };
  for (const key of ["a", "b", "c"]) {
    const result = await render(key, "9:16");
    assert.equal(result.family, expected[key][0]);
    assert.equal(result.composition?.variant, expected[key][1], key);
    assert.equal(result.geometry.valid, true, `${key}: ${JSON.stringify(result.geometry.issues)}`);
    assert.equal(result.renderedGeometry.source, "final_rendered_geometry");
    assert.ok(result.assetVerification.length > 0 && result.assetVerification.every((item) => item.visible && item.fidelityPass), `${key}: ${JSON.stringify(result.assetVerification)}`);
    assertInsideStorySafe(result, key);
  }
});

test("9:16 institucional: as 4 variantes de cena única têm composição vertical própria e respeitam a safe area", async () => {
  for (const variant of ["MINIMAL_PREMIUM", "PHOTO_DOMINANT_EDITORIAL", "ASYMMETRIC_LUXURY", "FULL_BLEED_STORY"]) {
    const result = await render("b", "9:16", { variant });
    assert.equal(result.composition.variant, variant);
    assert.equal(result.geometry.valid, true, `${variant}: ${JSON.stringify(result.geometry.issues)}`);
    assertInsideStorySafe(result, variant);
    const head = result.renderedGeometry.textBoxes.find((box) => box.id === "headline");
    assert.ok(head.fontSizePx >= 50, `${variant}: headline ${head.fontSizePx}px pequena demais para tela cheia`);
    assert.ok(result.composition.largestEmptyBandPct <= 0.12, `${variant}: faixa vazia ${result.composition.largestEmptyBandPct}`);
    assert.ok(["COVER_FOCAL_SAFE_CROP", "FULL_BLEED"].includes(result.composition.baseFit.strategy), `${variant}: ${result.composition.baseFit.strategy}`);
  }
});

test("9:16 não muda a classe visual da base (o formato muda composição, nunca classificação)", async () => {
  for (const baseFile of ["916/b-base.webp", "scenario-b-4f4d604-base.webp", "scenario-b-db3a574-base.webp", "scenario-b-openai-base.webp"]) {
    const vertical = await render("b", "9:16", { baseFile });
    const feed = await render("b", "4:5", { baseFile });
    assert.equal(vertical.composition.baseVisualClass, feed.composition.baseVisualClass, baseFile);
    assert.equal(vertical.geometry.valid, true, `${baseFile}: ${JSON.stringify(vertical.geometry.issues)}`);
    assertInsideStorySafe(vertical, baseFile);
  }
});

test("9:16 digital: FLOATING/UI_HERO/UI_DETAIL_FOCUS empilham na safe area, tela inteira fiel e legível", async () => {
  for (const variant of ["FLOATING_PRODUCT", "UI_HERO", "UI_DETAIL_FOCUS"]) {
    const result = await render("c", "9:16", { variant });
    assert.equal(result.composition.variant, variant);
    assert.equal(result.geometry.valid, true, `${variant}: ${JSON.stringify(result.geometry.issues)}`);
    assertInsideStorySafe(result, variant);
    assert.ok(result.composition.screenshot.displayScale >= 0.4, `${variant}: escala ${result.composition.screenshot.displayScale}`);
    assert.ok(result.assetVerification.filter((item) => item.role === "screenshot").every((item) => item.visible && item.fidelityPass));
  }
});

test("9:16 produto: split lateral vira empilhado (HERO_DOMINANT); override de QA ainda força o split", async () => {
  const longCopy = { headline: "O casamento organizado como vocês sonharam", subheadline: "Presentes, lista e RSVP em um só lugar.", cta: "Comprar agora" };
  const feed = await render("a", "4:5", { plan: longCopy });
  const vertical = await render("a", "9:16", { plan: longCopy });
  if (feed.composition.variant === "SPLIT_EDITORIAL") {
    assert.equal(vertical.composition.variant, "HERO_DOMINANT");
    assert.ok(vertical.composition.selectionReasons.some((reason) => /split lateral vira empilhado/.test(reason)));
  }
  assert.equal(vertical.geometry.valid, true, JSON.stringify(vertical.geometry.issues));
  assertInsideStorySafe(vertical, "produto");
  const forced = await render("a", "9:16", { variant: "SPLIT_EDITORIAL" });
  assert.equal(forced.composition.variant, "SPLIT_EDITORIAL");
});

test("9:16 encaixe de texto: headline/sub/CTA curtos, médios e longos sem overflow, sem texto minúsculo, sem coluna estreita", async () => {
  const H = { short: "Sem Correria", medium: "O casamento organizado como vocês sonharam", long: "Organize o casamento inteiro, do convite ao último presente, sem planilhas e sem estresse" };
  const S = { short: "Tudo em um só lugar.", long: "Site do casamento, lista de presentes com pagamento online, confirmação de presença dos convidados e mural de recados, tudo em um só lugar." };
  const C = { short: "Comprar", long: "Quero criar o site do meu casamento" };
  for (const key of ["a", "b", "c"]) {
    for (const h of Object.keys(H)) for (const s of Object.keys(S)) for (const c of Object.keys(C)) {
      const result = await render(key, "9:16", { plan: { headline: H[h], subheadline: S[s], cta: C[c], title: H[h] } });
      const label = `${key}/${h}/${s}/${c}`;
      assert.equal(result.geometry.valid, true, `${label}: ${JSON.stringify(result.geometry.issues)}`);
      assertInsideStorySafe(result, label);
      const size = (id) => result.renderedGeometry.textBoxes.find((box) => box.id === id);
      assert.ok(size("headline").fontSizePx >= 48, `${label}: headline ${size("headline").fontSizePx}px`);
      assert.ok((size("headline").rect.widthPct / 100) * 1080 >= 700, `${label}: coluna da headline estreita`);
      assert.ok(size("subheadline").fontSizePx >= 19, `${label}: subtítulo ${size("subheadline").fontSizePx}px`);
      assert.ok(size("cta").fontSizePx >= 15, `${label}: CTA ${size("cta").fontSizePx}px`);
    }
  }
});

test("4:5 aprovado intocado: mesmos variantes, retângulos e fidelidade dos fixtures reais", async () => {
  const expected = {
    a: { variant: "OVERLAY_EDITORIAL", assets: ["product_photo@11.9,10.1 76.3x61.0", "logo@6.7,4.4 19.6x3.4"] },
    b: { variant: "MINIMAL_PREMIUM", assets: ["logo@77.1,81.3 13.6x2.4"] },
    c: { variant: "FLOATING_PRODUCT", assets: ["screenshot@2.6,42.8 94.8x53.3", "logo@5.2,6.7 17.0x3.0"] },
  };
  for (const key of ["a", "b", "c"]) {
    const result = await render(key, "4:5");
    assert.equal(result.composition.variant, expected[key].variant);
    assert.deepEqual(result.renderedGeometry.assetBoxes.map((box) => `${box.id}@${box.rect.xPct.toFixed(1)},${box.rect.yPct.toFixed(1)} ${box.rect.widthPct.toFixed(1)}x${box.rect.heightPct.toFixed(1)}`), expected[key].assets);
    assert.equal(result.geometry.valid, true);
  }
});

test("9:16 digital com screenshot de celular (mockup legado) também respeita a safe area vertical", async () => {
  const fx = await scenario("c");
  const sharpModule = (await import("sharp")).default;
  const phone = await sharpModule({ create: { width: 720, height: 1280, channels: 3, background: "#F4F1EE" } }).composite([{ input: await sharpModule({ create: { width: 600, height: 120, channels: 3, background: "#B66B77" } }).png().toBuffer(), left: 60, top: 300 }]).png().toBuffer();
  const assets = fx.assets.map((asset) => (asset.role === "screenshot" ? { ...asset, buffer: phone } : asset));
  const result = await renderEditorialCreative({ baseImageBuffer: fx.base, context: { ...fx.context, format: "9:16" }, plan: fx.plan, assets });
  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
  assertInsideStorySafe(result, "mobile");
});
