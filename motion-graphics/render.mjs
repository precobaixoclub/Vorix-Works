// Renderizador das cenas de motion design (Remotion) para o worker de vídeo.
//
// - O pacote (webpack) é montado UMA vez por processo e reaproveitado.
// - Os arquivos do job (fotos, capturas, gravação) e as fontes são servidos por um HTTP local em 127.0.0.1,
//   só durante o render, somente da pasta do job (sem travessia de caminho).
// - Concorrência do Chromium limitada (padrão 1 no VPS): o worker já garante um render por vez, e a cena do
//   Remotion roda ANTES dos passos do FFmpeg — os dois nunca disputam a CPU ao mesmo tempo.
// - O Chromium é aberto uma vez e reaproveitado entre as cenas do mesmo vídeo; fecha sozinho depois de um
//   tempo ocioso (devolve a memória ao worker) e é reaberto se cair no meio de um render.
// - Imagens maiores que o necessário são reduzidas UMA vez (sem recriar nada: só reamostragem), o que tira
//   decodificação pesada de cada quadro. Capturas de tela mantêm resolução alta para a lupa.
// - Perfis: "final" (padrão, qualidade de entrega) e "preview" (metade da resolução, para iteração rápida).
import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
const require_crypto = () => ({ createHash });
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const here = dirname(fileURLToPath(import.meta.url));
const FONTS = resolve(here, "..", "src", "infrastructure", "rendering", "assets");
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime", ".ttf": "font/ttf" };
let bundlePromise;

/**
 * Chromium baixado pelo `ensureBrowser()` dentro da pasta DESTE pacote. O Remotion procura em
 * `<cwd>/node_modules/.remotion` por padrão — o worker roda em /app, então o caminho é informado aqui.
 */
function findBrowser() {
  if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
  const root = join(here, "node_modules", ".remotion");
  if (!existsSync(root)) return undefined;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) stack.push(file);
      else if (name === "chrome-headless-shell" || name === "chrome-headless-shell.exe") return file;
    }
  }
  return undefined;
}
const browserExecutable = findBrowser();

/** Hash do código das composições: entra na chave do cache das cenas (template novo = render novo). */
export const TEMPLATES_VERSION = (() => {
  const { createHash } = require_crypto();
  const hash = createHash("sha256");
  const walk = (dir) => { for (const name of readdirSync(dir).sort()) { const file = join(dir, name); if (statSync(file).isDirectory()) walk(file); else hash.update(name).update(readFileSync(file)); } };
  walk(join(here, "src"));
  return hash.digest("hex").slice(0, 16);
})();

const CHROMIUM = { gl: "swangle" };
let browserPromise;
let idleTimer;
async function browser() {
  clearTimeout(idleTimer);
  browserPromise ??= openBrowser("chrome", { chromiumOptions: CHROMIUM, logLevel: "error", ...(browserExecutable ? { browserExecutable } : {}) });
  return browserPromise;
}
export async function closeBrowser() {
  clearTimeout(idleTimer);
  const pending = browserPromise;
  browserPromise = undefined;
  if (pending) await pending.then((b) => b.close({ silent: true })).catch(() => undefined);
}
function releaseLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), Number(process.env.REMOTION_BROWSER_IDLE_MS ?? 30_000));
  idleTimer.unref?.();
}

/** Lado maior máximo por papel (px). O quadro é 1080×1920; o macro do detalhe amplia até ~3,4× e a lupa da tela, mais. */
const MAX_SIDE = { photo: 3200, photos: 3200, logo: 1600, screenshot: 4096 };
async function fitted(jobDir, name, maxSide) {
  if (!/.(png|jpe?g|webp)$/i.test(name)) return name;
  const { default: sharp } = await import("sharp");
  const meta = await sharp(join(jobDir, name)).metadata();
  if (Math.max(meta.width ?? 0, meta.height ?? 0) <= maxSide) return name;
  const out = `fit${maxSide}-${name}`;
  if (!existsSync(join(jobDir, out))) {
    const image = sharp(join(jobDir, name)).rotate().resize({ width: maxSide, height: maxSide, fit: "inside", kernel: "lanczos3" });
    await (/.png$/i.test(name) ? image.png() : /.webp$/i.test(name) ? image.webp({ quality: 95 }) : image.jpeg({ quality: 94, chromaSubsampling: "4:4:4" })).toFile(join(jobDir, out));
  }
  return out;
}

