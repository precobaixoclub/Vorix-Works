// Renderizador da automação editorial. Roda no container da API: o agendador injeta `const request = {...}`
// antes deste código e lê a última linha (JSON). Também é importável (testes) — nada roda sem `request`.
//
// Recebe a base visual (sem texto) e compõe texto + logo oficial, decidindo pelo CONTEÚDO da imagem:
// - layout do texto (topo/esquerda/base) que não cobre rosto nem produto (áreas informadas pelo gerador)
//   e cai na região mais limpa da foto;
// - véu atrás do texto dimensionado pelo bloco e pelo contraste realmente necessário — nunca sobre rostos;
// - logo oficial sem caixa: versão compatível com o fundo, transparência preservada (fundo sólido de
//   arquivo sem alpha é removido), tamanho proporcional, margem fixa, contraste medido; sombra/halo suave
//   só quando o contraste não basta. Placa apenas se a marca pedir explicitamente.
// Devolve a arte e um relatório de qualidade; recusa (erro) quando o texto cobriria um rosto.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import satori from "satori";
import sharp from "sharp";

// Núcleo do motor criativo (compilado em dist/): composição com os arquivos originais e Quality Gate
// de fidelidade. Carregado sob demanda pelo diretório de trabalho (o container roda em /app).
const dist = (path) => import(pathToFileURL(join(process.cwd(), "dist", path)).href);

export const WIDTH = 1080;
export const HEIGHT = 1350;
const MARGIN = 64;
const TEXT_X = 84;
const LOGO_AREA_RATIO = 0.0115;
const MIN_TEXT_CONTRAST = 4.5;
const MIN_LOGO_CONTRAST = 3;
const LAYOUTS = ["top", "left", "bottom"];
const PLACEMENTS = ["top_left", "top_center", "top_right", "bottom_left", "bottom_center", "bottom_right"];
const PROTECTED_WEIGHT = { face: 100, product: 30, person: 8, key_object: 12 };

const linear = (value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const relativeLuminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const hexRgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
export const hexLuminance = (hex) => relativeLuminance(...hexRgb(hex));
export const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function intersection(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const grow = (rect, pad) => ({ x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad });

/** Áreas protegidas (em % da imagem gerada) → retângulos no canvas, considerando o recorte "cover". */
export function mapProtectedAreas(areas, baseWidth, baseHeight) {
  const scale = Math.max(WIDTH / baseWidth, HEIGHT / baseHeight);
  const sw = baseWidth * scale;
  const sh = baseHeight * scale;
  const ox = (sw - WIDTH) / 2;
  const oy = (sh - HEIGHT) / 2;
  return (areas ?? []).filter((area) => PROTECTED_WEIGHT[area?.kind] && [area.x, area.y, area.width, area.height].every(Number.isFinite) && area.width > 0 && area.height > 0)
    .map((area) => {
      const x = clamp(area.x / 100 * sw - ox, 0, WIDTH);
      const y = clamp(area.y / 100 * sh - oy, 0, HEIGHT);
      return { kind: area.kind, x, y, w: clamp(area.width / 100 * sw, 0, WIDTH - x), h: clamp(area.height / 100 * sh, 0, HEIGHT - y) };
    }).filter((rect) => rect.w > 4 && rect.h > 4);
}

/** Luminância (média, p10, p90) e "detalhe" (variação entre vizinhos) de uma região do canvas. */
export function regionStats(raw, channels, rect) {
  const x0 = clamp(Math.round(rect.x), 0, WIDTH - 1);
  const y0 = clamp(Math.round(rect.y), 0, HEIGHT - 1);
  const x1 = clamp(Math.round(rect.x + rect.w), x0 + 1, WIDTH);
  const y1 = clamp(Math.round(rect.y + rect.h), y0 + 1, HEIGHT);
  const values = [];
  let detail = 0;
  let pairs = 0;
  for (let y = y0; y < y1; y += 3) {
    let previous;
    for (let x = x0; x < x1; x += 3) {
      const index = (y * WIDTH + x) * channels;
      const value = relativeLuminance(raw[index], raw[index + 1], raw[index + 2]);
      values.push(value);
      if (previous !== undefined) { detail += Math.abs(value - previous); pairs += 1; }
      previous = value;
    }
  }
  values.sort((a, b) => a - b);
  const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, p10: at(0.1), p90: at(0.9), detail: pairs ? detail / pairs : 0 };
}

// ---------------------------------------------------------------- logo

/** Prepara a logo: fundo sólido de arquivo sem transparência é removido (a partir da borda), recorta o vazio. */
export async function prepareLogo(logo) {
  const { data, info } = await sharp(Buffer.from(logo.data, "base64")).rotate().ensureAlpha()
    .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const border = [];
  for (let x = 0; x < width; x += 1) border.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y += 1) border.push(y * width, y * width + width - 1);
  const opaque = border.filter((pixel) => data[pixel * 4 + 3] > 200);
  let knockedOut = false;
  if (opaque.length > border.length * 0.6) {
    const median = [0, 1, 2].map((channel) => opaque.map((pixel) => data[pixel * 4 + channel]).sort((a, b) => a - b)[Math.floor(opaque.length / 2)]);
    const distance = (pixel) => Math.hypot(data[pixel * 4] - median[0], data[pixel * 4 + 1] - median[1], data[pixel * 4 + 2] - median[2]);
    if (opaque.filter((pixel) => distance(pixel) < 40).length > opaque.length * 0.85) {
      // Remove só o fundo conectado à borda (não fura a logo); borda suave de 1px pela distância de cor.
      const visited = new Uint8Array(width * height);
      const stack = opaque.filter((pixel) => distance(pixel) < 48);
      stack.forEach((pixel) => { visited[pixel] = 1; });
      while (stack.length) {
        const pixel = stack.pop();
        data[pixel * 4 + 3] = Math.round(clamp((distance(pixel) - 30) / 18, 0, 1) * data[pixel * 4 + 3]);
        const x = pixel % width;
        for (const next of [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width]) {
          if (next >= 0 && next < width * height && !visited[next] && distance(next) < 48) { visited[next] = 1; stack.push(next); }
        }
      }
      knockedOut = true;
    }
  }
  const trimmed = await sharp(data, { raw: { width, height, channels: 4 } }).trim({ background: "#00000000", threshold: 10 }).png().toBuffer({ resolveWithObject: true });
  const pixels = await sharp(trimmed.data).ensureAlpha().raw().toBuffer();
  let weight = 0;
  let luminance = 0;
  const samples = [];
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (alpha < 0.5) continue;
    const value = relativeLuminance(pixels[index], pixels[index + 1], pixels[index + 2]);
    weight += alpha;
    luminance += alpha * value;
    samples.push(value);
  }
  samples.sort((a, b) => a - b);
  const quantile = (q) => samples.length ? samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] : 0.5;
  return {
    png: trimmed.data, width: trimmed.info.width, height: trimmed.info.height, aspect: trimmed.info.width / trimmed.info.height,
    // Tons claro e escuro da própria logo: logo bicolor (contorno vivo + miolo escuro) é legível pelo tom que contrasta.
    luminance: weight ? luminance / weight : 0.5, tones: [quantile(0.15), quantile(0.85)],
    knockedOut, variant: logo.variant ?? "PRIMARY", backgrounds: logo.backgrounds ?? [],
  };
}

