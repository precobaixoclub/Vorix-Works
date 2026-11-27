// Renderizador das cenas de motion design (Remotion) para o worker de vídeo.
//
// - O pacote (webpack) é montado UMA vez por processo e reaproveitado.
// - Os arquivos do job (fotos, capturas, gravação) e as fontes são servidos por um HTTP local em 127.0.0.1,
//   só durante o render, somente da pasta do job (sem travessia de caminho).
// - Concorrência do Chromium limitada (padrão 1 no VPS): o worker já garante um render por vez, e a cena do
//   Remotion roda ANTES dos passos do FFmpeg — os dois nunca disputam a CPU ao mesmo tempo.
import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
const require_crypto = () => ({ createHash });
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const here = dirname(fileURLToPath(import.meta.url));
const FONTS = resolve(here, "..", "src", "infrastructure", "rendering", "assets");
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime", ".ttf": "font/ttf" };
let bundlePromise;

/** Hash do código das composições: entra na chave do cache das cenas (template novo = render novo). */
export const TEMPLATES_VERSION = (() => {
  const { createHash } = require_crypto();
  const hash = createHash("sha256");
  const walk = (dir) => { for (const name of readdirSync(dir).sort()) { const file = join(dir, name); if (statSync(file).isDirectory()) walk(file); else hash.update(name).update(readFileSync(file)); } };
  walk(join(here, "src"));
  return hash.digest("hex").slice(0, 16);
})();

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

/**
 * Renderiza uma cena. `assets` são nomes de arquivo dentro de `jobDir` (viram URLs locais nas props: chaves
 * terminadas em "photo", "photos", "screenshot", "video", "logo").
 */
export async function renderScene({ jobDir, outputPath, props, concurrency = Number(process.env.REMOTION_CONCURRENCY ?? 1), cacheDir, timeoutMs = 180_000, signal, onProgress }) {
  const serveUrl = await bundleOnce(cacheDir);
  const server = await serve(resolve(jobDir), FONTS);
  const base = `http://127.0.0.1:${server.address().port}`;
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
  for (const key of ["photo", "screenshot", "video", "logo"]) if (typeof inputProps[key] === "string") inputProps[key] = url(inputProps[key]);
  if (Array.isArray(inputProps.photos)) inputProps.photos = inputProps.photos.map(url);
  const started = Date.now();
  try {
    const composition = await selectComposition({ serveUrl, id: "Scene", inputProps, timeoutInMilliseconds: timeoutMs });
    let cancel;
    if (signal) {
      const { makeCancelSignal } = await import("@remotion/renderer");
      const made = makeCancelSignal();
      cancel = made.cancelSignal;
      signal.addEventListener("abort", () => made.cancel(), { once: true });
    }
    await renderMedia({
      serveUrl, composition, inputProps, codec: "h264", crf: 17, pixelFormat: "yuv420p", outputLocation: outputPath, concurrency,
      timeoutInMilliseconds: timeoutMs, chromiumOptions: { gl: "swangle" }, logLevel: "error", ...(cancel ? { cancelSignal: cancel } : {}),
      onProgress: ({ progress }) => onProgress?.(progress),
    });
    return { ms: Date.now() - started, frames: composition.durationInFrames };
  } finally {
    server.close();
  }
}
