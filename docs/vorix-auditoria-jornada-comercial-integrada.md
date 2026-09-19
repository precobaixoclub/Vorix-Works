# Auditoria — Jornada Comercial Integrada (Conversas → Contatos → Negócios → Tarefas → Propostas → Venda)

> **Natureza deste documento**: auditoria factual, read-only. Nenhum código, migration, endpoint, botão ou UI foi criado ou alterado para produzir este relatório — todo o conteúdo vem de leitura direta do código/schema existente, com citações `arquivo:linha`. As seções 26-30 contêm **recomendações**, claramente marcadas como tal, e não descrevem nada implementado.

> **Nota de nomenclatura, importante para ler o resto do documento**: os arquivos de migration têm nomes como `0091_crm_contacts.sql`, `0092_crm_contact_identities...sql`, `0095_crm_deals.sql`, `0096_crm_tasks.sql`, `0098_crm_proposals.sql` — mas as TABELAS que eles criam **não têm o prefixo `crm_`**: os nomes reais no banco são `contacts`, `contact_identities`, `deals`, `tasks`, `proposals`, `pipelines`, `pipeline_stages`, `timeline_events`. Este relatório usa os nomes REAIS das tabelas/tipos a partir daqui.

---

## 1. Resumo executivo

O Vorix hoje tem dois "mundos" de dados sobre uma mesma pessoa, **deliberadamente isolados por arquitetura** (isolamento verificado em CI por `scripts/check-crm-isolation.mjs`):

- **Inbox** (`inbox_contacts`, `inbox_conversations`, `inbox_messages`) — tudo que nasce de uma mensagem do WhatsApp/Instagram. Rápido, resiliente, nunca depende do CRM para funcionar.
- **CRM** (`contacts`, `deals`, `tasks`, `proposals`, `pipelines`) — tudo que é gestão comercial deliberada: quem é o cliente, o que estamos vendendo, o que fazer a seguir, o que foi proposto.

A ÚNICA ponte entre os dois mundos é uma coluna opcional: `inbox_contacts.contact_id` (FK pra `contacts.id`, migration `0092`). Essa coluna **nunca é preenchida automaticamente** — só por uma ação humana explícita ("Vincular ao CRM", dentro da própria tela de Conversas) ou pelo backfill único que rodou uma vez, historicamente, na migration 0092.

Isso explica exatamente o sintoma que motivou esta auditoria: **uma pessoa pode conversar no WhatsApp por semanas e nunca existir como um "Contato" pesquisável no CRM**, a menos que um humano clique em vincular. Quando vinculada, porém, a integração já é surpreendentemente boa: dentro da própria conversa é possível criar negócio/tarefa/proposta de verdade, pré-preenchidos com o contato certo (`crm-panel.tsx`). O problema não é "falta tudo" — é que essa ponte é **manual, pouco visível, e some depois de atravessada**: nada volta a aparecer dentro da conversa depois (nenhum card de "proposta enviada" no chat), e as outras telas (Contatos, Negócios, Propostas) não se conectam umas às outras com a mesma qualidade que a tela de Conversas já demonstra ser possível.

Achados-chave:
- **Auto-criação de Contact**: NÃO existe. Confirmado exaustivamente (§6).
- **Contact 360**: existe e mostra dados reais em todas as abas, mas 4 das 6 abas carregam a lista INTEIRA do workspace e filtram no client, em vez de usar os endpoints já filtráveis por `contactId` que a própria API expõe (§7).
- **Negócio ↔ Conversa**: sem FK direta — é resolvido por um JOIN em memória no frontend via `contactId` (§11, §22).
- **Proposta**: modelo de estados real e completo (draft→sent→viewed→accepted/rejected/expired), snapshot de itens genuíno (nunca referência viva a produto), aceite já move o negócio pra "Ganho" automaticamente (§17, §22). Mas: "Enviar" não envia nada de verdade (só muda status), visualização é rastreada só uma vez (nunca conta quantas vezes o link foi aberto), não existe revogar/regenerar link, e recusa não afeta o negócio nem pede motivo (§15-§19, §23).
- **Templates de proposta**: não existem, em nenhum grau (§24, §26).
- **Timeline unificada**: o schema (`timeline_events`) já foi desenhado pra ser genérico o bastante pra unificar contato+negócio+tarefa+proposta+conversa — mas a Inbox nunca escreve nele (usa um mecanismo próprio e paralelo, `inbox_conversation_events`), e mesmo as 4 entidades que escrevem nele são sempre lidas isoladamente (uma entidade por vez, nunca agregado por contato). É a lacuna de maior alavancagem encontrada: a "espinha dorsal" já existe, falta só a camada de agregação (§19, §24).

---

## 2. Conversas (Inbox) — o que já existe hoje

### 2.1 Criação de `InboxConversation`

Identidade real da conversa: `(connection_id, external_chat_id)` — **nunca** `contact_id` (migration `0115_inbox_canonical_chat_identity.sql:25-50`, que corrigiu um bug real: antes, cada participante de um grupo virava uma conversa diferente).

Criação: `registerInboundMessage` (`src/application/inbox/inbox-use-cases.ts:1009-1095`) chama `conversationRepository.findOrCreate(...)` → `INSERT ... ON CONFLICT (connection_id, external_chat_id) WHERE merge_status IS NULL DO UPDATE` (`postgres-inbox-conversation-repository.ts:49-66`).

Campos existentes hoje (cumulativo, todas as migrations 0082→0129 aplicadas):
`id, tenant_id, workspace_id, connection_id, contact_id (opcional, FK inbox_contacts), status, assigned_user_id, department_id, last_message_at, unread_count, ai_enabled, automation_enabled, chat_type ('direct'|'group'), external_chat_id, group_name, group_participant_count, group_metadata_updated_at, merge_status, merged_into_conversation_id, merged_at, is_urgent, current_team_id, current_phase_id, is_pinned, pinned_at` (+ tags via tabela satélite N:N `inbox_conversation_tags`, migration `0129`).

### 2.2 `InboxContact`

Tabela `inbox_contacts` (migration `0081`), pivô = **telefone**, não LID: `unique(workspace_id, phone_normalized)`. Campos cumulativos: `id, tenant_id, workspace_id, name, phone_normalized, profile_picture_url, external_id, metadata, whatsapp_pn, whatsapp_lid (migration 0116), contact_id (FK opcional pra contacts, migration 0092), merge_status/merged_into_contact_id/merged_at (tombstone, migration 0118), profile_picture_storage_ref, profile_picture_synced_at`.

Upsert: `PostgresInboxContactRepository.upsertByPhone` (`postgres-inbox-contact-repository.ts:31-74`), `ON CONFLICT (workspace_id, phone_normalized) WHERE merge_status IS NULL DO UPDATE`. Colisão de alias PN/LID com outro contato → **nunca funde automaticamente**, loga warning e refaz sem o alias conflitante (`:32-51`).

### 2.3 Telefone/LID/JID — resolução

`resolveInboundPivotPhone` (`inbox-use-cases.ts:955-975`) decide o telefone canônico. Quando `chatLid` + evidência forte (`chatPhoneE164`) vêm juntos, grava um par em `inbox_identity_links` (migration `0117`) — link persistido LID↔telefone pra próximas mensagens que só tragam o LID.

### 2.4 Grupos

Para `input.isGroup`, o bloco inteiro de criação/atualização de `InboxContact` é **pulado** (`inbox-use-cases.ts:1023`) — `contact` fica `undefined`. A conversa nasce com `chatType: 'group'`, `externalChatId = chatId (JID @g.us)`, `contactId: undefined`. Quem mandou cada mensagem fica em `inbox_messages.sender_external_id/sender_display_name/sender_phone_e164`, nunca na conversa. Vínculo ao CRM é bloqueado deliberadamente para grupo, tanto no backend (grupo nunca tem `contact_id`) quanto na UI (`inbox-tab.tsx:2492-2496`, `crm-panel.tsx:64-68` recusa se `!conversation.contactId`).

