import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { apiClient } from "@/lib/api-client";
import { resolveActiveSolution, routeOwner, type RouteOwner, type SolutionKey, type SolutionSummary } from "@/lib/solutions";

const REMEMBERED_SOLUTION_KEY = "vorix:active-solution";
const FALLBACK_SOLUTIONS: SolutionSummary[] = [{ key: "conversations", name: "Vorix Conversas", internal: false }];

/** Soluções a que o tenant tem acesso (`GET /v1/solutions`). Uma solução sem acesso não vem na
 * lista — o frontend nunca fica sabendo dela, então não há como mostrá-la "em breve". */
export function useSolutions() {
  const swr = useSWR(["solutions"], () => apiClient.get<{ solutions: SolutionSummary[] }>("/v1/solutions"), { revalidateOnFocus: false });
  // Falha ao consultar as soluções NÃO pode derrubar o produto: vale o padrão (só Conversas).
  // Marketing continua fechado nesse caso — e a API barra de qualquer forma.
  const solutions = swr.data?.solutions ?? (swr.error ? FALLBACK_SOLUTIONS : undefined);
  const available = useMemo<SolutionKey[]>(() => (solutions ?? []).map((solution) => solution.key), [solutions]);
  return {
    solutions: solutions ?? [],
    available,
    // Enquanto a lista não chega, nada de Marketing é assumido (fail-closed na interface também).
    isLoading: swr.isLoading || (!swr.data && !swr.error),
    hasMarketing: available.includes("marketing"),
  };
}

function readRemembered(): SolutionKey | undefined {
  try {
    const value = window.sessionStorage.getItem(REMEMBERED_SOLUTION_KEY);
    return value === "conversations" || value === "meetings" || value === "marketing" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Solução ativa (a da navegação exibida) a partir da rota atual. Em telas do Core vale a última
 * solução visitada nesta aba. */
export function useActiveSolution(pathname: string, workspaceBase: string): { owner: RouteOwner; active: SolutionKey; available: SolutionKey[]; solutions: SolutionSummary[]; isLoading: boolean } {
  const { solutions, available, isLoading } = useSolutions();
  const owner = routeOwner(pathname, workspaceBase);
  const [remembered, setRemembered] = useState<SolutionKey | undefined>(undefined);

  useEffect(() => {
    setRemembered(readRemembered());
  }, []);

  useEffect(() => {
    if (owner === "core") return;
    setRemembered(owner);
    try {
      window.sessionStorage.setItem(REMEMBERED_SOLUTION_KEY, owner);
    } catch {
      // Sem sessionStorage (janela privada/bloqueio): a navegação continua funcionando.
    }
  }, [owner]);

  return { owner, active: resolveActiveSolution({ owner, available, remembered }), available, solutions, isLoading };
}