/** Arquivo de cada template: a versão de uma cena só muda quando a base comum ou o SEU arquivo mudam. */
const TEMPLATE_FILES = { spot: "spot.tsx", product_hero: "product.tsx", detail_reveal: "product.tsx", lineup: "product.tsx", software_focus: "software-title-speech.tsx", title_card: "software-title-speech.tsx", speech_captions: "software-title-speech.tsx", clock: "concept.tsx", counter: "concept.tsx", versus: "concept.tsx", mask_reveal: "concept.tsx" };
const BASE_VERSION = (() => {
  const hash = createHash("sha256");
  const walk = (dir) => { for (const name of readdirSync(dir).sort()) { const file = join(dir, name); if (statSync(file).isDirectory()) { if (name !== "templates") walk(file); } else hash.update(name).update(readFileSync(file)); } };
  walk(join(here, "src"));
  return hash.digest("hex");
})();
export function templateVersion(template) {
  const file = TEMPLATE_FILES[template];
  if (!file) return TEMPLATES_VERSION;
  return createHash("sha256").update(BASE_VERSION).update(readFileSync(join(here, "src", "templates", file))).digest("hex").slice(0, 16);
}

function bundleOnce(cacheDir) {
  bundlePromise ??= bundle({ entryPoint: join(here, "src", "index.tsx"), outDir: cacheDir ? resolve(cacheDir, "remotion-bundle") : undefined, enableCaching: true });
  return bundlePromise;
}

