import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Acesso a arquivos do object storage (`/uploads/<key>`) — PRIVADO por padrão.
 *
 * Um arquivo só é lido por: (1) URL ASSINADA curta, com escopo de UMA chave (HMAC sobre a chave e a
 * expiração — trocar a chave, a expiração ou a assinatura invalida); ou (2) objeto marcado
 * explicitamente como público (`public_objects`, com motivo persistido). A URL canônica sem
 * assinatura (a que já está persistida em tabelas/JSON) continua sendo o IDENTIFICADOR do arquivo,
 * nunca uma credencial: quem precisa ler assina no momento do uso —
 * - respostas JSON autenticadas (só chaves do tenant do usuário; ver `object-url-access.ts`);
 * - o próprio backend antes de baixar por HTTP ou de mandar a URL para a OpenAI;
 * - publicação externa (Instagram/TikTok/Meta) com validade maior.
 *
 * Sem configuração (`configureObjectUrlSigning` não chamado, ou storage que não é servido por esta
 * API — ex.: S3), tudo aqui é no-op e devolve a URL como está.
 */

export const OBJECT_URL_TTL = {
  /** Download interno pelo próprio backend. */
  internalFetch: 10 * 60,
  /** Leitura pela OpenAI (vision `image_url`) — a OpenAI baixa na hora. */
  aiProvider: 15 * 60,
  /** Preview no navegador (respostas JSON autenticadas). */
  preview: 60 * 60,
  /** Plataformas externas de publicação baixando a mídia (Instagram/TikTok/Meta Ads). */
  externalPublication: 24 * 60 * 60,
} as const;

/** Teto absoluto aceito na verificação (nenhuma assinatura vale mais que isto). */
export const OBJECT_URL_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

type SigningConfig = { publicBaseUrl: URL; key: Buffer; now: () => number };

let active: SigningConfig | undefined;

/** Deriva a chave de assinatura do segredo do servidor (nunca o segredo cru; nunca vai para URL). */
export function deriveObjectUrlSigningKey(serverSecret: string): Buffer {
  return createHmac("sha256", serverSecret).update("vorix:object-url-signing:v1").digest();
}

export function configureObjectUrlSigning(input: { publicBaseUrl: string; signingKey: Buffer; now?: () => number }): void {
  const base = new URL(input.publicBaseUrl.endsWith("/") ? input.publicBaseUrl : `${input.publicBaseUrl}/`);
  active = { publicBaseUrl: base, key: input.signingKey, now: input.now ?? (() => Date.now()) };
}

export function resetObjectUrlSigning(): void {
  active = undefined;
}

export function isObjectUrlSigningConfigured(): boolean {
  return active !== undefined;
}

function signature(key: Buffer, objectKey: string, exp: number): string {
  return createHmac("sha256", key).update(`obj:v1\n${objectKey}\n${exp}`).digest("base64url");
}

