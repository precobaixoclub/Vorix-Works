/**
 * Endereços de "Criar conteúdo" (Fase 4). Um ponto só para montar os links — Início, Revisão,
 * Publicações e a rota antiga `/social/compose` apontam todos para cá.
 */

export type CreateMode = "ia" | "pronto";

/** Parâmetros antigos de `/create` (atalho rápido da Home e da Produção) que já indicam a criação com IA. */
const LEGACY_AI_PARAMS = ["draft", "format", "aspectRatio", "channel", "ideia"] as const;
/** Parâmetros que só o compositor usa (conteúdo vindo da Revisão). */
const COMPOSER_PARAMS = ["media", "caption", "source"] as const;

/** Qual modo abrir: o pedido explicitamente, ou o deduzido de links antigos; `undefined` = mostrar a escolha. */
export function resolveCreateMode(params: URLSearchParams): CreateMode | undefined {
  const mode = params.get("modo");
  if (mode === "ia" || mode === "pronto") return mode;
  if (COMPOSER_PARAMS.some((key) => params.has(key))) return "pronto";
  if (LEGACY_AI_PARAMS.some((key) => params.has(key))) return "ia";
  return undefined;
}

export function createHref(workspaceId: string, mode?: CreateMode, extra?: URLSearchParams): string {
  const params = new URLSearchParams(extra);
  params.delete("modo");
  const query = mode ? `modo=${mode}${params.toString() ? `&${params.toString()}` : ""}` : params.toString();
  return `/workspaces/${workspaceId}/create${query ? `?${query}` : ""}`;
}

/** `/social/compose?…` → `/create?modo=pronto&…` preservando mídia, legenda e origem. */
export function composeRedirectHref(workspaceId: string, search: string): string {
  return createHref(workspaceId, "pronto", new URLSearchParams(search));
}

/** Link da Revisão para publicar uma peça aprovada (mídia + legenda + execução de origem). */
export function publishFromReviewHref(workspaceId: string, runId: string, mediaUrls: readonly string[], caption: string): string {
  const params = new URLSearchParams();
  for (const url of mediaUrls) params.append("media", url);
  if (caption && caption !== "Sem descrição.") params.set("caption", caption);
  params.set("source", runId);
  return createHref(workspaceId, "pronto", params);
}
