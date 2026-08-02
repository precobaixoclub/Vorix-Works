import { ApiError } from "@/lib/api-error";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

/**
 * Release Track 1.0 (Fase 6) — fecha o achado sistêmico da Sprint 24: nenhuma página
 * workspace-scoped distinguia um erro real da API de "lista vazia". `ApiError.statusCode` já
 * carrega tudo que é preciso para diferenciar os três casos que importam para quem usa o produto:
 * sem permissão (401/403), API fora do ar (`NETWORK_ERROR`, statusCode 0) e qualquer outro erro.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const isApiError = error instanceof ApiError;
  const statusCode = isApiError ? error.statusCode : undefined;

  if (statusCode === 401 || statusCode === 403) {
    return (
      <EmptyState
        icon={<span aria-hidden="true">🔒</span>}
        title="Sem permissão"
        description="Você não tem permissão para ver este conteúdo. Se acha que isso é um engano, peça a quem administra este workspace para revisar seu papel."
      />
    );
  }

  if (statusCode === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true">⚠️</span>}
        title="Indisponível no momento"
        description="Não foi possível conectar à API do Vorix. Verifique sua conexão e tente novamente."
        action={onRetry ? <Button variant="secondary" onClick={onRetry}>Tentar de novo</Button> : undefined}
      />
    );
  }

  return (
    <EmptyState
      icon={<span aria-hidden="true">⚠️</span>}
      title="Não foi possível carregar"
      description={isApiError ? error.message : "Ocorreu um erro inesperado. Tente novamente em instantes."}
      action={onRetry ? <Button variant="secondary" onClick={onRetry}>Tentar de novo</Button> : undefined}
    />
  );
}
