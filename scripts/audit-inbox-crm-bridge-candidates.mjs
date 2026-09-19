#!/usr/bin/env node
// Jornada Comercial Integrada, Fase 1 — auditoria SOMENTE LEITURA (seção 12 do pedido: "não criar
// todos automaticamente sem critério... criar primeiro auditoria read-only"). Nunca escreve/cria/
// vincula nada — só relata, pra decisão humana sobre um backfill controlado depois (seção 13, fora
// do escopo deste script).
//
// Uso: node scripts/audit-inbox-crm-bridge-candidates.mjs [workspaceId]
// Sem workspaceId: relata agregado por workspace, para todos os workspaces com pelo menos 1
// InboxContact direto.

import { Pool } from "pg";

const MIN_MESSAGES_FOR_AUTO_CRM_CONTACT = 3; // mesmo limiar de `inbox-crm-bridge-use-cases.ts`

async function main() {
  const workspaceId = process.argv[2];
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log("[audit] SOMENTE LEITURA — nada é escrito/criado/vinculado por este script.\n");
    if (workspaceId) console.log(`[audit] escopo: workspace=${workspaceId}\n`);
    else console.log("[audit] escopo: todos os workspaces\n");

    const scopeClause = workspaceId ? "and ic.workspace_id = $1" : "";
    const params = workspaceId ? [workspaceId] : [];

    // 1) Total de InboxContacts DIRETOS (nunca conta tombstones de merge — já não são o registro
    //    ativo) e quantos já têm `contact_id` (vínculo manual ou de uma rodada anterior da ponte).
    const totals = await pool.query(
      `select ic.workspace_id,
              count(*)::int as total_inbox_contacts,
              count(*) filter (where ic.contact_id is not null)::int as already_linked,
              count(*) filter (where ic.whatsapp_pn is not null)::int as strong_phone_evidence,
              count(*) filter (where ic.phone_normalized ~ '^\\+[1-9][0-9]{7,14}$')::int as looks_like_e164
       from inbox_contacts ic
       where ic.merge_status is null ${scopeClause}
       group by ic.workspace_id
       order by ic.workspace_id`,
      params,
    );

    if (totals.rows.length === 0) {
      console.log("[audit] Nenhum InboxContact encontrado neste escopo.");
      return;
    }

    // 2) Elegibilidade — sinal mínimo de relacionamento real (mesmo limiar já usado pelo nudge
    //    visual em `crm-panel.tsx` e pelo gatilho automático em produção): conversa DIRETA (nunca
    //    grupo — grupo nunca tem InboxContact), não fundida, com >= N mensagens.
    const eligible = await pool.query(
      `select ic.workspace_id, count(*)::int as eligible_count
       from inbox_contacts ic
       join inbox_conversations conv on conv.contact_id = ic.id and conv.chat_type = 'direct' and conv.merge_status is null
       where ic.merge_status is null and ic.contact_id is null ${scopeClause ? "and ic.workspace_id = $1" : ""}
         and (select count(*) from inbox_messages m where m.conversation_id = conv.id) >= ${MIN_MESSAGES_FOR_AUTO_CRM_CONTACT}
       group by ic.workspace_id`,
      params,
    );
    const eligibleByWorkspace = new Map(eligible.rows.map((row) => [row.workspace_id, row.eligible_count]));

    // 3) Conflitos pré-existentes — estado que NUNCA deveria acontecer sob uso normal (nenhum
    //    caminho de código cria isso hoje), mas a auditoria confere de qualquer forma: uma
    //    `contact_identities(channel='whatsapp', external_id=<inbox_contact.id>)` já existe
    //    apontando pra um Contact DIFERENTE do que `inbox_contacts.contact_id` teria (ou já
    //    deveria ter, se estivesse preenchido). Reporta pra revisão manual — nunca resolvido aqui.
    const conflicts = await pool.query(
      `select ic.workspace_id, count(*)::int as conflict_count
       from inbox_contacts ic
       join contact_identities cid on cid.channel = 'whatsapp' and cid.external_id = ic.id
       where ic.merge_status is null and ic.contact_id is not null and cid.contact_id <> ic.contact_id ${scopeClause}
       group by ic.workspace_id`,
      params,
    );
    const conflictsByWorkspace = new Map(conflicts.rows.map((row) => [row.workspace_id, row.conflict_count]));

    console.log(
      "workspace_id".padEnd(38),
      "total".padStart(7),
      "vinculados".padStart(11),
      "PN forte".padStart(9),
      "e164?".padStart(7),
      "elegíveis".padStart(10),
      "conflitos".padStart(10),
    );
    for (const row of totals.rows) {
      console.log(
        row.workspace_id.padEnd(38),
        String(row.total_inbox_contacts).padStart(7),
        String(row.already_linked).padStart(11),
        String(row.strong_phone_evidence).padStart(9),
        String(row.looks_like_e164).padStart(7),
        String(eligibleByWorkspace.get(row.workspace_id) ?? 0).padStart(10),
        String(conflictsByWorkspace.get(row.workspace_id) ?? 0).padStart(10),
      );
    }

    console.log(`\n[audit] "elegíveis" = conversa direta, não fundida, sem contact_id, com >= ${MIN_MESSAGES_FOR_AUTO_CRM_CONTACT} mensagens — candidatos SEGUROS a um backfill controlado futuro (nunca executado por este script).`);
    console.log("[audit] \"conflitos\" deveria ser sempre 0 hoje (nenhum código cria esse estado) — um valor > 0 merece investigação manual antes de qualquer backfill.");
    console.log("[audit] Nenhuma ação foi tomada. Decisão de permitir/rodar um backfill controlado é humana (ver docs/vorix-jornada-comercial-fase1-contatos.md, seção 12/13).");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[audit] falhou:", error instanceof Error ? error.message : error);
  process.exit(1);
});
