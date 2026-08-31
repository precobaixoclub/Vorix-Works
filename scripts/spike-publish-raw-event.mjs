// Script de uso EXCLUSIVO do spike (docs/conversas-fase2-spike.md). Publica um evento SINTÉTICO
// na fila plana `wuzapi.events.raw`, no MESMO formato confirmado ao vivo/via código-fonte real do
// WuzAPI (type/event/state/userID/instanceName — ver wuzapi-event-mapper.ts) — permite testar todo
// o pipeline RabbitMQ -> vorix-worker -> Postgres sem depender de um WhatsApp pareado de verdade.
//
// Uso: RABBITMQ_URL=... node scripts/spike-publish-raw-event.mjs <tipo> <instanceName> [externalMessageId] [body]
//   tipo: message | receipt-delivered | receipt-read | connected | disconnected | logged-out
import amqplib from "amqplib";

const [, , kind, instanceName, arg3, arg4] = process.argv;
const rabbitMqUrl = process.env.RABBITMQ_URL;
if (!rabbitMqUrl || !kind || !instanceName) {
  throw new Error("Uso: RABBITMQ_URL=... node scripts/spike-publish-raw-event.mjs <tipo> <instanceName> [externalMessageId] [body]");
}

function buildPayload() {
  const now = Math.floor(Date.now() / 1000);
  switch (kind) {
    case "message":
      return {
        type: "Message",
        event: {
          Info: { ID: arg3 ?? `synthetic-${Date.now()}`, Sender: "5511988887777@s.whatsapp.net", PushName: "Contato Sintético", Timestamp: now },
          Message: { conversation: arg4 ?? "Mensagem sintética de teste (spike Fase 2)" },
        },
        userID: "1",
        instanceName,
      };
    case "receipt-delivered":
      return { type: "ReadReceipt", event: { MessageIDs: [arg3] }, state: "Delivered", userID: "1", instanceName };
    case "receipt-read":
      return { type: "ReadReceipt", event: { MessageIDs: [arg3] }, state: "Read", userID: "1", instanceName };
    case "connected":
      return { type: "Connected", event: {}, userID: "1", instanceName };
    case "disconnected":
      return { type: "Disconnected", event: {}, userID: "1", instanceName };
    case "logged-out":
      return { type: "LoggedOut", event: {}, userID: "1", instanceName };
    default:
      throw new Error(`Tipo desconhecido: ${kind}`);
  }
}

const connection = await amqplib.connect(rabbitMqUrl);
const channel = await connection.createChannel();
const payload = buildPayload();
channel.sendToQueue("wuzapi.events.raw", Buffer.from(JSON.stringify(payload)), { persistent: true });
console.log("publicado em wuzapi.events.raw:", JSON.stringify(payload));
await channel.close();
await connection.close();
