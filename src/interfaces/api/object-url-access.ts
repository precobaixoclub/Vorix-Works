import type { FastifyInstance } from "fastify";
import type { WorkspaceRepositoryPort } from "../../application/ports/workspace-repository.port.js";
import type { AuthPrincipal } from "../../domain/identity/identity.model.js";
import { classifyObjectKeyOwner, isObjectUrlSigningConfigured, OBJECT_URL_TTL, parseOwnedObjectUrl, signObjectKey } from "../../shared/utils/object-url-signing.js";

/** Decide se um usuário autenticado pode LER uma chave do storage (e, portanto, recebê-la assinada). */
export type ObjectKeyReadAuthorizer = (principal: AuthPrincipal, objectKey: string) => Promise<boolean>;

/**
 * Regras (o principal é por tenant; um workspace é acessível quando pertence ao tenant):
 * - `assets/<tenant>/<ws>/…` e `<tenant>/<ws>/…`: tenant do principal E workspace desse tenant;
 * - `ai-generated|gpt-creative-engine|product-assets|…/<tenant>/…`: tenant do principal;
 * - `qa-assets/…` (fixtures de homologação): só tenants da allowlist de QA;
 * - qualquer outra chave: nunca.
 */
export function createObjectKeyReadAuthorizer(deps: { workspaceRepository: WorkspaceRepositoryPort; qaTenantIds: readonly string[] }): ObjectKeyReadAuthorizer {
  const qaTenants = new Set(deps.qaTenantIds);
  return async (principal, objectKey) => {
    const owner = classifyObjectKeyOwner(objectKey);
    if (!owner) return false;
    if (owner.kind === "system_qa") return qaTenants.has(principal.tenantId);
    if (owner.tenantId !== principal.tenantId) return false;
    if (owner.kind === "tenant") return true;
    const workspace = await deps.workspaceRepository.getById(owner.workspaceId).catch(() => undefined);
    return Boolean(workspace && workspace.tenantId === principal.tenantId);
  };
}

/**
 * Respostas JSON para um usuário autenticado (access token normal) saem com as URLs deste storage
 * ASSINADAS (validade de preview) — só as chaves que ele pode ler; as demais ficam canônicas (sem
 * assinatura → 404 em `/uploads`). O frontend continua usando `<img src>` sem mudar nada.
 */
export function registerSignedObjectUrlResponses(app: FastifyInstance, deps: { publicBaseUrl: string; authorize: ObjectKeyReadAuthorizer }): void {
  const base = deps.publicBaseUrl.endsWith("/") ? deps.publicBaseUrl : `${deps.publicBaseUrl}/`;
  const pattern = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"\\\\\\s<>]*`, "g");
  app.addHook("onSend", async (request, reply, payload) => {
    const principal = request.zunoContext?.principal;
    if (!principal || principal.purpose || typeof payload !== "string" || !payload.includes(base)) return payload;
    if (!String(reply.getHeader("content-type") ?? "").includes("application/json") || !isObjectUrlSigningConfigured()) return payload;
    const replacements = new Map<string, string>();
    const decisions = new Map<string, boolean>();
    for (const match of new Set(payload.match(pattern) ?? [])) {
      const parsed = parseOwnedObjectUrl(match);
      if (!parsed) continue;
      if (!decisions.has(parsed.key)) decisions.set(parsed.key, await deps.authorize(principal, parsed.key));
      if (!decisions.get(parsed.key)) continue;
      const signed = signObjectKey(parsed.key, OBJECT_URL_TTL.preview);
      if (signed) replacements.set(match, signed);
    }
    if (replacements.size === 0) return payload;
    return payload.replace(pattern, (match) => replacements.get(match) ?? match);
  });
}
