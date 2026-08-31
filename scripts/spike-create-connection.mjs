// Script de uso EXCLUSIVO do spike de verificação da Fase 2 (docs/conversas-fase2-spike.md).
// Cria um workspace + uma MessagingConnection reais contra o Postgres descartável do spike,
// chamando o MESMO caminho de código de produção (createConnection -> WuzApiMessagingProvider ->
// WuzApiClient -> WuzAPI real) — valida a integração de verdade, não só a API crua via curl.
//
// Uso: DATABASE_URL=... INBOX_WUZAPI_BASE_URL=... INBOX_WUZAPI_ADMIN_TOKEN=... node scripts/spike-create-connection.mjs
import { buildPlatformRepositories } from "../dist/infrastructure/storage/build-platform-repositories.js";
import { WuzApiClient } from "../dist/infrastructure/messaging/wuzapi/wuzapi-client.js";
import { WuzApiMessagingProvider } from "../dist/infrastructure/messaging/wuzapi/wuzapi-messaging-provider.js";
import { createConnection } from "../dist/application/inbox/inbox-use-cases.js";

const databaseUrl = process.env.DATABASE_URL;
const wuzApiBaseUrl = process.env.INBOX_WUZAPI_BASE_URL;
const wuzApiAdminToken = process.env.INBOX_WUZAPI_ADMIN_TOKEN;
if (!databaseUrl || !wuzApiBaseUrl || !wuzApiAdminToken) {
  throw new Error("DATABASE_URL, INBOX_WUZAPI_BASE_URL e INBOX_WUZAPI_ADMIN_TOKEN são obrigatórios.");
}

const repositories = buildPlatformRepositories({ driver: "postgres", databaseUrl });
const tenantId = "spike-tenant";
const workspace = await repositories.workspaceRepository.create({ tenantId, name: "Spike Workspace" });
console.log("workspace criado:", workspace.id);

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

const connection = await createConnection(deps, { tenantId, workspaceId: workspace.id, displayName: "WhatsApp Teste Spike" });
console.log("connection criada:", JSON.stringify(connection, null, 2));

await repositories.pool.end();