### 2.5 Responsável e equipe

Roteamento automático só na CRIAÇÃO da conversa (`maybeRouteNewConversationToTeam`, `:1106-1122`, condição `createdAt === updatedAt && !currentTeamId && !assignedUserId` — nunca reavaliado depois): resolve equipe via `inbox_channel_routing_configs` (migration `0123`), e se houver round-robin, resolve o próximo agente por nível de atendimento. Atribuição manual: `assignConversation`, `takeOverConversation`, `transferConversation` (CAS atômico contra `fromUserId`).

### 2.6 Status vs. Fase do Kanban — DOIS campos independentes

- `status`: enum fixo `open/pending/resolved/archived` (migration `0082` original). `archived` nunca é setado por nenhum caso de uso hoje.
- `current_phase_id`: FK pra `team_kanban_phases` (migration `0125`) — a COLUNA do Kanban de Atendimento, dentro da equipe atual. Tem seu próprio `phase_type` (`RUNNING`/`PAUSED`).

`moveConversationPhase` move só `current_phase_id`, nunca `status`. Nenhum código sincroniza os dois automaticamente.

### 2.7 Takeover

`takeOverConversation` (`inbox-use-cases.ts:456-497`): operação atômica (`tryTakeOver`, compare-and-set) que muda `assigned_user_id` **e** desliga `ai_enabled` na MESMA operação — é isso que fecha a janela de IA+humano respondendo ao mesmo tempo. Se outro atendente já assumiu simultaneamente, lança 409 (`INBOX_CONVERSATION_ALREADY_ASSIGNED`).

### 2.8 Timeline da conversa

A Inbox tem seu **próprio** mecanismo de eventos, `inbox_conversation_events`, via `conversationEventRepository.record(...)` — **completamente separado** de `timeline_events` (o mecanismo genérico do CRM, ver §19). Eventos registrados: `took_over`, `ai_paused`, `transferred`, `status_changed`, `ai_response_skipped_insufficient_credits`, `ai_response_failed`, `ai_response_cancelled`, `ai_response_sent`. Intercalado com as mensagens por `createdAt` na UI — mas nunca alimenta a timeline do Contato/Negócio/Proposta.

### 2.9 Ações de CRM dentro da conversa — já são REAIS

Componente: `crm-panel.tsx` (`CrmContextSection`/`LinkedCrmSection`), renderizado só para `conversation.chatType === 'direct'` dentro de `inbox-tab.tsx`.

| Ação | Existe | Comportamento real |
|---|---|---|
| Vincular ao CRM | Sim | `handleLink` (`crm-panel.tsx:64-80`) chama `createContact({workspaceId, name, origin:"whatsapp"})` + `linkContactIdentity(contact.id, "whatsapp", conversation.contactId)` — grava de verdade em `contacts`/`contact_identities`. Aparece com destaque especial ("Vorix encontrou uma oportunidade") quando `messageCount >= 3`. |
| Abrir contato completo | Sim, mas **link morto** | `inbox-tab.tsx:2487-2489`: `href="/workspaces/{id}/contacts"` — a lista GERAL, sem `contactId` nem qualquer parâmetro que abra o registro específico. |
| + Negócio | Sim, real | `createDeal({contactId, pipelineId: defaultPipeline.id, stageId: defaultStage.id, title, valueCents})` — pré-preenchido com o contato real já vinculado. |
| + Tarefa | Sim, real | `createTask({workspaceId, contactId, type, title})`. |
| + Proposta | Sim, real | `createProposal({workspaceId, contactId, title, items:[...]})` — ao suceder, mostra modal com o link público pra copiar. |
| Ver negócios/tarefas do contato | Sim | Lista até 4 negócios e 3 tarefas pendentes do `contactId`, inline no painel, via `useDeals`/`useTasks` filtrados por `contactId`. |

Tudo isso só existe quando `conversation.crmContactId` já está presente — ou seja, depende inteiramente do passo manual "Vincular ao CRM" ter acontecido antes.

---

## 3. `Contact` (CRM) — o que é, hoje

Tabela `contacts` (migration `0091`, nunca alterada depois — confirmado por grep de `alter table contacts` em todas as migrations posteriores). Campos: `id, tenant_id, workspace_id, name, company, document, origin, owner_user_id, team_id, tags (jsonb), custom_fields (jsonb), notes, created_at, updated_at, last_interaction_at`.

**Não existe `phone` nem `email` como coluna de `Contact`** — telefone/canal vive em `ContactIdentity` (§4), nunca na tabela de contato em si. **Não existe `avatar`/`leadScore` persistido** — lead score é calculado sob demanda (§20), nunca gravado.

Sem NENHUMA constraint UNIQUE além do `id` — nada impede dois contatos com o mesmo nome/empresa no mesmo workspace (a prevenção de duplicidade acontece só no nível de `ContactIdentity`, §4).

---

## 4. `ContactIdentity`

Tabela `contact_identities` (migration `0092`): `id, contact_id (FK contacts, cascade), tenant_id, workspace_id, channel (CHECK 'whatsapp'|'instagram'|'facebook'|'tiktok'), external_id, connection_id, created_at`. **`UNIQUE(channel, external_id)`** — "mesma identidade de canal nunca aponta pra dois contatos diferentes".

Não existe canal `email`. Não existe distinção estrutural entre WhatsApp PN e LID neste nível — essa distinção vive só em `inbox_contacts.whatsapp_pn`/`whatsapp_lid`, uma tabela totalmente diferente, do outro bounded context.

**Deduplicação/merge**: `linkContactIdentity` (`contact-use-cases.ts:60-83`) é idempotente por `(channel, external_id)` mas **nunca funde automaticamente** — se a identidade já pertence a OUTRO contato, retorna `conflictsWithAnotherContact: true`, e a rota traduz isso em `422 CONTACT_IDENTITY_CONFLICT` ("resolva manualmente"). Não existe `mergeContacts` em lugar nenhum do código — o próprio comentário do domínio confirma isso como decisão deliberada, fase futura, não implementada.

---

## 5. Contact vs InboxContact — dois mundos isolados por design

O `crm.model.ts` documenta explicitamente: "Bounded context próprio, isolado de inbox/instagram-dm (verificado por `scripts/check-crm-isolation.mjs`) — a única ligação com o WhatsApp existente é via `contact_identities`/`inbox_contacts.contact_id` (migration 0092), **nunca um import direto de código**."

`scripts/check-crm-isolation.mjs` é um guard de CI: falha o build se qualquer arquivo em `/domain/crm/`, `/application/crm/` importar de `/domain/inbox/`, `/application/inbox/` (e vice-versa).

---

## 6. Auto-criação de Contact — a pergunta central

**Resposta definitiva: NÃO existe. Confirmado exaustivamente.**

Busca completa (dois agentes independentes chegaram à mesma conclusão) por todo `src/` por `createContact(`, `findOrCreateContact(`, `contactRepository.create(`, `linkContactIdentity(`: só há chamadas em `contact-use-cases.ts` (as próprias definições) e em `src/interfaces/api/routes/v1/contacts.route.ts` (o endpoint HTTP `POST /contacts`, acionado por humano/API — inclusive é exatamente isso que `crm-panel.tsx`/"Vincular ao CRM" chama).

