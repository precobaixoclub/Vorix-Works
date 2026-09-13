import type { BrowserContext, Page, Route } from "@playwright/test";
import { TINY_JPEG_BASE64, TINY_PDF, buildTinyWav } from "./media-fixtures";

/**
 * Mocka a API inteira para os testes de layout/mídia de Conversas — necessário porque
 * `AUTH_MODE=noop` (o único modo que roda sem Postgres/JWT configurados) não tem fluxo de login
 * real (`identity` só existe com `AUTH_MODE=jwt`, ver `container.ts`); a única forma de exercitar
 * o App Shell + Inbox reais num Chromium real sem provisionar Postgres é mockar a rede e deixar o
 * Next.js/React renderar de verdade por cima disso. `proxy.ts` (middleware de borda) só checa a
 * PRESENÇA do cookie `zuno_refresh_token`, nunca o valida — por isso `loginCookie()` basta.
 */

export const WORKSPACE_ID = "ws-qa-conversas";
export const TENANT_ID = "tenant-qa";

const CONVERSATIONS = [
  {
    id: "conv-media",
    connectionId: "conn-1",
    contactId: "contact-1",
    status: "open",
    assignedUserId: undefined,
    lastMessageAt: new Date().toISOString(),
    unreadCount: 2,
    aiEnabled: true,
    automationEnabled: false,
    contactName: "Carla Mendes",
    contactPhone: "+5511999990001",
    lastMessagePreview: { type: "document", direction: "inbound" },
  },
  {
    id: "conv-text",
    connectionId: "conn-1",
    contactId: "contact-2",
    status: "pending",
    assignedUserId: "user-qa",
    lastMessageAt: new Date(Date.now() - 3_600_000).toISOString(),
    unreadCount: 0,
    aiEnabled: false,
    automationEnabled: false,
    contactName: "Rodrigo Alves",
    contactPhone: "+5511999990002",
    lastMessagePreview: { type: "text", direction: "outbound", body: "Perfeito, vou verificar e já te retorno!" },
  },
  {
    id: "conv-resolved",
    connectionId: "conn-1",
    contactId: "contact-3",
    status: "resolved",
    assignedUserId: "user-qa",
    lastMessageAt: new Date(Date.now() - 86_400_000).toISOString(),
    unreadCount: 0,
    aiEnabled: false,
    automationEnabled: false,
    contactName: "Fernanda Souza",
    contactPhone: "+5511999990003",
    lastMessagePreview: { type: "text", direction: "inbound", body: "Muito obrigada pelo atendimento!" },
  },
];

function messagesFor(conversationId: string) {
  if (conversationId !== "conv-media") {
    return [
      { id: "m1", conversationId, direction: "inbound", type: "text", status: "read", body: "Oi! Queria saber sobre o pedido 4821.", sentByAi: false, sentByAutomation: false, createdAt: new Date(Date.now() - 7_200_000).toISOString() },
      { id: "m2", conversationId, direction: "outbound", type: "text", status: "delivered", body: "Perfeito, vou verificar e já te retorno!", sentByAi: false, sentByAutomation: false, createdAt: new Date(Date.now() - 3_600_000).toISOString() },
    ];
  }
  const now = Date.now();
  return [
    { id: "img-1", conversationId, direction: "inbound", type: "image", status: "read", mediaStorageRef: { provider: "inbox-media", objectKey: "fixture/image" }, mimeType: "image/jpeg", body: "Segue a foto da embalagem", sentByAi: false, sentByAutomation: false, createdAt: new Date(now - 6 * 60_000).toISOString() },
    { id: "audio-1", conversationId, direction: "inbound", type: "audio", status: "read", mediaStorageRef: { provider: "inbox-media", objectKey: "fixture/audio" }, mimeType: "audio/wav", metadata: { durationSeconds: 2 }, sentByAi: false, sentByAutomation: false, createdAt: new Date(now - 5 * 60_000).toISOString() },
    { id: "video-1", conversationId, direction: "inbound", type: "video", status: "read", mediaStorageRef: { provider: "inbox-media", objectKey: "fixture/video" }, mimeType: "video/mp4", sentByAi: false, sentByAutomation: false, createdAt: new Date(now - 4 * 60_000).toISOString() },
    { id: "doc-1", conversationId, direction: "inbound", type: "document", status: "read", mediaStorageRef: { provider: "inbox-media", objectKey: "fixture/document" }, mimeType: "application/pdf", metadata: { fileName: "contrato.pdf", fileSizeBytes: TINY_PDF.byteLength }, sentByAi: false, sentByAutomation: false, createdAt: new Date(now - 3 * 60_000).toISOString() },
    { id: "text-1", conversationId, direction: "outbound", type: "text", status: "read", body: "Recebido, obrigado!", sentByAi: false, sentByAutomation: false, createdAt: new Date(now - 2 * 60_000).toISOString() },
    { id: "failed-1", conversationId, direction: "outbound", type: "text", status: "failed", body: "Vou te enviar o boleto atualizado", sentByAi: false, sentByAutomation: false, createdAt: new Date(now - 60_000).toISOString() },
  ];
}

