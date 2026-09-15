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
  /** Fase 10 (Pre-Pilot Hardening) — ver `AuthPrincipal.purpose`. Ausente em todo access token
   * normal; presente e igual a `"inbox_stream"` só no token de curta duração do SSE da Inbox, ou
   * `"inbox_media"` (redesign operacional) no token de curta duração do proxy de mídia. */
  purpose?: "inbox_stream" | "inbox_media" | "inbox_avatar";
  /** Redesign operacional (mídia real) — só presente com `purpose: "inbox_media"`: escopa o token
   * a UMA mensagem específica, para um token minted para a mídia da mensagem A nunca servir para
   * ler a mídia da mensagem B (mesmo dentro da curtíssima janela de validade). */
  messageId?: string;
  /** Fotos de grupo/contato — só presentes com `purpose: "inbox_avatar"`, mesmo racional de
   * `messageId` acima (escopa a UM contato OU UMA conversa específica). */
  avatarKind?: "contact" | "conversation";
  avatarTargetId?: string;
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