`registerInboundMessage` (o handler de toda mensagem inbound) chama `contactRepository.upsertByPhone(...)` — mas esse `contactRepository` é um port **diferente e homônimo** (`InboxContactRepositoryPort`, não `ContactRepositoryPort`), que só sabe escrever em `inbox_contacts`. Nunca cria uma linha em `contacts`. `inbox_contacts.contact_id` fica `NULL` para sempre, a menos que:
1. um humano clique "Vincular ao CRM" (fluxo real, já existe — §2.9); ou
2. tenha sido preenchido pelo backfill único da migration 0092 (rodou uma vez, historicamente, não roda de novo).

### Exemplo pedido — pessoa nova manda WhatsApp pela primeira vez

```
Mensagem recebida (DM, número novo)
→ InboxContact X — CRIADO (upsertByPhone, INSERT puro)
→ InboxConversation Y — CRIADA (chatType='direct', contactId=X.id)
→ Contact CRM existe?      NÃO
→ ContactIdentity existe?  NÃO
→ Deal existe?             NÃO
```

```
Mensagem recebida (GRUPO, primeira vez)
→ InboxContact — NÃO criado (bloco pulado para grupo)
→ InboxConversation Y — CRIADA (chatType='group', contactId=null)
→ Contact CRM existe?      NÃO
→ ContactIdentity existe?  NÃO
→ Deal existe?             NÃO
```

### Opções — análise (NÃO IMPLEMENTAR)

**Opção A — criar `Contact` automaticamente na primeira mensagem.**
- Vantagens: exatamente a preferência conceitual do usuário ("se falou comigo, já existe"); zero passo manual.
- Riscos: é exatamente o que o usuário quer evitar — todo número errado, spam, ou contato de suporte pontual vira lixo permanente no CRM. Hoje **não existe nenhum merge/dedupe de `Contact`** (§4) — qualquer erro aqui é irreversível sem intervenção manual. Automação que dispara em `contact_created` passaria a rodar pra qualquer um que mandasse "oi" errado. Contradiz a filosofia já estabelecida em todo o resto do sistema ("nunca fusão/criação automática silenciosa" — mesmo padrão do `inbox_contacts`, do `linkContactIdentity`, do reconciliador de identidade).
- Impacto técnico: exigiria ou quebrar o isolamento arquitetural (`registerInboundMessage` chamando CRM diretamente — o CI de isolamento bloquearia isso hoje) ou um bridge assíncrono (evento pós-mensagem → cria contato) — mais complexidade operacional (idempotência, ordem, retries) pra manter a separação.

**Opção B — manter `InboxContact` separado; criar `Contact` só com sinal de interesse comercial.**
- Vantagens: risco zero de lixo/duplicata; já é o comportamento de fato hoje (inclusive o nudge "Vorix encontrou uma oportunidade" com `messageCount >= 3` **já existe**, só que exige clique); não exige nenhuma mudança na arquitetura de isolamento.
- Riscos: nunca chega a "parece que já existe" de verdade — sempre depende de alguém lembrar de clicar; enquanto isso, a pessoa não é pesquisável no CRM mesmo depois de 10 mensagens.
- Impacto técnico: mínimo — é só polimento de UX sobre o que já existe.

**Opção C (recomendada para avaliação) — híbrida: criação automática, mas marcada como "leve"/não-qualificada, disparada só por um sinal mínimo já existente.**

A ideia: reaproveitar o MESMO sinal que já dispara o nudge visual hoje (`messageCount >= 3`, já codificado em `crm-panel.tsx`) — mas em vez de só destacar um botão, criar o `Contact` automaticamente nesse ponto, marcado com `origin: "whatsapp_auto"` (distinto de um contato criado deliberadamente). Isso:
- satisfaz "se falou comigo mais de uma vez, já deve existir e ser pesquisável";
- evita o pior risco (número errado/spam de uma mensagem só nunca vira contato, porque nunca passa de 1 mensagem);
- a dedupe real já é estrutural aqui: `ContactIdentity` tem `UNIQUE(channel, external_id)`, então a MESMA pessoa nunca gera dois contatos por essa via;
- `origin: "whatsapp_auto"` permite que relatórios/automações filtrem "contato deliberado" vs "auto-capturado" se isso importar depois;
- tecnicamente, ainda respeitaria o isolamento se implementado como um evento/job assíncrono pós-mensagem (nunca uma chamada síncrona dentro de `registerInboundMessage`), mantendo o CI de isolamento satisfeito.

Esta é uma recomendação a avaliar, não uma decisão — o trade-off central (automação vs. controle de qualidade dos dados) é do produto, não técnico.

---

## 7. Contact 360 — auditoria da tela

Único arquivo: `web/app/workspaces/[workspaceId]/contacts/page.tsx` (659 linhas) — tudo monolítico (listagem, card, modal de detalhe com abas, criação, edição) num arquivo só, nenhum componente extraído.

**Listagem**: SEM paginação nenhuma (nem fixa, nem adaptativa) — renderiza todos os contatos retornados de uma vez. Viola a regra 4 do `web/CLAUDE.md`. Grid bespoke de cards (não usa `ListCard`/`StatsGrid` do design system). Busca com debounce 300ms; filtros por Responsável e Equipe (sem filtro por tag/origem).

**Detalhe** (`ContactDetailModal`, usa o `DetailModal` padrão — correto, não é `Tabs` cru): 6 seções — Resumo, Conversas, Negócios, Tarefas, Propostas, Timeline.

| Seção | Dado real? | Fonte |
|---|---|---|
| Resumo | Sim | Campos do próprio `contact` já carregado pela listagem + `useLeadScore` (chamada de API real, escopada) |
| Conversas | Sim, mas ineficiente | `useInboxConversations(workspace.id)` — busca **todas** as conversas do workspace e filtra no client por `crmContactId === contact.id` |
| Negócios | Sim, mas ineficiente | `useDeals(workspace.id)` sem filtro — busca **todos** os negócios do workspace e filtra no client, apesar da API já aceitar `params.contactId` |
| Tarefas | Sim, mas ineficiente | Mesmo padrão — `useTasks(workspace.id)` sem filtro |
| Propostas | Sim, mas ineficiente | Mesmo padrão — `useProposals(workspace.id)` sem filtro |
| Timeline | Sim, escopada de verdade | `useContactTimeline(contact.id, workspaceId)` — única seção com fetch dedicado ao contato |

Nenhum dado é hardcoded/placeholder — tudo é real, mas 4 das 6 seções pagam o custo de carregar o workspace inteiro à toa (a API já suporta o filtro certo, só não é usado).

**Abrir conversa a partir do contato**: sim, dois pontos (botão "Enviar mensagem" na aba Resumo, e clique em qualquer item da aba Conversas) — ambos navegam pra `/conversas?conversation={id}`.

**Criar negócio/tarefa/proposta a partir do contato**: existem os 3 botões, mas **nenhum cria inline** — todos só navegam (`router.push('/deals?contactId=...')` etc.), deixando a tela de destino pré-preencher o formulário (que o usuário ainda precisa confirmar lá). Diferente do padrão de Conversas, que cria de verdade sem sair da tela.

**Múltiplos negócios**: sim, tratado — aba "Negócios" lista todos, cada um clicável abrindo seu próprio `DealDetailModal`. Sem seletor/dropdown, sem destaque de "principal" — é uma lista simples.

**Hooks existentes vs. usados**: `useContact(contactId)` (fetch dedicado a UM contato) existe mas **não é usado** na tela de Contatos — só em `crm-panel.tsx`. A tela de Contatos sempre deriva o contato selecionado da lista já em cache. `useContactDeals`/`useContactTasks`/`useContactProposals` **não existem** — a tela reusa os hooks genéricos do workspace inteiro.

---

## 8. Objetivo ideal do Contato — o que o Vorix já responde hoje

