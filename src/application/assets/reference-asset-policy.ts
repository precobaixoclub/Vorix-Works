/**
 * Política única de resolução de reference assets (produto/logo/screenshot/referência de estilo)
 * para os dois motores criativos. Achado de auditoria: `referenceAssets`/`referenceImageUrl`
 * aceitavam qualquer string e o backend fazia `fetch(url)` cru — sem prova de posse, sem bloqueio de
 * rede interna, sem limite de tamanho.
 *
 * Modelo de confiança:
 * - TENANT_MANAGED_ASSET: objeto no storage gerenciado sob `<tenantId>/<workspaceId>/<arquivo>`
 *   (upload de mídia) ou `assets/<tenantId>/<workspaceId>/<arquivo>` (Asset Library). A CHAVE do
 *   storage é a fonte de verdade de posse — nunca a URL enviada pelo cliente em si.
 * - SYSTEM_QA_ASSET: `qa-assets/<namespace>/<arquivo>`, controlado só pela plataforma; permitido
 *   apenas quando o chamador provou homologação editorial (flag + allowlist + trusted actor).
 * - APPROVED_EXTERNAL_ASSET: não suportado — nenhum fluxo do produto nem dado persistido usa origem
 *   externa; imagem externa precisa ser enviada ao storage antes.
 * - UNTRUSTED_URL: todo o resto (outro host, IP literal, localhost, file:, ftp:, data:, chaves fora
 *   dos namespaces acima). Negado sem nenhuma requisição de rede.
 *
 * Como o objeto é lido do storage pela chave (nunca por HTTP), não existe fetch de rede para
 * reference assets: SSRF, redirects e DNS rebinding deixam de existir por construção.
 */

export const REFERENCE_ASSET_TRUST_CATEGORIES = ["TENANT_MANAGED_ASSET", "SYSTEM_QA_ASSET", "APPROVED_EXTERNAL_ASSET", "UNTRUSTED_URL"] as const;
export type ReferenceAssetTrustCategory = (typeof REFERENCE_ASSET_TRUST_CATEGORIES)[number];

export const REFERENCE_ASSET_ERROR_CODES = [
  "REFERENCE_ASSET_FORBIDDEN",
  "REFERENCE_ASSET_SOURCE_NOT_ALLOWED",
  "REFERENCE_ASSET_INVALID",
  "REFERENCE_ASSET_TOO_LARGE",
  "REFERENCE_ASSET_NOT_FOUND",
] as const;
export type ReferenceAssetErrorCode = (typeof REFERENCE_ASSET_ERROR_CODES)[number];

/** Teto de bytes de um reference asset de imagem — checado ANTES de ler/decodificar. */
export const REFERENCE_ASSET_MAX_BYTES = 15 * 1024 * 1024;

/** Mensagens deliberadamente genéricas: nunca revelam se o objeto existe nem a quem pertence. */
const SAFE_MESSAGES: Record<ReferenceAssetErrorCode, string> = {
  REFERENCE_ASSET_FORBIDDEN: "Asset de referência não autorizado para este tenant/workspace.",
  REFERENCE_ASSET_SOURCE_NOT_ALLOWED: "Origem do asset de referência não permitida — envie a imagem para o storage da plataforma.",
  REFERENCE_ASSET_INVALID: "Referência de asset inválida.",
  REFERENCE_ASSET_TOO_LARGE: "Asset de referência excede o tamanho máximo permitido.",
  REFERENCE_ASSET_NOT_FOUND: "Asset de referência não autorizado ou indisponível.",
};

export class ReferenceAssetError extends Error {
  readonly code: ReferenceAssetErrorCode;
  /** Categoria sanitizada para log/auditoria — nunca a URL completa. */
  readonly reasonCategory: string;

  constructor(code: ReferenceAssetErrorCode, reasonCategory: string) {
    super(`${code}: ${SAFE_MESSAGES[code]}`);
    this.name = "ReferenceAssetError";
    this.code = code;
    this.reasonCategory = reasonCategory;
  }
}

