import { getApiBaseUrl } from "@/lib/api-error";
import { getAccessToken } from "@/lib/auth-token";
import type { RemoteInputAction } from "./remote-input";
import type { SocialNetwork } from "./types";

export const SOCIAL_CONNECTION_STREAM_PATH = "/v1/social/connections/interactive/stream";

export type ConnectionStreamStatus = "CONNECTING" | "CHECKPOINT_REQUIRED" | "EXPIRED";

/**
 * Tela ao vivo do login da rede (WebSocket): os quadros chegam assim que a página muda e cada
 * tecla/clique sobe na hora, sem uma requisição HTTP por ação. O token vai na 1ª mensagem, nunca na
 * URL. `onUnavailable` avisa quando o canal não abriu (a página volta ao modo por consulta).
 */
export class SocialConnectionStream {
  private socket?: WebSocket;
  private gotFrame = false;
  private stopped = false;

  constructor(private readonly handlers: {
    onFrame: (jpeg: Blob) => void;
    onStatus: (status: ConnectionStreamStatus) => void;
    onUnavailable: () => void;
    onEnded: () => void;
  }) {}

  open(input: { workspaceId: string; network: SocialNetwork; flowId: string }): void {
    let socket: WebSocket;
    try { socket = new WebSocket(`${getApiBaseUrl().replace(/^http/, "ws").replace(/\/+$/, "")}${SOCIAL_CONNECTION_STREAM_PATH}`); }
    catch { this.handlers.onUnavailable(); return; }
    socket.binaryType = "blob";
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ t: "auth", accessToken: getAccessToken(), ...input }));
    socket.onmessage = (event) => {
      if (event.data instanceof Blob) { this.gotFrame = true; this.handlers.onFrame(event.data); return; }
      try {
        const message = JSON.parse(String(event.data)) as { t?: string; s?: string };
        if (message.t === "status" && (message.s === "CONNECTING" || message.s === "CHECKPOINT_REQUIRED" || message.s === "EXPIRED")) this.handlers.onStatus(message.s);
      } catch { /* ignora mensagem malformada */ }
    };
    socket.onclose = (event) => {
      if (this.stopped) return;
      this.socket = undefined;
      if (event.code === 4404) { this.handlers.onStatus("EXPIRED"); return; }
      // Sem nenhum quadro: o canal não funciona aqui (proxy, rede) → modo por consulta.
      if (!this.gotFrame) this.handlers.onUnavailable(); else this.handlers.onEnded();
    };
  }

  /** `false` quando o canal não está aberto (quem chama usa o modo por consulta). */
  send(action: RemoteInputAction): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.gotFrame) return false;
    this.socket.send(JSON.stringify({ t: "input", action }));
    return true;
  }

  close(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = undefined;
  }
}
