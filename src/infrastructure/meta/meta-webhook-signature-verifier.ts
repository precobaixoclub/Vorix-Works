import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificação de assinatura de webhook da Meta — módulo Instagram DM Automation, Fase 5.
 *
 * DELIBERADAMENTE um verificador novo, nunca uma extensão de `webhook-signature-verifier.ts`
 * (`src/application/webhook/`): aquele verificador assina `${timestamp}.${nonce}.${rawPayload}`
 * com três headers próprios (`x-zuno-signature`/`x-zuno-timestamp`/`x-zuno-nonce`) — um esquema
 * criado pro Zuno assinar os PRÓPRIOS webhooks sandbox, incompatível por design com o esquema fixo
 * da Meta: um único header `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 só sobre os bytes CRUS
 * do corpo (sem timestamp nem nonce — a Meta não assina replay-protection, só integridade), com o
 * App Secret como chave.
 *
 * Exige o Buffer bruto do corpo (`request.rawBody`, ver `instagram-dm-webhook.route.ts`) — nunca
 * `JSON.stringify(JSON.parse(body))`, que pode reordenar chaves/mudar espaçamento e invalidar um
 * HMAC calculado sobre os bytes originais.
 */
export function verifyMetaWebhookSignature(input: { appSecret: string; rawBody: Buffer; signatureHeader: string | string[] | undefined }): boolean {
  const header = Array.isArray(input.signatureHeader) ? input.signatureHeader[0] : input.signatureHeader;
  if (!header) return false;
  const [algo, hex] = header.split("=");
  if (algo !== "sha256" || !hex) return false;

  const expectedHex = createHmac("sha256", input.appSecret).update(input.rawBody).digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(hex, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
