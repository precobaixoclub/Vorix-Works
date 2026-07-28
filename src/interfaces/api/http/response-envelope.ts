/** Envelope de resposta padrão da API — toda rota (presente ou futura) responde neste formato, nunca um corpo solto. */
export type ApiSuccessEnvelope<T> = {
  ok: true;
  data: T;
  meta?: { requestId: string };
};

export type ApiErrorEnvelope = {
  ok: false;
  error: { code: string; message: string; recoverable: boolean; details?: Record<string, unknown> };
  meta?: { requestId: string };
};

export function successEnvelope<T>(data: T, requestId?: string): ApiSuccessEnvelope<T> {
  return { ok: true, data, ...(requestId ? { meta: { requestId } } : {}) };
}

export function errorEnvelope(
  error: { code: string; message: string; recoverable: boolean; details?: Record<string, unknown> },
  requestId?: string,
): ApiErrorEnvelope {
  return { ok: false, error, ...(requestId ? { meta: { requestId } } : {}) };
}