function serve(root, fontsDir) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    const base = path.startsWith("/fonts/") ? fontsDir : root;
    const file = normalize(join(base, path.replace(/^\/fonts\//, "/")));
    if (!file.startsWith(resolve(base) + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    const size = statSync(file).size;
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? "");
    const headers = { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "accept-ranges": "bytes", "access-control-allow-origin": "*" };
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : size - 1;
      response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
    } else {
      response.writeHead(200, { ...headers, "content-length": size });
      createReadStream(file).pipe(response);
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** Props com os arquivos do job trocados por URLs do servidor local (e as imagens reduzidas uma vez). */
async function prepareProps(jobDir, props, base) {
  const url = (name) => `${base}/${encodeURIComponent(name)}`;
  const inputProps = { ...props, assetBase: base };
  // Fundo desfocado pré-calculado uma vez (o desfoque por quadro no Chromium é o passo mais caro).
  if (typeof props.photo === "string" && !props.backdrop) {
    const blurred = `blur-${props.photo.replace(/\.[a-z0-9]+$/i, "")}.jpg`;
    const target = join(jobDir, blurred);
    if (!existsSync(target)) {
      const { default: sharp } = await import("sharp");
      await sharp(join(jobDir, props.photo)).rotate().resize({ width: 360 }).blur(14).modulate({ brightness: 0.55, saturation: 0.9 }).jpeg({ quality: 80 }).toFile(target);
    }
    inputProps.backdrop = url(blurred);
  }
  for (const key of ["photo", "screenshot", "logo"]) if (typeof inputProps[key] === "string") inputProps[key] = url(await fitted(jobDir, inputProps[key], MAX_SIDE[key]));
  if (typeof inputProps.video === "string") inputProps.video = url(inputProps.video);
  if (Array.isArray(inputProps.photos)) inputProps.photos = await Promise.all(inputProps.photos.map(async (name) => url(await fitted(jobDir, name, MAX_SIDE.photos))));
  // Spot: fotos por id ({ src, w, h, ... }) e o recorte da estampa (PNG com transparência, sem reamostrar).
  else if (inputProps.photos && typeof inputProps.photos === "object") inputProps.photos = Object.fromEntries(await Promise.all(Object.entries(inputProps.photos).map(async ([id, photo]) => [id, { ...photo, src: url(await fitted(jobDir, photo.src, MAX_SIDE.photos)) }])));
  if (inputProps.cutout?.src) inputProps.cutout = { ...inputProps.cutout, src: url(inputProps.cutout.src) };
  return inputProps;
}

/**
 * Renderiza uma cena. `assets` são nomes de arquivo dentro de `jobDir` (viram URLs locais nas props: chaves
 * terminadas em "photo", "photos", "screenshot", "video", "logo").
 */
export async function renderScene({ jobDir, outputPath, props, concurrency = Number(process.env.REMOTION_CONCURRENCY ?? 1), cacheDir, timeoutMs = 180_000, signal, onProgress, quality = process.env.REMOTION_QUALITY === "preview" ? "preview" : "final" }) {
  const serveUrl = await bundleOnce(cacheDir);
  const server = await serve(resolve(jobDir), FONTS);
  const base = `http://127.0.0.1:${server.address().port}`;
  const inputProps = await prepareProps(jobDir, props, base);
  const started = Date.now();
  const profile = quality === "preview" ? { scale: 0.5, crf: 23, jpegQuality: 70 } : { scale: 1, crf: 17, jpegQuality: 90 };
  const attempt = async () => {
    const puppeteerInstance = await browser();
    const composition = await selectComposition({ serveUrl, id: "Scene", inputProps, timeoutInMilliseconds: timeoutMs, puppeteerInstance, ...(browserExecutable ? { browserExecutable } : {}) });
    let cancel;
    if (signal) {
      const { makeCancelSignal } = await import("@remotion/renderer");
      const made = makeCancelSignal();
      cancel = made.cancelSignal;
      signal.addEventListener("abort", () => made.cancel(), { once: true });
    }
    await renderMedia({
      serveUrl, composition, inputProps, codec: "h264", crf: profile.crf, scale: profile.scale, jpegQuality: profile.jpegQuality, pixelFormat: "yuv420p", outputLocation: outputPath, concurrency,
      timeoutInMilliseconds: timeoutMs, chromiumOptions: CHROMIUM, puppeteerInstance, ...(browserExecutable ? { browserExecutable } : {}),
      // Memória: o worker tem 2 GiB. Cache de quadros de vídeo limitado (o padrão cresce até estourar).
      offthreadVideoCacheSizeInBytes: Number(process.env.REMOTION_VIDEO_CACHE_BYTES ?? 256 * 1024 * 1024), offthreadVideoThreads: 1, logLevel: "error", ...(cancel ? { cancelSignal: cancel } : {}),
      onProgress: ({ progress }) => onProgress?.(progress),
    });
    return composition.durationInFrames;
  };
  try {
    let frames;
    try {
      frames = await attempt();
    } catch (error) {
      if (signal?.aborted || !/target closed|protocol error|session closed|disconnected|browser has|crash|ECONNRESET/i.test(String(error?.message ?? error))) throw error;
      // Chromium caiu ou ficou inconsistente: fecha, abre outro e tenta UMA vez.
      await closeBrowser();
      frames = await attempt();
    }
    return { ms: Date.now() - started, frames, quality };
  } finally {
    server.close();
    releaseLater();
  }
}

/**
 * Quadros parados de uma composição (storyboard visual, de baixo custo: nenhum vídeo é codificado).
 * Grava `<outDir>/<prefixo>-<quadro>.jpg` e devolve os caminhos.
 */
export async function renderStills({ jobDir, props, frames, outDir, prefix = "quadro", scale = 0.5, cacheDir, timeoutMs = 120_000 }) {
  const serveUrl = await bundleOnce(cacheDir);
  const server = await serve(resolve(jobDir), FONTS);
  const base = `http://127.0.0.1:${server.address().port}`;
  const started = Date.now();
  try {
    const inputProps = await prepareProps(jobDir, props, base);
    const puppeteerInstance = await browser();
    const composition = await selectComposition({ serveUrl, id: "Scene", inputProps, timeoutInMilliseconds: timeoutMs, puppeteerInstance, ...(browserExecutable ? { browserExecutable } : {}) });
    const files = [];
    for (const frame of frames) {
      const output = join(outDir, `${prefix}-${String(frame).padStart(4, "0")}.jpg`);
      await renderStill({ serveUrl, composition, inputProps, frame: Math.min(composition.durationInFrames - 1, Math.max(0, frame)), output, imageFormat: "jpeg", jpegQuality: 85, scale, puppeteerInstance, timeoutInMilliseconds: timeoutMs, chromiumOptions: CHROMIUM, logLevel: "error", ...(browserExecutable ? { browserExecutable } : {}) });
      files.push(output);
    }
    return { files, ms: Date.now() - started };
  } finally {
    server.close();
    releaseLater();
  }
}
