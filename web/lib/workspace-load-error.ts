import { ApiError } from "@/lib/api-error";

/**
 * Por que o espaço de trabalho não abriu (Fase 6). Antes, QUALQUER falha ao buscar o workspace —
 * inclusive "Limite operacional de requisições excedido" (429), API fora do ar ou rede caída —
 * aparecia como "Espaço de Trabalho não encontrado", o que fazia parecer que a empresa tinha sumido.
 * Só 404/403 (o servidor disse que não existe ou que a pessoa não tem acesso) é "não encontrado";
 * o resto é temporário e merece "Tentar de novo".
 */
export type WorkspaceLoadProblem = "not_found" | "rate_limited" | "offline" | "unavailable";

export function classifyWorkspaceError(error: unknown): WorkspaceLoadProblem {
  if (error instanceof ApiError) {
    if (error.statusCode === 404 || error.statusCode === 403 || /NOT_FOUND|FORBIDDEN|ACCESS_DENIED/.test(error.code)) return "not_found";
    if (error.statusCode === 429 || error.code === "RATE_LIMIT_EXCEEDED") return "rate_limited";
    if (error.statusCode === 0 || error.code === "NETWORK_ERROR") return "offline";
    return "unavailable";
  }
  if (error instanceof TypeError) return "offline"; // fetch sem rede
  return "unavailable";
}

export const WORKSPACE_LOAD_MESSAGE: Record<WorkspaceLoadProblem, { title: string; description: string; retry: boolean }> = {
  not_found: { title: "Espaço de Trabalho não encontrado", description: "Ele pode ter sido removido, arquivado ou você não tem acesso a ele.", retry: false },
  rate_limited: { title: "Muitas solicitações em pouco tempo", description: "O Vorix pausou por alguns segundos para proteger a sua conta. Seus dados estão seguros — tente de novo em instantes.", retry: true },
  offline: { title: "Sem conexão com o Vorix", description: "Verifique a sua internet e tente de novo.", retry: true },
  unavailable: { title: "Não foi possível abrir o espaço de trabalho", description: "Houve uma falha temporária ao carregar. Seus dados estão seguros — tente de novo.", retry: true },
};
