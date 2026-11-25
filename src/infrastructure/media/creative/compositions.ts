import sharp from "sharp";
import { sha256Prefix, type Rect } from "./image-analysis.js";
import { quadScale, warpIntoQuad, type Quad } from "./perspective-warp.js";
import { cutoutProduct, locatePrint, type ProductCutout } from "./product-cutout.js";

/**
 * Composições controladas por arquétipo — montam a BASE da peça (sem texto) com os arquivos
 * ORIGINAIS: fotografia do produto (recortada ou emoldurada) e captura real da interface (encaixada
 * por perspectiva num dispositivo). O renderizador editorial aplica depois título, texto, CTA e logo
 * na área livre indicada por `layout`, respeitando `protectedAreas`.
 *
 * Por que determinístico: fidelidade comercial vem antes da criatividade livre. A IA entra no
 * cenário (`scene`) e na edição com referência; quando ela não preserva o produto ou a tela, a
 * composição controlada é a correção — o produto e a interface nunca são "parecidos", são os mesmos.
 */

export const CANVAS = { width: 1080, height: 1350 } as const;

export type BrandTones = { surface: string; accent: string; foreground: string; light: boolean; secondary?: string };

export type ProductPhotoInput = { id: string; data: Buffer; productCode?: string; variantLabel?: string };
export type CaptureInput = {
  id: string;
  data: Buffer;
  /** Densidade de pixels da captura (2 = capturada em @2x). */
  devicePixelRatio?: number;
  /** Trecho que importa para a funcionalidade (px da captura). */
  focus?: Rect;
  feature?: string;
  form?: "desktop" | "mobile";
};

export type CompositionLabel = { left: number; top: number; width: number; text: string; size?: number; align?: "left" | "center"; tone?: "foreground" | "accent" | "muted" };

export type ProtectedArea = { kind: "face" | "product" | "person" | "key_object"; x: number; y: number; width: number; height: number };

export type CompositionResult = {
  base: Buffer;
  layout: "top" | "left" | "bottom";
  protectedAreas: ProtectedArea[];
  labels: CompositionLabel[];
  evidence: {
    product?: { composited: true; sourceId: string; sourceSha256: string; productCode?: string; variantLabel?: string; rect: Rect; coverage: number; touchesEdge: boolean; cutoutConfidence: number; printRect?: Rect };
    variants?: Array<{ sourceId: string; variantLabel?: string; rect: Rect }>;
    screen?: { composited: true; captureId: string; captureSha256: string; feature?: string; quad: Quad; legibilityScale: number; renderedTextPx: number; screenRect: Rect };
  };
};

const W = CANVAS.width;
const H = CANVAS.height;
const hexRgb = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
const mix = (a: string, b: string, t: number) => `#${hexRgb(a).map((value, index) => Math.round(value * (1 - t) + hexRgb(b)[index] * t).toString(16).padStart(2, "0")).join("")}`;
const pct = (rect: Rect): Omit<ProtectedArea, "kind"> => ({ x: (rect.x / W) * 100, y: (rect.y / H) * 100, width: (rect.w / W) * 100, height: (rect.h / H) * 100 });
const svg = (body: string, width: number = W, height: number = H) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);

/** Fundo de estúdio nas cores da marca: gradiente + brilho do destaque + vinheta + grão fino. */
export async function brandBackdrop(tones: BrandTones, glow: { x: number; y: number; r: number; strength?: number } = { x: 0.7, y: 0.72, r: 0.62 }): Promise<Buffer> {
  const top = tones.light ? mix(tones.surface, "#FFFFFF", 0.35) : mix(tones.surface, "#000000", 0.25);
  const bottom = tones.light ? mix(tones.surface, "#000000", 0.07) : mix(tones.surface, tones.accent, 0.08);
  const glowOpacity = (glow.strength ?? (tones.light ? 0.16 : 0.42)).toFixed(2);
  const body = `<defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
    <radialGradient id="glow" cx="${glow.x}" cy="${glow.y}" r="${glow.r}"><stop offset="0" stop-color="${tones.accent}" stop-opacity="${glowOpacity}"/><stop offset="1" stop-color="${tones.accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.45" r="0.85"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${tones.light ? 0.08 : 0.35}"/></radialGradient>
    <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 ${tones.light ? 0.05 : 0.07}"/></feComponentTransfer></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#glow)"/><rect width="100%" height="100%" fill="url(#vig)"/><rect width="100%" height="100%" filter="url(#n)"/>`;
  return sharp(svg(body)).png().toBuffer();
}

