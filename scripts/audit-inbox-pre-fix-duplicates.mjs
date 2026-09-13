#!/usr/bin/env node
// Auditoria SOMENTE LEITURA das conversas do módulo Conversas criadas ANTES da correção do bug
// estrutural de identidade de conversa (ver docs/conversas-canonical-chat-identity.md). Nunca
// escreve/apaga/mescla nada — o mapper antigo descartava o `Chat`/`IsGroup`/`IsFromMe` bruto do
// WuzAPI, então não existe dado suficiente para reconciliar automaticamente com segurança (mesclar
// às cegas arrisca juntar duas pessoas DIFERENTES que só coincidem em nome/horário — proibido pela
// seção 19 do pedido original). Este script só AGRUPA candidatos por proximidade temporal para
// revisão HUMANA; a decisão de arquivar/mesclar manualmente é sempre de uma pessoa.
//
// Uso: node scripts/audit-inbox-pre-fix-duplicates.mjs <workspaceId> [--before=<ISO8601>] [--window-seconds=90]
//
// --before: timestamp de corte (ISO) — conversas criadas ANTES disso são candidatas a "pré-fix".
//           Se omitido, usa a data/hora de deploy da migration 0115 registrada em schema_migrations.
// --window-seconds: janela de agrupamento (mensagens de conversas DIFERENTES cujo primeiro evento
//           caiu dentro dessa janela viram candidatas a "mesmo grupo real, fragmentado").

import { Pool } from "pg";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--before=")) flags.before = arg.slice("--before=".length);
    else if (arg.startsWith("--window-seconds=")) flags.windowSeconds = Number(arg.slice("--window-seconds=".length));
    else positional.push(arg);
  }
  return { workspaceId: positional[0], before: flags.before, windowSeconds: flags.windowSeconds ?? 90 };
}

async function main() {
  const { workspaceId, before, windowSeconds } = parseArgs(process.argv.slice(2));
  if (!workspaceId) {
    console.error("Uso: node scripts/audit-inbox-pre-fix-duplicates.mjs <workspaceId> [--before=<ISO8601>] [--window-seconds=90]");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const cutoff = before ?? (await pool.query("select applied_at from schema_migrations where id = '0115_inbox_canonical_chat_identity'")).rows[0]?.applied_at;
    if (!cutoff) {
      console.error("Não foi possível determinar o corte 'pré-fix' — migration 0115 ainda não aplicada, ou passe --before explicitamente.");
      process.exit(1);
    }
    console.log(`[audit] workspace=${workspaceId} corte(pré-fix)=${new Date(cutoff).toISOString()} janela=${windowSeconds}s`);
    console.log("[audit] SOMENTE LEITURA — nada é escrito/apagado/mesclado por este script.\n");

    const { rows: conversations } = await pool.query(
      `select c.id, c.chat_type, c.external_chat_id, c.group_name, c.created_at,
              ct.name as contact_name, ct.phone_normalized as contact_phone,
              (select count(*)::int from inbox_messages m where m.conversation_id = c.id) as message_count,
              (select min(created_at) from inbox_messages m where m.conversation_id = c.id) as first_message_at,
              (select max(created_at) from inbox_messages m where m.conversation_id = c.id) as last_message_at
       from inbox_conversations c
       left join inbox_contacts ct on ct.id = c.contact_id
       where c.workspace_id = $1 and c.created_at < $2
       order by first_message_at asc nulls last`,
      [workspaceId, cutoff],
    );

    console.log(`[audit] ${conversations.length} conversa(s) pré-fix encontrada(s).\n`);

    // Agrupa por proximidade temporal do PRIMEIRO evento — candidato a "vários remetentes do MESMO
    // grupo real, cada um virou uma conversa separada pelo bug antigo". Só um SINAL para revisão
    // humana, nunca uma conclusão automática (dois contatos podem coincidir em horário por acaso).
    const clusters = [];
    let current = [];
    for (const conv of conversations) {
      if (!conv.first_message_at) continue;
      if (current.length === 0) {
        current.push(conv);
        continue;
      }
      const prev = current[current.length - 1];
      const deltaSeconds = (new Date(conv.first_message_at) - new Date(prev.first_message_at)) / 1000;
      if (deltaSeconds <= windowSeconds) {
        current.push(conv);
      } else {
        if (current.length > 1) clusters.push(current);
        current = [conv];
      }
    }
    if (current.length > 1) clusters.push(current);

    if (clusters.length === 0) {
      console.log("[audit] Nenhum cluster candidato encontrado dentro da janela configurada.");
    } else {
      console.log(`[audit] ${clusters.length} cluster(s) candidato(s) a "mesmo grupo real fragmentado" — REVISAR MANUALMENTE, nunca mesclar automaticamente:\n`);
      clusters.forEach((cluster, i) => {
        const span = (new Date(cluster[cluster.length - 1].first_message_at) - new Date(cluster[0].first_message_at)) / 1000;
        console.log(`--- Cluster ${i + 1} (${cluster.length} conversas, ${span.toFixed(0)}s de intervalo) ---`);
        for (const conv of cluster) {
          const phone = conv.contact_phone ? `${conv.contact_phone.slice(0, 6)}${"*".repeat(Math.max(conv.contact_phone.length - 6, 0))}` : "(sem contato)";
          console.log(`  ${conv.id}  chatType=${conv.chat_type}  contato="${conv.contact_name ?? "(sem nome)"}" (${phone})  msgs=${conv.message_count}  primeira=${new Date(conv.first_message_at).toISOString()}`);
        }
        console.log();
      });
    }

    // Bucket separado: conversas SEM nome de contato (PushName ausente) — no padrão observado na
    // homologação real, isto costuma corresponder a self-echo do próprio número mal categorizado
    // como "contato" pelo bug antigo (ver docs/conversas-canonical-chat-identity.md, seção 3 do
    // relatório). Também só um SINAL, nunca uma conclusão automática.
    const unnamed = conversations.filter((c) => !c.contact_name && c.message_count > 5);
    if (unnamed.length > 0) {
      console.log(`[audit] ${unnamed.length} conversa(s) sem nome de contato E com mais de 5 mensagens — candidatas a self-echo mal categorizado (revisar manualmente):`);
      for (const conv of unnamed) {
        console.log(`  ${conv.id}  msgs=${conv.message_count}  primeira=${new Date(conv.first_message_at).toISOString()}  última=${new Date(conv.last_message_at).toISOString()}`);
      }
      console.log();
    }

    console.log("[audit] Nenhuma ação foi tomada. Decisão de arquivar/mesclar manualmente é humana — ver seção 19 do pedido original (nunca merge automático sob ambiguidade).");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[audit] falhou:", error instanceof Error ? error.message : error);
  process.exit(1);
});
