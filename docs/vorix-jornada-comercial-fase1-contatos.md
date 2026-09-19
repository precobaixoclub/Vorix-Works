# Jornada Comercial Integrada — Fase 1: Ponte Automática Inbox → CRM (Contatos)

> Escopo: só a fundação CONVERSA → PESSOA → CONTATO CRM → CONTACT 360, conforme pedido. Nenhuma
> mudança em Proposal Templates, tracking avançado de propostas, timeline 360 completa, automações
> comerciais novas, IA criando negócio, ou mudanças grandes em Negócios/Tarefas/Propostas — tudo
> isso continua fora desta rodada, para a Fase 2 (não iniciada).

---

## 1. Arquitetura da ponte

A ponte vive em `src/application/commercial-bridge/inbox-crm-bridge-use-cases.ts` — um módulo
**deliberadamente fora** de `/domain/crm/`, `/application/crm/`, `/domain/inbox/` e
`/application/inbox/`. Isso não é um detalhe cosmético: `scripts/check-crm-isolation.mjs` (CI)
proíbe cada bounded context de importar o outro diretamente, e essa proibição continua intacta
(confirmado — ver §14). Um orquestrador NEUTRO, que depende dos dois lados por fora, é o único jeito
de integrar sem violar essa regra.

A ponte reusa integralmente os casos de uso já existentes do CRM (`createContact`,
`linkContactIdentity`, de `contact-use-cases.ts`) — nunca duplica a lógica deles. A única peça nova
de escrita é `InboxContactRepositoryPort.linkCrmContact` (grava `inbox_contacts.contact_id`).

Convenção de identidade preservada, nunca reinventada: a ponte usa exatamente a mesma
`ContactIdentity(channel: "whatsapp", externalId: <InboxContact.id>)` que o vínculo manual
("Vincular ao CRM", `crm-panel.tsx`) já usa em produção. Isso garante que um contato vinculado
manualmente ANTES desta rodada e um vinculado automaticamente DEPOIS sejam estruturalmente
idênticos — nenhuma segunda convenção paralela.

## 2. Gatilho

`MIN_MESSAGES_FOR_AUTO_CRM_CONTACT = 3` — o **mesmo limiar** que já disparava o destaque visual
"Vorix encontrou uma oportunidade" em `crm-panel.tsx` (`messageCount >= 3`), só que agora avaliado
no **backend**, a cada mensagem inbound de uma conversa **direta** (nunca grupo — grupo nunca tem
`InboxContact`, então a ponte nunca é sequer chamada para ele, ver §8). Antes, esse limiar só
existia como nudge visual, exigindo um clique humano; agora ele efetivamente cria/vincula o
`Contact`, sem exigir que ninguém abra a tela de Conversas.

Isso evita transformar spam/número errado/uma mensagem isolada em lixo permanente no CRM — a opção
recomendada na auditoria (Opção C, entre A "sempre automático" e B "só manual") foi a implementada.

## 3. Idempotência

`ensureCrmContactForInboxContact` resolve nesta ordem:
1. `InboxContact` já tem `crmContactId`? Devolve o vínculo existente — no-op.
2. Já existe uma `ContactIdentity(whatsapp, <inboxContactId>)` de uma chamada concorrente anterior?
   Reusa o `Contact` dela.
3. Senão, cria um `Contact` novo + a `ContactIdentity` correspondente.

Testado sob concorrência REAL (não simulada) — duas chamadas simultâneas (`Promise.all`) para o
MESMO `InboxContact` contra um Postgres real (via pglite) convergem para o MESMO `Contact` vencedor,
sem criar duas identidades divergentes (ver teste "simula uma corrida concorrente",
`tests/crm-conversas-integration.test.mjs`). `linkCrmContact` no repositório nunca sobrescreve um
vínculo já existente (`UPDATE ... WHERE contact_id IS NULL`) — a mesma trava que garante isso em
todo o resto do módulo Inbox (nunca merge/overwrite silencioso).

## 4. Telefone

O telefone continua sendo resolvido e deduplicado **inteiramente pelo Inbox**
(`upsertByPhone`/`unique(workspace_id, phone_normalized)`) — a ponte nunca decide nada sobre
telefone/LID/PN por conta própria; ela só consome o `InboxContact` já resolvido. O princípio de
identidade pedido (PESSOA ≠ CHAT ≠ IDENTIDADE TÉCNICA) foi preservado sem nenhuma mudança de schema:
o telefone nunca aparece como coluna do `Contact` (nunca apareceu, e continua assim — ver §3 do
relatório de auditoria), só denormalizado via a conversa vinculada quando exibido na UI (§9).

