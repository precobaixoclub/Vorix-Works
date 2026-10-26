import { z } from "zod";
import type { SocialNetwork } from "../../../domain/social/social-publishing.model.js";

export const scopeSchema = z.object({ tenantId: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200), network: z.enum(["instagram", "facebook", "tiktok"]) }).strict();
export type GatewayScope = z.infer<typeof scopeSchema>;
export type GatewayUserScope = GatewayScope & { userId: string };
export const interactionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), x: z.number().min(0).max(1279), y: z.number().min(0).max(799) }).strict(),
  z.object({ kind: z.literal("drag"), x: z.number().min(0).max(1279), y: z.number().min(0).max(799), toX: z.number().min(0).max(1279), toY: z.number().min(0).max(799) }).strict(),
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["Enter", "Tab", "Shift+Tab", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape", "Control+A", "Meta+A", "Space"]) }).strict(),
  z.object({ kind: z.literal("scroll"), delta: z.number().int().min(-1600).max(1600) }).strict(),
]);
export type GatewayInteraction = z.infer<typeof interactionSchema>;
export type GatewayFrame = { image: string; width: 1280; height: 800; status: "CONNECTING" | "CHECKPOINT_REQUIRED"; expiresAt: string };
export type GatewayCredential = { credentialReferenceId: string; network: SocialNetwork; externalAccountId: string; username?: string; displayName?: string; status: "active" | "revoked" | "expired" };
export class GatewayError extends Error {
  constructor(public readonly code: "AUTH_REQUIRED" | "SESSION_INVALID" | "CHECKPOINT_REQUIRED" | "UNSUPPORTED" | "MUSIC_UNAVAILABLE" | "RATE_LIMITED" | "NETWORK_ERROR" | "TEMPORARY_PLATFORM_ERROR" | "NOT_FOUND" | "BUSY") { super(code); }
}
export interface GatewayTransport {
  isConfigured(): boolean;
  call<T>(operation: string, input: Record<string, unknown>): Promise<T>;
}
