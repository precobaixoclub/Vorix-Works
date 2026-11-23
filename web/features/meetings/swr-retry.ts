import type { SWRConfiguration } from "swr";
import { ApiError } from "@/lib/api-error";

/** Máximo de novas tentativas automáticas depois de um erro. */
export const MEETINGS_MAX_RETRIES = 3;

/**
 * Fase 9 — sem configuração, o SWR tenta de novo PARA SEMPRE depois de um erro (com intervalo
 * crescente), inclusive em 404/403: abrir uma reunião excluída, de outro workspace ou sem acesso
 * ficava consultando a API indefinidamente. Erros de cliente (4xx, exceto 408/429) não mudam
 * sozinhos — não repetem; falhas de rede/servidor repetem no máximo 3 vezes. "Tentar novamente"
 * continua disponível na tela.
 */
export function shouldRetryMeetingsRequest(error: unknown, retryCount: number): boolean {
  if (retryCount >= MEETINGS_MAX_RETRIES) return false;
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429) return false;
  return true;
}

export const MEETINGS_RETRY: Pick<SWRConfiguration, "onErrorRetry"> = {
  onErrorRetry: (error, _key, config, revalidate, { retryCount }) => {
    if (!shouldRetryMeetingsRequest(error, retryCount)) return;
    setTimeout(() => void revalidate({ retryCount }), (config.errorRetryInterval ?? 5000) * 2 ** retryCount);
  },
};
