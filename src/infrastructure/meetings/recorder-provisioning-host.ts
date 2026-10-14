import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { runProvisioningSession, type ActiveProvisioning, type RecorderProvisioningDeps, type ViewerChannel } from "../../application/meetings/recorder-provisioning.js";
import { verifyWorkerLinkToken } from "./provisioning-link-auth.js";

export const PROVISIONING_LINK_HEADER = "x-vorix-provisioning-link";

export type RecorderProvisioningHostOptions = {
  port: number;
  host: string;
  /** Endereço pelo qual a API alcança este worker (ex.: ws://vorix-recorder-1:7088). */
  publicEndpoint: string;
  masterSecret: string;
  maxConcurrent: number;
};

/**
 * Lado WORKER do login self-service: reivindica sessões pendentes, abre o navegador temporário e
 * expõe a tela/entrada num WebSocket interno — acessível só pela API, com token HMAC por sessão.
 * Roda em paralelo às gravações (laço próprio), sem bloquear nem ser bloqueado por elas.
 */
export class RecorderProvisioningHost {
  private readonly active = new Map<string, ActiveProvisioning>();
  private server: WebSocketServer | undefined;

  constructor(private readonly deps: RecorderProvisioningDeps, private readonly options: RecorderProvisioningHostOptions) {}

  async start(): Promise<void> {
    const server = new WebSocketServer({ port: this.options.port, host: this.options.host, maxPayload: 4 * 1024 });
    this.server = server;
    server.on("connection", (socket, request) => this.onConnection(socket, request));
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
  }

  get activeCount(): number {
    return this.active.size;
  }

  /** Um passo do laço: expira sessões vencidas e assume uma nova, se houver vaga. */
  async tick(): Promise<void> {
    await this.deps.repository.expireProvisioningSessions(this.deps.now());
    if (this.active.size >= this.options.maxConcurrent) return;
    const session = await this.deps.repository.claimProvisioningSession({ workerId: this.deps.workerId, workerEndpoint: this.options.publicEndpoint, now: this.deps.now() });
    if (!session) return;
    this.deps.log?.("provisionamento assumido", { sessionId: session.id, accountId: session.recorderAccountId });
    const run = runProvisioningSession(this.deps, session);
    this.active.set(session.id, run);
    void run.done.finally(() => this.active.delete(session.id)).catch(() => undefined);
  }

  async stop(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map(async (run) => {
      await run.cancel("Worker encerrando.");
      await run.done;
    }));
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    const match = /^\/provisioning\/([A-Za-z0-9_-]{1,100})$/.exec(new URL(request.url ?? "/", "http://worker").pathname);
    const sessionId = match?.[1];
    const header = request.headers[PROVISIONING_LINK_HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    const run = sessionId ? this.active.get(sessionId) : undefined;
    if (!sessionId || !run || !verifyWorkerLinkToken(this.options.masterSecret, sessionId, token, this.deps.now())) {
      socket.close(4401, "unauthorized");
      return;
    }
    const channel: ViewerChannel = {
      sendFrame(frame) {
        // Contrapressão: rede lenta perde frames, nunca acumula memória.
        if (socket.readyState !== socket.OPEN || socket.bufferedAmount > 2 * 1024 * 1024) return;
        const header = Buffer.alloc(4);
        header.writeUInt16BE(Math.min(frame.width, 65_535), 0);
        header.writeUInt16BE(Math.min(frame.height, 65_535), 2);
        socket.send(Buffer.concat([header, frame.jpeg]), { binary: true });
      },
      sendStatus(status) {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ t: "status", ...status }));
      },
    };
    try { run.attachViewer(channel); } catch { socket.close(4409, "viewer already attached"); return; }
    void run.done.then(() => socket.close(1000, "session ended")).catch(() => socket.close(1011, "session failed"));
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if ((parsed as { t?: string }).t === "cancel") {
        void run.cancel("Cancelado pelo cliente.");
        return;
      }
      // Repasse ao navegador; o conteúdo da mensagem nunca é logado.
      run.input(parsed);
    });
    socket.on("close", () => run.detachViewer(channel));
    socket.on("error", () => run.detachViewer(channel));
  }
}
