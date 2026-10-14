import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { AuthPort } from "../../application/ports/auth.port.js";
import { hasPermission } from "../../domain/identity/identity.model.js";
import type { MeetingRepositoryPort, RecorderProvisioningSession } from "../../application/ports/meeting-repository.port.js";
import { hashViewerToken, signWorkerLinkToken } from "../../infrastructure/meetings/provisioning-link-auth.js";
import { PROVISIONING_LINK_HEADER } from "../../infrastructure/meetings/recorder-provisioning-host.js";

export const PROVISIONING_STREAM_PATH = "/v1/meetings/recorder-provisioning/stream";

export type ProvisioningStreamDeps = {
  repository: Pick<MeetingRepositoryPort, "findProvisioningSessionByViewerHash" | "getProvisioningSession" | "consumeProvisioningViewer">;
  authPort: AuthPort;
  canUseMeetings: (tenantId: string) => Promise<boolean>;
  masterSecret: string;
  now: () => Date;
  /** Quanto esperar um worker do recorder assumir a sessão. */
  workerWaitMs?: number;
  /** Fábrica do socket para o worker (substituível em teste). */
  connectWorker?: (url: string, headers: Record<string, string>) => WebSocket;
};

const OPEN_STATES: readonly RecorderProvisioningSession["status"][] = ["pending", "starting", "live"];

/**
 * Relay do navegador temporário de login: cliente ⇄ API ⇄ worker do recorder.
 *
 * O cliente autentica com o token de visualização (primeira mensagem — nunca na URL, para não
 * aparecer em log de acesso). A API não interpreta nem registra o que passa: frames de tela descem,
 * cliques/teclas sobem. Nada é persistido.
 */
export function attachProvisioningStreamProxy(server: Server, deps: ProvisioningStreamDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", "http://api").pathname;
    if (pathname !== PROVISIONING_STREAM_PATH) return;
    wss.handleUpgrade(request, socket, head, (client) => handleViewer(client, deps));
  });
  return wss;
}

function handleViewer(client: WebSocket, deps: ProvisioningStreamDeps): void {
  let upstream: WebSocket | undefined;
  let closed = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const status = (payload: Record<string, unknown>) => {
    if (client.readyState === client.OPEN) client.send(JSON.stringify({ t: "status", ...payload }));
  };
  const close = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    clearTimeout(authTimer);
    clearTimeout(expiryTimer);
    pending.length = 0;
    upstream?.close();
    if (client.readyState === client.OPEN || client.readyState === client.CONNECTING) client.close(code, reason);
  };
  const authTimer = setTimeout(() => close(4401, "auth timeout"), 10_000);
  const pending: RawData[] = [];

  let authenticating = false;
  const authenticate = async (data: RawData) => {
    clearTimeout(authTimer);
    let token: string | undefined;
    let accessToken: string | undefined;
    try {
      const message = JSON.parse(data.toString()) as { t?: string; token?: string; accessToken?: string };
      if (message.t === "auth" && typeof message.token === "string" && message.token.length <= 200) token = message.token;
      if (typeof message.accessToken === "string" && message.accessToken.length <= 3500) accessToken = message.accessToken;
    } catch {
      token = undefined;
    }
    if (!token || !accessToken) return close(4401, "unauthorized");
    const authentication = await deps.authPort.verifyToken(accessToken);
    if (!authentication.authenticated || !hasPermission(authentication.principal.role, "meeting:manage_recorder_accounts")) return close(4401, "unauthorized");
    const principal = authentication.principal;
    let session = await deps.repository.findProvisioningSessionByViewerHash(hashViewerToken(token)).catch(() => undefined);
    if (!session || !OPEN_STATES.includes(session.status) || Date.parse(session.expiresAt) <= deps.now().getTime()) return close(4401, "unauthorized");
    if (session.tenantId !== principal.tenantId || session.createdByUserId !== principal.userId || !await deps.canUseMeetings(principal.tenantId)) return close(4401, "unauthorized");
    if (!await deps.repository.consumeProvisioningViewer({ sessionId: session.id, viewerTokenHash: hashViewerToken(token), tenantId: principal.tenantId, userId: principal.userId, now: deps.now() })) return close(4401, "unauthorized");
    expiryTimer = setTimeout(() => close(4401, "session expired"), Math.max(1, Date.parse(session.expiresAt) - deps.now().getTime()));

    // Aguarda um worker do recorder assumir a sessão (fila em Postgres).
    const deadline = Date.now() + (deps.workerWaitMs ?? 30_000);
    while (session && !session.workerEndpoint && OPEN_STATES.includes(session.status) && Date.now() < deadline && !closed) {
      status({ s: "waiting_worker" });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      session = await deps.repository.getProvisioningSession({ sessionId: session.id }).catch(() => undefined);
    }
    if (closed) return;
    if (!session?.workerEndpoint || !OPEN_STATES.includes(session.status)) {
      status({ s: "failed", code: "RECORDER_UNAVAILABLE", m: "O serviço de gravação não está disponível agora. Tente novamente em instantes." });
      return close(1011, "worker unavailable");
    }

    const url = `${session.workerEndpoint.replace(/\/+$/, "")}/provisioning/${encodeURIComponent(session.id)}`;
    const headers = { [PROVISIONING_LINK_HEADER]: signWorkerLinkToken(deps.masterSecret, session.id, deps.now()) };
    upstream = deps.connectWorker ? deps.connectWorker(url, headers) : new WebSocket(url, { headers, maxPayload: 8 * 1024 * 1024 });
    const link = upstream;
    link.on("open", () => {
      for (const queued of pending.splice(0)) link.send(queued, { binary: false });
    });
    link.on("message", (payload, isBinary) => {
      if (client.readyState !== client.OPEN) return;
      if (isBinary && client.bufferedAmount > 2 * 1024 * 1024) return;
      client.send(payload, { binary: isBinary });
    });
    link.on("close", () => close(1000, "session ended"));
    link.on("error", () => {
      status({ s: "failed", code: "RECORDER_UNAVAILABLE", m: "A conexão com o serviço de gravação caiu." });
      close(1011, "worker error");
    });
  };

  // Entrada do cliente → worker (sem leitura, sem log).
  client.on("message", (data, isBinary) => {
    if (isBinary || closed) return;
    // A 1ª mensagem é a autenticação: consumida aqui, NUNCA repassada ao worker.
    if (!authenticating) {
      authenticating = true;
      void authenticate(data).catch(() => close(4401, "unauthorized"));
      return;
    }
    if (!upstream || upstream.readyState === upstream.CONNECTING) {
      if (pending.length < 50) pending.push(data);
      return;
    }
    if (upstream.readyState === upstream.OPEN) upstream.send(data, { binary: false });
  });
  client.on("close", () => close());
  client.on("error", () => close());
}
