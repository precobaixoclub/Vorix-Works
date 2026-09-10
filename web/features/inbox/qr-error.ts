import { ApiError } from "@/lib/api-error";

/** Fase 10 (Pre-Pilot Hardening) — nunca expõe a mensagem crua do backend/WuzAPI ao usuário do
 * onboarding; traduz os poucos casos conhecidos e cai num texto genérico e honesto pros demais.
 * Extraído como função pura (sem dependência de React/Next) especificamente para ser testável de
 * forma direta, mesmo racional de `shouldDeliverInboxNotification`/`isPrincipalAuthorizedForRequest`
 * no backend. */
export function humanizeQrError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 409) return "A conexão ainda está iniciando no gateway. Aguarde alguns segundos e tente de novo.";
    if (err.statusCode === 503 || err.statusCode === 0) return "O serviço de WhatsApp está indisponível no momento.";
  }
  return "Não foi possível gerar o QR Code.";
}