| Pergunta | Vorix responde hoje? |
|---|---|
| Quem é essa pessoa? | Sim (nome/empresa/origem/tags) |
| Como entrou? | Parcial (`origin`, mas só um texto livre, sem taxonomia fechada) |
| Qual telefone? | Indireto — não é campo do Contact, é resolvido via `ContactIdentity`/conversas vinculadas |
| Quais conversas tivemos? | Sim (aba Conversas) |
| Existe negócio aberto? | Sim (aba Negócios) |
| Quais tarefas pendentes? | Sim (aba Tarefas) |
| Quais propostas enviadas? | Sim (aba Propostas) |
| Ela visualizou? | Parcial — só sabe SE visualizou uma vez, nunca quantas vezes nem quando foi a última (§16) |
| Aceitou/recusou? | Sim, status da proposta reflete isso |
| Já comprou antes? | Indireto — teria que inferir de negócios com `wonAt` preenchido; não há um resumo "histórico de compras" dedicado |

---

## 9. `Deal` (Negócio) — o que é, hoje

Modelo confirmado: **Contato = quem; Negócio = o que estamos tentando vender pra ele.** Exemplo do usuário ("Negócio = Venda do Plano Pro para João") bate exatamente com o modelo real: `Deal.title` é texto livre, `Deal.contactId` aponta pro Contact — não há nada que force um título estruturado, é só uma etiqueta livre descrevendo a oportunidade.

## 10. `Deal` — schema completo

Tabela `deals` (migration `0095`, nunca alterada depois): `id, tenant_id, workspace_id, pipeline_id (not null), stage_id (not null, on delete restrict), contact_id (opcional, on delete set null), title, value_cents, currency, owner_user_id, team_id, origin, loss_reason, won_at, lost_at, expected_close_date, created_at, updated_at, last_stage_changed_at`.

`contactId` é opcional por design — "um negócio pode nascer sem contato ligado ainda" (comentário da própria migration). Confirmado também na UI: `SearchableCombo` de contato no formulário de criação tem opção explícita "Sem contato".

## 11. Pipeline e Stage

Tabela `pipelines`: `id, tenant_id, workspace_id, name, is_default (bool), created_at, updated_at` — índice único parcial garante no máximo 1 pipeline padrão por workspace. Tabela `pipeline_stages`: `id, pipeline_id, name, position, is_won (bool), is_lost (bool), created_at`, `unique(pipeline_id, position)`.

**Pipeline padrão**: criado sob demanda (lazy), nunca semeado por migration — `ensureDefaultPipeline` (`pipeline-use-cases.ts:29-48`), chamado no primeiro `listPipelines`. 6 etapas fixas em português: Novo, Contato Feito, Proposta Enviada, Negociação, Ganho (`isWon`), Perdido (`isLost`).

**Mover negócio / Ganho / Perdido / motivo / reabertura**: tudo passa por **uma única função**, `moveDealStage` (`deal-use-cases.ts:72-105`). Não existem `winDeal`/`loseDeal`/`reopenDeal` separados:
- mover pra etapa `isWon` → seta `wonAt = now`, limpa `lostAt`/`lossReason`, automaticamente.
- mover pra etapa `isLost` → seta `lostAt = now`, **exige `lossReason` obrigatório** (lança `DEAL_LOSS_REASON_REQUIRED` se ausente).
- mover pra qualquer etapa aberta comum → limpa `wonAt`/`lostAt`/`lossReason` — "reabrir" é exatamente isso, sem função dedicada.

## 12. Negócio e Conversa — sem FK direta

**Confirmado: NÃO existe nenhuma coluna/FK direta entre `deals` e `inbox_conversations`, em nenhuma direção.** O vínculo é indireto, em 2 saltos, resolvido inteiramente no frontend:

```
InboxConversation.crmContactId  (campo de LEITURA, JOIN denormalizado: inbox_contacts.contact_id)
        ↓ (mesmo valor)
Deal.contactId  (FK real: contacts.id)
```

`web/app/workspaces/[workspaceId]/deals/page.tsx:95-101` monta um `Map<crmContactId, conversation>` em memória e casa com `deal.contactId` na hora de renderizar cada card — não é uma query de banco, é um `find`/`Map` sobre listas já carregadas (`useDeals` + `useInboxConversations`).

**Se a pessoa tem 3 negócios diferentes**: cada um aparece como card separado no Kanban de Negócios; na Contact 360, a aba "Negócios" lista os 3 numa lista simples clicável (sem seletor, sem destaque de "principal", §7).

## 13. Negócio automático ou humano

Não existe **criação automática** de negócio em nenhum lugar — nem por IA, nem por automação de regras. Confirmado: o vocabulário fechado de sugestões da IA (`COMMERCIAL_SUGGESTION_ACTIONS`) tem `follow_up_task | reach_out | review_deal_stage | send_proposal | none` — **`create_deal` não existe nesse vocabulário**. A IA nunca sugere "criar negócio", só ações sobre negócios/contatos já existentes.

O que existe:
- **Botão "Criar negócio"**: sim, em Conversas (inline, real) e em Contatos/dentro do card do contato (navega, §7).
- **Sugestão de IA (Copiloto Comercial)**: sim — gera sugestões com `evidence`/`rationale`/`confidence`, mas **sempre exige aceite humano explícito** antes de qualquer efeito (`acceptCommercialSuggestion`, comentário no código: "Aceitar É a autorização humana exigida pela auditoria"). Mesmo aceitando, só `follow_up_task`/`reach_out` criam uma tarefa automaticamente — `review_deal_stage`/`send_proposal` só marcam a sugestão como aceita, sem executar nada (exigem julgamento humano de qual etapa/proposta).
- **Lead score**: determinístico (nunca IA), calculado sob demanda, nunca persistido (§20).
- **Regras de automação**: rodam de fato sozinhas (sem humano no loop) quando ativas, mas com escopo fechado e uma trava explícita: **nunca movem um negócio pra etapa de perda automaticamente** (exige motivo humano, sempre).

---

## 14. `Task` (Tarefa) — o que é, hoje

Modelo confirmado: **"o que precisamos fazer em seguida"** — bate com o exemplo do usuário (ligar amanhã, mandar proposta, follow-up, cobrar retorno, agendar demonstração) via o enum de tipo: `ligacao | whatsapp | reuniao | enviar_proposta | follow_up | personalizada`.

Tabela `tasks` (migration `0096`, nunca alterada): `id, tenant_id, workspace_id, contact_id (opcional), deal_id (opcional), type, title, description, due_at, status ('pending'|'done'|'cancelled'), owner_user_id, team_id, completed_at, created_at, updated_at`. Comentário da própria migration: "uma tarefa solta (sem contato/negócio) também é válida."

## 15. Tarefas — vínculos

| Vínculo | Existe? |
|---|---|
| Contact | Sim (`contact_id`) |
| Deal | Sim (`deal_id`) |
| Proposal | **Não** — nenhuma coluna, nenhum campo |
| Conversation | **Não** — nenhuma coluna, nenhum campo |

Criação de tarefa a partir de uma conversa: **não existe** — nenhuma UI de "criar tarefa" dentro de `inbox-tab.tsx`. O único caminho de vínculo automático é via query string `?contactId=`/`?dealId=`, usada a partir de Contatos/Negócios — nunca do Inbox.

**Wait — atualizado por outro achado**: o relatório de Conversas (§2.9) confirma que "+ Tarefa" **existe sim** dentro de `crm-panel.tsx`, real, com `contactId` pré-preenchido. A ausência confirmada pelo agente de Tarefas é especificamente dentro de `inbox-tab.tsx` fora do painel CRM — ou seja, a criação de tarefa a partir da conversa **existe, mas só depois que a conversa já está vinculada ao CRM** (mesma dependência de §2.9).

## 16. Follow-up

