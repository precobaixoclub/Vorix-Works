import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { SOCIAL_POST_FORMATS } from "../../domain/social/social-publishing.model.js";
import { SocialBrowserPool, parseGatewayProxy } from "../../infrastructure/social/gateway/browser-pool.js";
import { EncryptedGatewayStore } from "../../infrastructure/social/gateway/encrypted-store.js";
import { GatewayError, interactionSchema, scopeSchema } from "../../infrastructure/social/gateway/protocol.js";
import { SocialGatewayService } from "../../infrastructure/social/gateway/service.js";

const user = scopeSchema.extend({ userId: z.string().min(1).max(200) });
const flow = user.extend({ flowId: z.string().uuid() });
const account = scopeSchema.extend({ credentialReferenceId: z.string().regex(/^socgw-[\da-f-]{36}$/), externalAccountId: z.string().min(1).max(200).optional() });
const format = z.enum(SOCIAL_POST_FORMATS);
const music = z.object({ musicId: z.string().min(1).max(200), title: z.string().max(300), artist: z.string().max(300).optional(), coverUrl: z.string().max(2000).optional(), durationSec: z.number().nonnegative().optional(), segmentStartSec: z.number().nonnegative().optional(), segmentDurationSec: z.number().positive().max(90).optional(), providerData: z.record(z.string(), z.string().max(300)).optional() }).strict();
const media = z.object({ url: z.string().url().max(4000), kind: z.enum(["image", "video"]), mimeType: z.string().optional(), width: z.number().optional(), height: z.number().optional(), durationSec: z.number().optional(), sizeBytes: z.number().optional(), hasAudio: z.boolean().optional(), coverUrl: z.string().optional() }).strict();

export function createSocialGatewayServer(service: SocialGatewayService, token: string) {
  if (token.length < 32) throw new Error("SOCIAL_GATEWAY_TOKEN requires at least 32 characters");
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, requestTimeout: 250_000 });
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/healthz") return;
    const supplied = Buffer.from(request.headers.authorization ?? ""); const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(401).send({ code: "UNAUTHORIZED" });
  });
  app.setErrorHandler((error, _request, reply) => {
    const code = error instanceof GatewayError ? error.code : error instanceof z.ZodError ? "INVALID_REQUEST" : "TEMPORARY_PLATFORM_ERROR";
    void reply.code(code === "NOT_FOUND" ? 404 : code === "INVALID_REQUEST" ? 400 : 409).send({ code });
  });
  app.get("/healthz", async () => ({ ok: true, service: "social-provider-gateway", resources: service.resources() }));
  app.post("/rpc/connect", async request => { const body = user.extend({ returnPath: z.string().optional() }).parse(request.body); return service.connect(body); });
  app.post("/rpc/frame", async request => { const body = flow.parse(request.body); return service.frame(body, body.flowId); });
  app.post("/rpc/interact", async request => { const body = flow.extend({ action: interactionSchema }).parse(request.body); return service.interact(body, body.flowId, body.action); });
  app.post("/rpc/finish", async request => { const body = flow.parse(request.body); return service.finish(body, body.flowId); });
  app.post("/rpc/cancel", async request => { const body = flow.parse(request.body); return service.cancel(body, body.flowId); });
  app.post("/rpc/accounts", async request => service.accounts(scopeSchema.parse(request.body)));
  app.post("/rpc/resolve", async request => service.resolve(account.parse(request.body)));
  app.post("/rpc/disconnect", async request => service.disconnect(account.parse(request.body)));
  app.post("/rpc/health", async request => service.health(account.parse(request.body)));
  app.post("/rpc/publish", async request => service.publish(account.extend({ externalAccountId: z.string().min(1).max(200), format, caption: z.string().max(5000), media: z.array(media).max(35), music: music.optional(), idempotencyKey: z.string().min(1).max(300), attemptStartedAt: z.string().max(100) }).parse(request.body)));
  app.post("/rpc/status", async request => service.status(account.extend({ externalPostId: z.string().max(200).optional(), providerReference: z.string().max(300).optional() }).parse(request.body)));
  app.post("/rpc/acknowledge", async request => service.acknowledge(account.extend({ idempotencyKey: z.string().min(1).max(300), outcome: z.enum(["published", "not_published"]), externalUrl: z.string().url().max(2000).optional() }).parse(request.body)));
  app.post("/rpc/music", async request => service.music(account.extend({ query: z.string().max(100), format, limit: z.number().int().min(1).max(20) }).parse(request.body)));
  attachStream(app.server, service, token);
  app.addHook("onClose", () => service.shutdown());
  return app;
}