/** Legibilidade da logo sobre um fundo: o melhor contraste entre os tons dominantes dela e o fundo. */
export function logoLegibility(logo, backgroundLuminance) {
  return Math.max(...(logo.tones ?? [logo.luminance]).map((tone) => contrastRatio(tone, backgroundLuminance)));
}

/** Rótulo do cadastro incoerente com o arquivo (ex.: "para fundo escuro" mas a arte é escura). */
export function mislabeled(logo) {
  const onlyDark = logo.backgrounds.includes("DARK") && !logo.backgrounds.includes("LIGHT");
  const onlyLight = logo.backgrounds.includes("LIGHT") && !logo.backgrounds.includes("DARK");
  return (onlyDark && logo.luminance < 0.12) || (onlyLight && logo.luminance > 0.6);
}

export function logoBox(aspect, scale = 1) {
  const area = LOGO_AREA_RATIO * WIDTH * HEIGHT * scale * scale;
  const w = Math.sqrt(area * aspect);
  const h = Math.sqrt(area / aspect);
  const k = Math.min(1, (250 * scale) / w, (140 * scale) / h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export function logoRect(placement, box) {
  const x = placement.endsWith("left") ? MARGIN : placement.endsWith("right") ? WIDTH - MARGIN - box.w : Math.round((WIDTH - box.w) / 2);
  const y = placement.startsWith("top") ? MARGIN : HEIGHT - MARGIN - box.h;
  return { x, y, w: box.w, h: box.h };
}

/** Posição pedida pela marca: configuração explícita do workspace, senão o que as notas da identidade dizem. */
export function brandLogoPlacement(profile, config) {
  if (PLACEMENTS.includes(config?.placement)) return config.placement;
  const notes = String(profile?.identity?.notes ?? "");
  const sentence = notes.split(/[.\n;]/).find((part) => /\blogo/i.test(part) && /(topo|superior|inferior|rodap[ée]|parte de baixo)/i.test(part));
  if (!sentence) return undefined;
  const vertical = /(inferior|rodap[ée]|parte de baixo)/i.test(sentence) ? "bottom" : "top";
  const horizontal = /centraliz|centro|central/i.test(sentence) ? "center" : /direit/i.test(sentence) ? "right" : /esquerd/i.test(sentence) ? "left" : undefined;
  return horizontal ? `${vertical}_${horizontal}` : undefined;
}

// ---------------------------------------------------------------- texto

function linesAt(text, columns) {
  return String(text ?? "").trim().split(/\r?\n/).filter((line) => line.trim()).flatMap((paragraph) => {
    const lines = [];
    for (const word of paragraph.trim().split(/\s+/)) {
      if (!lines.length || `${lines.at(-1)} ${word}`.length > columns) lines.push(word);
      else lines[lines.length - 1] += ` ${word}`;
    }
    return lines;
  });
}

function measure(text, size, lineMultiplier, fieldWidth) {
  const lines = linesAt(text, Math.floor(fieldWidth / (size * 0.59)));
  if (lines.some((line) => line.length * size * 0.56 > fieldWidth)) return { lines, height: Infinity, size };
  const line = Math.ceil(size * lineMultiplier);
  return { lines, size, line, height: lines.length * line };
}

/** Bloco de texto para um layout, respeitando a faixa ocupada pela logo (topReserve/bottomReserve = limites em y). */
export function planText({ layout, headline, body, cta, logoTopEdge, logoBottomEdge, fashionCampaign = false }) {
  const fieldWidth = layout === "left" ? 435 : WIDTH - 2 * TEXT_X;
  const start = layout === "left" ? Math.max(165, (logoTopEdge ?? 0) + 48) : Math.max(95, (logoTopEdge ?? 0) + 48);
  const floor = (logoBottomEdge ?? HEIGHT - 31) - 48;
  const largest = fashionCampaign ? (layout === "left" ? 88 : 120) : (layout === "left" ? 61 : 74);
  for (let size = largest; size >= 35; size -= 2) {
    const title = measure(headline, size, fashionCampaign ? 0.98 : 1.08, fieldWidth);
    const detail = measure(body, fashionCampaign ? 34 : Math.max(26, Math.round(size * 0.48)), 1.19, fieldWidth);
    const action = measure(cta, 29, 1.18, fieldWidth);
    const height = 66 + title.height + detail.height + action.height;
    if (!Number.isFinite(height)) continue;
    const y = layout === "bottom" ? floor - height : start;
    const limit = layout === "top" ? 600 : layout === "left" ? floor : HEIGHT;
    if (layout === "bottom" ? y >= 740 : y + height <= limit) return { layout, fieldWidth, title, detail, action, rect: { x: TEXT_X, y, w: fieldWidth, h: height } };
  }
  return undefined;
}

function protectedPenalty(zone, areas) {
  return areas.reduce((total, area) => total + (intersection(zone, area) / (area.w * area.h)) * PROTECTED_WEIGHT[area.kind], 0);
}

/** Escolhe layout do texto + posição da logo pelo conteúdo: protege rostos/produto e prefere regiões limpas. */
export function chooseComposition({ raw, channels, protectedRects, requestedLayout, requestedPlacement, fixedPlacement, logoAspect, logoScale, headline, body, cta, fashionCampaign }) {
  const layouts = [...new Set([LAYOUTS.includes(requestedLayout) ? requestedLayout : "top", ...LAYOUTS])];
  const placements = fixedPlacement ? [fixedPlacement] : [...new Set([requestedPlacement, "bottom_right", "bottom_left", "top_left", "top_right", "top_center", "bottom_center"].filter((item) => PLACEMENTS.includes(item)))];
  const box = logoBox(logoAspect, logoScale);
  let best;
  for (const layout of layouts) {
    for (const [order, placement] of placements.entries()) {
      const logo = logoRect(placement, box);
      const top = placement.startsWith("top");
      const text = planText({ layout, headline, body, cta, fashionCampaign, logoTopEdge: top ? logo.y + logo.h : undefined, logoBottomEdge: top ? undefined : logo.y });
      if (!text) continue;
      const zone = grow(text.rect, 24);
      if (intersection(grow(logo, 16), zone) > 0) continue;
      const stats = regionStats(raw, channels, text.rect);
      const logoStats = regionStats(raw, channels, logo);
      const score = protectedPenalty(zone, protectedRects) + protectedPenalty(grow(logo, 12), protectedRects) * 1.5
        + stats.detail * 60 + logoStats.detail * 25 + (layout === layouts[0] ? 0 : 0.4) + order * 0.15;
      if (!best || score < best.score) best = { score, layout, placement, text, logo };
    }
  }
  if (!best) throw new Error("QUALITY_TEXT_OVERFLOW: o texto da pauta excede a área segura e precisa de revisão editorial");
  return best;
}

// ---------------------------------------------------------------- véu e camadas

/** Opacidade mínima do véu para o texto atingir contraste 4.5:1 sobre o pior ponto da região. */
export function requiredVeilAlpha(stats, textLuminance, surfaceLuminance) {
  const worst = textLuminance > surfaceLuminance ? stats.p90 : stats.p10;
  const floor = clamp(0.22 + stats.detail * 9, 0.22, 0.8);
  for (let alpha = 0; alpha <= 0.92; alpha += 0.02) {
    if (contrastRatio(textLuminance, worst * (1 - alpha) + surfaceLuminance * alpha) >= MIN_TEXT_CONTRAST + 0.3) return Math.max(alpha, floor);
  }
  return 0.92;
}

async function veilLayer(textRect, layout, alpha, surfaceRgb, protectedRects) {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  let x0 = textRect.x - 70;
  let y0 = textRect.y - 70;
  let x1 = textRect.x + textRect.w + 70;
  let y1 = textRect.y + textRect.h + 90;
  if (x0 < MARGIN * 1.6) x0 = -80;
  if (y0 < MARGIN * 1.6 || layout === "top") y0 = -80;
  if (x1 > WIDTH - MARGIN * 1.6) x1 = WIDTH + 80;
  if (y1 > HEIGHT - MARGIN * 1.6 || layout === "bottom") y1 = HEIGHT + 80;
  if (layout === "left") { y0 = -80; y1 = HEIGHT + 80; }
  const value = Math.round(alpha * 255);
  for (let y = Math.max(0, y0); y < Math.min(HEIGHT, y1); y += 1) mask.fill(value, y * WIDTH + Math.max(0, x0), y * WIDTH + Math.min(WIDTH, x1));
  const soft = await sharp(Buffer.from(mask), { raw: { width: WIDTH, height: HEIGHT, channels: 1 } }).blur(46).extractChannel(0).raw().toBuffer();
  // Rostos nunca recebem véu; produto recebe no máximo 40% do véu.
  if (protectedRects.length) {
    const guard = new Uint8Array(WIDTH * HEIGHT);
    for (const area of protectedRects.filter((item) => item.kind === "face" || item.kind === "product")) {
      const strength = area.kind === "face" ? 255 : 150;
      const pad = area.kind === "face" ? 28 : 0;
      for (let y = Math.max(0, Math.floor(area.y - pad)); y < Math.min(HEIGHT, Math.ceil(area.y + area.h + pad)); y += 1) {
        for (let x = Math.max(0, Math.floor(area.x - pad)); x < Math.min(WIDTH, Math.ceil(area.x + area.w + pad)); x += 1) guard[y * WIDTH + x] = Math.max(guard[y * WIDTH + x], strength);
      }
    }
    const guardSoft = await sharp(Buffer.from(guard), { raw: { width: WIDTH, height: HEIGHT, channels: 1 } }).blur(14).extractChannel(0).raw().toBuffer();
    for (let index = 0; index < soft.length; index += 1) soft[index] = Math.round(soft[index] * (1 - guardSoft[index] / 255));
  }
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
    rgba[index * 4] = surfaceRgb[0]; rgba[index * 4 + 1] = surfaceRgb[1]; rgba[index * 4 + 2] = surfaceRgb[2]; rgba[index * 4 + 3] = soft[index];
  }
  return sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer();
}

/** Sombra/halo suave com a silhueta da própria logo (sem caixa). */
async function logoGlow(logoPng, rect, rgb, mode) {
  const pad = mode === "halo" ? 70 : 34;
  const w = rect.w + 2 * pad;
  const h = rect.h + 2 * pad;
  const silhouette = await sharp(logoPng).resize(rect.w, rect.h, { fit: "contain", background: "#00000000" }).ensureAlpha().raw().toBuffer();
  const canvas = Buffer.alloc(w * h * 4);
  const strength = mode === "halo" ? 1 : 0.85;
  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      const alpha = silhouette[(y * rect.w + x) * 4 + 3];
      if (!alpha) continue;
      const target = ((y + pad) * w + (x + pad)) * 4;
      canvas[target] = rgb[0]; canvas[target + 1] = rgb[1]; canvas[target + 2] = rgb[2]; canvas[target + 3] = Math.round(alpha * strength);
    }
  }
  let layer = sharp(canvas, { raw: { width: w, height: h, channels: 4 } });
  if (mode === "halo") {
    const ellipse = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${rect.w / 2 + 30}" ry="${rect.h / 2 + 26}" fill="rgb(${rgb.join(",")})" fill-opacity="0.72"/></svg>`);
    const merged = await sharp(canvas, { raw: { width: w, height: h, channels: 4 } }).composite([{ input: ellipse, blend: "dest-over" }]).raw().toBuffer();
    layer = sharp(merged, { raw: { width: w, height: h, channels: 4 } });
  }
  return { input: await layer.blur(mode === "halo" ? 26 : 9).png().toBuffer(), left: rect.x - pad, top: rect.y - pad, strength: mode === "halo" ? 0.72 : 0.5 };
}