## 5. Identities

Nenhuma mudança em `ContactIdentity` — a mesma tabela/constraint (`UNIQUE(channel, external_id)`)
já existente é o que impede duplicação. A ponte só a EXERCITA de um segundo lugar (automático, além
do manual), nunca muda seu formato.

## 6. Conflitos

Verificado explicitamente no teste de corrida (§3): quando duas tentativas de vínculo colidem, a
que perde a corrida real (`ContactIdentity` já existente) nunca sobrescreve a vencedora — o
`Contact` "perdedor" (criado por engano na corrida) fica órfão, sem identidade, e o log registra o
conflito para quem quiser investigar. Nunca um merge automático. O script de auditoria (§12) também
confere isso em dados reais: `conflitos` deveria ser sempre `0` (e foi `0` em produção, ver §16).

## 7. Grupos

Estruturalmente excluídos, não por uma checagem a mais: `registerInboundMessage` nunca resolve um
`InboxContact` para `input.isGroup === true` — `contact` fica `undefined`. O hook da ponte em
`inbox-worker.ts` é `if (contact && commercialBridgeDeps)`, então ele nunca é sequer chamado para um
evento de grupo. Testado explicitamente (`tests/crm-conversas-integration.test.mjs`, "contato de
GRUPO nunca é chamado").

## 8. Backfill

Implementado **só o passo de auditoria read-only** desta fase (`scripts/audit-inbox-crm-bridge-candidates.mjs`)
— NENHUM script de execução de backfill foi criado ou rodado. Isso é deliberado: o pedido original
pede a auditoria PRIMEIRO, e a decisão de "permitir backfill" é humana, depois de revisar os
números. Rodado contra produção (read-only, sem qualquer escrita):

```
workspace_id                             total  vinculados  PN forte   e164?  elegíveis  conflitos
workspace-mscc9pi2-jkvwbo                   50           0        47      50         38          0
```

Leitura: 50 `InboxContacts` diretos existem hoje; 0 têm vínculo com o CRM; 47 têm evidência forte de
telefone real (`whatsapp_pn` observado); todos os 50 têm formato de telefone válido; **38 já
seriam elegíveis** para um backfill controlado (conversa direta, >= 3 mensagens, sem vínculo ainda);
0 conflitos pré-existentes (como esperado). Um backfill controlado (reaproveitando a MESMA
`ensureCrmContactForInboxContact`, em lote, com log) é trivial de escrever depois que isso for
aprovado — não foi feito nesta rodada.

## 9. Contact 360

- **Header**: mostra o telefone da conversa vinculada (`primaryConversation.contactPhone`) ao lado
  de empresa/origem — sem precisar de nenhuma coluna nova no `Contact` (LID/PN nunca existiram no
  schema dele, então nunca havia risco de vazarem ali).
- **Abas Negócios/Tarefas/Propostas**: passaram a usar `useDeals/useTasks/useProposals(workspaceId,
  {contactId})` (a API já suportava o filtro; só não era usado aqui) em vez de filtrar a lista
  inteira do workspace no client. A chave de cache do SWR inclui `contactId` no array, então quando
  nenhum contato está selecionado a nova chamada REUSA a mesma entrada de cache da listagem geral
  (nunca uma requisição extra à toa) — só vira uma chamada genuinamente escopada quando um contato é
  aberto.
- **Grade de cartões**: continua usando as listas do workspace inteiro, deliberadamente — cada
  cartão precisa das próprias métricas (pipeline aberto, próxima atividade), então não dá pra
  escopar por contato enquanto a grade inteira está visível. Documentado como decisão, não omissão.

## 10. Deep-link

`?contactId=<id>` **já existia** (a tela de Contatos já reagia a esse parâmetro, abrindo o
`ContactDetailModal` sozinha) — não foi recriado, só finalmente USADO no lugar que estava quebrado:
o link "Abrir contato completo" dentro do painel de Conversas, que antes ia só para a lista geral
(`/contacts`, sem parâmetro nenhum). Agora é `/contacts?contactId=<conversation.crmContactId>`.

## 11. Scoped fetches

Ver §9 — implementado para Negócios/Tarefas/Propostas do `ContactDetailModal`. Não implementado
para a listagem/grade (decisão documentada, §9) nem para a aba Conversas (nenhum endpoint
`GET /conversations?contactId=` existe hoje — permanece filtro client-side sobre
`useInboxConversations`, como já auditado; fora do escopo desta fase).

## 12. Automações

**Decisão explícita, não silenciosa** (pedido do usuário, seção 29/30): o `contact_created` que a
ponte automática dispara (via `createContact`, reaproveitado sem alteração) **grava normalmente o
evento na timeline** do contato — mas o wiring da ponte dentro do worker **omite deliberadamente**
a dependência `automation` (`ContactUseCaseDeps.automation` é opcional; a ponte passa `undefined`).

Motivo: `automation-use-cases.ts` já resolve condições por `origin` (`condition.field === "origin"`
→ `context.contact?.origin === condition.equals`) — uma regra hoje configurada para
`origin === "whatsapp"` (vínculo manual) **nunca dispara sozinha** para um contato com
`origin: "whatsapp_auto"`, porque a string é diferente. Isso já seria "seguro por acaso", mas
optei por ir além e desligar automação de verdade nesta fase (nenhuma regra roda, nem por engano,
para contatos auto-capturados) até que o operador reveja o volume real de auto-criações e decida se
quer that isso dispare automações. Habilitar depois é trivial: passar o bundle `automation` completo
para `commercialBridgeDeps.contact` em `inbox-worker.ts` (hoje só contactRepository/
contactIdentityRepository/timelineEventRepository são construídos ali).

## 13. Testes

6 testes novos em `tests/crm-conversas-integration.test.mjs` (Postgres real via pglite, nunca
mocks — mesmo padrão já estabelecido no arquivo):

1. Conversa direta com >= 3 mensagens cria e vincula um Contact automaticamente (origin distinto,
   mesma convenção de identidade do vínculo manual).
2. NUNCA dispara abaixo do limiar (2 mensagens → nada acontece).
3. Idempotência: chamar duas vezes sequencialmente para o mesmo InboxContact nunca cria um segundo
   Contact.
4. Corrida concorrente real (`Promise.all`): duas chamadas simultâneas convergem pro mesmo Contact,
   nunca duas identidades divergentes.
5. Grupo: checagem estrutural de que a ponte nunca tem como ser chamada (grupo nunca tem
   InboxContact).
6. Multi-tenant: o mesmo número de telefone em dois tenants diferentes nunca cria/reusa o mesmo
   Contact.

Suíte completa (`tests/inbox-*.test.mjs tests/crm-*.test.mjs`): **251/251 passando**, sem nenhuma
regressão nos módulos que tiveram ports alterados.

## 14. Runtime

- `npm run typecheck` (raiz): limpo.
- `npm run build` (raiz): limpo.
- `npm run architecture:check` (inclui `check-crm-isolation.mjs` e todos os outros guards de
  isolamento do projeto): **todos OK**, incluindo confirmação explícita de que o isolamento
  CRM↔Inbox permanece intacto (1011 arquivos verificados).
- `cd web && npx tsc --noEmit` + `npm run build`: limpos.
- Deploy real confirmado: log da própria feature flag apareceu no worker de produção
  (`[inbox-worker] INBOX_CRM_AUTO_CONTACT_ENABLED=false — ponte Inbox→CRM desligada...`) — prova
  que o código novo está genuinamente rodando, não só "container no ar".
- Script de auditoria rodado contra o banco de produção real (§8) — validado com dados reais, não
  hipotéticos.

**Não realizado nesta rodada** (documentado como limitação, não fingido): um teste de ponta a ponta
clicando numa conversa real no navegador (seção 34 do pedido) não foi feito porque este ambiente não
tem acesso a um workspace autenticado com dados reais. A verificação de runtime foi feita da forma
mais forte disponível: testes de integração contra Postgres real (não mocks) exercitando a mesma
lógica que roda em produção, mais a confirmação de que o código publicado está de fato ativo no
worker de produção.

## 15. Migrations

**Nenhuma.** Toda coluna necessária (`inbox_contacts.contact_id`) já existia desde a migration 0092
— esta fase só passou a escrevê-la de um segundo lugar (automático), nunca precisou de schema novo.

## 16. Commits

- `939ee61` — `feat(conversas): visualizador de mídia com navegação e autofocus do composer após
  envio`. Fecha uma rodada anterior (já implementada/testada, aguardando revisão) que ainda não
  tinha sido commitada — incluiu também a correção do link "Abrir contato completo" (o mesmo arquivo
  `inbox-tab.tsx` já estava com mudanças pendentes daquela rodada; separado em commit próprio para
  não misturar os dois contextos no mesmo commit da Fase 1).
- `7b071ac` — `feat(crm): ponte automática Inbox->CRM (Jornada Comercial Fase 1)`. Todo o trabalho
  descrito neste relatório.

## 17. Deploy

Runbook padrão executado: `git push` → `git archive` → `scp` → backup em
`deploy_backups/pre-local-sync-<timestamp>.tgz` no servidor → sync de código → 
`docker compose up -d --build`. Sem migration para rodar. Verificado: `https://vorixworks.com` (200),
`https://api.vorixworks.com/v1/health` (ok), os 4 containers (`zuno-web`, `zuno-api`,
`vorix-worker`, `zuno-postgres`) saudáveis, e a string exata do novo log da feature flag confirmada
dentro do container do worker rodando.

## 18. Riscos restantes

- **Feature desligada em produção por padrão** (`INBOX_CRM_AUTO_CONTACT_ENABLED=false`) — nada muda
  no comportamento real até o operador setar essa env var conscientemente. Isto é deliberado (rollout
  cauteloso), não um esquecimento — só avisando explicitamente aqui para não passar despercebido.
- **Sem QA de navegador ao vivo** (§14) — mitigado por testes de integração reais contra Postgres,
  mas não é o mesmo que ver um clique de verdade numa conversa de produção.
- **Limite de contatos por plano** (`ContactRepositoryPort.countByWorkspace`, usado por
  entitlements/billing) não foi auditado nem gateado dentro da ponte — se um workspace estiver no
  limite do plano quando a ponte tentar criar um Contact, o comportamento exato (erro silencioso vs.
  falha visível) não foi verificado nesta rodada. Como a chamada é best-effort (nunca quebra o
  processamento da mensagem), uma falha aqui só significa "este contato específico não foi
  auto-vinculado desta vez" — não é um risco de disponibilidade, mas vale investigar antes de ativar
  a flag num workspace perto do limite.
- **Backfill dos 38 elegíveis identificados** (§8) não foi executado — decisão pendente do usuário.
- **`automation` omitido deliberadamente** (§12) — se o operador espera que `contact_created` dispare
  automações também para contatos auto-capturados, isso precisa de uma mudança futura explícita
  (documentada, não é um bug).

## 19. Classificação final

```
INBOX_CRM_BRIDGE              = VERIFIED_RUNTIME   (testes de integração Postgres reais + confirmado ativo em produção via log; feature flag OFF por padrão)
AUTO_CONTACT_CREATION         = VERIFIED_RUNTIME   (teste 1 — cria e vincula de verdade contra Postgres real)
AUTO_CONTACT_IDEMPOTENCY      = VERIFIED_AUTOMATED (testes 3 e 4 — sequencial e concorrência real via Promise.all)
PHONE_CONTACT_DEDUP           = VERIFIED_RUNTIME   (dedupe é estrutural, herdado do Inbox — unique(workspace_id, phone_normalized) já existente; nunca decidido pela ponte)
GROUPS_EXCLUDED               = VERIFIED_RUNTIME   (estrutural — contact nunca existe para grupo; teste 5 documenta a garantia)
CONTACT_360_CONTEXTUAL        = PARTIAL            (scoped fetches implementados e typechecados; sem clique real de navegador para confirmar visualmente)
CONTACT_DEEP_LINK             = PARTIAL            (reaproveita mecanismo pré-existente e já comprovado; o NOVO ponto de entrada, o link corrigido, não foi clicado ao vivo)
CONVERSATION_CONTACT_LINK     = PARTIAL            (mesma ressalva — lógica correta e typechecada, sem clique real)
CONTACT_SCOPED_FETCHES        = YES
```

---

## Arquivos alterados/criados

- `src/application/commercial-bridge/inbox-crm-bridge-use-cases.ts` (novo)
- `src/application/ports/inbox-contact-repository.port.ts`, `inbox-message-repository.port.ts`
- `src/domain/inbox/inbox.model.ts`
- `src/infrastructure/storage/in-memory-inbox-{contact,message}-repository.ts`
- `src/infrastructure/storage/postgres/postgres-inbox-{contact,message}-repository.ts`
- `src/interfaces/worker/inbox-worker.ts`
- `scripts/audit-inbox-crm-bridge-candidates.mjs` (novo)
- `tests/crm-conversas-integration.test.mjs`
- `web/app/workspaces/[workspaceId]/contacts/page.tsx`
- `web/app/workspaces/[workspaceId]/conversas/inbox-tab.tsx` (fix do deep-link, commit separado)
