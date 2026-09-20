#!/usr/bin/env node
// Jornada Comercial Integrada, Fase 1 — reconciliação CONTROLADA (seção 13 do pedido): só depois da
// auditoria read-only (`scripts/audit-inbox-crm-bridge-candidates.mjs`) confirmar quantos
// InboxContacts elegíveis e inequívocos existem. Nunca mexe em grupo (grupo nunca tem
// InboxContact/candidato). Nunca faz merge ambíguo — um candidato com conflito de identidade é
// pulado e reportado, nunca resolvido aqui (mesma regra de `ensureCrmContactForInboxContact`).
//
// Reusa a MESMA função de produção que a ponte automática usa por mensagem
// (`ensureCrmContactForInboxContact`) — não há uma segunda lógica de criação/vínculo só pro
// backfill; o comportamento em batch é idêntico ao comportamento em tempo real, só que aplicado a
// contatos que já existiam antes da ponte estar ligada.
//
// Uso:
//   node scripts/backfill-inbox-crm-bridge.mjs [workspaceId] [--apply] [--limit N]
//
// Sem --apply: DRY RUN — só lista os candidatos que seriam processados, nada é escrito.
// Com --apply: processa de fato, em lote, um contato por vez, com log de cada resultado.
// Sem workspaceId: roda para todos os workspaces (use com cautela; prefira rodar por workspace).
// --limit N: processa no máximo N candidatos nesta execução (útil pra rodar em lotes pequenos).
//
// Idempotente: pode ser interrompido e re-executado livremente — `ensureCrmContactForInboxContact`
// nunca cria duplicata para um InboxContact que já foi processado (por esta execução ou por
// qualquer outra, incluindo a ponte automática em tempo real).

import { Pool } from "pg";
import { buildIdentityRepositories } from "../dist/infrastructure/storage/build-identity-repositories.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { ensureCrmContactForInboxContact, MIN_MESSAGES_FOR_AUTO_CRM_CONTACT } from "../dist/application/commercial-bridge/inbox-crm-bridge-use-cases.js";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limitFlagIndex = args.indexOf("--limit");
  const limit = limitFlagIndex >= 0 ? Number(args[limitFlagIndex + 1]) : undefined;
  const workspaceId = args.find((arg) => !arg.startsWith("--") && arg !== String(limit));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[backfill] DATABASE_URL não definido.");
    process.exitCode = 1;
    return;
  }

  console.log(apply ? "[backfill] MODO APLICAR — vai criar/vincular Contacts de verdade." : "[backfill] DRY RUN — nada será escrito (rode com --apply para aplicar).");
  console.log(workspaceId ? `[backfill] escopo: workspace=${workspaceId}` : "[backfill] escopo: TODOS os workspaces");
  if (limit) console.log(`[backfill] limite: ${limit} candidatos nesta execução`);
  console.log("");

  // Reusa o mesmo builder de repositórios de produção — `secretsMasterKey` não é usado por nenhum
  // dos três repositórios de CRM consumidos aqui (contact/contactIdentity/timelineEvent).
  const identityDeps = buildIdentityRepositories({ databaseUrl, secretsMasterKey: "unused-in-backfill-script" });
  const pool = identityDeps.pool;
  const inboxContactRepository = new PostgresInboxContactRepository(pool);
  const inboxMessageRepository = new PostgresInboxMessageRepository(pool);

  const bridgeDeps = {
    inboxContactRepository,
    inboxMessageRepository,
    contact: {
      contactRepository: identityDeps.contactRepository,
      contactIdentityRepository: identityDeps.contactIdentityRepository,
      timelineEventRepository: identityDeps.timelineEventRepository,
      // `automation` deliberadamente omitido — mesma decisão da ponte em tempo real (ver
      // docs/vorix-jornada-comercial-fase1-contatos.md, seção "Automações"): contato auto-capturado
      // (backfill ou tempo real) nunca dispara automações de `contact_created` nesta fase.
    },
  };

  try {
    // Mesma query de elegibilidade da auditoria read-only, mas retornando os IDs em vez de só contar
    // — candidato = conversa DIRETA (grupo nunca tem InboxContact), não fundida, sem `contact_id`,
    // com >= MIN_MESSAGES_FOR_AUTO_CRM_CONTACT mensagens, e SEM conflito de identidade pré-existente.
    const scopeClause = workspaceId ? "and ic.workspace_id = $1" : "";
    const params = workspaceId ? [workspaceId] : [];
    const candidates = await pool.query(
      `select distinct ic.id as inbox_contact_id, ic.tenant_id, ic.workspace_id, ic.name, ic.phone_normalized, conv.id as conversation_id
       from inbox_contacts ic
       join inbox_conversations conv on conv.contact_id = ic.id and conv.chat_type = 'direct' and conv.merge_status is null
       left join contact_identities cid on cid.channel = 'whatsapp' and cid.external_id = ic.id
       where ic.merge_status is null and ic.contact_id is null ${scopeClause}
         and cid.id is null
         and (select count(*) from inbox_messages m where m.conversation_id = conv.id) >= ${MIN_MESSAGES_FOR_AUTO_CRM_CONTACT}
       order by ic.workspace_id, ic.id`,
      params,
    );

    const rows = limit ? candidates.rows.slice(0, limit) : candidates.rows;
    console.log(`[backfill] ${candidates.rows.length} candidato(s) elegível(is) encontrado(s)${limit && candidates.rows.length > limit ? `, processando ${rows.length} nesta execução` : ""}.\n`);

    if (rows.length === 0) {
      console.log("[backfill] Nada a fazer.");
      return;
    }

    let created = 0;
    let reused = 0;
    let failed = 0;

    for (const row of rows) {
      const label = `InboxContact=${row.inbox_contact_id} workspace=${row.workspace_id} nome="${row.name ?? row.phone_normalized ?? "?"}"`;
      if (!apply) {
        console.log(`[dry-run] criaria/vincularia Contact para ${label}`);
        continue;
      }
      try {
        const result = await ensureCrmContactForInboxContact(bridgeDeps, {
          tenantId: row.tenant_id,
          workspaceId: row.workspace_id,
          inboxContactId: row.inbox_contact_id,
          contactName: row.name ?? undefined,
          contactPhone: row.phone_normalized ?? undefined,
        });
        if (!result) {
          console.log(`[skip] ${label} — já fundido ou removido entre a consulta e o processamento.`);
          continue;
        }
        if (result.created) {
          created += 1;
          console.log(`[criado] ${label} -> Contact=${result.contactId}`);
        } else {
          reused += 1;
          console.log(`[reusado] ${label} -> Contact=${result.contactId} (já existia)`);
        }
      } catch (error) {
        failed += 1;
        console.error(`[erro] ${label}:`, error instanceof Error ? error.message : error);
      }
    }

    if (apply) {
      console.log(`\n[backfill] concluído — criados=${created} reusados=${reused} falhas=${failed}.`);
    } else {
      console.log("\n[backfill] DRY RUN concluído — nada foi escrito. Rode novamente com --apply para aplicar.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[backfill] falhou:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
