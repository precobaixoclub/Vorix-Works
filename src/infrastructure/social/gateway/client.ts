import type { GatewayTransport } from "./protocol.js";
import { GatewayError } from "./protocol.js";

/** Internal service token never leaves the API/worker. No response bodies or exceptions are logged. */
export class SocialGatewayClient implements GatewayTransport {
  constructor(private readonly url: string | undefined, private readonly token: string | undefined, private readonly http: typeof fetch = fetch) {}
  isConfigured(): boolean { return !!this.url && !!this.token && this.token.length >= 32; }
  async call<T>(operation: string, input: Record<string, unknown>): Promise<T> {
    if (!this.isConfigured()) throw new GatewayError("TEMPORARY_PLATFORM_ERROR");
    try {
      const response = await this.http(`${this.url!.replace(/\/$/, "")}/rpc/${encodeURIComponent(operation)}`, { method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(operation === "publish" ? 240_000 : 60_000), redirect: "error" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { code?: string };
        const allowed = ["AUTH_REQUIRED", "SESSION_INVALID", "CHECKPOINT_REQUIRED", "UNSUPPORTED", "MUSIC_UNAVAILABLE", "RATE_LIMITED", "NETWORK_ERROR", "NOT_FOUND", "BUSY"];
        throw new GatewayError(allowed.includes(body.code ?? "") ? body.code as GatewayError["code"] : "TEMPORARY_PLATFORM_ERROR");
      }
      return await response.json() as T;
    } catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError("NETWORK_ERROR"); }
  }
}