function json(data: unknown) {
  return { ok: true, data };
}

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json(data)) });
}

export async function loginCookie(context: BrowserContext) {
  await context.addCookies([{ name: "zuno_refresh_token", value: "qa-fixture-token", url: "http://localhost:3001" }]);
}

export async function mockConversasBackend(page: Page) {
  const wavBuffer = buildTinyWav(2);

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/v1/auth/refresh" && method === "POST") {
      return fulfillJson(route, { accessToken: "qa-fixture-access-token", expiresIn: 900, tenantId: TENANT_ID, role: "owner" });
    }
    if (path === "/v1/auth/me") {
      return fulfillJson(route, { user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner" });
    }
    if (path === `/v1/workspaces/${WORKSPACE_ID}`) {
      return fulfillJson(route, {
        id: WORKSPACE_ID, tenantId: TENANT_ID, name: "Workspace QA", status: "active",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        campaignIds: [], integrations: [], members: [], settings: {},
      });
    }
    if (path === "/v1/inbox/status") return fulfillJson(route, { enabled: true });
    if (path === "/v1/inbox/conversations") return fulfillJson(route, { conversations: CONVERSATIONS });
    if (path === "/v1/inbox/members") return fulfillJson(route, { members: [{ userId: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", role: "owner" }] });
    if (path === "/v1/inbox/connections") return fulfillJson(route, { connections: [] });
    if (/\/v1\/inbox\/conversations\/[^/]+\/messages$/.test(path)) {
      const conversationId = path.split("/")[4];
      return fulfillJson(route, { messages: messagesFor(conversationId) });
    }
    if (/\/v1\/inbox\/conversations\/[^/]+\/events$/.test(path)) return fulfillJson(route, { events: [] });
    if (path === "/v1/inbox/media-token" && method === "POST") {
      const body = request.postDataJSON() as { messageId: string };
      return fulfillJson(route, { mediaToken: `qa-media-token:${body.messageId}`, expiresIn: 60 });
    }
    if (/\/v1\/inbox\/media\//.test(path)) {
      const messageId = path.split("/").pop();
      if (messageId === "img-1") return route.fulfill({ status: 200, contentType: "image/jpeg", body: Buffer.from(TINY_JPEG_BASE64, "base64") });
      if (messageId === "audio-1") return route.fulfill({ status: 200, contentType: "audio/wav", body: wavBuffer });
      if (messageId === "doc-1") return route.fulfill({ status: 200, contentType: "application/pdf", body: TINY_PDF });
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "INBOX_MEDIA_NOT_FOUND", message: "not found", recoverable: true } }) });
    }
    if (path === "/v1/workspaces/credits") return fulfillJson(route, null);
    if (path === "/v1/billing/overview") return fulfillJson(route, null);

    // Fallback genérico — cobre endpoints periféricos do App Shell (WorkspaceSwitcher via
    // `/v1/workspaces`, NotificationBell via `/v1/execution-runs`, memberships etc., todos bare
    // array) que não são o alvo deste teste: `[]` é o formato mais comum entre eles; POST
    // desconhecido responde um objeto vazio (ação genérica, não uma listagem).
    return fulfillJson(route, method === "GET" ? [] : {});
  });
}
