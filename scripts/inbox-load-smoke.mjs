#!/usr/bin/env node
// Módulo Conversas — Fase 7, requisito 11 ("teste de carga controlado, sem WhatsApp real, usando
// fake provider + RabbitMQ/Postgres reais quando disponível"). RabbitMQ real não está disponível
// neste ambiente (sem Docker) — este script mede a camada aplicação+Postgres (pglite, protocolo
// de fio real) diretamente via os mesmos casos de uso que o worker chama, sem passar pelo
// RabbitMQ. Isso NÃO substitui um teste de carga com o broker real (permanece
// RUNTIME_VALIDATION_PENDING_BROKER) — é o que dá pra medir sem infraestrutura externa: gargalos
// óbvios na camada que o RabbitMQ nunca protege sozinho (Postgres, application, IA).
//
// Cenário mínimo pedido: 10 conexões, 100 conversas, 1000 mensagens, rajadas inbound/outbound, IA
// ligada numa parte das conversas. "Não quero benchmark artificial gigantesco. Quero descobrir
// gargalos óbvios."
//
// Uso: node scripts/inbox-load-smoke.mjs   (requer `npm run build` antes — importa de dist/)

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { registerInboundMessage, processOutboundMessage, sendInboxMessage, maybeGenerateAiResponse } from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "../tests/helpers/pglite-test-db.mjs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
const CONNECTIONS = 10;
const CONVERSATIONS_PER_CONNECTION = 10; // 10 x 10 = 100 conversas
const MESSAGES_TOTAL = 1000;
const AI_ENABLED_FRACTION = 0.2; // parte das conversas com IA ligada

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

function summarize(label, samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  console.log(
    `  ${label}: n=${sorted.length} avg=${(sum / (sorted.length || 1)).toFixed(2)}ms p50=${percentile(sorted, 50).toFixed(2)}ms p95=${percentile(sorted, 95).toFixed(2)}ms p99=${percentile(sorted, 99).toFixed(2)}ms max=${(sorted.at(-1) ?? 0).toFixed(2)}ms`,
  );
}

