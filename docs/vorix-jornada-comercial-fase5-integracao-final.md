# Jornada Comercial Integrada — Fase 5: Amarração Final

> Implementado localmente em 20 de setembro de 2026 e **fechado operacionalmente no mesmo dia**:
> commitado (5 commits semânticos), push para `origin/main`, deploy real via SSH em produção.
> `DEPLOYED_SHA = 4a388aa`. Os itens `PENDING_QA` das Fases 1–4 continuam `PENDING_QA` — nenhuma
> evidência nova de QA autenticado real foi produzida nesta rodada de fechamento, então nada foi
> promovido artificialmente (ver §24 do fechamento operacional, abaixo).

## 0. Fechamento operacional (20 de setembro de 2026)

**Commits** (5, semânticos, todos com `tsc --noEmit`/`build`/`architecture:check` verdes antes):

| SHA | Mensagem |
|---|---|
| `05997dc` | `feat(crm): adiciona timeline comercial 360` |
| `86a9b8e` | `fix(crm): unifica contexto comercial e tarefas` |
| `e501dc1` | `feat(home): adiciona inteligencia comercial contextual` |
| `3b3d5ad` | `test(crm): cobre jornada comercial integrada` |
| `4a388aa` | `docs: registra Fase 5 da jornada comercial` |

**Push**: `origin/main` avançou de `e89fd4b` para `4a388aa`. `HEAD == origin/main` confirmado
(`git fetch` + comparação de SHA), working tree limpa.

**Deploy**: backup pré-deploy em `deploy_backups/pre-fase5-jornada-comercial-20260920220721.tgz`
no servidor; `git archive HEAD | gzip` → `scp` → extração preservando `.env.zuno` intocado →
`docker compose up -d --build`. Sem migration (nenhuma nova nesta fase — confirmado antes e depois:
`130 aplicada(s), 0 pendente(s)`, idêntico ao estado pós-Fase-4).

**Saúde pós-deploy**: os 4 containers (`zuno-zuno-web-1`, `zuno-zuno-api-1`, `zuno-vorix-worker-1`,
`zuno-zuno-postgres-1`) subiram saudáveis. `https://vorixworks.com` → 200. `/v1/health` → `ok`.
`/readyz` → `ready: true`, `status: degraded` só por causa de `production_guard: warn` — **o mesmo
warning pré-existente já documentado no fechamento da Fase 4** (config de produção/canary sempre
ativa neste ambiente, não relacionado a nenhuma fase específica), demais checks (`database`,
`secret_manager`, `operational_state`, `publication_queue`) = `pass`. Logs sem `error`/`exception`/
`fatal` novos. Flag `INBOX_CRM_AUTO_CONTACT_ENABLED=false` confirmada intacta no log do worker.

**Smoke da rota nova**: `GET /v1/contacts/:id/activity` sem autenticação retornou `401
UNAUTHORIZED` (nunca 500) — confirma que a rota está registrada e o guard de permissão
(`contact:read`) roda antes de qualquer lógica de negócio. O log do servidor mostra o stack trace
exato apontando pra `contacts.route.js:110` (a linha nova desta fase), confirmando que o código
deployado é de fato o código novo. QA autenticado real (contato de verdade, dados agregados de
verdade) segue fora do alcance deste ambiente — ver classificação em §22.

**Achado da varredura de testes backend (não é bug da Fase 5)**: ao rodar a suíte COMPLETA do
repositório (243 arquivos, não só os de CRM) como checagem extra de regressão, 2 arquivos falharam
— ambos pré-existentes e sem nenhuma relação com esta fase:
- `tests/instagram-dm-persistence.test.mjs` importa
  `postgres-instagram-dm-conversation-repository.js`, um módulo que **nunca existiu** em `src/`
  (confirmado por busca no código-fonte) — o arquivo de teste foi commitado em `7b24f64` ("feat
  (instagram-dm): Fase 5 — Instagram DM Automation", uma numeração de fase interna do produto
  totalmente diferente da Jornada Comercial), órfão desde então.
- `tests/cli.smoke.test.mjs` (teste `LOCAL_PRODUCTION resolve assets visuais...`) trava por >60s e
  é encerrado (`SIGTERM`) — arquivo do commit inicial do repositório, sobre renderização de vídeo,
  sem nenhuma relação com CRM/Comercial.

