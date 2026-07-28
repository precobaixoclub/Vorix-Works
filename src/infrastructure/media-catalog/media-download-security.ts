import { mkdir, open, rm, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * REAL FOOTAGE ACQUISITION (seção 11) — todo o hardening de download de mídia externa vive aqui,
 * isolado do resto do Media Intelligence Engine. Nunca usa shell (só fetch nativo do Node 20),
 * nunca executa o conteúdo baixado (só grava bytes em disco e devolve o caminho; quem lê
 * metadados depois é o FFmpeg, um binário conhecido e fixo, nunca o arquivo baixado em si).
 */

export type DownloadLimits = {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  allowedHosts: string[];
  maxRetries: number;
};

export const DEFAULT_DOWNLOAD_LIMITS: DownloadLimits = {
  timeoutMs: 20_000,
  maxBytes: 200 * 1024 * 1024,
  maxRedirects: 3,
  allowedHosts: [],
  maxRetries: 2,
};

export type DownloadResult =
  | { ok: true; absolutePath: string; sizeBytes: number; contentType: string | null }
  | { ok: false; reason: string };

/** Só HTTPS e host presente na allowlist explícita — nunca aceita HTTP puro nem host fora da lista, mesmo que o redirecionamento pareça legítimo. */
export function isAllowedDownloadUrl(rawUrl: string, allowedHosts: string[]): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `URL invalida: "${rawUrl}".` };
  }
  if (url.protocol !== "https:") return { ok: false, reason: `Protocolo nao permitido: "${url.protocol}" - so HTTPS e aceito.` };
  const hostAllowed = allowedHosts.some((allowedHost) => url.hostname === allowedHost || url.hostname.endsWith(`.${allowedHost}`));
  if (!hostAllowed) return { ok: false, reason: `Host "${url.hostname}" nao esta na allowlist do provider (${allowedHosts.join(", ")}).` };
  return { ok: true, url };
}

const FILENAME_ALLOWED_CHAR = /^[A-Za-z0-9._-]$/;

/**
 * Reconstroi o nome de arquivo caractere a caractere, mantendo só letras/números/ponto/hífen/
 * underscore — proteção contra path traversal e caracteres de controle sem depender de nenhuma
 * classe de regex com intervalo de código (evita ambiguidade de escape em qualquer toolchain).
 */
export function sanitizeDownloadFileName(name: string): string {
  let safe = "";
  for (const char of name) {
    safe += FILENAME_ALLOWED_CHAR.test(char) ? char : "_";
  }
  // O filtro por caractere sozinho preserva "." (necessário para extensões), então ".." sobrevive
  // intacto quando aparecia no nome original — precisa de uma segunda passada dedicada a quebrar
  // qualquer sequência de path traversal remanescente.
  safe = safe.replace(/\.{2,}/g, "_");
  safe = safe.replace(/_{2,}/g, "_");
  if (safe.length === 0) safe = "download";
  return safe.slice(0, 180);
}