**Não é uma entidade distinta** — é só um valor do enum `type` (`follow_up`), tratado como uma tarefa comum. Sem SLA, sem contador de adiamentos, sem due-date semântica diferenciada. É o tipo padrão pré-selecionado no formulário de criação.

**Surfacing de atraso**: existe em UM único lugar — um KPI tile no Home do workspace ("Tarefas atrasadas", contagem client-side de `dueAt < now` sobre tarefas `pending`). Não existe nenhum `sourceType` de notificação para tarefa atrasada (a tabela `notifications` — migration `0126` — suportaria isso estruturalmente, mas o único `sourceType` realmente usado hoje é `inbox_conversation_assigned`). O `VorixIntelligencePanel` (Home) também mostra até 3 tarefas atrasadas com ação "Concluir" — é o segundo (e último) lugar onde atraso aparece.

Fluxo ideal do usuário ("vou pensar" → agendar follow-up → aparece atrasado no Home/Contato/Negócio):
- "Agendar follow-up" a partir da conversa: **não existe** hoje (só via deep-link de Contato/Negócio).
- "Follow-up atrasado" no Home: **existe**, como KPI + item no VorixIntelligencePanel.
- "Tarefa pendente" no Contato: **existe** (aba Tarefas).
- "Próxima atividade" no Negócio: **existe** — cada card de negócio no Kanban já mostra `nextPendingTask` (tipo + título + data, ou "Sem próxima atividade").

---

## 17. `Proposal` — o que é, hoje

Modelo confirmado: **"o que estamos oferecendo formalmente"**. Estados reais, via CHECK constraint E replicados no domínio TS: `draft, sent, viewed, accepted, rejected, expired` — os 6 exatamente como o usuário esperava.

## 18. Proposta — modelo de campos

Tabela `proposals` (migration `0098`, nunca alterada): `id, tenant_id, workspace_id, deal_id (opcional), contact_id (opcional), title, items (jsonb), discount_cents, total_cents, currency, valid_until (date), conditions (text livre), status, public_token_hash (unique — nunca o token cru), sent_at, viewed_at, responded_at, created_at, updated_at`.

Não existe tabela separada de line-items — `items` é uma coluna jsonb única. Não existe estrutura de blocos/rich-content — é itens de linha + um único campo de texto livre (`conditions`). Não existe campo de "introdução"/"termos"/"escopo" separados.

**Produtos/Serviços**: tabela `products` (migration `0097`, deliberadamente sem estoque): `id, tenant_id, workspace_id, name, description, price_cents, currency, active, created_at, updated_at`.

## 19. Snapshot — confirmado e por que importa

**Confirmado: é snapshot puro, nunca referência viva.** Comentário da própria migration: "`items` congela nome/preço no momento (nunca uma referência viva a `products`, que pode mudar de preço depois)". Cada `ProposalItem` (`{productId?, name, quantity, unitPriceCents, subtotalCents}`) copia `name`/`unitPriceCents` do produto no instante do clique — depois disso é editável independentemente e nunca mais é recalculado a partir de `products`.

Por que importa: se o preço de um produto mudar amanhã, todas as propostas JÁ ENVIADAS continuam mostrando o preço de quando foram criadas — essencial pra uma proposta comercial ser um "congelamento" confiável do que foi oferecido, não um documento que muda sozinho.

---

## 15-bis. Link público — fluxo completo (numeração do pedido original, seção "Link público")

Rota: `web/app/p/[token]/page.tsx` (client, sem sessão) + backend `src/interfaces/api/routes/v1/public-proposals.route.ts` (comentário explícito: "o próprio token da URL é a autenticação", sem `requirePermission`/`requirePrincipal`).

**Segurança do token**: `randomBytes(32).hex()` (256 bits) — só o **hash SHA-256** é persistido (`public_token_hash`), nunca o token cru. O token cru só existe uma vez, no retorno da criação (`{proposal, rawToken}`), exibido num modal com aviso explícito de que não é recuperável depois. Confirmado como abordagem correta de segurança.

**Expiração**: checada sob demanda (não há job agendado) — na leitura pública (`getPublicProposal`), se `validUntil` já passou e o status não é terminal, transiciona pra `expired` na hora.

**Revogar/regenerar**: **não existe.** Busca exaustiva por "revoke"/"regenerat" não encontrou nada ligado a propostas. `UpdateProposalInput` exclui explicitamente `publicTokenHash` do que pode ser atualizado. **Gap real**: um link vazado ou perdido não pode ser invalidado nem substituído.

**Reenviar**: `POST /proposals/:id/send` (`sendProposal`) só muda `status` de `draft`→`sent` e grava `sentAt` — **não envia nada de fato** (nem e-mail, nem WhatsApp), não gera novo token, e só funciona a partir de `draft` (não pode ser chamado de novo numa proposta já enviada). **Gap real**: se o operador perder o link antes de mandar pro cliente, a proposta fica presa — sem reenviar nem regenerar.

---

## 20. Visualização — tracking

**Existe, mas é binário e de disparo único.** `viewed_at` é uma única coluna timestamp, não uma tabela de log. Escrito em `getPublicProposal`, só na transição `sent`→`viewed`:

```ts
// proposal-use-cases.ts:148-160 (paráfrase fiel do código real)
if (proposal.status === "sent") {
  setStatus(proposal.id, { status: "viewed", viewedAt: now });
  timelineEventRepository.record({ eventType: "proposal_viewed", actorType: "system", ... });
  return viewed;
}
return proposal; // visitas seguintes não atualizam nada
```

**Não existe**: contagem de quantas vezes foi aberta, "primeira visualização" separada de "última visualização", histórico de visitas. Depois da primeira transição pra `viewed`, qualquer nova abertura do link não gera nenhum registro adicional.

**Documentado como gap** (pedido explícito do usuário, seção 20-21 do prompt original): se o requisito de produto for "saber quantas vezes o cliente abriu" ou "ver a última visualização", isso **não existe hoje** e precisaria de uma tabela de eventos por visita (`proposal_views`) — não uma mudança na coluna única atual.

## 21. Status "Visualizada" — o modelo já suporta a jornada pedida

```
Rascunho (draft) → Enviada (sent) → Visualizada (viewed) → Aceita (accepted)
                                                          → Recusada (rejected)
                                  → Expirada (expired, a qualquer momento antes de uma resposta)
```

Essa é exatamente a jornada que o CHECK constraint + as transições em `proposal-use-cases.ts` já implementam — sem necessidade de mudança de modelo pra essa parte. A limitação está só na granularidade da visualização (§20), não na existência dos estados em si.

## 22. Aceite

**Confirmado: SIM, os dois acontecem** — mas por **duas chamadas separadas, não uma única transação/função**:
1. `respondToPublicProposal(..., "accepted")` → `proposals.status = "accepted"`, grava evento `proposal_accepted`.
2. De volta na ROTA (não dentro do use case de aceite), `applyProposalAcceptanceToDeal(deps, proposal)` é chamado explicitamente em seguida (`public-proposals.route.ts:43`) → se houver `dealId` e uma etapa `isWon` no pipeline do negócio (e ele ainda não estiver nela), move o negócio pra lá, com `actorType: "system"`, `trigger: "proposal_accepted"`.

Risco documentado: se alguém chamar `acceptPublicProposal` fora dessa rota HTTP específica (script, teste, futuro endpoint), o negócio **não seria movido** — as duas ações estão desacopladas por decisão de design, não por acidente, mas isso é uma armadilha de acoplamento implícito que vale documentar.

## 23. Recusa

