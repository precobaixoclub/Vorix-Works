// Script de uso EXCLUSIVO do spike (docs/conversas-fase2-spike.md). Busca o QR Code de uma
// conexão já criada via getConnectionQrCode (mesmo caminho de código de produção) e salva como PNG.
import { writeFileSync } from "node:fs";
import { buildPlatformRepositories } from "../dist/infrastructure/storage/build-platform-repositories.js";
import { WuzApiClient } from "../dist/infrastructure/messaging/wuzapi/wuzapi-client.js";
import { WuzApiMessagingProvider } from "../dist/infrastructure/messaging/wuzapi/wuzapi-messaging-provider.js";
import { getConnectionQrCode } from "../dist/application/inbox/inbox-use-cases.js";

const databaseUrl = process.env.DATABASE_URL;
const wuzApiBaseUrl = process.env.INBOX_WUZAPI_BASE_URL;
const wuzApiAdminToken = process.env.INBOX_WUZAPI_ADMIN_TOKEN;
const tenantId = process.env.SPIKE_TENANT_ID;
const workspaceId = process.env.SPIKE_WORKSPACE_ID;
const connectionId = process.env.SPIKE_CONNECTION_ID;
if (!databaseUrl || !wuzApiBaseUrl || !wuzApiAdminToken || !tenantId || !workspaceId || !connectionId) {
  throw new Error("DATABASE_URL, INBOX_WUZAPI_BASE_URL, INBOX_WUZAPI_ADMIN_TOKEN, SPIKE_TENANT_ID, SPIKE_WORKSPACE_ID, SPIKE_CONNECTION_ID são obrigatórios.");
}

const repositories = buildPlatformRepositories({ driver: "postgres", databaseUrl });
const provider = new WuzApiMessagingProvider(new WuzApiClient({ baseUrl: wuzApiBaseUrl, adminToken: wuzApiAdminToken }));
const deps = {
  connectionRepository: repositories.messagingConnectionRepository,
  contactRepository: repositories.inboxContactRepository,
  conversationRepository: repositories.inboxConversationRepository,
  messageRepository: repositories.inboxMessageRepository,
  workspaceRepository: repositories.workspaceRepository,
  outboundQueue: { publish: async () => {} },
  provider,
};

const { qrCode, expiresAt } = await getConnectionQrCode(deps, { tenantId, workspaceId, connectionId });
console.log("expiresAt:", expiresAt);
const base64 = qrCode.replace(/^data:image\/png;base64,/, "");
writeFileSync("/opt/conversas-spike/spike-fixtures/qr.png", Buffer.from(base64, "base64"));
console.log("QR salvo em /opt/conversas-spike/spike-fixtures/qr.png");

await repositories.pool.end();