export function isReferenceAssetError(error: unknown): error is ReferenceAssetError {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && (REFERENCE_ASSET_ERROR_CODES as readonly string[]).includes(code);
}

export type ReferenceAssetScope = {
  tenantId: string;
  workspaceId: string;
  /** `true` só quando flag editorial + allowlist + trusted actor já foram comprovados. */
  qaNamespaceAllowed: boolean;
};

export type ReferenceAssetPolicyConfig = {
  /** Base pública do storage gerenciado (ex.: https://api.vorixworks.com/uploads). */
  publicBaseUrl: string;
};

export type AuthorizedReferenceAsset = {
  category: Exclude<ReferenceAssetTrustCategory, "UNTRUSTED_URL" | "APPROVED_EXTERNAL_ASSET">;
  objectKey: string;
};

export type ReferenceAssetAuthorization =
  | ({ ok: true } & AuthorizedReferenceAsset)
  | { ok: false; category: ReferenceAssetTrustCategory; code: ReferenceAssetErrorCode; reasonCategory: string };

const ID_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const FILE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

function deny(category: ReferenceAssetTrustCategory, code: ReferenceAssetErrorCode, reasonCategory: string): ReferenceAssetAuthorization {
  return { ok: false, category, code, reasonCategory };
}

/** Extrai a chave do storage a partir da URL, aceitando só a base pública configurada (ou o
 * caminho relativo dela). Nunca aceita outro host, porta, esquema, credenciais, query ou fragmento. */
function extractObjectKey(rawUrl: string, config: ReferenceAssetPolicyConfig): { key?: string; reason?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2000) return { reason: "empty_or_too_long" };
  let base: URL;
  try {
    base = new URL(config.publicBaseUrl.endsWith("/") ? config.publicBaseUrl : `${config.publicBaseUrl}/`);
  } catch {
    return { reason: "policy_base_invalid" };
  }
  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    return { reason: "unparseable_url" };
  }
  if (url.protocol !== base.protocol) return { reason: `scheme_${url.protocol.replace(":", "") || "unknown"}` };
  if (url.username || url.password) return { reason: "credentials_in_url" };
  if (url.host !== base.host) return { reason: "external_host" };
  if (url.search || url.hash) return { reason: "query_or_fragment" };
  // Rejeita traversal ANTES da normalização do WHATWG URL (que resolve `..` silenciosamente).
  const rawPath = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  if (/(^|\/|\\)\.\.?($|\/|\\)/.test(rawPath) || /%2e|%2f|%5c|%00|\\/i.test(rawPath)) return { reason: "path_traversal" };
  if (!url.pathname.startsWith(base.pathname)) return { reason: "outside_storage_base" };
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(base.pathname.length));
  } catch {
    return { reason: "bad_encoding" };
  }
  if (!key || key.includes("\0") || key.includes("\\") || key.startsWith("/") || key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { reason: "path_traversal" };
  }
  return { key };
}

/**
 * Autoriza um reference asset ANTES de qualquer leitura, decode ou chamada de IA. Pura e
 * determinística — nenhuma rede, nenhum disco.
 */
