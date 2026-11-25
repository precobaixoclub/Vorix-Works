import { createHash } from "node:crypto";

/**
 * Trava de publicação do piloto automático — aplicada no backend, na ÚLTIMA etapa antes de criar a
 * publicação agendada (não só na interface). Uma arte só segue para o agendador se:
 * - cada imagem enviada tem um veredito do Quality Gate;
 * - todos os vereditos são `approved: true` (inconclusivo/ausente = reprovado);
 * - o SHA-256 da imagem enviada é exatamente o da imagem que o Quality Gate aprovou (nenhuma imagem de
 *   tentativa reprovada ou alterada depois da aprovação passa).
 */

export type ScreenApproval = { screen: number; approved: boolean; imageSha256?: string; failures?: Array<{ code: string; message?: string }> };

export type GuardResult = { ok: true } | { ok: false; reason: string };

export const sha256Hex = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

export function verifyApprovedArt(images: readonly Buffer[], approvals: readonly ScreenApproval[] | undefined): GuardResult {
  if (!approvals?.length) return { ok: false, reason: "Sem veredito do Quality Gate para a arte — publicação bloqueada." };
  if (approvals.length !== images.length) return { ok: false, reason: `Vereditos (${approvals.length}) não correspondem às imagens enviadas (${images.length}) — publicação bloqueada.` };
  for (const [index, image] of images.entries()) {
    const approval = approvals[index];
    if (approval?.approved !== true) {
      const why = approval?.failures?.map((failure) => failure.code).join(", ");
      return { ok: false, reason: `Tela ${index + 1} não aprovada pelo Quality Gate${why ? ` (${why})` : ""} — publicação bloqueada.` };
    }
    if (!approval.imageSha256 || approval.imageSha256 !== sha256Hex(image)) {
      return { ok: false, reason: `A imagem da tela ${index + 1} não é a que o Quality Gate aprovou — publicação bloqueada.` };
    }
  }
  return { ok: true };
}