// ---------------------------------------------------------------- composição

async function catalogBase(photos, surface) {
  const gap = 22;
  const panelWidth = Math.floor((WIDTH - 2 * TEXT_X - gap * (photos.length - 1)) / photos.length);
  const panelHeight = 590;
  const top = 585;
  const start = Math.floor((WIDTH - photos.length * panelWidth - (photos.length - 1) * gap) / 2);
  const layers = await Promise.all(photos.map(async ({ data, color }, index) => {
    const column = start + index * (panelWidth + gap);
    const { data: input, info: { width, height } } = await sharp(Buffer.from(data, "base64"))
      .resize(panelWidth, panelHeight, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    return { input, left: column + Math.floor((panelWidth - width) / 2), top: top + Math.floor((panelHeight - height) / 2),
      width, height, column, color };
  }));
  const input = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: surface } })
    .composite(layers.map(({ input, left, top }) => ({ input, left, top }))).png().toBuffer();
  const areas = layers.map(({ left, top, width, height }) => ({
    kind: "product", x: left / WIDTH * 100, y: top / HEIGHT * 100,
    width: width / WIDTH * 100, height: height / HEIGHT * 100,
  }));
  const labelTop = Math.max(...layers.map(layer => layer.top + layer.height)) + 22;
  return { input, areas, labels: layers.map(({ column, color }) => ({ left: column, width: panelWidth, top: labelTop, color })) };
}