Nenhum dos dois toca em qualquer arquivo desta fase. A suíte relevante (87 testes de backend —
66 CRM + 14 atendimento + 7 novos da Fase 5 — e 56 de frontend) permanece 100% verde, batendo com o
baseline informado. Classificado como `OPERATIONAL_QA` (achado registrado, não corrigido nesta
rodada — corrigir um teste órfão de um módulo não-comercial seria escopo fora do pedido desta
fase).

## 1. Visão final da jornada

O objetivo desta fase não era construir um módulo novo, e sim fazer o produto parar de parecer
"Conversas + Contatos + Negócios + Tarefas + Propostas" como telas independentes. A peça central é
a **Timeline Comercial 360**: uma camada de leitura que junta, por Contato, tudo que já era gravado
em `timeline_events` (contato/negócio/tarefa/proposta) com os eventos operacionais de
`inbox_conversation_events` (Conversas) — sem criar uma terceira tabela de eventos e sem o CRM
importar Inbox diretamente. A partir dela, o Contact 360 passa a ter um "Histórico" de verdade, e o
Home ganha um sinal a mais de "o que precisa da minha atenção agora".

Itens fora do escopo desta fase (e nunca tocados): ERP, financeiro, estoque, NFSe, contratos,
pagamentos/Pix, assinatura digital, um novo construtor de Proposta, um novo canal de mensageria, IA
vendendo sozinha ou enviando proposta por conta própria, um novo funil de marketing.

## 2. Timeline Comercial 360 — desenho

Novo arquivo `src/application/commercial/contact-activity-use-cases.ts`, no mesmo padrão de ponte
neutra já usado em `commercial-bridge` (Fase 1) e `proposal-delivery-use-cases.ts` (Fase 4): importa
dos dois lados (CRM e Inbox) porque é o único papel dela, e o guard de arquitetura
(`check-crm-isolation.mjs`) já cobre `/application/commercial/` como ponte — não foi preciso alterar
o guard, só usar o padrão já existente.

`getContactActivity(deps, {contactId, tenantId, workspaceId, limit?})`:

1. valida que o Contact pertence a `tenantId`/`workspaceId` (nunca 403, sempre 404 — mesmo padrão
   do resto do CRM);
2. busca em paralelo: eventos de timeline do próprio contato, Deals do contato
   (`dealRepository.listByWorkspace({contactId})`), Tasks do contato, Proposals do contato e — só
   quando o módulo Conversas está ligado neste processo (`inbox` é opcional nos deps) — as
   conversas do contato (via `inbox_contacts.contact_id`, filtro já existente desde a Fase 1);
3. para cada Deal/Task/Proposal encontrado, busca os eventos de timeline daquela entidade
   específica (`entityType: "deal"/"task"/"proposal"`, `entityId`); para cada conversa (excluindo
   as com `mergeStatus: "merged"` — nunca aparecem em nenhuma UI, mesmo padrão do resto do
   produto), busca os eventos operacionais da conversa;
4. mapeia cada evento bruto para um item normalizado (ver §3), com um `title`/`description` em
   português já prontos — o frontend não precisa saber o nome de nenhuma coluna ou tabela;
5. deduplica por `id` (defensivo — o desenho atual não produz duplicatas reais, ver §4), ordena do
   mais recente pro mais antigo com desempate determinístico, corta em `limit` (padrão 50).

`GET /contacts/:id/activity` foi adicionado a `contacts.route.ts` (arquivo já classificado como CRM
pelo guard) — a rota só importa o TIPO de deps da ponte neutra, nunca um símbolo de Inbox
diretamente, preservando o isolamento. Em `index.ts`, os deps da rota ganharam
`proposalRepository` (não existia ali antes) e um bloco `inbox` opcional, montado exatamente como
`sharedInboxDeps` já era passado para `delivery` em `proposals.route.ts` — `undefined` quando o
módulo Conversas está desligado neste ambiente.

## 3. Formato normalizado do evento

```ts
type ContactActivityItem = {
  id: string;
  type: string;               // ex.: "deal_won", "proposal_accepted", "conversation_took_over"
  category: "contact" | "conversation" | "deal" | "task" | "proposal";
  occurredAt: string;
  actor: { type: "user"; id: string } | { type: "system" | "ai" | "automation" | "contact" };
  title: string;               // já em português, pronto pra tela
  description?: string;
  entityType?: "contact" | "deal" | "task" | "proposal" | "conversation";
  entityId?: string;
  metadata?: Record<string, unknown>;
};
```