function encodeKey(objectKey: string): string {
  return objectKey.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/**
 * Chave do storage a partir de uma URL deste storage. Mesma rigidez da política de reference
 * assets: mesmo esquema/host/base, sem credenciais, sem fragmento, sem traversal (cru ou codificado);
 * a única query aceita é a de assinatura (`exp` + `sig`), devolvida separada.
 */
export function parseOwnedObjectUrl(rawUrl: string, publicBaseUrl?: string): { key: string; exp?: string; sig?: string } | undefined {
  const base = publicBaseUrl ? new URL(publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`) : active?.publicBaseUrl;
  if (!base || typeof rawUrl !== "string") return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 4000) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== base.protocol || url.host !== base.host || url.username || url.password || url.hash) return undefined;
  if (!url.pathname.startsWith(base.pathname)) return undefined;
  const rawPath = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").split("?")[0]!;
  if (/(^|\/|\\)\.\.?($|\/|\\)/.test(rawPath) || /%2e|%2f|%5c|%00|\\/i.test(rawPath)) return undefined;
  const params = [...url.searchParams.keys()];
  if (params.some((name) => name !== "exp" && name !== "sig")) return undefined;
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(base.pathname.length));
  } catch {
    return undefined;
  }
  if (!key || key.includes("\0") || key.includes("\\") || key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return undefined;
  return { key, ...(url.searchParams.get("exp") ? { exp: url.searchParams.get("exp")! } : {}), ...(url.searchParams.get("sig") ? { sig: url.searchParams.get("sig")! } : {}) };
}

/**
 * URL assinada para UMA chave. A expiração é arredondada para cima numa janela (1/4 da validade,
 * no máximo 15 min) para que assinaturas emitidas em sequência gerem a MESMA URL — o navegador
 * reaproveita o cache em vez de baixar de novo a cada resposta.
 */
export function signObjectKey(objectKey: string, ttlSeconds: number): string | undefined {
  if (!active) return undefined;
  const ttl = Math.max(60, Math.min(ttlSeconds, OBJECT_URL_MAX_TTL_SECONDS - 15 * 60));
  const bucket = Math.min(15 * 60, Math.floor(ttl / 4));
  const nowSeconds = Math.floor(active.now() / 1000);
  const exp = Math.ceil((nowSeconds + ttl) / bucket) * bucket;
  const url = new URL(encodeKey(objectKey), active.publicBaseUrl);
  url.search = `exp=${exp}&sig=${signature(active.key, objectKey, exp)}`;
  return url.toString();
}

/** Assina se for URL deste storage (descartando assinatura antiga); qualquer outra URL volta igual. */
export function signOwnedUrl(rawUrl: string, ttlSeconds: number): string {
  const parsed = active ? parseOwnedObjectUrl(rawUrl) : undefined;
  if (!parsed) return rawUrl;
  return signObjectKey(parsed.key, ttlSeconds) ?? rawUrl;
}

/** Mídia entregue a uma plataforma EXTERNA de publicação (Instagram/Facebook/TikTok/Meta Ads), que
 * baixa o arquivo pela URL: assinada, escopo de uma chave, validade de 24 h. */
export function signForExternalPublication(rawUrl: string): string {
  return signOwnedUrl(rawUrl, OBJECT_URL_TTL.externalPublication);
}

/** URL canônica (sem assinatura) — para persistir/comparar; nunca uma credencial. */
export function stripObjectUrlSignature(rawUrl: string): string {
  const parsed = active ? parseOwnedObjectUrl(rawUrl) : undefined;
  if (!parsed || (!parsed.exp && !parsed.sig)) return rawUrl;
  return new URL(encodeKey(parsed.key), active!.publicBaseUrl).toString();
}

export type ObjectSignatureVerdict = "VALID" | "MISSING" | "EXPIRED" | "INVALID";

export function verifyObjectSignature(objectKey: string, exp: string | undefined, sig: string | undefined): ObjectSignatureVerdict {
  if (!active) return "INVALID";
  if (!exp && !sig) return "MISSING";
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return "INVALID";
  const expected = Buffer.from(signature(active.key, objectKey, Number(exp)));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "INVALID";
  const nowSeconds = Math.floor(active.now() / 1000);
  if (Number(exp) <= nowSeconds) return "EXPIRED";
  if (Number(exp) - nowSeconds > OBJECT_URL_MAX_TTL_SECONDS) return "INVALID";
  return "VALID";
}

/** Dono de uma chave pelo layout do storage (ver produtores em `objectStorage.put`). */
export type ObjectKeyOwner =
  | { kind: "workspace"; tenantId: string; workspaceId: string }
  | { kind: "tenant"; tenantId: string }
  | { kind: "system_qa"; namespace: string };

const TENANT_ONLY_PREFIXES = new Set(["ai-generated", "gpt-creative-engine", "product-assets", "ghost-text-recheck", "gpt-creative-prototype"]);
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function classifyObjectKeyOwner(objectKey: string): ObjectKeyOwner | undefined {
  const segments = objectKey.split("/");
  if (segments[0] === "qa-assets" && segments.length === 3 && ID.test(segments[1]!)) return { kind: "system_qa", namespace: segments[1]! };
  if (TENANT_ONLY_PREFIXES.has(segments[0]!) && segments.length === 3 && ID.test(segments[1]!) && segments[1]!.startsWith("tenant-")) {
    return { kind: "tenant", tenantId: segments[1]! };
  }
  const scoped = segments[0] === "assets" ? segments.slice(1) : segments;
  const isProductImage = segments[0] === "assets" && scoped.length === 4 && scoped[2] === "products" && /^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(scoped[3]!);
  if ((scoped.length === 3 || isProductImage) && ID.test(scoped[0]!) && scoped[0]!.startsWith("tenant-") && ID.test(scoped[1]!)) {
    return { kind: "workspace", tenantId: scoped[0]!, workspaceId: scoped[1]! };
  }
  return undefined;
}