async function fitBase(scene: Buffer | undefined, tones: BrandTones, glow?: Parameters<typeof brandBackdrop>[1]): Promise<Buffer> {
  if (!scene) return brandBackdrop(tones, glow);
  return sharp(scene).rotate().resize(W, H, { fit: "cover", position: "attention" }).png().toBuffer();
}

/** Sombra suave a partir da silhueta (alpha) da camada. */
async function silhouetteShadow(layer: Buffer, opacity: number, blur: number): Promise<Buffer> {
  const { data, info } = await sharp(layer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const shadow = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index += 4) shadow[index + 3] = Math.round(data[index + 3] * opacity);
  return sharp(shadow, { raw: { width: info.width, height: info.height, channels: 4 } }).blur(blur).png().toBuffer();
}

async function roundedMask(buffer: Buffer, width: number, height: number, radius: number): Promise<Buffer> {
  return sharp(buffer).resize(width, height, { fit: "cover", position: "centre" }).composite([{ input: svg(`<rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/>`, width, height), blend: "dest-in" }]).png().toBuffer();
}

type Placed = { input: Buffer; left: number; top: number };
/** Distância mínima entre a peça e a lateral da arte. */
const EDGE_MARGIN = 24;

/** Recorte redimensionado para caber em `box` (altura alvo), devolve a camada e o retângulo do produto. */
async function placeCutout(cutout: ProductCutout, targetHeight: number, anchor: { centerX: number; bottom: number }, crop?: "source-bottom"): Promise<{ layer: Placed; rect: Rect; shadow: Placed }> {
  const bbox = cutout.bbox;
  // Nunca deixa a peça sair pela lateral: reduz até caber com margem.
  const scale = Math.min(targetHeight / bbox.h, (W - 2 * EDGE_MARGIN) / bbox.w);
  const resized = await sharp(cutout.png).extract({ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h }).resize(Math.round(bbox.w * scale), Math.round(bbox.h * scale)).png().toBuffer();
  const meta = await sharp(resized).metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  // Foto de modelo cortada no topo (rosto fora do quadro): esmaece a borda cortada em vez de deixar
  // uma linha reta no meio da arte. Só a borda; a peça não é tocada.
  const cutTop = bbox.y <= 2;
  const cropped = cutTop
    ? await sharp(resized).composite([{ input: svg(`<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.16" stop-color="#fff" stop-opacity="1"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#f)"/>`, width, height), blend: "dest-in" }]).png().toBuffer()
    : resized;
  const left = Math.round(Math.max(EDGE_MARGIN, Math.min(W - EDGE_MARGIN - width, anchor.centerX - width / 2)));
  // Foto de modelo cortada na base (calça na borda inferior da foto): encosta na base da arte.
  const touchesSourceBottom = bbox.y + bbox.h >= cutout.height - 2;
  const top = Math.round((crop === "source-bottom" || touchesSourceBottom ? H : anchor.bottom) - height);
  const shadow = await silhouetteShadow(cropped, 0.42, 22);
  return { layer: { input: cropped, left, top }, rect: { x: left, y: top, w: width, h: height }, shadow: { input: shadow, left: left + 14, top: top + 18 } };
}

async function compose(base: Buffer, layers: Placed[]): Promise<Buffer> {
  // `sharp` recusa camadas maiores que a base ou fora dela: recorta cada camada ao canvas antes.
  const safe: Placed[] = [];
  for (const layer of layers) {
    const meta = await sharp(layer.input).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const left = Math.max(0, layer.left);
    const top = Math.max(0, layer.top);
    const right = Math.min(W, layer.left + width);
    const bottom = Math.min(H, layer.top + height);
    if (right <= left || bottom <= top) continue;
    const input = left === layer.left && top === layer.top && right - left === width && bottom - top === height
      ? layer.input
      : await sharp(layer.input).extract({ left: left - layer.left, top: top - layer.top, width: right - left, height: bottom - top }).png().toBuffer();
    safe.push({ input, left, top });
  }
  return sharp(base).composite(safe).png().toBuffer();
}

