/** Extraído de `api-client.ts` para `lib/auth-api.ts` poder usar o mesmo tipo de erro sem criar um import circular (auth-api.ts <-> api-client.ts). */

export type ApiSuccessEnvelope<T> = { ok: true; data: T; meta?: { requestId: string } };
export type ApiErrorEnvelope = {
  ok: false;
  error: { code: string; message: string; recoverable: boolean; details?: Record<string, unknown> };
  meta?: { requestId: string };
};
export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly recoverable: boolean;

  constructor(code: string, message: string, statusCode: number, recoverable: boolean) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.recoverable = recoverable;
  }
}

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:3000";
}
