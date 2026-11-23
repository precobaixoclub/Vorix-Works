import type { SWRConfiguration } from "swr";
import { ApiError } from "@/lib/api-error";

/** Máximo de novas tentativas automáticas depois de um erro. */
export const MAX_SWR_RETRIES = 3;

/**
 * Política de retentativa do app inteiro (Fase 14; começou em Reuniões na Fase 9). Sem ela, o SWR
 * repete PARA SEMPRE depois de um erro (com intervalo crescente), inclusive em 403/404: abrir um
 * registro excluído, de outro workspace ou sem permissão ficava consultando a API sem fim. Erros de
 * cliente (4xx, exceto 408/429) não mudam sozinhos — não repetem; rede, servidor e 429 repetem no
 * máximo 3 vezes, com intervalo crescente. "Tentar de novo" continua nas telas.
 */
export function shouldRetryRequest(error: unknown, retryCount: number): boolean {
  if (retryCount >= MAX_SWR_RETRIES) return false;
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429) return false;
  return true;
}

export const APP_SWR_RETRY: Pick<SWRConfiguration, "onErrorRetry"> = {
  onErrorRetry: (error, _key, config, revalidate, { retryCount }) => {
    if (!shouldRetryRequest(error, retryCount)) return;
    setTimeout(() => void revalidate({ retryCount }), (config.errorRetryInterval ?? 5000) * 2 ** retryCount);
  },
};
