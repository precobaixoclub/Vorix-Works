-- 0117 — Módulo Conversas: tabela de aliases LID→telefone PERSISTIDA (bloco "réplica de
-- identidade", inspirado no `IdentityLink` de outro sistema do usuário — CMDesk/desk-spark-ai).
--
-- Causa raiz que esta migration fecha: hoje o Vorix só resolve LID→telefone NO MOMENTO do evento,
-- via `Info.SenderAlt`/`RecipientAlt` (evidência real do provider, `whatsapp-identity.ts`) — mas
-- nunca persiste essa descoberta. Se a mesma pessoa mandar uma mensagem depois SEM o `*Alt` (nem
-- todo evento do WuzAPI traz esse campo), o Vorix recalcula um pseudo-telefone a partir do LID
-- sozinho e cria um SEGUNDO contato/conversa para a mesma pessoa — o risco "PN/LID cruzado" já
-- documentado em docs/conversas-canonical-chat-identity.md (seção "Riscos restantes").
--
-- Com esta tabela, a resolução de identidade em `registerInboundMessage` passa a consultar
-- primeiro "este LID já foi visto com um `*Alt` antes?" — se sim, usa o telefone real como pivô
-- mesmo que o evento atual não traga o `*Alt` de novo.
--
-- Migration ADITIVA — nenhuma linha de `inbox_contacts`/`inbox_conversations` é tocada aqui.

create table if not exists inbox_identity_links (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  -- Alias técnico normalizado ("+<dígitos>", mesmo formato de `whatsapp-identity.ts:normalizeAliasValue`).
  lid text not null,
  -- Telefone canônico resolvido — SEMPRE vindo de evidência real do provider (`*Alt`), nunca de
  -- heurística (o Vorix, ao contrário do CMDesk, não tem nem implementa fonte de evidência fraca
  -- pra identidade — ver docs do plano desta entrega).
  phone_e164 text not null,
  -- 0-100, sobe via GREATEST() a cada nova evidência confirmando o mesmo par, nunca desce. Hoje só
  -- existe uma fonte (100 sempre, `Info.SenderAlt`/`RecipientAlt`) — o campo já existe para uma
  -- futura segunda fonte sem precisar de outra migration.
  confidence integer not null default 100 check (confidence between 0 and 100),
  -- Única fonte real disponível hoje: 'wuzapi_alt_field'.
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Um LID só pode apontar para UM telefone por workspace — a garantia central desta tabela.
  unique (workspace_id, lid)
);

-- Usado pelo worker de reconciliação (Fase 4) e pelo merge (Fase 2): "quais LIDs já resolveram
-- para este telefone?" — para achar contatos/conversas antigas por pseudo-telefone-LID que agora
-- têm uma correlação real disponível.
create index if not exists inbox_identity_links_phone_idx on inbox_identity_links (workspace_id, phone_e164);
