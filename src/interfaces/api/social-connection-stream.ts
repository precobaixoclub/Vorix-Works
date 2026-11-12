import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { AuthPort } from "../../application/ports/auth.port.js";
import type { WorkspaceRepositoryPort } from "../../application/ports/workspace-repository.port.js";
import type { AccessResolver } from "../../application/identity/access-resolver.js";
import { hasPermission, type AuthPrincipal } from "../../domain/identity/identity.model.js";
import { SOCIAL_NETWORKS, type SocialNetwork } from "../../domain/social/social-publishing.model.js";
import { interactionSchema } from "../../infrastructure/social/gateway/protocol.js";
import { canAccessWorkspace } from "./http/workspace-tenant-guard.js";

export const SOCIAL_CONNECTION_STREAM_PATH = "/v1/social/connections/interactive/stream";

export type SocialConnectionStreamDeps = {
  authPort: AuthPort;
  accessResolver?: Pick<AccessResolver, "resolve">;
  workspaceRepository: Pick<WorkspaceRepositoryPort, "getById">;
  /** Marketing contratado e a rede ligada ao provedor por navegador para este tenant. */
  canConnect: (tenantId: string, network: SocialNetwork) => Promise<boolean>;
  gatewayUrl?: string;
  gatewayToken?: string;
  /** Fábrica do socket para o gateway (substituível em teste). */
  connectGateway?: (url: string, headers: Record<string, string>) => WebSocket;
};

const FLOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Entrada humana: mais que isso por segundo é robô ou travamento — o excesso é descartado. */
const MAX_INPUTS_PER_SECOND = 40;

/**
 * Relay da tela de login das redes sociais (Marketing): cliente ⇄ API ⇄ gateway privado.
 *
 * Mesmas regras da rota HTTP `/social/connections/interactive/:flowId/:operation`: token de sessão
 * comum (nunca um token de escopo restrito), perfil e permissões ATUAIS, empresa, espaço permitido
 * para a pessoa e ativo, Marketing contratado e rede ligada ao provedor por navegador. O token vai
 * na 1ª mensagem (nunca na URL). O gateway confere de novo que o fluxo é deste usuário. A API só
 * repassa: quadros descem, entrada validada sobe; nada é lido além do formato nem registrado.
 */
export function attachSocialConnectionStreamProxy(server: Server, deps: SocialConnectionStreamDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(request.url ?? "/", "http://api").pathname !== SOCIAL_CONNECTION_STREAM_PATH) return;
    wss.handleUpgrade(request, socket, head, (client) => handleViewer(client, deps));
  });
  return wss;
}

function handleViewer(client: WebSocket, deps: SocialConnectionStreamDeps): void {
  let upstream: WebSocket | undefined;
  let closed = false;
  let authenticating = false;
  let windowStart = Date.now();
  let windowCount = 0;
  const close = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    clearTimeout(authTimer);
    clearTimeout(lifetimeTimer);
    upstream?.close();
    if (client.readyState === client.OPEN || client.readyState === client.CONNECTING) client.close(code, reason);
  };
  const authTimer = setTimeout(() => close(4401, "auth timeout"), 10_000);
  // O fluxo do gateway expira em 10 minutos; o canal nunca vive além disso com folga.
  const lifetimeTimer = setTimeout(() => close(4408, "session expired"), 12 * 60_000);

  const authenticate = async (data: RawData) => {
    clearTimeout(authTimer);
    let message: { t?: unknown; accessToken?: unknown; workspaceId?: unknown; network?: unknown; flowId?: unknown };
    try { message = JSON.parse(data.toString()); } catch { return close(4401, "unauthorized"); }
    const { accessToken, workspaceId, network, flowId } = message;
    if (message.t !== "auth" || typeof accessToken !== "string" || accessToken.length > 3500 || typeof workspaceId !== "string" || workspaceId.length === 0 || workspaceId.length > 200
      || typeof flowId !== "string" || !FLOW_ID.test(flowId) || typeof network !== "string" || !(SOCIAL_NETWORKS as readonly string[]).includes(network)) {
      return close(4401, "unauthorized");
    }
    const principal = await authorize(deps, accessToken, workspaceId, network as SocialNetwork);
    if (!principal) return close(4401, "unauthorized");
    if (closed) return;
    if (!deps.gatewayUrl || !deps.gatewayToken) return close(1011, "gateway unavailable");

    const url = `${deps.gatewayUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/stream`;
    const headers = { authorization: `Bearer ${deps.gatewayToken}` };
    upstream = deps.connectGateway ? deps.connectGateway(url, headers) : new WebSocket(url, { headers, maxPayload: 4 * 1024 * 1024 });
    const link = upstream;
    link.on("open", () => link.send(JSON.stringify({ tenantId: principal.tenantId, workspaceId, network, userId: principal.userId, flowId })));
    link.on("message", (payload, isBinary) => {
      if (client.readyState !== client.OPEN) return;
      // Cliente lento: pula quadros em vez de acumular memória (o próximo quadro substitui).
      if (isBinary && client.bufferedAmount > 2 * 1024 * 1024) return;
      client.send(payload, { binary: isBinary });
    });
    link.on("close", (code) => close(code === 4404 ? 4404 : 1000, "session ended"));
    link.on("error", () => close(1011, "gateway error"));
  };

  client.on("message", (data, isBinary) => {
    if (isBinary || closed) return;
    // A 1ª mensagem é a autenticação: consumida aqui, NUNCA repassada ao gateway.
    if (!authenticating) {
      authenticating = true;
      void authenticate(data).catch(() => close(4401, "unauthorized"));
      return;
    }
    if (!upstream || upstream.readyState !== upstream.OPEN) return;
    const now = Date.now();
    if (now - windowStart >= 1_000) { windowStart = now; windowCount = 0; }
    if (++windowCount > MAX_INPUTS_PER_SECOND) return;
    let message: { t?: unknown; action?: unknown };
    try { message = JSON.parse(data.toString()); } catch { return; }
    const action = interactionSchema.safeParse(message.action);
    if (message.t !== "input" || !action.success) return;
    upstream.send(JSON.stringify({ t: "input", action: action.data }));
  });
  client.on("close", () => close());
  client.on("error", () => close());
}

async function authorize(deps: SocialConnectionStreamDeps, accessToken: string, workspaceId: string, network: SocialNetwork): Promise<AuthPrincipal | undefined> {
  const verified = await deps.authPort.verifyToken(accessToken);
  if (!verified.authenticated) return undefined;
  // Tokens de escopo restrito (mídia/avatar/stream da Inbox) só valem nas próprias rotas.
  if (verified.principal.purpose) return undefined;
  const principal = deps.accessResolver ? await deps.accessResolver.resolve(verified.principal) : verified.principal;
  if (!principal || !hasPermission(principal, "marketing:social_connect")) return undefined;
  const workspace = await deps.workspaceRepository.getById(workspaceId);
  if (!workspace || workspace.tenantId !== principal.tenantId || workspace.status !== "active" || !canAccessWorkspace(principal, workspaceId)) return undefined;
  if (!await deps.canConnect(principal.tenantId, network).catch(() => false)) return undefined;
  return principal;
}
