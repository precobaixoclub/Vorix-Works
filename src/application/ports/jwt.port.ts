import type { TenantRole } from "../../domain/identity/identity.model.js";

/** Payload assinado do access token — os mesmos campos de `AuthPrincipal`, sem `iat`/`exp`
 * (controlados pela biblioteca JWT por trás do adapter, nunca por este contrato). */
export type JwtAccessTokenPayload = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  sessionId: string;
  /** Sprint 25 — opcional no verify (tokens antigos não têm). Sempre `false` como default
   * quando ausente; para virar `true`, o usuário precisa fazer novo login/refresh. */
  isPlatformAdmin?: boolean;
};

export type JwtVerificationResult =
  | { valid: true; payload: JwtAccessTokenPayload }
  | { valid: false; reason: "expired" | "invalid" };

export type JwtPort = {
  sign(payload: JwtAccessTokenPayload, expiresInSeconds: number): string;
  /** Diferencia "expirado" dos demais motivos de falha (assinatura inválida, malformado) — usado
   * pelo `JwtAuthAdapter` para devolver `reason: "expired_token"` vs. `"invalid_token"` corretamente. */
  verify(token: string): JwtVerificationResult;
};
