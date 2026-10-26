/**
 * Soluções do Vorix no frontend — espelha `src/domain/solutions/solution.model.ts`.
 *
 * O Vorix é uma plataforma de soluções independentes sobre um Core compartilhado (conta,
 * workspace, usuários, cobrança). Cada solução tem a PRÓPRIA navegação; o que decide qual solução
 * está ativa é a rota em que a pessoa está — nenhuma URL mudou nesta separação.
 *
 * Isto aqui é só organização de interface. O bloqueio de verdade é o guarda da API
 * (`solution-access.middleware.ts`): quem não tem a solução recebe 403 do backend mesmo que
 * digite a URL na mão.
 */

export type SolutionKey = "conversations" | "meetings" | "marketing" | "site";

export type SolutionSummary = {
  key: SolutionKey;
  name: string;
  /** Acesso interno a uma solução ainda fora da oferta comercial. */
  internal: boolean;
};

export const SOLUTION_SHORT_NAME: Record<SolutionKey, string> = {
  site:"Site",
  conversations: "Conversas",
  meetings: "Meetings",
  marketing: "Marketing",
};

/** Para onde o seletor de soluções leva (caminho relativo ao workspace). */
export const SOLUTION_HOME_PATH: Record<SolutionKey, string> = {
  site:"/site",
  conversations: "",
  meetings: "/meetings",
  marketing: "/production",
};

/** Primeiro segmento da rota (depois de `/workspaces/:id`) → solução dona da tela. */
const MARKETING_SEGMENTS: ReadonlySet<string> = new Set([
  "create",
  "production",
  "campaigns",
  "calendar",
  "publish",
  // Redes sociais: criar publicação, calendário e integrações (Instagram/Facebook/TikTok).
  "social",
  "meta-ads",
  "knowledge",
  "assets",
  "review",
  "chat",
  "analytics",
  "instagram",
  "facebook",
  "tiktok",
  // Bastidor técnico da produção/publicação de conteúdo.
  "planning",
  "runtime",
  "execution",
  "publications",
  "providers",
  "governance",
  "operations",
]);

/** Vorix Meetings: tudo sob `/meetings` (início, Central, gravações, detalhe). */
const MEETINGS_SEGMENTS: ReadonlySet<string> = new Set(["meetings"]);

const CONVERSATIONS_SEGMENTS: ReadonlySet<string> = new Set(["", "conversas", "kanban", "contacts", "deals", "tasks", "proposals", "results", "reports", "performance", "products"]);

/** Telas do Core (conta/workspace): não pertencem a uma solução — mantêm a que já estava ativa. */
const CORE_SEGMENTS: ReadonlySet<string> = new Set(["settings", "connections", "onboarding"]);

export type RouteOwner = SolutionKey | "core";

/** Dono de uma rota do workspace. Rota desconhecida cai no Core (nunca bloqueia por engano). */
export function routeOwner(pathname: string, workspaceBase: string): RouteOwner {
  if (!pathname.startsWith(workspaceBase)) return "core";
  const segment = pathname.slice(workspaceBase.length).split("/").filter(Boolean)[0] ?? "";
  if(segment==="site")return "site";
  if(segment==="commerce")return "site";
  if (MARKETING_SEGMENTS.has(segment)) return "marketing";
  if (MEETINGS_SEGMENTS.has(segment)) return "meetings";
  if (CONVERSATIONS_SEGMENTS.has(segment)) return "conversations";
  if (CORE_SEGMENTS.has(segment)) return "core";
  return "core";
}

/**
 * Solução cuja navegação deve aparecer agora. Numa tela do Core vale a última solução usada
 * (`remembered`), desde que a pessoa ainda tenha acesso a ela; senão, a primeira disponível.
 */
export function resolveActiveSolution(input: { owner: RouteOwner; available: readonly SolutionKey[]; remembered?: SolutionKey }): SolutionKey {
  const fallback: SolutionKey = input.available[0] ?? "conversations";
  if (input.owner !== "core") return input.available.includes(input.owner) ? input.owner : fallback;
  if (input.remembered && input.available.includes(input.remembered)) return input.remembered;
  return fallback;
}

/** `true` quando a pessoa está numa tela de uma solução a que não tem acesso. */
export function isRouteBlocked(owner: RouteOwner, available: readonly SolutionKey[]): boolean {
  return owner !== "core" && !available.includes(owner);
}