**Confirmado: assimétrico em relação ao aceite.** `rejectPublicProposal` só faz `proposals.status = "rejected"` + `respondedAt`. **Não existe** campo de motivo de recusa em nenhum nível (schema, use case, rota, UI). **O negócio NÃO é tocado de forma alguma** — nenhuma função equivalente a `applyProposalAcceptanceToDeal` existe para rejeição; o negócio permanece exatamente onde estava. Só a automação (se configurada com trigger `proposal_rejected`) pode reagir — mas isso é regra opcional de automação genérica, não comportamento padrão do sistema.

---

## 24. Modelos de Proposta — situação atual

**Busca exaustiva, conclusão definitiva: não existe absolutamente nenhum conceito de template/modelo reutilizável de proposta hoje** — nem tabela, nem tipo TS, nem endpoint, nem função de duplicar/clonar proposta. O único "reaproveitamento" parcial é o catálogo de `Products`, usado só para preencher linha-item (nome+preço) — não é um template de proposta inteira (sem título/condições/múltiplos itens pré-configurados).

## 25. Template de Proposta — conceito (ANÁLISE, não decisão de arquitetura)

Ver recomendação detalhada em §26.

## 26. Blocos do Template (ANÁLISE)

Ver recomendação em §26 abaixo — pedido explícito do usuário para não implementar, só avaliar.

---

## 26. Recomendação — Proposal Templates (análise, não implementação)

O usuário propôs uma estrutura `ProposalTemplate` com campos ricos (logo, cores, blocos, cabeçalho, assinatura). A auditoria mostra que hoje **nenhuma dessas peças existe** — nem editor de blocos, nem branding por workspace, nem rich text. Recomendação, em duas fases:

**Fase recomendada 1 (baixo risco, reaproveita 100% do modelo atual)**: um `ProposalTemplate` **espelhando exatamente** o shape que `Proposal` já tem hoje — `{id, tenant_id, workspace_id, name, default_title_pattern, default_items (mesmo shape de ProposalItem, sem productId obrigatório), default_conditions, default_valid_days}`. Ao criar uma proposta, escolher um template pré-preenche EXATAMENTE os mesmos campos que o formulário de criação já expõe hoje — nenhuma nova tela de renderização, nenhum motor de blocos. Isso resolve o caso de uso central do pedido (seção 27 do prompt original: "Conversa com João → Criar proposta → selecionar template → dados já preenchidos → adicionar produtos → revisar → enviar") sem inventar infraestrutura nova.

**Fase 2, especulativa, só se a Fase 1 provar valor**: editor de blocos + branding visual (logo/cores por workspace). Recomendo **não** começar por aqui — hoje não existe nenhuma base (sem editor rich-text no stack, sem armazenamento de branding por workspace identificado nesta auditoria) e é um salto de complexidade grande sem validação prévia de que o modelo simples (Fase 1) é insuficiente.

Recomendo explicitamente **contra** assumir de antemão que a arquitetura de blocos é "a certa" — o pedido do usuário já reconhece essa incerteza ("mas NÃO assumir que essa é a arquitetura certa. Quero recomendação"), e a auditoria não encontrou nenhum precedente no código que justifique pular direto pra blocos.

---

## 27. Recomendação — Envio de proposta pelo WhatsApp (análise, não implementação)

Viabilidade: **alta, com risco baixo**, porque a peça que falta é pequena e o resto já existe:
- O envio de mensagem de texto pelo WhatsApp já existe e está em uso — é o mesmo `sendInboxMessage` que o composer de Conversas já chama.
- `crm-panel.tsx` já roda DENTRO da tela de Conversas, com `conversationId`/`contactId` em escopo — é o lugar natural pra adicionar um botão "Enviar no WhatsApp" ao lado do link público já gerado no modal de "Proposta criada".
- Hoje esse modal só oferece copiar o link manualmente (`navigator.clipboard.writeText`) — o operador cola no WhatsApp por fora, sem nenhum rastro no sistema desse envio específico.

Recomendação: um botão que chama o MESMO `sendInboxMessage(workspaceId, conversationId, texto_com_o_link)` já usado pelo composer — **nunca** um segundo sistema de envio. Ponto em aberto pra decisão futura (não técnica): se esse botão também deveria chamar `sendProposal` (mudar status pra "sent") na mesma ação, ou deixar como passos deliberadamente separados — como os dois fluxos hoje são independentes, é uma decisão de produto, não uma limitação técnica.

---

## 19-bis. Timeline única — auditoria (numeração da seção 33 do pedido original)

Schema `timeline_events` (migration `0093`) É genuinamente genérico: `entity_type CHECK IN ('contact','deal','conversation','proposal','task')`, `entity_id`, `event_type`, `actor_type`, `payload jsonb`, `occurred_at`. Comentário da própria migration: desenhado pra que as 5 entidades "convergirem na MESMA timeline sem duplicar o payload".

**Na prática, hoje:**
- Eventos são gravados para `contact` (`contact_created`, `identity_linked`, `commercial_suggestions_generated`, `commercial_suggestion_accepted`), `deal` (`deal_created`, `deal_stage_changed`), `task` (`task_created`, `task_completed`, `task_cancelled`), `proposal` (`proposal_created`, `proposal_sent`, `proposal_viewed`, `proposal_accepted`/`rejected`).
- **`entity_type = 'conversation'` NUNCA é gravado** — apesar de o CHECK permitir. A Inbox usa seu próprio mecanismo paralelo (`inbox_conversation_events`, §2.8), que nunca escreve em `timeline_events`.
- **Toda leitura é escopada a UMA entidade só**: `WHERE entity_type = $1 AND entity_id = $2` (`postgres-timeline-event-repository.ts:39`) — não existe nenhuma query/endpoint que agregue "todos os eventos (negócio+tarefa+proposta+conversa) de um mesmo contato".
- Resultado: **4 timelines isoladas** (uma por tela — Contato, Negócio, Proposta — mais a 4ª desconexa da Inbox), nunca uma timeline 360°, apesar do schema já suportar isso.

Este é, nas palavras do próprio agente que auditou este ponto, **"a lacuna de maior alavancagem"** encontrada nesta auditoria: a base de dados já foi desenhada corretamente para o objetivo final; falta só a camada de agregação (endpoint + tela), não uma mudança de schema.

---

## 20-bis. IA comercial (numeração da seção 20/12 do pedido original)

| Mecanismo | O que faz | Requer humano? |
|---|---|---|
| Copiloto Comercial (`commercial-copilot-use-cases.ts`) | Gera sugestões (`follow_up_task \| reach_out \| review_deal_stage \| send_proposal \| none`) com `evidence`/`rationale`/`confidence`, baseado em contexto real do contato (negócios, tarefas atrasadas, dias sem interação) | Sim, sempre — "aceitar é a autorização humana exigida pela auditoria" (comentário do próprio código) |
| Lead Score (`lead-scoring.ts`) | Cálculo determinístico (nunca IA), fatores fixos somados (interação recente, negócios abertos, tarefas atrasadas etc.), 0-100, nunca persistido | N/A — é só leitura |
| Automation Rules (`automation-use-cases.ts`) | 4 gatilhos (`deal_stage_changed \| contact_created \| proposal_accepted \| proposal_rejected`), até 3 condições em AND, 1 ação (`create_task \| add_tag \| assign_owner \| assign_owner_least_loaded_in_team \| move_deal_stage`) | **Não** — roda sozinha quando ativa, mas nunca pode mover um negócio pra etapa de perda automaticamente (trava explícita no código) |
| VorixIntelligencePanel (Home) | Widget que reexpõe sugestões pendentes + tarefas atrasadas + "negócios sem próxima atividade" | Sim — toda ação no painel exige clique humano antes de qualquer chamada de API |

Nenhum desses mecanismos cria um `Deal` sozinho — `create_deal` não existe no vocabulário de nenhum dos dois sistemas (sugestão de IA nem automação de regras).