export async function renderArt(request) {
  const { base, catalogPhotos, profile, body, layout, logoPlacement, protectedAreas, logoConfig } = request;
  const identity = profile?.identity;
  const fashionCampaign = request.presentation === "fashion_campaign";
  const cta = fashionCampaign ? undefined : request.cta;
  const headline = fashionCampaign || identity?.typography?.headlineCase === "UPPERCASE" ? request.headline?.toLocaleUpperCase("pt-BR") : request.headline;
  const colors = (identity?.colors ?? []).filter((color) => /^#[\da-f]{6}$/i.test(color.hex));
  const logosInput = request.logos?.length ? request.logos : request.logo ? [{ data: request.logo, variant: "PRIMARY", backgrounds: request.logoBackgrounds ?? [] }] : [];
  if (!logosInput.length) throw new Error("QUALITY_LOGO_MISSING: workspace sem logo oficial configurada");

  const brandNotes = identity?.notes ?? "";
  const darkBackground = /fundo\s+sempre\s+(?:preto|escuro|azul[- ]marinho)/i.test(brandNotes);
  const lightBackground = /fundo\s+sempre\s+claro|nunca\s+escuro/i.test(brandNotes);
  const darkBrand = darkBackground || /preto tecnológico/i.test(brandNotes) || colors.some((color) => /preto tecnológico/i.test(color.name));
  const serif = identity?.typography?.family === "SERIF";
  const darkFashionPoster = fashionCampaign && request.composition?.archetype === "fashion_poster";
  const light = !darkBrand && !darkFashionPoster && (lightBackground || serif || logosInput.every((logo) => (logo.backgrounds ?? []).includes("LIGHT") && !(logo.backgrounds ?? []).includes("DARK")));
  const lightest = [...colors].sort((a, b) => hexLuminance(b.hex) - hexLuminance(a.hex))[0]?.hex ?? "#FFFFFF";
  const darkest = [...colors].sort((a, b) => hexLuminance(a.hex) - hexLuminance(b.hex))[0]?.hex ?? "#0B0B10";
  const surface = light
    ? colors.find((color) => /creme|off.white/i.test(color.name) && hexLuminance(color.hex) > 0.72)?.hex ?? "#F5F1EA"
    : colors.find((color) => hexLuminance(color.hex) < 0.035)?.hex ?? "#12121A";
  const foreground = light ? "#19151A" : "#FAFAFF";
  const accent = colors.find((color) => color.role === "ACCENT")?.hex ?? colors[0]?.hex ?? foreground;
  const accentText = contrastRatio(hexLuminance(accent), hexLuminance(surface)) >= MIN_TEXT_CONTRAST ? accent : foreground;

  const catalog = catalogPhotos?.length ? await catalogBase(catalogPhotos, surface) : undefined;
  // Composição controlada (motor criativo): a base é montada com a foto original do produto ou a
  // captura real da tela, no arquétipo planejado; a IA pode entrar só como cenário (`scene`).
  const composition = request.composition ? await composeBase(request.composition, { surface, accent, foreground, light }) : undefined;
  const original = composition?.base ?? catalog?.input ?? Buffer.from(base, "base64");
  const originalSize = await sharp(original).metadata();
  // Base de 2:3 (1024x1536, comum no gerador) até quadrada: recorte central para 4:5 (as áreas protegidas já
  // são mapeadas com esse recorte). Fora disso o recorte cortaria a cena: QUALITY_ → o pipeline gera de novo.
  const ratio = originalSize.width && originalSize.height ? originalSize.width / originalSize.height : 0;
  if (!(ratio >= 0.6 && ratio <= 1.05)) {
    throw new Error(`QUALITY_ASPECT: A base visual gerada não está em proporção vertical 4:5 (${originalSize.width}x${originalSize.height})`);
  }
  const canvas = await sharp(original).resize(WIDTH, HEIGHT, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const protectedRects = mapProtectedAreas(composition?.protectedAreas ?? catalog?.areas ?? protectedAreas, originalSize.width, originalSize.height);
  const logos = await Promise.all(logosInput.map(prepareLogo));
  const fixedPlacement = brandLogoPlacement(profile, logoConfig) ?? (darkFashionPoster ? "top_right" : undefined);
  const scale = clamp(Number(logoConfig?.scale) || (fashionCampaign ? 0.82 : 1), 0.6, 1.6);

  const plan = chooseComposition({
    raw: canvas.data, channels: canvas.info.channels, protectedRects, requestedLayout: composition?.layout ?? layout, requestedPlacement: logoPlacement,
    fixedPlacement, logoAspect: logos[0].aspect, logoScale: scale, headline, body, cta, fashionCampaign,
  });
  const issues = [];
  const textZone = grow(plan.text.rect, 24);
  for (const area of protectedRects) {
    const covered = intersection(textZone, area) / (area.w * area.h);
    if (area.kind === "face" && covered > 0.02) issues.push(`texto cobriria ${Math.round(covered * 100)}% de um rosto`);
    if (area.kind === "product" && covered > 0.35) issues.push(`texto cobriria ${Math.round(covered * 100)}% do produto`);
  }
  if (issues.length) throw new Error(`QUALITY_COMPOSITION: ${issues.join("; ")}`);

  // Na cena de campanha a zona real de texto pode ser escura mesmo com um logo para fundo claro.
  const textStats = regionStats(canvas.data, canvas.info.channels, plan.text.rect);
  const useSceneTone = fashionCampaign && !catalog && !composition;
  const sceneIsLight = textStats.mean >= 0.4;
  const textSurface = useSceneTone ? (sceneIsLight ? lightest : darkest) : surface;
  const textForeground = useSceneTone ? (sceneIsLight ? "#19151A" : "#FAFAFF") : foreground;
  // Véu só onde o texto precisa, na intensidade que o contraste exige.
  const surfaceLuminance = hexLuminance(textSurface);
  const fgLum = hexLuminance(textForeground);
  const veilAlpha = requiredVeilAlpha(textStats, fgLum, surfaceLuminance);
  const veil = await veilLayer(plan.text.rect, plan.layout, veilAlpha, hexRgb(textSurface), protectedRects);
  const withVeil = await sharp(canvas.data, { raw: { width: WIDTH, height: HEIGHT, channels: canvas.info.channels } }).composite([{ input: veil }]).raw().toBuffer({ resolveWithObject: true });
  const finalTextStats = regionStats(withVeil.data, withVeil.info.channels, plan.text.rect);
  const textContrast = contrastRatio(fgLum, fgLum > surfaceLuminance ? finalTextStats.p90 : finalTextStats.p10);
  if ((catalog || composition) && textContrast < MIN_TEXT_CONTRAST) throw new Error("QUALITY_CONTRAST: texto da pauta abaixo de 4,5:1");

  // Logo: versão compatível com o fundo real daquele canto; tratamento só se o contraste pedir.
  const background = regionStats(withVeil.data, withVeil.info.channels, plan.logo);
  const tone = background.mean < 0.2 ? "DARK" : "LIGHT";
  // O rótulo do cadastro é conferido com a cor real do arquivo: versão "para fundo escuro" que é escura
  // (ou vice-versa) não conta como compatível e vira aviso no relatório.
  const assetWarnings = logos.filter((logo) => mislabeled(logo)).map((logo) => `versão ${logo.variant} da logo está cadastrada para fundo ${logo.backgrounds.includes("DARK") ? "escuro, mas é escura" : "claro, mas é clara"}`);
  const ranked = logos.map((logo) => ({ logo, contrast: logoLegibility(logo, background.mean), compatible: !mislabeled(logo) && (logo.backgrounds.length === 0 || logo.backgrounds.includes(tone)) }))
    .sort((a, b) => (Number(b.compatible) * 2 + Math.min(b.contrast, MIN_LOGO_CONTRAST + 1.5)) - (Number(a.compatible) * 2 + Math.min(a.contrast, MIN_LOGO_CONTRAST + 1.5)));
  const chosen = ranked[0];
  const box = { w: Math.round(Math.min(plan.logo.w, plan.logo.h * chosen.logo.aspect)), h: Math.round(Math.min(plan.logo.h, plan.logo.w / chosen.logo.aspect)) };
  const rect = { x: plan.logo.x + Math.round((plan.logo.w - box.w) / 2), y: plan.logo.y + Math.round((plan.logo.h - box.h) / 2), ...box };
  if (plan.placement.endsWith("left")) rect.x = plan.logo.x;
  if (plan.placement.endsWith("right")) rect.x = plan.logo.x + plan.logo.w - box.w;
  const requestedTreatment = ["none", "shadow", "halo", "plate"].includes(logoConfig?.treatment) ? logoConfig.treatment : "auto";
  // Sem contraste suficiente: versão monocromática da logo oficial (branca no escuro, preta no claro), nítida —
  // o halo/sombra desfocado parecia um borrão (retorno do usuário, 25/11/2026). Halo/sombra só se a marca pedir.
  const treatment = requestedTreatment !== "auto" ? requestedTreatment : chosen.contrast >= MIN_LOGO_CONTRAST ? "none" : "mono";
  const glowRgb = hexRgb(chosen.logo.luminance > 0.4 ? darkest : lightest);
  const layers = [];
  let logoContrast = chosen.contrast;
  let logoPng = chosen.logo.png;
  if (treatment === "mono") {
    const ink = background.mean < 0.35 ? [250, 250, 250] : [17, 17, 17];
    const { data: px, info } = await sharp(chosen.logo.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let index = 0; index < px.length; index += 4) { px[index] = ink[0]; px[index + 1] = ink[1]; px[index + 2] = ink[2]; }
    logoPng = await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    logoContrast = contrastRatio(relativeLuminance(...ink), background.mean);
  } else if (treatment === "plate") {
    const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${rect.w + 36}" height="${rect.h + 28}"><rect width="100%" height="100%" rx="14" fill="${chosen.logo.luminance > 0.4 ? darkest : lightest}"/></svg>`);
    layers.push({ input: plate, left: rect.x - 18, top: rect.y - 14 });
    logoContrast = logoLegibility(chosen.logo, hexLuminance(chosen.logo.luminance > 0.4 ? darkest : lightest));
  } else if (treatment === "shadow" || treatment === "halo") {
    const glow = await logoGlow(chosen.logo.png, rect, glowRgb, treatment);
    layers.push({ input: glow.input, left: glow.left, top: glow.top });
    const glowLum = relativeLuminance(...glowRgb);
    logoContrast = logoLegibility(chosen.logo, background.mean * (1 - glow.strength) + glowLum * glow.strength);
  }
  // Logo pouco legível não derruba a peça (a marca perderia o horário): vira aviso no relatório de qualidade.
  const legibilityWarnings = logoContrast < 1.6 ? [`logo pouco legível mesmo com halo (contraste ${logoContrast.toFixed(2)})`] : [];
  layers.push({ input: await sharp(logoPng).resize(rect.w, rect.h, { fit: "contain", background: "#00000000" }).png().toBuffer(), left: rect.x, top: rect.y });

  // Texto (satori), na área planejada.
  const fontDir = "dist/infrastructure/rendering/assets";
  const fonts = [
    { name: "Geist", data: await readFile(`${fontDir}/geist-regular.ttf`), weight: 400 },
    { name: "DM Serif Display", data: await readFile(`${fontDir}/dm-serif-display-regular.ttf`), weight: 400 },
  ];
  if (fashionCampaign) fonts.push({ name: "Barlow Condensed", data: await readFile(`${fontDir}/barlow-condensed-bold.ttf`), weight: 700 });
  const el = (style, children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
  const group = (block, top, family, color, weight = 400) => el({ position: "absolute", left: TEXT_X, top, width: plan.text.fieldWidth, flexDirection: "column" },
    block.lines.map((line) => el({ fontFamily: family, fontWeight: weight, color, fontSize: block.size, height: block.line, whiteSpace: "nowrap" }, line)));
  const { rect: textRect, title, detail, action } = plan.text;
  const lettering = Buffer.from(await satori(el({ width: WIDTH, height: HEIGHT, position: "relative" }, [
    ...(!fashionCampaign ? [el({ position: "absolute", top: textRect.y, left: TEXT_X, width: 47, height: 5, borderRadius: 2, backgroundColor: accent })] : []),
    group(title, textRect.y + 28, fashionCampaign ? "Barlow Condensed" : serif ? "DM Serif Display" : "Geist", textForeground, fashionCampaign ? 700 : 400),
    group(detail, textRect.y + 45 + title.height, "Geist", textForeground),
    group(action, textRect.y + 66 + title.height + detail.height, "Geist", accentText),
    ...(catalog?.labels ?? []).map(({ left, width, top, color }) => el({
      position: "absolute", left, width, top, justifyContent: "center", fontFamily: "Geist", color: foreground, fontSize: 20,
    }, color)),
    // Rótulos da composição (cor da variante, "Estampa original", modelo) — nunca sobre o texto principal.
    ...(fashionCampaign ? [] : composition?.labels ?? []).filter((label) => {
      const box = { x: label.left, y: label.top, w: label.width, h: (label.size ?? 22) * 1.4 };
      return intersection(box, grow(plan.text.rect, 8)) === 0 && intersection(box, grow(rect, 12)) === 0;
    }).map((label) => el({
      position: "absolute", left: label.left, width: label.width, top: label.top, justifyContent: label.align === "center" ? "center" : "flex-start", fontFamily: "Geist",
      color: label.tone === "accent" ? accentText : foreground, opacity: label.tone === "muted" ? 0.78 : 1, fontSize: label.size ?? 22, letterSpacing: 0.4,
    }, label.text)),
  ]), { width: WIDTH, height: HEIGHT, fonts }));

  const jpeg = await sharp(withVeil.data, { raw: { width: WIDTH, height: HEIGHT, channels: withVeil.info.channels } }).composite([{ input: lettering }, ...layers]).jpeg({ quality: 93, mozjpeg: true }).toBuffer();
  const round = (value) => Math.round(value * 100) / 100;
  const quality = {
    layout: plan.layout, requestedLayout: layout ?? null, textRect: plan.text.rect, veilAlpha: round(veilAlpha), textContrast: round(textContrast),
    logo: { variant: chosen.logo.variant, placement: plan.placement, fixedByBrand: Boolean(fixedPlacement), treatment, contrast: round(logoContrast), rawContrast: round(chosen.contrast), knockedOut: chosen.logo.knockedOut, rect },
    protectedAreas: protectedRects.map((area) => ({ kind: area.kind, x: Math.round(area.x), y: Math.round(area.y), w: Math.round(area.w), h: Math.round(area.h) })),
    issues: textContrast < 3 ? [`contraste do texto ${round(textContrast)}:1`] : [],
    warnings: [...assetWarnings, ...legibilityWarnings, ...(chosen.contrast < MIN_LOGO_CONTRAST ? [`logo com contraste ${round(chosen.contrast)}:1 sem tratamento — falta uma versão oficial adequada a este fundo`] : [])],
  };
  // Quality Gate de fidelidade (quando o agendador manda o plano): produto, tela, texto e repetição.
  const strictBackground = darkBackground ? "dark" : lightBackground ? "light" : undefined;
  const review = request.fidelity ? await fidelityReview({ request, jpeg, canvas, composition, protectedRects, plan, quality, logoContrast, strictBackground, colors }) : undefined;
  return { image: jpeg.toString("base64"), quality, ...(review ?? {}) };
}

const b64 = (value) => Buffer.from(value, "base64");

/** Base da peça pelo arquétipo planejado, com os arquivos originais (ver compositions.ts). */
async function composeBase(spec, tones) {
  const { composeProduct, composeSoftware, composeTypographic } = await dist("infrastructure/media/creative/compositions.js");
  const scene = spec.scene ? b64(spec.scene) : undefined;
  if (spec.mode === "physical_product") {
    return composeProduct(spec.archetype, { photos: spec.products.map((photo) => ({ ...photo, data: b64(photo.data) })), tones, scene });
  }
  if (spec.mode === "software") return composeSoftware(spec.archetype, { capture: { ...spec.capture, data: b64(spec.capture.data) }, tones, scene });
  return composeTypographic({ tones, scene });
}

/** Evidências medidas na arte final + veredito do Quality Gate de fidelidade + impressão visual. */
async function fidelityReview({ request, jpeg, canvas, composition, protectedRects, plan, quality, logoContrast, strictBackground, colors }) {
  const { evaluateFidelityGate } = await dist("application/creative-engine/creative-fidelity-gate.js");
  const { assessVariety } = await dist("application/creative-engine/visual-variety.js");
  const { evaluateSceneBackground, fingerprintArt, measureProductFidelity, measureScreen } = await dist("infrastructure/media/creative/measure-fidelity.js");
  const { fidelity } = request;
  const evidence = { operation: fidelity.operation, transmittedReferenceIds: fidelity.transmittedReferenceIds ?? [] };
  const product = composition?.evidence.product;
  if (product) {
    evidence.product = { composited: true, coverage: product.coverage, touchesEdge: product.touchesEdge, usedProductCode: product.productCode, usedVariant: product.variantLabel, cutout: product.cutout };
  } else if (fidelity.spec.mode === "physical_product" && fidelity.reference) {
    // Produto gerado pela IA a partir da foto original: mede contra a foto, na região que o gerador apontou.
    const area = protectedRects.filter((item) => item.kind === "product").sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (area) {
      const base = await sharp(canvas.data, { raw: { width: WIDTH, height: HEIGHT, channels: canvas.info.channels } }).png().toBuffer();
      const measured = await measureProductFidelity(b64(fidelity.reference), base, { x: area.x, y: area.y, w: area.w, h: area.h });
      evidence.product = { composited: false, shapeDistance: measured.shapeDistance, colorDeltaE: measured.colorDeltaE, printDistance: measured.printDistance, coverage: (area.w * area.h) / (WIDTH * HEIGHT) };
      evidence.productMeasure = measured;
    }
  }
  const screen = composition?.evidence.screen;
  if (screen) {
    const measured = await measureScreen(jpeg, screen.screenRect);
    evidence.screen = { composited: true, captureId: screen.captureId, luminanceStd: measured.luminanceStd, edgeDensity: measured.edgeDensity, legibilityScale: screen.legibilityScale, renderedTextPx: screen.renderedTextPx, captureFeature: screen.feature };
  }
  const textZone = grow(plan.text.rect, 24);
  evidence.text = {
    contrast: quality.textContrast, issues: quality.issues,
    coversProduct: protectedRects.some((area) => area.kind === "product" && intersection(textZone, area) / (area.w * area.h) > 0.35),
    marginOk: plan.text.rect.x >= MARGIN - 1 && plan.text.rect.x + plan.text.rect.w <= WIDTH - MARGIN + 1,
  };
  evidence.logo = { ok: logoContrast >= 1.6, warnings: quality.warnings };
  const fingerprint = await fingerprintArt(jpeg, {
    archetype: composition?.appliedArchetype ?? request.composition?.archetype ?? fidelity.archetype ?? "ai_scene", textLayout: plan.layout,
    productCount: request.composition?.products?.length ?? (evidence.product ? 1 : 0), ...(fidelity.seriesKey ? { seriesKey: fidelity.seriesKey } : {}),
  });
  evidence.variety = assessVariety(fingerprint, request.history ?? []);
  if (fidelity.aiReview) evidence.aiReview = fidelity.aiReview;
  if (fidelity.spec.mode === "conceptual" || fidelity.sceneReviewRequired === true) {
    evidence.scene = {
      reviewRequired: fidelity.sceneReviewRequired === true,
      review: fidelity.sceneReview,
      paletteIssue: strictBackground ? await evaluateSceneBackground(jpeg, { tone: strictBackground, colors: colors.map(({ hex }) => hex), protectedRects }) : undefined,
    };
  }
  // O veredito leva o SHA-256 da imagem avaliada: o backend só agenda exatamente esta imagem.
  const { sha256Hex } = await dist("application/creative-engine/publication-guard.js");
  const gate = { ...evaluateFidelityGate(fidelity.spec, evidence), imageSha256: sha256Hex(jpeg) };
  // Reprovada: a correção é decidida pelo motivo (nunca repetir a mesma solicitação).
  let revision;
  if (!gate.approved) {
    const { planRevision } = await dist("application/creative-engine/targeted-revision.js");
    const context = fidelity.revisionContext ?? {};
    revision = planRevision({ failures: gate.failures, operation: fidelity.operation, attempt: context.attempt ?? 1, maxAttempts: context.maxAttempts ?? 3, spentUsd: context.spentUsd ?? 0, budgetUsd: context.budgetUsd ?? 0, aiAttemptCostUsd: context.aiAttemptCostUsd ?? 0 });
  }
  return { gate, ...(revision ? { revision } : {}), fingerprint, ...(composition?.appliedArchetype ? { appliedArchetype: composition.appliedArchetype } : {}), evidence: { ...evidence, ...(screen ? { screenRect: screen.screenRect } : {}) } };
}

if (typeof request !== "undefined") {
  // eslint-disable-next-line no-undef
  console.log(JSON.stringify(await renderArt(request)));
}