const productEvidence = (photo: ProductPhotoInput, cutout: ProductCutout, rect: Rect, printRect?: Rect): NonNullable<CompositionResult["evidence"]["product"]> => {
  const visible = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: Math.min(W, rect.x + rect.w) - Math.max(0, rect.x), h: Math.min(H, rect.y + rect.h) - Math.max(0, rect.y) };
  return {
    composited: true, sourceId: photo.id, sourceSha256: sha256Prefix(photo.data), productCode: photo.productCode, variantLabel: photo.variantLabel,
    rect: visible, coverage: (visible.w * visible.h * cutout.coverage) / ((cutout.bbox.w * cutout.bbox.h) / (cutout.width * cutout.height)) / (W * H),
    // Cortar na base é intencional (foto de modelo); lateral/topo cortados são defeito.
    touchesEdge: rect.x < 0 || rect.x + rect.w > W || rect.y < 0, cutoutConfidence: cutout.confidence, ...(printRect ? { printRect } : {}),
  };
};

// ---------------------------------------------------------------- produto físico

export async function composeProduct(archetype: string, input: { photos: ProductPhotoInput[]; tones: BrandTones; scene?: Buffer }): Promise<CompositionResult> {
  const [primary, ...others] = input.photos;
  if (!primary) throw new Error("COMPOSITION_PRODUCT_PHOTO_MISSING: composição de produto sem fotografia original.");
  const cutout = await cutoutProduct(primary.data);
  const usable = cutout.confidence >= 0.55;
  const tones = input.tones;

  if (archetype === "product_editorial" || !usable) {
    // Página editorial: foto ORIGINAL inteira (sem recorte) em painel alto à direita.
    const base = await fitBase(input.scene, tones, { x: 0.25, y: 0.85, r: 0.7, strength: tones.light ? 0.1 : 0.3 });
    const panel = { x: 548, y: 96, w: 476, h: 1158 };
    // Enquadra pela estampa/peça (nunca corta a estampa na lateral): recorte centrado no produto.
    const focus = usable ? await locatePrint(cutout) : { x: cutout.width * 0.3, y: 0, w: cutout.width * 0.4, h: cutout.height };
    const cropH = cutout.height;
    const cropW = Math.min(cutout.width, Math.round(cropH * (panel.w / panel.h)));
    const cropX = Math.round(Math.max(0, Math.min(cutout.width - cropW, focus.x + focus.w / 2 - cropW / 2)));
    const framed = await sharp(cutout.photo).extract({ left: cropX, top: 0, width: cropW, height: cropH }).png().toBuffer();
    const photo = await roundedMask(framed, panel.w, panel.h, 26);
    const frameShadow = await sharp(svg(`<rect x="${panel.x + 10}" y="${panel.y + 18}" width="${panel.w}" height="${panel.h}" rx="26" fill="#000" fill-opacity="${tones.light ? 0.22 : 0.5}"/>`)).blur(24).png().toBuffer();
    const rule = svg(`<rect x="${panel.x - 34}" y="${panel.y + 40}" width="3" height="${panel.h - 80}" fill="${tones.accent}" fill-opacity="0.9"/>`);
    const composed = await compose(base, [{ input: frameShadow, left: 0, top: 0 }, { input: rule, left: 0, top: 0 }, { input: photo, left: panel.x, top: panel.y }]);
    const label = [primary.productCode ? `Modelo ${primary.productCode}` : undefined, primary.variantLabel].filter(Boolean).join(" · ");
    return {
      base: composed, layout: "left", protectedAreas: [{ kind: "product", ...pct(panel) }],
      labels: label ? [{ left: 84, top: 1210, width: 430, text: label, size: 22, tone: "muted" }] : [],
      evidence: { product: { composited: true, sourceId: primary.id, sourceSha256: sha256Prefix(primary.data), productCode: primary.productCode, variantLabel: primary.variantLabel, rect: panel, coverage: (panel.w * panel.h) / (W * H) * 0.6, touchesEdge: false, cutoutConfidence: cutout.confidence } },
    };
  }

  if (archetype === "variant_lineup" && others.length) {
    const base = await fitBase(input.scene, tones, { x: 0.5, y: 0.78, r: 0.6 });
    const all = [primary, ...others.slice(0, 2)];
    const cutouts = [cutout, ...await Promise.all(all.slice(1).map((photo) => cutoutProduct(photo.data)))];
    const slots = all.length === 2
      ? [{ cx: 640, h: 760, z: 2 }, { cx: 380, h: 660, z: 1 }]
      : [{ cx: 540, h: 760, z: 3 }, { cx: 290, h: 640, z: 1 }, { cx: 800, h: 640, z: 2 }];
    const placed = await Promise.all(cutouts.map((item, index) => placeCutout(item, slots[index].h, { centerX: slots[index].cx, bottom: H - 40 })));
    const order = slots.map((slot, index) => ({ slot, index })).sort((a, b) => a.slot.z - b.slot.z);
    const layers: Placed[] = order.flatMap(({ index }) => [placed[index].shadow, placed[index].layer]);
    const composed = await compose(base, layers);
    const labels: CompositionLabel[] = all.map((photo, index) => ({ left: slots[index].cx - 110, top: 600, width: 220, text: photo.variantLabel ?? "", size: 22, align: "center" as const, tone: index === 0 ? "accent" as const : "muted" as const })).filter((label) => label.text);
    return {
      base: composed, layout: "top", labels,
      protectedAreas: placed.map(({ rect }) => ({ kind: "product" as const, ...pct(rect) })),
      evidence: {
        product: productEvidence(primary, cutout, placed[0].rect),
        variants: all.slice(1).map((photo, index) => ({ sourceId: photo.id, variantLabel: photo.variantLabel, rect: placed[index + 1].rect })),
      },
    };
  }

  if (archetype === "print_detail") {
    const base = await fitBase(input.scene, tones, { x: 0.3, y: 0.7, r: 0.65 });
    const print = await locatePrint(cutout);
    // Zoom da estampa com os pixels da foto ORIGINAL (sem reamostragem criativa).
    const zoomBox = { x: 84, y: 640, w: 640, h: 640 };
    const square = Math.max(print.w, print.h);
    const crop = { left: Math.max(0, Math.round(print.x + print.w / 2 - square / 2)), top: Math.max(0, Math.round(print.y + print.h / 2 - square / 2)), width: 0, height: 0 };
    crop.width = Math.min(cutout.width - crop.left, Math.round(square));
    crop.height = Math.min(cutout.height - crop.top, Math.round(square));
    const zoom = await roundedMask(await sharp(cutout.photo).extract(crop).png().toBuffer(), zoomBox.w, zoomBox.h, 320);
    const ring = svg(`<circle cx="${zoomBox.x + zoomBox.w / 2}" cy="${zoomBox.y + zoomBox.h / 2}" r="${zoomBox.w / 2 + 6}" fill="none" stroke="${tones.accent}" stroke-width="4"/>`);
    const zoomShadow = await sharp(svg(`<circle cx="${zoomBox.x + zoomBox.w / 2 + 8}" cy="${zoomBox.y + zoomBox.h / 2 + 16}" r="${zoomBox.w / 2}" fill="#000" fill-opacity="${tones.light ? 0.2 : 0.45}"/>`)).blur(26).png().toBuffer();
    const mini = await placeCutout(cutout, 560, { centerX: 880, bottom: H - 30 });
    const composed = await compose(base, [{ input: zoomShadow, left: 0, top: 0 }, mini.shadow, mini.layer, { input: zoom, left: zoomBox.x, top: zoomBox.y }, { input: ring, left: 0, top: 0 }]);
    return {
      base: composed, layout: "top",
      labels: [{ left: zoomBox.x, top: zoomBox.y - 44, width: 420, text: "Estampa original", size: 22, tone: "accent" }],
      protectedAreas: [{ kind: "product", ...pct(zoomBox) }, { kind: "product", ...pct(mini.rect) }],
      evidence: { product: productEvidence(primary, cutout, mini.rect, zoomBox) },
    };
  }

  if (archetype === "commercial_bold") {
    const base = await fitBase(input.scene, tones, { x: 0.78, y: 0.55, r: 0.55 });
    const band = svg(`<polygon points="${W * 0.42},${H} ${W},${H * 0.18} ${W},${H * 0.52} ${W * 0.7},${H}" fill="${tones.accent}" fill-opacity="${tones.light ? 0.9 : 0.85}"/>`);
    const placed = await placeCutout(cutout, 980, { centerX: 800, bottom: H });
    const composed = await compose(base, [{ input: band, left: 0, top: 0 }, placed.shadow, placed.layer]);
    return { base: composed, layout: "left", labels: [], protectedAreas: [{ kind: "product", ...pct(placed.rect) }], evidence: { product: productEvidence(primary, cutout, placed.rect) } };
  }

  // product_studio (padrão) — peça grande, centralizada, sombra de contato, brilho da marca.
  const base = await fitBase(input.scene, tones, { x: 0.5, y: 0.8, r: 0.5 });
  const placed = await placeCutout(cutout, 760, { centerX: W / 2, bottom: H - 36 });
  const floor = await sharp(svg(`<ellipse cx="${W / 2}" cy="${H - 30}" rx="360" ry="34" fill="#000" fill-opacity="${tones.light ? 0.18 : 0.45}"/>`)).blur(20).png().toBuffer();
  const composed = await compose(base, [{ input: floor, left: 0, top: 0 }, placed.shadow, placed.layer]);
  return { base: composed, layout: "top", labels: [], protectedAreas: [{ kind: "product", ...pct(placed.rect) }], evidence: { product: productEvidence(primary, cutout, placed.rect) } };
}