## 21-bis. Automações — UI

Backend completo (CRUD de regras + logs de execução) existe e é exposto via API. **Existe também UI de configuração** — `web/app/workspaces/[workspaceId]/settings/automations/page.tsx` (criar/editar/ativar/desativar/excluir regras, ver logs).

---

## 22-bis. Relações entre entidades — diagrama real (baseado 100% no código/schema encontrado)

```
Contact (contacts)
 ├─ ContactIdentity (contact_identities.contact_id)         — N, unique(channel, external_id)
 ├─ Deal (deals.contact_id, opcional)                       — N
 │   ├─ Task (tasks.deal_id, opcional)                      — N
 │   └─ Proposal (proposals.deal_id, opcional)               — N
 ├─ Task (tasks.contact_id, opcional, INDEPENDENTE de Deal) — N
 ├─ Proposal (proposals.contact_id, opcional, INDEPENDENTE) — N
 └─ TimelineEvent (entity_type='contact', entity_id=Contact.id) — N, nunca agregado com os de baixo

InboxContact (inbox_contacts)                      ── mundo ISOLADO do CRM ──
 ├─ contact_id → Contact (OPCIONAL, nunca automático, só manual)
 └─ InboxConversation (inbox_conversations.contact_id → InboxContact.id)
      ├─ crmContactId (campo de LEITURA, JOIN: InboxContact.contact_id — NÃO é coluna própria)
      └─ InboxConversationEvent (mecanismo PRÓPRIO, paralelo a TimelineEvent, nunca convergem)

Deal ⇢ InboxConversation:  SEM FK direta — resolvido em memória no frontend via contactId === crmContactId
Task ⇢ InboxConversation:  SEM NENHUM vínculo
Proposal ⇢ InboxConversation: SEM NENHUM vínculo
```

## 23-bis. Cardinalidades

| Relação | Cardinalidade |
|---|---|
| Contact → ContactIdentity | 1 → N (tipicamente 1 por canal, mas nada impede mais de um `external_id` no mesmo canal) |
| Contact → Deal | 1 → N (`contactId` opcional em Deal) |
| Contact → Task | 1 → N (direto) + indireto via cada Deal |
| Contact → Proposal | 1 → N (direto) + indireto via cada Deal |
| Deal → Proposal | 1 → N (`dealId` opcional em Proposal) |
| Deal → Task | 1 → N (`dealId` opcional em Task) |
| Proposal → Deal | **opcional**, nunca obrigatório (`deal_id` nullable) |
| Proposal → Contact | **opcional**, nunca obrigatório (`contact_id` nullable) |
| InboxContact → Contact | 0 ou 1 (FK opcional, nunca preenchida automaticamente) |
| InboxContact → InboxConversation | 1 → N (na prática, tipicamente 1 por conexão/canal) |

---

## 24-bis. Gap Analysis

| Capacidade | Existe | Parcial | Não existe | Backend | Frontend | Observação |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Auto-criação de Contact | | | ✔ | Não | N/A | Vínculo manual ("Vincular ao CRM") funciona bem, mas nunca automático |
| Contact 360 | | ✔ | | Sim | Sim | Funciona, mas 4/6 abas ignoram filtros por `contactId` já disponíveis na API |
| Criar Deal da conversa | ✔ | | | Sim | Sim | Real, inline, pré-preenchido — só depende do vínculo CRM já ter sido feito |
| Tarefas (CRUD geral) | ✔ | | | Sim | Sim | Completa, com views Hoje/Atrasadas/Próximas/Concluídas |
| Follow-up (como conceito dedicado) | | ✔ | | Parcial | Parcial | É só um `type` de tarefa, sem SLA/contador |
| Proposal (ciclo de vida) | ✔ | | | Sim | Sim | Estados reais e completos |
| Public proposal (link) | ✔ | | | Sim | Sim | Token-hash seguro, expiração sob demanda |
| Proposal viewed (tracking) | | ✔ | | Parcial | Parcial | Só 1ª visualização; sem contagem/última visita |
| Proposal accepted | ✔ | | | Sim | Sim | Já move o Deal pra "Ganho" automaticamente |
| Proposal refused | | ✔ | | Parcial | Não | Sem motivo, sem efeito no Deal |
| Proposal template | | | ✔ | Não | Não | Zero, em qualquer grau |
| Proposal blocks | | | ✔ | Não | Não | Modelo é flat (itens + texto livre) |
| Send via WhatsApp (proposta) | | | ✔ | Não | Não | "Enviar" só muda status; link é copiado manualmente |
| Proposal card na conversa | | | ✔ | Não | Não | Nenhum system-card/evento aparece de volta no chat |
| Timeline (unificada) | | ✔ | | Parcial* | Não | *Schema pronto, mas Inbox não escreve nele e leitura nunca agrega |
| CRM contextual (ações cruzadas) | | ✔ | | Sim | Parcial | Forte em Conversas; fraco/navegação-só em Contatos/Negócios; ausente em Propostas e no Kanban de Atendimento |
| Conversion (funil completo) | | | ✔ | Não | Não | KPIs isolados existem (Home, VorixIntelligencePanel); nenhuma visão de funil ponta-a-ponta |

---

## 25-bis. Problemas de UX — por que hoje ninguém entende os módulos

Baseado inteiramente na auditoria acima, não em suposição:

1. **Navegação separada sem narrativa comum**: Conversas, Contatos, Negócios, Tarefas, Propostas são 5 rotas de topo, sem nenhum elemento visual/estrutural que diga "isto é uma operação só".
2. **Profundidade de integração muito desigual entre telas**: dentro de Conversas, criar negócio/tarefa/proposta é inline e real (§2.9) — mas a partir de Contatos ou Negócios, os mesmos botões só navegam e pedem confirmação de novo (§7, achado do agente de contextual actions). Isso ensina o usuário, sem querer, que "Conversas é especial" e o resto é mais burocrático.
3. **Entidades relacionadas nunca aparecem juntas de verdade**: não existe timeline 360° (§19-bis) — abrir um contato mostra 4 listas separadas, cada uma buscando o workspace inteiro e filtrando (§7), em vez de uma narrativa cronológica única.
4. **Contact não nasce da conversa**: provavelmente a maior fonte de confusão. Duas entidades chamadas "contato" (InboxContact vs Contact) que o usuário nunca vê como distintas, mas que se comportam de forma completamente diferente — uma sempre existe, a outra só existe depois de um clique manual e pouco visível.
5. **Deal parece abstrato**: nada sugere "crie um negócio aqui" de forma proativa (a IA nunca sugere isso, §13) — só aparece como botão discreto depois que o contato já foi vinculado ao CRM.
6. **Proposal parece isolado de verdade**: confirmado no código — o card/modal de proposta mostra nome do contato/negócio como **texto estático**, sem nenhum link de volta (`router.push`) pra essas telas. E nada volta pra dentro da conversa depois de enviada (§24-bis).
7. **"Abrir contato completo" é literalmente um link morto** (§2.9) — o único ponto que deveria fechar o ciclo "estou na conversa, quero ver o histórico completo dessa pessoa" não funciona.

---

## 26-bis / 27-bis — ver seções 26 e 27 acima (Proposal Templates e envio via WhatsApp)

---

## 28. Jornada ideal sugerida — Novo Lead