export function authorizeReferenceAssetUrl(rawUrl: string, scope: ReferenceAssetScope, config: ReferenceAssetPolicyConfig): ReferenceAssetAuthorization {
  const { key, reason } = extractObjectKey(rawUrl, config);
  if (!key) {
    const invalid = reason === "path_traversal" || reason === "bad_encoding" || reason === "empty_or_too_long" || reason === "unparseable_url";
    return deny("UNTRUSTED_URL", invalid ? "REFERENCE_ASSET_INVALID" : "REFERENCE_ASSET_SOURCE_NOT_ALLOWED", reason ?? "unknown");
  }
  const segments = key.split("/");

  if (segments[0] === "qa-assets") {
    if (segments.length !== 3 || !ID_SEGMENT.test(segments[1]!.replace(/\./g, "_")) || !FILE_SEGMENT.test(segments[2]!)) return deny("SYSTEM_QA_ASSET", "REFERENCE_ASSET_INVALID", "qa_namespace_shape");
    if (!scope.qaNamespaceAllowed) return deny("SYSTEM_QA_ASSET", "REFERENCE_ASSET_FORBIDDEN", "qa_namespace_not_authorized");
    return { ok: true, category: "SYSTEM_QA_ASSET", objectKey: key };
  }

  const managed = segments[0] === "assets" ? segments.slice(1) : segments;
  if (managed.length === 3 && ID_SEGMENT.test(managed[0]!) && ID_SEGMENT.test(managed[1]!) && FILE_SEGMENT.test(managed[2]!) && managed[0]!.startsWith("tenant-")) {
    // Escopo WORKSPACE_ONLY: cada workspace tem a sua própria Asset Library e as chaves de upload
    // são namespaced por workspace — mesmo tenant, outro workspace, também é negado.
    if (managed[0] !== scope.tenantId || managed[1] !== scope.workspaceId) return deny("TENANT_MANAGED_ASSET", "REFERENCE_ASSET_FORBIDDEN", "ownership_mismatch");
    return { ok: true, category: "TENANT_MANAGED_ASSET", objectKey: key };
  }

  return deny("UNTRUSTED_URL", "REFERENCE_ASSET_SOURCE_NOT_ALLOWED", "unmanaged_storage_key");
}

/** Mesma autorização, lançando `ReferenceAssetError` — conveniência para os pontos de entrada. */
export function assertReferenceAssetUrlAuthorized(rawUrl: string, scope: ReferenceAssetScope, config: ReferenceAssetPolicyConfig): AuthorizedReferenceAsset {
  const result = authorizeReferenceAssetUrl(rawUrl, scope, config);
  if (!result.ok) throw new ReferenceAssetError(result.code, result.reasonCategory);
  return { category: result.category, objectKey: result.objectKey };
}

/** Linha de log sanitizada: nunca URL completa, token ou signed URL. */
export function describeReferenceAssetDecision(input: { scope: ReferenceAssetScope; role: string; result: ReferenceAssetAuthorization | { ok: false; code: string; reasonCategory: string; category?: string } }): string {
  const { scope, role, result } = input;
  const outcome = result.ok ? `allowed category=${result.category}` : `denied code=${result.code} category=${result.category ?? "unknown"} reason=${result.reasonCategory}`;
  return `[reference-asset] tenantId=${scope.tenantId} workspaceId=${scope.workspaceId} role=${role} ${outcome}`;
}

/** Leitura de um asset já autorizado — implementada sobre o storage gerenciado (nunca HTTP). */
export type ReferenceAssetReaderPort = {
  read(objectKey: string, options: { maxBytes: number }): Promise<Buffer>;
};

/** Resolver completo usado pelos motores: autoriza e lê pela chave. */
export type ReferenceAssetResolverPort = {
  authorize(rawUrl: string, scope: ReferenceAssetScope): ReferenceAssetAuthorization;
  load(rawUrl: string, scope: ReferenceAssetScope): Promise<Buffer>;
};

export function createReferenceAssetResolver(config: ReferenceAssetPolicyConfig, reader: ReferenceAssetReaderPort, options: { maxBytes?: number } = {}): ReferenceAssetResolverPort {
  const maxBytes = options.maxBytes ?? REFERENCE_ASSET_MAX_BYTES;
  return {
    authorize: (rawUrl, scope) => authorizeReferenceAssetUrl(rawUrl, scope, config),
    load: async (rawUrl, scope) => {
      const authorized = assertReferenceAssetUrlAuthorized(rawUrl, scope, config);
      return reader.read(authorized.objectKey, { maxBytes });
    },
  };
}