`entityType`/`entityId` existem só para permitir o clique ("abrir aquele negócio/proposta/conversa
específica"), nunca para o frontend reconstruir lógica de negócio a partir deles.

### Tipos incluídos (lista branca — só o que a Fase 5 pediu)

- **Contato**: `contact_created`, `identity_linked`.
- **Conversa**: `conversation_started` (sintético, a partir de `InboxConversation.createdAt` — não
  existe um evento gravado pra "início", então é derivado do próprio registro, nunca inventado),
  `conversation_took_over`, `conversation_transferred`, `conversation_resolved`,
  `conversation_reopened`, `conversation_ai_paused`, `conversation_ai_resumed`.
- **Negócio**: `deal_created`, `deal_stage_changed`, `deal_won`, `deal_lost`, `deal_reopened`.
- **Tarefa**: `task_created`, `task_rescheduled`, `task_completed`, `task_cancelled`.
- **Proposta**: `proposal_created`, `proposal_sent`, `proposal_resent`,
  `proposal_link_regenerated`, `proposal_viewed`, `proposal_accepted`, `proposal_rejected`,
  `proposal_expired`.

Deliberadamente **fora**: qualquer mensagem de WhatsApp, os tipos `assigned`/`unassigned`/
`kanban_phase_changed` (ruído operacional interno da Inbox, sem valor comercial), e os 4 tipos
`ai_response_*`/`ai_response_skipped_insufficient_credits` (metadado técnico de IA — nunca deveria
aparecer numa timeline voltada a vendas, e tem dado sensível junto, ver §7).

## 4. Derivações e regra de dedupe

Dois pontos não são gravados como um evento próprio hoje, e por isso são **derivados na leitura**
(nunca inventados — sempre a partir do estado real persistido):

- **`deal_won`/`deal_lost`/`deal_reopened`**: o banco só grava `deal_stage_changed` com
  `payload.isWon`/`payload.isLost` da etapa de destino — não existe flag de "a etapa de origem era
  terminal". O agregador processa a sequência cronológica de `deal_stage_changed` de CADA negócio
  (nunca cruzando negócios diferentes) e marca como `deal_reopened` qualquer transição não-terminal
  que venha depois de uma transição terminal (`isWon`/`isLost`) anterior do MESMO negócio.
- **`proposal_expired`**: a expiração é lida sob demanda (`respondToPublicProposal`/`listProposals`
  marcam `status: "expired"` na leitura; não existe `timelineEventRepository.record` próprio para
  isso). O item sintético só aparece quando `proposal.status === "expired"` de fato no momento da
  consulta, com `occurredAt = validUntil` — reflete o estado real, nunca uma previsão.

**Dedupe**: a única dedupe aplicada é defensiva, por `id`, via `Map` — o desenho atual (uma consulta
por par entidade/id, nunca duas fontes pro mesmo evento) não produz duplicatas reais.
`proposal_accepted` (categoria proposta) e `deal_stage_changed`→`deal_won` (categoria negócio,
`payload.trigger: "proposal_accepted"`) são dois eventos **legitimamente distintos** — o primeiro
diz "o cliente aceitou", o segundo diz "por isso o negócio mudou de etapa" — e os dois aparecem na
Timeline, nunca escondidos um pelo outro.

## 5. Ator — nunca um UUID cru

- `actorType: "user"` com `actorId` → `{type: "user", id}`; o **backend nunca resolve o nome** — o
  frontend já carrega a lista de membros do workspace pra outras telas (`useInboxMembers`), e
  resolve com a mesma função (`activityActorLabel`, em `presentation.ts`, réplica deliberada de
  `userLabel` de `components/UserPicker.tsx` — não importada de lá pra não fazer `features/crm`
  depender de `components/`).
- `actorType: "ai"`/`"automation"` → rótulo fixo (IA/Automação).
- **Decisão de apresentação**: `proposal_viewed`/`proposal_accepted`/`proposal_rejected` são
  gravados no banco com `actorType: "system"` (é a página pública, sem sessão, quem dispara) — mas
  quem realmente age ali é o cliente. Só na Timeline 360 (camada de apresentação, o dado gravado
  não muda) esses 3 tipos ganham `actor: {type: "contact"}` (rótulo "Cliente"). O início de uma
  conversa (`conversation_started`) também é atribuído ao cliente, pelo mesmo motivo.

## 6. Contact 360 — Histórico

A aba antes chamada "Timeline" virou "Histórico" e passou a consumir `useContactActivity` (novo
hook) em vez de `useContactTimeline` (que continua existindo — outros consumidores futuros podem
usá-la, só deixou de ser a fonte desta aba). Cada item mostra título, descrição (quando houver),
data/hora e ator resolvido; itens ligados a um Negócio, Proposta ou Conversa são clicáveis: abrem o
`DealDetailModal`, trocam pra aba Propostas e abrem o `ProposalDetailModal`, ou navegam pra
`/conversas?conversation=<id>`, respectivamente (mesmo padrão de deep-link já usado no resto do
Contact 360).

O restante do Contact 360 (header, resumo com negócios/tarefa seguinte/proposta atual, ações
contextuais, abas Conversas/Negócios/Tarefas/Propostas) já existia das Fases 2–4 com dados reais —
não havia métrica inventada pra remover, e não foi alterado nesta rodada além do necessário pro
Histórico.

## 7. Privacidade

A Timeline 360 nunca inclui: token público (só existe cru na resposta de criação/regeneração de
link, nunca persistido — nada muda aqui), `publicTokenHash`, JID/LID/id de conexão de mensageria
(o `conversationId` exposto é o id interno do Vorix, usado só para o deep-link, nunca o identificador
do provider), payload bruto de provider, ou qualquer um dos campos de `ai_response_*`
(`aiTraceId`, `model`, `tokens`, custo estimado etc.) — esses tipos de evento simplesmente nunca
entram na lista branca do agregador (§3), não é uma redação campo-a-campo que poderia vazar por
esquecimento. Coberto pelo teste `Fase 5 — Timeline 360 agrega...` (verifica que o token bruto e o
hash nunca aparecem na resposta serializada).

## 8. Home / Vorix Intelligence

Dois ajustes, ambos em `vorix-intelligence-panel.tsx` e no `page.tsx` da Home:

- **Unificação da semântica de "tarefa atrasada"**: existiam **três** definições silenciosamente
  diferentes de "atrasada" no produto — `isTaskOverdue` (início do dia, usada em Contact 360/tela de
  Tarefas), o cálculo inline do painel Intelligence (instante atual) e um TERCEIRO cálculo inline
  no `page.tsx` da própria Home (também instante atual, usado tanto no card KPI "Tarefas atrasadas"
  quanto em `isFreshWorkspace`). Decisão: as três agora usam `isTaskOverdue` (início do dia) — é a
  definição já estabelecida e mais usada, e evita que uma tarefa com vencimento hoje às 17h vire
  "atrasada" já às 17h01 enquanto o dia comercial ainda está em curso. Documentado aqui como a
  semântica única do produto; qualquer nova tela que precisar de "atrasada" deve reusar
  `isTaskOverdue`, nunca reimplementar.
- **Novo bloco "Proposta visualizada sem resposta"** (item 19 do pedido): usa
  `useProposals(workspaceId, {status: "viewed"})` (filtro no backend, nunca carrega o workspace
  inteiro), mostra até 3 propostas com valor e data da última visualização, com ação "Abrir
  proposta" (novo deep-link `?proposal=<id>` na tela de Propostas — ver §10) e, quando a proposta
  tem contato vinculado, "Abrir contato".

Verificado que nenhum card do Home renderiza um "0" falso como fallback de erro — todos os valores
já usavam `metric ? String(...) : undefined` antes desta fase (correção anterior preservada,
conferido por leitura de código, não regredido).

## 9. Conversa — seção Comercial

Lida e conferida: a hierarquia (Negócio atual / Próxima ação / Proposta atual) já existia enxuta
desde as Fases 2–4, mas **a ação "Abrir cliente" citada no pedido não existia de fato** —
`LinkedCrmSection` (`crm-panel.tsx`) não tinha nenhum caminho pra sair da conversa direto pro
Contact 360 daquele contato. Corrigido: botão "Abrir cliente" no cabeçalho da seção COMERCIAL,
navegando para `/contacts?contactId=<id>` (mesmo deep-link já usado em todo o resto do produto).
Registro de transparência: a primeira versão desta seção do documento afirmava que esse botão já
existia — foi um erro de auditoria (assumi que fases anteriores tinham entregue o item completo sem
checar o código); corrigido depois de uma varredura dedicada (§11).

## 10. Deep-links

Novo: `GET/rota` `/workspaces/:id/proposals?proposal=<id>` — abre direto o
`ProposalDetailModal` daquela proposta (mesmo padrão já usado por `?contactId=`/`?dealId=` na
mesma tela, que pré-preenchem a criação). É a peça que faltava para o Home e a Timeline 360 abrirem
uma proposta específica sem o usuário precisar procurá-la na lista.

Contato (`?contactId=`) e Conversa (`?conversation=`) já tinham deep-link consistente desde as
Fases 1–3; Negócio (`?dealId=`) já existia (era usado só para pré-preencher criação) e passou a ser
reaproveitado também pelos novos links de "abrir negócio" a partir de uma Proposta (§11) — nenhum
parâmetro novo foi necessário além do `?proposal=`.

## 11. Navegação cruzada entre telas

Uma varredura dedicada (agente de exploração, leitura de código real — não suposição) checou, tela
por tela, se nomes de entidades relacionadas já eram clicáveis ou texto morto:

- `tasks/page.tsx`: já linkado (Contato e Negócio na linha da tarefa).
- `deals/page.tsx`: nome do contato no card era texto morto (o card inteiro abre o Deal, mas não
  havia caminho direto pro Contact 360). **Corrigido**: `DealDetailModal` ganhou um `onOpenContact`
  opcional, wireado em `deals/page.tsx` para `router.push(/contacts?contactId=)`.
- `DealDetailModal.tsx`: nome do contato no header e a "Contato" InfoCell eram texto morto; títulos
  de tarefa em Atividades também. Proposta relacionada já era clicável. **Corrigido**: header do
  Deal (nome do contato agora usa `onOpenContact` quando o chamador oferece); a `ProposalDetailModal`
  aberta de dentro do Deal também recebeu `onOpenContact` (mesmo callback, repassado). Títulos de
  tarefa em Atividades ficaram como estavam — não há uma tela de detalhe de Tarefa individual pra
  abrir, e duplicar "editar" ali seria escopo maior que o pedido.
- `ProposalDetailModal` (as DUAS implementações — a compartilhada em `components/crm/` e a local em
  `proposals/page.tsx`, duplicação já registrada na Fase 4): nome do contato e do negócio no header
  eram texto morto nas duas. **Corrigido nas duas**: contato agora abre `/contacts?contactId=`,
  negócio agora abre `/deals?dealId=` (a tela de Negócios já auto-abre o detalhe via esse
  parâmetro, mesmo padrão de `?contactId=`).
- `crm-panel.tsx` (seção COMERCIAL da Conversa): título do Negócio atual (caso de 1 negócio aberto)
  já tinha um botão "Abrir negócio" ao lado — não era texto morto sem saída, só não era o próprio
  texto que abria; deixado como está (ação já existe, mudar isso seria polimento estético, não uma
  lacuna real). Título da próxima tarefa segue sem abrir nada específico — não existe uma tela de
  detalhe de Tarefa individual no produto hoje; a ação "Concluir"/"Reagendar" já cobre o que dá pra
  fazer com uma tarefa. O gap real encontrado e corrigido aqui foi a ausência do botão "Abrir
  cliente" (§9).

Além disso, itens da Timeline 360 ficaram clicáveis (§6), e o novo bloco do Home leva direto à
Proposta ou ao Contato relevante (§8).

## 12. Status e badges

`StatusBadge` já é o componente único reusado por Negócio/Tarefa/Proposta/Conversa desde as fases
anteriores — não foi necessário criar nem alterar cores nesta rodada.

## 13. Timezone

`WORKSPACE_TIMEZONE` continua `NOT_IMPLEMENTED_PREEXISTING`. Não foi implementado nesta fase:
`isTaskOverdue`/`startOfToday` usam o horário local do NAVEGADOR do usuário (não um timezone de
workspace configurável) — unificar as três semânticas de "atrasada" (§8) não muda esse fato, só
garante que as três concordam entre si sob o mesmo relógio. Implementar timezone de workspace de
verdade tocaria Tarefas, Agenda e Analytics ao mesmo tempo — fora do orçamento de risco desta fase,
conforme pedido explícito de não criar solução superficial só para marcar checklist.

## 14. Performance e cache

O agregador faz uma consulta por entidade relacionada (Deals/Tasks/Proposals do contato, depois
uma consulta de timeline POR entidade encontrada, mais uma de eventos POR conversa) — aceitável
para os volumes reais de um único Contact (dezenas de negócios/tarefas/propostas, não milhares).
Nenhum fetch de workspace inteiro foi introduzido. `useContactActivity` usa a mesma chave de SWR já
usada nas outras abas do Contact 360 (mutate explícito disponível para invalidação pontual), sem
polling automático — mesmo padrão do resto do módulo.

## 15. Testes

Backend (`tests/commercial-timeline-fase5.test.mjs`, 7 testes, todos verdes contra Postgres real
via pglite):

1. agregação completa + ordenação decrescente + ator "Cliente" no aceite + ator "user" real no
   take-over + nunca vaza token/hash;
2. recusa de proposta mantém o Deal aberto e é atribuída ao cliente;
3. Contato sem nenhum Deal ainda mostra Tarefa e Conversa (nunca força a existência de negócio);
4. funciona com o módulo Conversas desligado (`inbox: undefined`), só com dados de CRM;
5. isolamento multi-tenant — contato de outro tenant nunca aparece, mesmo trocando só o
   `workspaceId`;
6. `task_rescheduled` aparece após reagendar; `deal_reopened` aparece corretamente após um negócio
   Ganho voltar para uma etapa aberta;
7. eventos de baixo nível (`assigned`, `kanban_phase_changed`, pausas/retomadas de IA fora da lista
   branca) nunca viram ruído — só os tipos explicitamente listados aparecem.

Frontend (`web/tests/contact-activity-presentation.test.ts`, 4 testes): resolução de ator (usuário
real, usuário não encontrado na lista carregada, os 4 tipos fixos, comportamento sem lista de
membros ainda carregada).

Todas as 66 suites de backend de CRM pré-existentes e as 14 de atendimento (`inbox-attendance`)
foram reexecutadas sem regressão. As 56 (agora 60, com os novos) suites de frontend também.

## 16. Cenários E2E (verificação lógica, não navegador)

Sem ferramenta de navegador neste ambiente (mesma limitação já registrada nas Fases 1–4), os dois
cenários pedidos foram verificados como testes de integração reais contra Postgres, cobrindo a
cadeia completa de chamadas de use-case (não simulação/mock):

- **Aceite** (teste 1 de §15): conversa iniciada → take-over → Deal criado → Tarefa criada e
  concluída → Proposta criada → enviada → visualizada (via `getPublicProposal`, o mesmo caminho da
  página pública) → aceita (via `acceptPublicProposal`) → `applyProposalAcceptanceToDeal` move o
  Deal para Ganho → a Timeline mostra a sequência inteira, mais recente primeiro, com `deal_won`
  no topo.
- **Recusa** (teste 2 de §15): Deal aberto → Proposta enviada → visualizada → recusada
  (`rejectPublicProposal`) → Deal continua na mesma etapa aberta → Timeline registra a recusa
  atribuída ao cliente, com o motivo.
- **Sem Deal** (teste 3 de §15): Contato conversa e tem Tarefa sem nunca ter um Deal — a Timeline
  funciona normalmente, sem nenhum item de categoria `deal`.

Isso é `VERIFIED_AUTOMATED` (integração real, não unitário com mocks) — não substitui QA autenticado
de navegador real, que seguirem `PENDING_QA` (ver §21).

## 17. Arquitetura

`npm run architecture:check` (suite completa, incluindo `check-crm-isolation.mjs`) passou depois de
todas as mudanças desta fase. O novo arquivo (`src/application/commercial/contact-activity-use-cases.ts`)
já cai na categoria de ponte neutra existente (`/application/commercial/`) — nenhum ajuste no guard
foi necessário. A rota nova em `contacts.route.ts` só importa o TIPO de deps da ponte, nunca um
símbolo de Inbox — confirmado lendo o próprio arquivo do guard (`CRM_IMPORT_MARKERS` não inclui
`/application/commercial/`, então isso nunca seria sequer um falso-positivo).

## 18. Arquivos alterados

Backend:
- `src/application/commercial/contact-activity-use-cases.ts` (novo)
- `src/application/crm/task-use-cases.ts` (grava `task_rescheduled` quando `dueAt` muda)
- `src/interfaces/api/routes/v1/contacts.route.ts` (`GET /contacts/:id/activity`)
- `src/interfaces/api/routes/v1/index.ts` (deps: `proposalRepository` + `inbox` opcional)
- `tests/commercial-timeline-fase5.test.mjs` (novo, 7 testes)

Frontend:
- `web/features/crm/types.ts` (`ContactActivityItem`/`ContactActivityActor`/`ContactActivityCategory`)
- `web/features/crm/api.ts` (`getContactActivity`)
- `web/features/crm/hooks.ts` (`useContactActivity`)
- `web/features/crm/presentation.ts` (`activityActorLabel`)
- `web/app/workspaces/[workspaceId]/contacts/page.tsx` (aba Histórico consumindo a Timeline 360,
  itens clicáveis)
- `web/app/workspaces/[workspaceId]/vorix-intelligence-panel.tsx` (semântica de atrasada unificada,
  bloco de propostas visualizadas)
- `web/app/workspaces/[workspaceId]/page.tsx` (mesma unificação de semântica de atrasada)
- `web/app/workspaces/[workspaceId]/proposals/page.tsx` (deep-link `?proposal=`; header da proposta
  local com nome do contato/negócio agora clicável)
- `web/components/crm/DealDetailModal.tsx` (`onOpenContact` opcional no header e repassado à
  `ProposalDetailModal` interna)
- `web/components/crm/ProposalDetailModal.tsx` (`onOpenContact`/`onOpenDeal` opcionais no header)
- `web/app/workspaces/[workspaceId]/deals/page.tsx` (`onOpenContact` wireado no `DealDetailModal`)
- `web/app/workspaces/[workspaceId]/conversas/crm-panel.tsx` (botão "Abrir cliente" novo na seção
  COMERCIAL — gap real, ver §9/§11; `onOpenDeal` wireado na `ProposalDetailModal` interna)
- `web/tests/contact-activity-presentation.test.ts` (novo, 4 testes)

## 19. Migrations

Nenhuma. A Timeline 360 é 100% leitura sobre tabelas já existentes (`timeline_events`,
`inbox_conversation_events`, mais as próprias tabelas de Deal/Task/Proposal/Contact/InboxConversation).

## 20. Endpoints novos

- `GET /v1/contacts/:id/activity?workspaceId=...&limit=...` → `ContactActivityItem[]`.

## 21. Riscos e lacunas conhecidas (nunca infladas)

O escopo do pedido original desta fase é maior do que o entregue nesta rodada — em vez de inflar
classificação, o que ficou de fora está listado explicitamente aqui, categorizado:

**PENDING_QA** (precisa de sessão autenticada de navegador real em produção, ambiente sem essa
ferramenta):
- QA visual/funcional real do Histórico do Contact 360, do bloco novo do Home, e do deep-link de
  Proposta, em 1440/1366/390px.
- Os cenários E2E de aceite/recusa validados nesta rodada são de integração real (backend), não
  clique-a-clique em navegador autenticado.

**FUTURE FEATURE / POLISH** (fora do orçamento desta rodada, não bloqueiam o que foi entregue):
- Auditoria completa de acessibilidade (foco, Escape, aria) dos modais de Fases 2–4 — não revisada
  nesta rodada.
- Revisão de microcopy/empty-states com CTA respeitando RBAC em todas as telas comerciais — não
  revisada nesta rodada além do que já existia.
- Auditoria de performance/N+1 em Negócios/Tarefas/Propostas fora do que a própria Timeline 360
  toca — não revisada nesta rodada.
- Revisão de busca (Contato/Negócio/Tarefa/Proposta) — não revisada nesta rodada.
- Timezone de workspace de verdade (ver §13) — continua documentado como lacuna conhecida.
- `ProposalDetailModal` duplicado (shared vs. local em `proposals/page.tsx`) — lacuna já registrada
  na Fase 4, não resolvida aqui (não bloqueia nada, é uma duplicação de componente, não de dado).

**OPERATIONAL_QA**:
- `tests/instagram-dm-persistence.test.mjs` e `tests/cli.smoke.test.mjs` — dois testes
  pré-existentes e sem nenhuma relação com a Jornada Comercial que falham na suíte completa do
  repositório (evidência em §0); não corrigidos aqui por serem fora de escopo (módulos Instagram DM
  Automation e renderização de vídeo, respectivamente).

**BUG** — nenhum bug novo encontrado nesta rodada além dos gaps reais já corrigidos (§11/§9, ver
também a lista de arquivos alterados em §18).

## 22. Classificação final (atualizada no fechamento operacional)

| Item | Classificação | Evidência |
|---|---|---|
| `DEPLOYED_SHA` | `4a388aa` | push + deploy confirmados, `HEAD == origin/main`, §0 |
| `PRODUCTION_HEALTH` | `PASS` | 4 containers saudáveis, web 200, `/v1/health` ok, `/readyz` ready=true (só warning pré-existente), logs sem erro novo, §0 |
| `TIMELINE_360_BACKEND` | `VERIFIED_AUTOMATED` | 7 testes de integração real (Postgres), §15; rota nova confirmada viva em produção (401 correto, nunca 500, §0) — leitura de dados agregados reais exige sessão autenticada, não alcançável neste ambiente |
| `TIMELINE_360_CONTACT` | `VERIFIED_LOCAL` | build+typecheck limpos, código lido linha a linha; abertura visual da aba Histórico em produção exige navegador autenticado |
| `TIMELINE_ORDERING` | `VERIFIED_AUTOMATED` | teste 1 de §15 (assert de ordem decrescente) |
| `TIMELINE_DEDUP` | `VERIFIED_AUTOMATED` | dedupe defensivo coberto pelo desenho (§4); nenhuma duplicata real possível no fluxo testado |
| `TIMELINE_MULTI_TENANT` | `VERIFIED_AUTOMATED` | teste 5 de §15 |
| `CONTACT_360_SUMMARY` | `VERIFIED_LOCAL` | já existia das Fases 2–4 com dados reais; não alterado além do Histórico |
| `HOME_COMMERCIAL_INTELLIGENCE` | `VERIFIED_LOCAL` | build+typecheck limpos; bloco novo depende de dados reais de produção pra ver renderizado, exige navegador autenticado |
| `CONVERSATION_COMMERCIAL_CONTEXT` | `VERIFIED_LOCAL` | gap real do "Abrir cliente" corrigido (§9/§11); confirmação visual exige navegador autenticado |
| `CROSS_SCREEN_CONSISTENCY` | `VERIFIED_LOCAL` | Timeline 360 nunca duplica estado — sempre lê da mesma fonte que cada tela já usa |
| `DEEP_LINKS` | `VERIFIED_LOCAL` | `?proposal=` novo, testado por leitura de código e padrão idêntico ao `?contactId=` existente; sem QA de navegador |
| `MOBILE_COMMERCIAL_FLOW` | `PENDING_QA` | sem ferramenta de navegador neste ambiente |
| `COMMERCIAL_E2E_ACCEPT` | `VERIFIED_AUTOMATED` | teste 1 de §15 (integração real, não navegador) |
| `COMMERCIAL_E2E_REJECT` | `VERIFIED_AUTOMATED` | teste 2 de §15 (integração real, não navegador) |
| `COMMERCIAL_JOURNEY_PRODUCTION_READY` | `NO` (ainda) | código deployado e saudável; falta QA de navegador autenticado real (clicar em Histórico/Home/deep-links/mobile com dados de produção) pra fechar o ciclo — mesmo padrão de todas as fases anteriores |

## 23. Entrega

Implementado, testado e **deployado**: `tsc --noEmit` limpo (backend e frontend), `npm run build`
limpo (backend e frontend), `npm run architecture:check` completo passando (`check-crm-isolation`
incluído), 66 testes de backend de CRM pré-existentes + 14 de atendimento sem regressão, 7 testes
novos de backend (`commercial-timeline-fase5.test.mjs`), 56 testes de frontend pré-existentes sem
regressão + 4 novos (`contact-activity-presentation.test.ts`) — todos re-executados no fechamento
operacional e continuam verdes. Push feito, deploy real feito, saúde confirmada (§0).

PARE — Fase 6 não é iniciada automaticamente.