async function main() {
  console.log(`[load-smoke] iniciando pglite + migrations...`);
  const db = await startTestPostgres({ port: 55799 });
  const startedAt = Date.now();
  try {
    await applyMigrations(db.pool, MIGRATIONS_DIR);

    const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `ws-${Math.random().toString(36).slice(2, 10)}` });
    const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
    const contactRepo = new PostgresInboxContactRepository(db.pool);
    const conversationRepo = new PostgresInboxConversationRepository(db.pool);
    const conversationEventRepository = new PostgresInboxConversationEventRepository(db.pool);
    const messageRepository = new PostgresInboxMessageRepository(db.pool);

    const tenantId = "tenant-load-smoke";
    const workspace = await workspaceRepo.create({ tenantId, name: "Load Smoke" });

    const provider = {
      sentMessages: [],
      async sendText(input) {
        this.sentMessages.push(input);
        return { externalMessageId: `wa-${this.sentMessages.length}` };
      },
    };
    const aiResponder = {
      async generateReply() {
        await new Promise((resolve) => setTimeout(resolve, 1)); // simula latência mínima de rede/IA
        return { ok: true, reply: "Resposta automática de teste.", provider: "fake", model: "fake", latencyMs: 1, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 }, traceId: "load-smoke" };
      },
    };
    const outboundQueue = { publish: async () => {} };
    const deps = { workspaceRepository: workspaceRepo, connectionRepository: connectionRepo, contactRepository: contactRepo, conversationRepository: conversationRepo, conversationEventRepository, messageRepository, provider, aiResponder, outboundQueue };

    console.log(`[load-smoke] criando ${CONNECTIONS} conexões x ${CONVERSATIONS_PER_CONNECTION} conversas...`);
    const conversations = [];
    let counter = 0;
    for (let c = 0; c < CONNECTIONS; c++) {
      const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: `Conexão ${c}` });
      await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: `sess-${connection.id}` });
      for (let k = 0; k < CONVERSATIONS_PER_CONNECTION; k++) {
        const phone = `+551199${(++counter).toString().padStart(6, "0")}`;
        const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: phone, name: `Cliente ${counter}` });
        const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
        const aiEnabled = Math.random() < AI_ENABLED_FRACTION;
        if (aiEnabled) await conversationRepo.setAiEnabled(conversation.id, true);
        conversations.push({ connectionId: connection.id, contactId: contact.id, conversationId: conversation.id, phone, aiEnabled });
      }
    }

    console.log(`[load-smoke] disparando ${MESSAGES_TOTAL} mensagens inbound em rajadas (mistura de conversas)...`);
    const inboundLatencies = [];
    const aiLatencies = [];
    let aiFailures = 0;
    const BURST_SIZE = 50;
    for (let sent = 0; sent < MESSAGES_TOTAL; sent += BURST_SIZE) {
      const burst = [];
      for (let i = 0; i < BURST_SIZE && sent + i < MESSAGES_TOTAL; i++) {
        const target = conversations[Math.floor(Math.random() * conversations.length)];
        burst.push(
          (async () => {
            const t0 = performance.now();
            const { message, wasCreated } = await registerInboundMessage(deps, {
              tenantId,
              workspaceId: workspace.id,
              connectionId: target.connectionId,
              fromPhone: target.phone,
              externalMessageId: `wa-in-${tenantId}-${sent}-${i}-${Math.random().toString(36).slice(2, 8)}`,
              type: "text",
              body: `Mensagem de carga ${sent + i}`,
              occurredAt: new Date().toISOString(),
            });
            inboundLatencies.push(performance.now() - t0);
            if (target.aiEnabled && wasCreated) {
              const tAi = performance.now();
              try {
                await maybeGenerateAiResponse(deps, { tenantId, workspaceId: workspace.id, conversationId: target.conversationId, triggeringMessageId: message.id });
                aiLatencies.push(performance.now() - tAi);
              } catch {
                aiFailures += 1;
              }
            }
          })(),
        );
      }
      await Promise.all(burst);
    }

    console.log(`[load-smoke] processando outbound pendente...`);
    const outboundLatencies = [];
    let outboundFailures = 0;
    for (const target of conversations) {
      const pending = await messageRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: target.conversationId });
      const queued = pending.filter((m) => m.direction === "outbound" && m.status === "queued");
      for (const message of queued) {
        const t0 = performance.now();
        try {
          await processOutboundMessage(deps, { messageId: message.id });
          outboundLatencies.push(performance.now() - t0);
        } catch {
          outboundFailures += 1;
        }
      }
    }

    const totalMs = Date.now() - startedAt;
    console.log(`\n[load-smoke] RESULTADOS`);
    console.log(`  Tempo total (setup + carga): ${(totalMs / 1000).toFixed(2)}s`);
    console.log(`  Conexões: ${CONNECTIONS} | Conversas: ${conversations.length} | Mensagens inbound: ${MESSAGES_TOTAL}`);
    console.log(`  Throughput inbound: ${(MESSAGES_TOTAL / (totalMs / 1000)).toFixed(1)} msg/s (inclui setup)`);
    summarize("registerInboundMessage (persistência + dedupe)", inboundLatencies);
    summarize("maybeGenerateAiResponse (conversas com IA)", aiLatencies);
    summarize("processOutboundMessage (envio + markSent)", outboundLatencies);
    console.log(`  Falhas de IA: ${aiFailures} | Falhas de outbound: ${outboundFailures}`);
    console.log(`  Mensagens outbound geradas pela IA e enviadas: ${provider.sentMessages.length}`);
  } finally {
    await db.stop();
  }
}

main().catch((error) => {
  console.error("[load-smoke] falhou:", error);
  process.exitCode = 1;
});