// ---------------------------------------------------------------- software

/** CSS px de uma linha de texto típica de interface (corpo 13–14 px). */
const UI_TEXT_CSS_PX = 13;

async function captureRaw(capture: CaptureInput, region?: Rect) {
  let pipeline = sharp(capture.data).rotate();
  if (region) pipeline = sharp(await pipeline.extract({ left: Math.round(region.x), top: Math.round(region.y), width: Math.round(region.w), height: Math.round(region.h) }).toBuffer());
  return pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function screenLayer(capture: CaptureInput, quad: Quad, region?: Rect) {
  const { data, info } = await captureRaw(capture, region);
  const layer = warpIntoQuad({ data, width: info.width, height: info.height }, quad, W, H);
  const scale = quadScale(quad, info.width, info.height);
  const dpr = capture.devicePixelRatio ?? 1;
  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  return {
    input: await sharp(layer, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(),
    evidence: {
      composited: true as const, captureId: capture.id, captureSha256: sha256Prefix(capture.data), ...(capture.feature ? { feature: capture.feature } : {}),
      quad, legibilityScale: scale, renderedTextPx: UI_TEXT_CSS_PX * dpr * scale,
      screenRect: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
    },
  };
}

const quadPoints = (quad: Quad) => quad.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

/** Janela de navegador reta com a captura real — moldura, barra com os três pontos e endereço. */
async function browserWindow(capture: CaptureInput, box: Rect, tones: BrandTones, region?: Rect) {
  const bar = 40;
  const screen: Quad = [{ x: box.x, y: box.y + bar }, { x: box.x + box.w, y: box.y + bar }, { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }];
  const frame = svg(`<defs><clipPath id="c"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="16"/></clipPath></defs>
    <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="16" fill="${tones.light ? "#FFFFFF" : "#16161F"}"/>
    <g clip-path="url(#c)"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${bar}" fill="${tones.light ? "#EEF0F3" : "#22222E"}"/></g>
    ${[0, 1, 2].map((index) => `<circle cx="${box.x + 22 + index * 18}" cy="${box.y + bar / 2}" r="5.5" fill="${["#FF5F57", "#FEBC2E", "#28C840"][index]}"/>`).join("")}
    <rect x="${box.x + box.w * 0.3}" y="${box.y + 10}" width="${box.w * 0.4}" height="${bar - 20}" rx="${(bar - 20) / 2}" fill="${tones.light ? "#FFFFFF" : "#2D2D3B"}"/>`);
  const shadow = await sharp(svg(`<rect x="${box.x + 6}" y="${box.y + 26}" width="${box.w}" height="${box.h}" rx="16" fill="#000" fill-opacity="${tones.light ? 0.25 : 0.6}"/>`)).blur(30).png().toBuffer();
  const screenPart = await screenLayer(capture, screen, region);
  const mask = svg(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="16" fill="#fff"/>`);
  const clipped = await sharp(screenPart.input).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return { layers: [{ input: shadow, left: 0, top: 0 }, { input: frame, left: 0, top: 0 }, { input: clipped, left: 0, top: 0 }], evidence: screenPart.evidence };
}

export async function composeSoftware(archetype: string, input: { capture: CaptureInput; tones: BrandTones; scene?: Buffer }): Promise<CompositionResult> {
  const { capture, tones } = input;
  const meta = await sharp(capture.data).metadata();
  const captureW = meta.width ?? 1;
  const captureH = meta.height ?? 1;
  const isMobile = capture.form === "mobile" || captureH / captureW > 1.4;

  if (archetype === "phone_conversation" || isMobile) {
    const base = await fitBase(input.scene, tones, { x: 0.72, y: 0.5, r: 0.55 });
    const phone = { x: 600, y: 150, w: 400, h: 1140 };
    const inset = 16;
    const screen: Quad = [{ x: phone.x + inset, y: phone.y + inset }, { x: phone.x + phone.w - inset, y: phone.y + inset }, { x: phone.x + phone.w - inset, y: phone.y + phone.h - inset }, { x: phone.x + inset, y: phone.y + phone.h - inset }];
    // Captura de desktop no celular: usa o trecho da funcionalidade, no formato da tela do aparelho.
    const ratio = (phone.w - 2 * inset) / (phone.h - 2 * inset);
    let region: Rect | undefined;
    if (!isMobile) {
      const focus = capture.focus ?? { x: 0, y: 0, w: captureW, h: captureH };
      const height = Math.min(captureH, focus.h);
      const width = Math.min(captureW, height * ratio);
      region = { x: Math.max(0, Math.min(captureW - width, focus.x + focus.w / 2 - width / 2)), y: Math.max(0, Math.min(captureH - height, focus.y)), w: width, h: height };
    } else {
      const height = Math.min(captureH, captureW / ratio);
      region = { x: 0, y: 0, w: captureW, h: height };
    }
    const body = svg(`<rect x="${phone.x}" y="${phone.y}" width="${phone.w}" height="${phone.h}" rx="58" fill="#0B0B10"/><rect x="${phone.x + 2}" y="${phone.y + 2}" width="${phone.w - 4}" height="${phone.h - 4}" rx="56" fill="none" stroke="#3A3A48" stroke-width="2"/>`);
    const shadow = await sharp(svg(`<rect x="${phone.x + 10}" y="${phone.y + 30}" width="${phone.w}" height="${phone.h}" rx="58" fill="#000" fill-opacity="${tones.light ? 0.3 : 0.6}"/>`)).blur(32).png().toBuffer();
    const screenPart = await screenLayer(capture, screen, region);
    const mask = svg(`<rect x="${phone.x + inset}" y="${phone.y + inset}" width="${phone.w - 2 * inset}" height="${phone.h - 2 * inset}" rx="44" fill="#fff"/>`);
    const clipped = await sharp(screenPart.input).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    const notch = svg(`<rect x="${phone.x + phone.w / 2 - 50}" y="${phone.y + 26}" width="100" height="26" rx="13" fill="#0B0B10"/>`);
    const composed = await compose(base, [{ input: shadow, left: 0, top: 0 }, { input: body, left: 0, top: 0 }, { input: clipped, left: 0, top: 0 }, { input: notch, left: 0, top: 0 }]);
    return { base: composed, layout: "left", labels: [], protectedAreas: [{ kind: "key_object", ...pct(phone) }], evidence: { screen: screenPart.evidence } };
  }

  if (archetype === "ui_focus" && capture.focus) {
    const base = await fitBase(input.scene, tones, { x: 0.5, y: 0.75, r: 0.6 });
    const window = { x: 64, y: 640, w: 760, h: 520 };
    const browser = await browserWindow(capture, window, tones);
    const dim = svg(`<rect x="${window.x}" y="${window.y + 40}" width="${window.w}" height="${window.h - 40}" fill="${tones.light ? "#FFFFFF" : "#0B0B12"}" fill-opacity="0.28"/>`);
    // Cartão ampliado do trecho que importa, em escala de leitura (≥ 1 px CSS por px da arte).
    const focus = capture.focus;
    const dpr = capture.devicePixelRatio ?? 1;
    const cardW = Math.min(600, Math.round((focus.w / dpr) * 1.05));
    const cardH = Math.round(cardW * (focus.h / focus.w));
    const card = { x: W - 64 - cardW, y: Math.min(H - 60 - cardH, 600 + Math.max(0, (700 - cardH) / 2)), w: cardW, h: Math.min(cardH, H - 660) };
    const cardQuad: Quad = [{ x: card.x, y: card.y }, { x: card.x + card.w, y: card.y }, { x: card.x + card.w, y: card.y + card.h }, { x: card.x, y: card.y + card.h }];
    const zoomed = await screenLayer(capture, cardQuad, { x: focus.x, y: focus.y, w: focus.w, h: Math.min(focus.h, focus.w * (card.h / card.w)) });
    const cardMask = svg(`<rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="18" fill="#fff"/>`);
    const cardClipped = await sharp(zoomed.input).composite([{ input: cardMask, blend: "dest-in" }]).png().toBuffer();
    const scaleX = window.w / captureW;
    const scaleY = (window.h - 40) / captureH;
    const source = { x: window.x + focus.x * scaleX, y: window.y + 40 + focus.y * scaleY, w: focus.w * scaleX, h: focus.h * scaleY };
    const accents = svg(`<rect x="${source.x}" y="${source.y}" width="${source.w}" height="${source.h}" rx="8" fill="none" stroke="${tones.accent}" stroke-width="4"/>
      <line x1="${source.x + source.w}" y1="${source.y + source.h / 2}" x2="${card.x}" y2="${card.y + card.h / 2}" stroke="${tones.accent}" stroke-width="3" stroke-dasharray="8 7"/>
      <rect x="${card.x - 4}" y="${card.y - 4}" width="${card.w + 8}" height="${card.h + 8}" rx="21" fill="none" stroke="${tones.accent}" stroke-width="4"/>`);
    const cardShadow = await sharp(svg(`<rect x="${card.x + 8}" y="${card.y + 22}" width="${card.w}" height="${card.h}" rx="18" fill="#000" fill-opacity="0.55"/>`)).blur(26).png().toBuffer();
    const glow = await sharp(svg(`<rect x="${card.x - 10}" y="${card.y - 10}" width="${card.w + 20}" height="${card.h + 20}" rx="26" fill="${tones.accent}" fill-opacity="0.45"/>`)).blur(30).png().toBuffer();
    const composed = await compose(base, [...browser.layers, { input: dim, left: 0, top: 0 }, { input: glow, left: 0, top: 0 }, { input: cardShadow, left: 0, top: 0 }, { input: cardClipped, left: 0, top: 0 }, { input: accents, left: 0, top: 0 }]);
    return {
      base: composed, layout: "top", labels: [],
      protectedAreas: [{ kind: "key_object", ...pct(card) }, { kind: "key_object", ...pct(window) }],
      evidence: { screen: { ...zoomed.evidence, screenRect: card } },
    };
  }

  if (archetype === "browser_window") {
    const base = await fitBase(input.scene, tones, { x: 0.5, y: 0.85, r: 0.6 });
    const width = 972;
    const height = Math.round(width * (captureH / captureW)) + 40;
    const box = { x: Math.round((W - width) / 2), y: Math.max(610, H - 60 - height), w: width, h: Math.min(height, H - 60 - 610) };
    const region = box.h < height ? { x: 0, y: 0, w: captureW, h: Math.round(captureH * ((box.h - 40) / (height - 40))) } : undefined;
    const browser = await browserWindow(capture, box, tones, region);
    const composed = await compose(base, browser.layers);
    return { base: composed, layout: "top", labels: [], protectedAreas: [{ kind: "key_object", ...pct(box) }], evidence: { screen: browser.evidence } };
  }

  // device_laptop (padrão) — notebook em leve perspectiva, tela real encaixada por homografia.
  const base = await fitBase(input.scene, tones, { x: 0.5, y: 0.78, r: 0.62 });
  const lid: Quad = [{ x: 118, y: 646 }, { x: 966, y: 616 }, { x: 984, y: 1142 }, { x: 102, y: 1166 }];
  const bezel = 18;
  const screen: Quad = [
    { x: lid[0].x + bezel, y: lid[0].y + bezel }, { x: lid[1].x - bezel, y: lid[1].y + bezel },
    { x: lid[2].x - bezel, y: lid[2].y - bezel * 1.4 }, { x: lid[3].x + bezel, y: lid[3].y - bezel * 1.4 },
  ];
  const deck: Quad = [{ x: lid[3].x - 26, y: lid[3].y + 2 }, { x: lid[2].x + 26, y: lid[2].y + 2 }, { x: lid[2].x + 92, y: lid[2].y + 64 }, { x: lid[3].x - 92, y: lid[3].y + 70 }];
  const device = svg(`<defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A3B44"/><stop offset="1" stop-color="#15161C"/></linearGradient></defs>
    <polygon points="${quadPoints(deck)}" fill="url(#d)"/><polygon points="${quadPoints(lid)}" fill="#0C0C11" stroke="#43434F" stroke-width="2"/>
    <rect x="${(deck[0].x + deck[1].x) / 2 - 90}" y="${deck[0].y + 4}" width="180" height="8" rx="4" fill="#0A0A0E" fill-opacity="0.7"/>`);
  const shadow = await sharp(svg(`<ellipse cx="${W / 2}" cy="${deck[2].y + 8}" rx="520" ry="40" fill="#000" fill-opacity="${tones.light ? 0.22 : 0.6}"/>`)).blur(24).png().toBuffer();
  const glow = await sharp(svg(`<polygon points="${quadPoints(lid)}" fill="${tones.accent}" fill-opacity="${tones.light ? 0.25 : 0.5}"/>`)).blur(60).png().toBuffer();
  const screenPart = await screenLayer(capture, screen);
  const composed = await compose(base, [{ input: glow, left: 0, top: 0 }, { input: shadow, left: 0, top: 0 }, { input: device, left: 0, top: 0 }, { input: screenPart.input, left: 0, top: 0 }]);
  const deviceRect = { x: deck[3].x, y: lid[1].y, w: deck[2].x - deck[3].x, h: deck[2].y - lid[1].y };
  return { base: composed, layout: "top", labels: [], protectedAreas: [{ kind: "key_object", ...pct(deviceRect) }], evidence: { screen: screenPart.evidence } };
}

// ---------------------------------------------------------------- conceitual

/** Peça tipográfica: fundo da marca com formas de destaque discretas; o texto vem do renderizador. */
export async function composeTypographic(input: { tones: BrandTones; scene?: Buffer }): Promise<CompositionResult> {
  const base = await fitBase(input.scene, input.tones, { x: 0.85, y: 0.9, r: 0.7 });
  const shapes = svg(`<circle cx="${W * 0.82}" cy="${H * 0.8}" r="250" fill="none" stroke="${input.tones.accent}" stroke-opacity="0.55" stroke-width="3"/>
    <circle cx="${W * 0.82}" cy="${H * 0.8}" r="170" fill="${input.tones.accent}" fill-opacity="0.12"/>
    <rect x="84" y="${H - 150}" width="160" height="5" rx="2" fill="${input.tones.accent}"/>`);
  return { base: await compose(base, [{ input: shapes, left: 0, top: 0 }]), layout: "top", labels: [], protectedAreas: [], evidence: {} };
}