const MAGIC_BYTES: Array<{ mimePrefixes: string[]; check: (bytes: Uint8Array) => boolean }> = [
  { mimePrefixes: ["video/mp4"], check: (bytes) => bytes.length >= 12 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp" },
  { mimePrefixes: ["video/quicktime"], check: (bytes) => bytes.length >= 12 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp" },
  { mimePrefixes: ["image/jpeg"], check: (bytes) => bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8 },
  { mimePrefixes: ["image/png"], check: (bytes) => bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 },
];

/** Confere que os PRIMEIROS BYTES REAIS do arquivo baixado correspondem ao Content-Type declarado - nunca confia só no header HTTP, que pode ser forjado ou estar errado. */
export function verifyRealMimeType(bytes: Uint8Array, declaredContentType: string | null): { ok: boolean; reason?: string } {
  if (!declaredContentType) return { ok: false, reason: "Content-Type ausente na resposta - nao e possivel confirmar o tipo real do arquivo." };
  const normalized = declaredContentType.split(";")[0].trim().toLowerCase();
  const matcher = MAGIC_BYTES.find((entry) => entry.mimePrefixes.includes(normalized));
  if (!matcher) return { ok: false, reason: `Content-Type "${normalized}" nao e um tipo de midia suportado para aquisicao.` };
  if (!matcher.check(bytes)) return { ok: false, reason: `Assinatura real do arquivo nao corresponde ao Content-Type declarado ("${normalized}").` };
  return { ok: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Baixa `url` para `destinationDir/fileNameHint` com todos os limites de segurança da seção 11:
 * timeout, limite de tamanho (abortado em streaming, nunca depois de já ter baixado tudo),
 * redirecionamentos limitados com a allowlist revalidada a cada salto, MIME real conferido pelos
 * bytes, escrita em arquivo temporário + rename atômico só após validar, limpeza de arquivo
 * parcial em qualquer falha, e retry controlado com backoff em erros transitórios (429/5xx).
 */
export async function downloadMediaFile(input: {
  url: string;
  destinationDir: string;
  fileNameHint: string;
  limits?: Partial<DownloadLimits>;
}): Promise<DownloadResult> {
  const limits = { ...DEFAULT_DOWNLOAD_LIMITS, ...input.limits };
  let attempt = 0;
  const currentUrl = input.url;

  while (attempt <= limits.maxRetries) {
    attempt += 1;
    const outcome = await attemptDownload(currentUrl, input.destinationDir, input.fileNameHint, limits);
    if (outcome.ok) return outcome;
    if (outcome.retryable && attempt <= limits.maxRetries) {
      await sleep(outcome.retryAfterMs ?? 500 * attempt);
      continue;
    }
    return { ok: false, reason: outcome.reason };
  }
  return { ok: false, reason: "Numero maximo de tentativas de download excedido." };
}

type AttemptOutcome =
  | { ok: true; absolutePath: string; sizeBytes: number; contentType: string | null }
  | { ok: false; reason: string; retryable: boolean; retryAfterMs?: number };

async function attemptDownload(startUrl: string, destinationDir: string, fileNameHint: string, limits: DownloadLimits): Promise<AttemptOutcome> {
  let hop = 0;
  let currentUrl = startUrl;

  while (true) {
    const validation = isAllowedDownloadUrl(currentUrl, limits.allowedHosts);
    if (!validation.ok) return { ok: false, reason: validation.reason, retryable: false };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
    let response: Response;
    try {
      response = await fetch(validation.url, { signal: controller.signal, redirect: "manual" });
    } catch (error) {
      clearTimeout(timeout);
      const isAbort = error instanceof Error && error.name === "AbortError";
      return { ok: false, reason: isAbort ? `Timeout ao baixar (${limits.timeoutMs}ms).` : `Falha de rede: ${error instanceof Error ? error.message : String(error)}.`, retryable: true };
    }
    clearTimeout(timeout);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      response.body?.cancel();
      if (!location) return { ok: false, reason: "Redirecionamento sem header Location.", retryable: false };
      hop += 1;
      if (hop > limits.maxRedirects) return { ok: false, reason: `Excedeu o limite de ${limits.maxRedirects} redirecionamento(s).`, retryable: false };
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      response.body?.cancel();
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      return { ok: false, reason: "Rate limit do provider (429).", retryable: true, retryAfterMs };
    }
    if (response.status >= 500) {
      response.body?.cancel();
      return { ok: false, reason: `Erro do provider (HTTP ${response.status}).`, retryable: true };
    }
    if (!response.ok) {
      response.body?.cancel();
      return { ok: false, reason: `HTTP ${response.status} ao baixar.`, retryable: false };
    }

    return writeResponseToDisk(response, destinationDir, fileNameHint, limits);
  }
}

async function writeResponseToDisk(response: Response, destinationDir: string, fileNameHint: string, limits: DownloadLimits): Promise<AttemptOutcome> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > limits.maxBytes) {
    response.body?.cancel();
    return { ok: false, reason: `Arquivo excede o limite de tamanho (${limits.maxBytes} bytes, declarado ${contentLength}).`, retryable: false };
  }
  if (!response.body) return { ok: false, reason: "Resposta sem corpo.", retryable: false };

  await mkdir(destinationDir, { recursive: true });
  const safeName = sanitizeDownloadFileName(fileNameHint);
  const tempPath = join(destinationDir, `download-${randomUUID()}-${safeName}`);
  const finalPath = join(destinationDir, safeName);

  const fileHandle = await open(tempPath, "w");
  let sizeBytes = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > limits.maxBytes) {
        await reader.cancel();
        throw new Error(`Arquivo excede o limite de tamanho (${limits.maxBytes} bytes) durante o download.`);
      }
      await fileHandle.write(value);
    }
  } catch (error) {
    await fileHandle.close();
    await rm(tempPath, { force: true });
    return { ok: false, reason: error instanceof Error ? error.message : String(error), retryable: false };
  }
  await fileHandle.close();

  const firstBytes = await readFirstBytes(tempPath, 32);
  const mimeCheck = verifyRealMimeType(firstBytes, response.headers.get("content-type"));
  if (!mimeCheck.ok) {
    await rm(tempPath, { force: true });
    return { ok: false, reason: mimeCheck.reason ?? "MIME real nao confere.", retryable: false };
  }

  await rename(tempPath, finalPath);
  return { ok: true, absolutePath: finalPath, sizeBytes, contentType: response.headers.get("content-type") };
}

async function readFirstBytes(filePath: string, count: number): Promise<Uint8Array> {
  const fileHandle = await open(filePath, "r");
  try {
    const buffer = new Uint8Array(count);
    const { bytesRead } = await fileHandle.read(buffer, 0, count, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

export async function fileSizeOf(absolutePath: string): Promise<number> {
  const stats = await stat(absolutePath);
  return stats.size;
}
