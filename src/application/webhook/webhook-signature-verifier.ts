import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEventRepositoryPort } from "../ports/webhook-event-repository.port.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";
import type { WebhookSignature } from "../../domain/webhook/webhook.model.js";

export type WebhookVerificationInput = {
  providerId: PublicationProvider;
  rawPayload: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
  secret?: string;
  now?: Date;
};

export type WebhookVerificationDecision =
  | { verified: true; signature: WebhookSignature }
  | { verified: false; status: "invalid_signature" | "timestamp_expired" | "replay_detected" | "provider_unknown" | "payload_invalid"; safeMessage: string; signature: WebhookSignature };

export class WebhookSignatureVerifier {
  constructor(private readonly deps: { repository: WebhookEventRepositoryPort; timestampToleranceMs?: number }) {}

  async verify(input: WebhookVerificationInput): Promise<WebhookVerificationDecision> {
    const digest = sha256(input.rawPayload);
    const signature: WebhookSignature = {
      algorithm: "hmac-sha256",
      headerName: "x-zuno-signature",
      signature: input.signature ?? "",
      timestamp: input.timestamp,
      nonce: input.nonce,
      payloadDigest: digest,
    };
    if (!input.secret) return { verified: false, status: "provider_unknown", safeMessage: "Provider sem webhook secret configurado.", signature };
    if (!input.rawPayload.trim()) return { verified: false, status: "payload_invalid", safeMessage: "Payload vazio.", signature };
    if (!input.timestamp || timestampExpired(input.timestamp, input.now ?? new Date(), this.deps.timestampToleranceMs ?? 5 * 60 * 1000)) {
      return { verified: false, status: "timestamp_expired", safeMessage: "Timestamp do webhook expirado.", signature };
    }
    if (!input.nonce || await this.deps.repository.hasNonce({ providerId: input.providerId, nonce: input.nonce })) {
      return { verified: false, status: "replay_detected", safeMessage: "Nonce de webhook repetido ou ausente.", signature };
    }
    const expected = sign(input.secret, input.timestamp, input.nonce, input.rawPayload);
    if (!safeEqual(input.signature ?? "", expected)) return { verified: false, status: "invalid_signature", safeMessage: "Assinatura HMAC inválida.", signature };
    return { verified: true, signature };
  }
}

export function signWebhookPayload(input: { secret: string; timestamp: string; nonce: string; rawPayload: string }): string {
  return sign(input.secret, input.timestamp, input.nonce, input.rawPayload);
}

function sign(secret: string, timestamp: string, nonce: string, rawPayload: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${rawPayload}`).digest("hex");
}

function sha256(rawPayload: string): string {
  return createHash("sha256").update(rawPayload).digest("hex");
}

function timestampExpired(timestamp: string, now: Date, toleranceMs: number): boolean {
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return true;
  return Math.abs(now.getTime() - parsed) > toleranceMs;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
