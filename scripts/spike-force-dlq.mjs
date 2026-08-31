// Script de uso EXCLUSIVO do spike. Publica um payload de outbound diretamente na fila principal
// com header x-attempt já no limite da escada (>= RETRY_TIERS_MS.length) — força o worker a rotear
// pra DLQ na primeira falha, sem esperar os ~380s naturais da escada completa (5s+15s+60s+300s).
// Uso: RABBITMQ_URL=... node scripts/spike-force-dlq.mjs <messageId> <tenantId> <workspaceId> <connectionId>
import amqplib from "amqplib";

const [, , messageId, tenantId, workspaceId, connectionId] = process.argv;
const rabbitMqUrl = process.env.RABBITMQ_URL;
if (!rabbitMqUrl || !messageId) throw new Error("Uso: RABBITMQ_URL=... node scripts/spike-force-dlq.mjs <messageId> <tenantId> <workspaceId> <connectionId>");

const connection = await amqplib.connect(rabbitMqUrl);
const channel = await connection.createChannel();
channel.sendToQueue("inbox.outgoing.queue", Buffer.from(JSON.stringify({ messageId, tenantId, workspaceId, connectionId })), {
  persistent: true,
  headers: { "x-attempt": 4 },
});
console.log("publicado com x-attempt=4 (deve ir direto pra DLQ na primeira falha)");
await channel.close();
await connection.close();