```
WhatsApp chega (número novo)
  → InboxContact criado automaticamente (já acontece hoje)
  → InboxConversation aberta (já acontece hoje)
  → [GAP] pessoa não vira Contact automaticamente — ver §6, Opção C
  → atendente conversa, qualifica
  → [PARCIAL] Vorix já destaca "oportunidade encontrada" com 3+ mensagens (já existe)
  → humano clica "Vincular ao CRM" (já existe, real)
  → humano cria Deal (já existe, inline, real)
  → Vorix sugere próxima ação via Copiloto Comercial (já existe — segue, siga, revise etapa, mande proposta)
  → humano aceita sugestão → tarefa criada (já existe, condicional ao tipo de sugestão)
  → humano cria Proposta com template (template = GAP, §26)
  → humano envia via WhatsApp (envio automático = GAP, §27 — hoje é copiar/colar manual)
  → [GAP] nenhum card volta pra dentro da conversa (§24-bis)
  → cliente visualiza (rastreado uma vez, §20)
  → cliente aceita → Deal já vira "Ganho" automaticamente (já existe, real, §22)
  → [GAP] nada disso aparece de volta na timeline do contato de forma unificada (§19-bis)
```

## 29. Jornada ideal sugerida — Cliente existente

```
Nova mensagem chega
  → resolvida por telefone/identity (InboxContact.upsertByPhone, já existe)
  → SE já foi vinculada ao CRM antes: reusa o MESMO Contact automaticamente (contact_identities.unique(channel,external_id) já garante isso — já funciona)
  → histórico completo? [PARCIAL] — existe, mas fragmentado em 4 listas isoladas em vez de 1 timeline (§19-bis, §25-bis)
  → pode abrir negócio novo OU existente — [PARCIAL] já é possível (aba Negócios do contato lista todos), mas sem indicação de qual é "o negócio ativo" quando há mais de um
```

---

## 30. Distinguir Contato e Negócio — validação da definição do usuário

A definição simples proposta pelo usuário bate EXATAMENTE com o que o código/comentários confirmam:

| Termo | Definição do usuário | Validado no código? |
|---|---|---|
| Contato | "quem é o cliente" | Sim — `Contact` não carrega nenhum dado comercial (sem valor, sem etapa); é puramente identidade |
| Negócio | "o que estamos tentando vender pra ele" | Sim — `Deal.title` é livre, `contactId` opcional (existe sem contato definido ainda) |
| Tarefa | "o que precisamos fazer em seguida" | Sim — enum de tipo (ligação, follow-up, enviar proposta...) confirma a intenção de "próxima ação" |
| Proposta | "o que estamos oferecendo formalmente" | Sim — snapshot congelado + ciclo de vida formal (draft→sent→...→accepted/rejected) |
| Conversa | "onde estamos falando com ele" | Sim — deliberadamente isolada do resto, só o canal de comunicação |

Essa definição pode virar copy de produto sem qualquer ajuste — já reflete o domínio real.

---

## 31. Prioridades — P0 a P3 (valor pra operação comercial, não facilidade)

### P0 — resolve a sensação de "5 sistemas separados" diretamente
1. **Corrigir "Abrir contato completo"** (link morto, §2.9) — trivial tecnicamente, mas é o único ponto que quebra a confiança no vínculo Conversa↔Contato.
2. **Card de proposta dentro da conversa** (enviada/visualizada/aceita, §24-bis) — é o que fecha visualmente o ciclo "mandei uma proposta e continuo acompanhando sem trocar de tela".
3. **Enviar proposta pelo WhatsApp reusando o pipeline existente** (§27) — pequeno, mas destrava o passo "envio" da jornada inteira sem inventar nada novo.
4. **Repensar a auto-criação de Contact** (Opção C, §6) — é o item que mais frequentemente causa a pergunta "pra que serve Contatos" em primeiro lugar.

### P1 — consolidam a integridade dos dados e da narrativa
5. **Recusa de proposta simétrica ao aceite** (motivo + decisão sobre o Deal, §23).
6. **Tracking de visualização real** (contagem + última visita, não só a primeira, §20).
7. **Endpoint agregador de timeline por contato** (a base já existe, §19-bis — maior alavancagem técnica encontrada).
8. **Contact 360 usando os filtros por `contactId` que a API já suporta** (performance/correção, não feature nova, §7).
9. **Revogar/regenerar link de proposta** (gap de segurança operacional, §15-bis).

### P2 — completam a experiência, exigem mais decisão de produto
10. **Templates de proposta**, modelo simples (Fase 1 de §26).
11. **Criar tarefa direto da conversa**, sem depender do vínculo CRM prévio (§2.9/§15).
12. **Paginação + `ListCard`/`StatsGrid` na lista de Contatos** (conformidade com design system, §7).
13. **Ações de CRM no Kanban de Atendimento**, hoje ausentes (§24-bis).
14. **UI de configuração de pipeline/stage** (backend já existe, sem tela, §11).

### P3 — especulativo, precisa validação antes de investir
15. **Editor de blocos + branding de proposta** (Fase 2 de §26 — só depois que templates simples provarem valor).
16. **Widgets de funil/conversão no Home** (depende do item 7/P1 existir primeiro).
17. **IA sugerindo criação de negócio** — hoje deliberadamente fora do vocabulário; exige cautela pra não repetir o risco de ruído já evitado em outros pontos do sistema.

---

## 32. Arquitetura recomendada (visão geral)

- **Manter o isolamento CRM↔Inbox como está** — é uma decisão deliberada, bem documentada, com CI garantindo que não se degrade (`check-crm-isolation.mjs`). Não há indício de que fundir os dois mundos resolveria algo que uma UX melhor sobre a ponte existente não resolva.
- **A ponte oficial (`contact_identities`/`inbox_contacts.contact_id`) já é a certa** — o trabalho que falta é de UX/orquestração em cima dela (deixá-la mais automática/visível), não de schema.
- **Timeline unificada = camada de leitura nova, não mudança de schema** — o `timeline_events` já é genérico o bastante; falta só um endpoint agregador (`GET /contacts/:id/activity` cruzando `timeline_events` de contact+deal+task+proposal, e — separadamente, já que a Inbox nunca escreve ali — trazendo `inbox_conversation_events` da conversa vinculada) e uma tela que consuma isso.
- **Envio de proposta por WhatsApp = orquestração fina sobre dois pipelines já existentes** (mensageria + token público), nunca um sistema novo.
- **Templates de proposta = extensão do modelo atual**, não substituição — reaproveitar o shape de `Proposal`/`ProposalItem` já validado em produção antes de considerar blocos/rich content.

---

## Arquivos e módulos citados nesta auditoria (não exaustivo — ver os relatórios brutos de cada frente para citações linha a linha completas)

- `db/migrations/0081`–`0129` (Inbox: 0081-0082, 0115-0129; CRM: 0091-0110, 0113)
- `src/domain/inbox/inbox.model.ts`, `src/domain/crm/crm.model.ts`
- `src/application/inbox/inbox-use-cases.ts`
- `src/application/crm/{contact,deal,task,proposal,pipeline,product,lead-scoring,lead-scoring-use-cases,automation,commercial-copilot,commercial-metrics}-use-cases.ts`
- `src/infrastructure/storage/postgres/postgres-{inbox-contact,inbox-conversation,proposal,timeline-event}-repository.ts`, `inbox-identity-reconciliation.ts`
- `src/interfaces/api/routes/v1/{contacts,public-proposals,proposals,pipelines}.route.ts`
- `scripts/check-crm-isolation.mjs`
- `web/app/workspaces/[workspaceId]/{contacts,deals,tasks,proposals,kanban}/page.tsx` (+ `kanban-board.tsx`, `DealDetailModal.tsx`)
- `web/app/workspaces/[workspaceId]/conversas/{inbox-tab,crm-panel}.tsx`
- `web/app/workspaces/[workspaceId]/{page.tsx (Home), vorix-intelligence-panel.tsx, settings/automations/page.tsx}`
- `web/app/p/[token]/page.tsx`, `web/features/crm/{hooks,api,public-proposal-api,presentation}.ts`