export const SOCIAL_GATEWAY_STREAM_PATH = "/stream";
const streamInput = z.object({ t: z.literal("input"), action: interactionSchema }).strict();

/**
 * Live login screen for the API relay only (same service token as the RPCs, checked before the
 * upgrade). The first message is the flow scope; the flow must belong to that user. Afterwards
 * JPEG frames go out as binary messages and validated human input comes in. Nothing is logged.
 */
function attachStream(server: Server, service: SocialGatewayService, token: string): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  const expected = Buffer.from(`Bearer ${token}`);
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(request.url ?? "/", "http://gateway").pathname !== SOCIAL_GATEWAY_STREAM_PATH) { socket.destroy(); return; }
    const supplied = Buffer.from(request.headers.authorization ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, client => {
      let session: ReturnType<SocialGatewayService["stream"]> | undefined;
      const scopeTimer = setTimeout(() => client.close(4400, "scope required"), 5_000);
      client.on("message", (data, isBinary) => {
        if (isBinary) return;
        let message: unknown;
        try { message = JSON.parse(data.toString()); } catch { return; }
        if (!session) {
          clearTimeout(scopeTimer);
          const parsed = flow.safeParse(message);
          if (!parsed.success) { client.close(4400, "invalid scope"); return; }
          try {
            session = service.stream(parsed.data, parsed.data.flowId, {
              frame: jpeg => { if (client.readyState === client.OPEN && client.bufferedAmount < 4 * 1024 * 1024) client.send(jpeg, { binary: true }); },
              status: status => { if (client.readyState === client.OPEN) client.send(JSON.stringify({ t: "status", ...status })); if (status.s === "EXPIRED") client.close(4404, "flow expired"); },
            });
          } catch { client.close(4404, "flow not found"); }
          return;
        }
        const input = streamInput.safeParse(message);
        if (input.success) session.input(input.data.action);
      });
      client.on("close", () => { clearTimeout(scopeTimer); session?.close(); });
      client.on("error", () => { clearTimeout(scopeTimer); session?.close(); });
    });
  });
}

async function main(): Promise<void> {
  const store = new EncryptedGatewayStore(process.env.SOCIAL_GATEWAY_DATA_DIR ?? "/data", process.env.SOCIAL_GATEWAY_ENCRYPTION_KEY ?? "");
  const pool = new SocialBrowserPool({ maxContexts: Math.min(4, Math.max(1, Number(process.env.SOCIAL_GATEWAY_MAX_CONTEXTS ?? 2))), executablePath: process.env.SOCIAL_GATEWAY_CHROMIUM_PATH, proxy: parseGatewayProxy(process.env.SOCIAL_GATEWAY_PROXY_URL) });
  const origins = (process.env.SOCIAL_GATEWAY_MEDIA_ORIGINS ?? "https://api.vorixworks.com").split(",").map(value => new URL(value.trim()).origin);
  const app = createSocialGatewayServer(new SocialGatewayService(store, pool, { mediaOrigins: origins }), process.env.SOCIAL_GATEWAY_TOKEN ?? "");
  await pool.checkReadiness();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { void app.close(); });
  await app.listen({ host: "0.0.0.0", port: Number(process.env.SOCIAL_GATEWAY_PORT ?? 3210) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main().catch(() => { process.stderr.write("Social gateway failed to start; verify service configuration.\n"); process.exitCode = 1; });
