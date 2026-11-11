import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import sharp from "sharp";
import type { PublicObjectRepositoryPort } from "../../../application/ports/public-object-repository.port.js";
import { resolveObjectPath } from "../../../infrastructure/storage/local-object-storage.js";
import { objectSignatureSecondsLeft, verifyObjectSignature } from "../../../shared/utils/object-url-signing.js";
import { NotFoundError } from "../http/app-error.js";

/**
 * `/uploads/<key>` — PRIVADO por padrão (ver `object-url-signing.ts`). Serve só com:
 * - URL assinada válida (escopo da chave, não expirada) → `Cache-Control: private`;
 * - chave marcada explicitamente como pública (`public_objects`, motivo persistido) → cache público curto.
 * Qualquer outro caso — sem assinatura, assinatura expirada/adulterada, chave inválida, traversal,
 * symlink para fora da raiz, arquivo inexistente — responde 404 (nunca revela se o arquivo existe).
 */
export async function registerUploadedObjectRoutes(app: FastifyInstance, options: { rootDir: string; publicObjects?: PublicObjectRepositoryPort }): Promise<void> {
  app.get("/uploads/*", async (request, reply) => {
    const key = (request.params as { "*": string })["*"];
    const query = (request.query ?? {}) as { exp?: unknown; sig?: unknown; w?: unknown };
    // Observabilidade: o MOTIVO da negação vai para o log (nunca a chave nem a assinatura); a
    // resposta é sempre o mesmo 404, para não revelar se o arquivo existe.
    const notFound = (reason: string) => {
      request.log.warn({ uploadsAccessDenied: reason }, "uploads: acesso negado");
      return new NotFoundError("Arquivo não encontrado.");
    };

    let absolutePath: string;
    try {
      absolutePath = resolveObjectPath(options.rootDir, key);
    } catch {
      throw notFound("INVALID_PATH");
    }

    const verdict = verifyObjectSignature(key, typeof query.exp === "string" ? query.exp : undefined, typeof query.sig === "string" ? query.sig : undefined);
    let publicObject = false;
    if (verdict !== "VALID") {
      if (verdict !== "MISSING") throw notFound(`SIGNATURE_${verdict}`);
      publicObject = (await options.publicObjects?.isPublic(key).catch(() => false)) ?? false;
      if (!publicObject) throw notFound("PRIVATE_WITHOUT_SIGNATURE");
    }

    // Symlink que aponte para fora da raiz nunca é servido (mesma regra do `read` por chave).
    const [realRoot, realFile] = await Promise.all([realpath(options.rootDir).catch(() => undefined), realpath(absolutePath).catch(() => undefined)]);
    if (!realRoot || !realFile) throw notFound("NOT_FOUND");
    if (!(realFile === realRoot || realFile.startsWith(`${realRoot}${sep}`))) throw notFound("OUTSIDE_ROOT");
    const fileStat = await stat(realFile).catch(() => undefined);
    if (!fileStat?.isFile()) throw notFound("NOT_FOUND");

    // A signed URL may be reused for as long as its signature lives (capped at a day): storefront
    // photos keep the same URL all day, so browsers stop downloading them on every page.
    const signedFor = publicObject ? 0 : objectSignatureSecondsLeft(typeof query.exp === "string" ? query.exp : undefined);
    reply.header("Cache-Control", publicObject ? "public, max-age=3600" : `private, max-age=${Math.max(60, Math.min(86_400, signedFor))}`);
    const width = Number(query.w);
    if (THUMB_WIDTHS.has(width) && THUMB_SOURCES.test(key)) {
      const thumb = await thumbnail(realRoot, realFile, key, width, fileStat.mtimeMs).catch((error) => {
        request.log.warn({ err: error }, "uploads: miniatura indisponível, servindo o original");
        return undefined;
      });
      if (thumb) return reply.type("image/webp").header("Content-Length", String(thumb.length)).send(thumb);
    }
    reply.header("Accept-Ranges", "bytes");
    reply.type(contentTypeForKey(key));
    // Range (um único intervalo): o player de áudio/vídeo navega pela gravação sem baixar tudo.
    const range = parseSingleRange(request.headers.range, fileStat.size);
    if (range === "unsatisfiable") {
      reply.code(416).header("Content-Range", `bytes */${fileStat.size}`);
      return reply.send();
    }
    if (range) {
      reply.code(206).header("Content-Range", `bytes ${range.start}-${range.end}/${fileStat.size}`).header("Content-Length", String(range.end - range.start + 1));
      return reply.send(createReadStream(realFile, { start: range.start, end: range.end }));
    }
    reply.header("Content-Length", String(fileStat.size));
    return reply.send(createReadStream(realFile));
  });
}

/**
 * Miniatura (`?w=`) de foto: a tela mostra quadrados de ~200 px, e baixar/decodificar o original
 * (até 5 MB, milhares de pixels) para cada um deixava o cadastro de produto lento. Gerada uma vez e
 * guardada em `.thumbs/` (prefixo com ponto: nunca é uma chave servível); refeita se o original mudar.
 * Só larguras fixas, para não virar redimensionamento arbitrário sob demanda.
 */
const THUMB_WIDTHS = new Set([160, 480, 960]);
const THUMB_SOURCES = /\.(?:jpe?g|png|webp)$/i;
async function thumbnail(root: string, source: string, key: string, width: number, sourceMtime: number): Promise<Buffer> {
  const target = join(root, ".thumbs", String(width), `${key}.webp`);
  const cached = await stat(target).catch(() => undefined);
  if (cached && cached.mtimeMs >= sourceMtime) return readFile(target);
  // Lido para memória antes: o sharp com caminho mantém o arquivo aberto no cache do libvips.
  const body = await sharp(await readFile(source), { limitInputPixels: 64_000_000 }).rotate().resize({ width, height: width, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, body);
  await rename(temporary, target);
  return body;
}

/** `bytes=a-b` | `bytes=a-` | `bytes=-n`. Múltiplos intervalos ou formato inválido = ignora (200 inteiro). */
export function parseSingleRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return undefined;
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

function contentTypeForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".otf")) return "font/otf";
  return "application/octet-stream";
}
