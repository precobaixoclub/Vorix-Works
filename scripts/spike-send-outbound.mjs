// Script de uso EXCLUSIVO do spike (docs/conversas-fase2-spike.md). Envia uma mensagem outbound
// pelo MESMO caminho de código de produção (sendInboxMessage -> persiste queued -> publica em
// inbox.outgoing.queue) — o worker (rodando com FakeMessagingProvider ou WuzApiMessagingProvider,
// dependendo de como foi iniciado) drena depois.
//
// Uso: DATABASE_URL=... INBOX_RABBITMQ_URL=... node scripts/spike-send-outbound.mjs <conversationId> <tenantId> <workspaceId> [body]
import { buildPlatformRepositories } from "../dist/infrastructure/storage/build-platform-repositories.js";
import { RabbitMqOutboundMessageQueue } from "../dist/infrastructure/messaging/rabbitmq/rabbitmq-outbound-message-queue.js";
import { sendInboxMessage } from "../dist/application/inbox/inbox-use-cases.js";

const [, , conversationId, tenantId, workspaceId, body] = process.argv;
const databaseUrl = process.env.DATABASE_URL;
const rabbitMqUrl = process.env.INBOX_RABBITMQ_URL;
if (!databaseUrl || !rabbitMqUrl || !conversationId || !tenantId || !workspaceId) {
  throw new Error("Uso: DATABASE_URL=... INBOX_RABBITMQ_URL=... node scripts/spike-send-outbound.mjs <conversationId> <tenantId> <workspaceId> [body]");
}

const repositories = buildPlatformRepositories({ driver: "postgres", databaseUrl });
const outboundQueue = new RabbitMqOutboundMessageQueue(rabbitMqUrl);
const deps = {
  connectionRepository: repositories.messagingConnectionRepository,
  contactRepository: repositories.inboxContactRepository,
  conversationRepository: repositories.inboxConversationRepository,
  messageRepository: repositories.inboxMessageRepository,
  workspaceRepository: repositories.workspaceRepository,
  outboundQueue,
  provider: undefined, // sendInboxMessage não usa provider diretamente, só quem drena a fila usa
};

const message = await sendInboxMessage(deps, { tenantId, workspaceId, conversationId, body: body ?? "Mensagem outbound sintética (spike Fase 2)" });
console.log("mensagem enfileirada:", JSON.stringify(message, null, 2));

await repositories.pool.end();
process.exit(0);
