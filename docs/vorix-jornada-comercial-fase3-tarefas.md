# Jornada Comercial Integrada — Fase 3: Conversa → Contato → Negócio → Próxima Ação

> Escopo: tornar Tarefa (`Task`) uma parte natural da operação comercial — nascendo em Conversas,
> no Negócio e no Contact 360, e aparecendo centralizada na tela Tarefas. Nenhuma entidade nova
> (`FollowUp`/`Activity`/`Reminder`), nenhuma migration, nenhum novo endpoint — a fundação de Task
> (CRM Execução Comercial) já existia inteira e correta; esta fase é inteiramente de UX/integração.
> Nenhuma mudança em Proposal Templates, envio de proposta por WhatsApp, Timeline 360, IA criando
> Deal, automação de mensagens, novo calendário ou novo sistema de notifications — tudo isso
> continua fora desta rodada. Fase 1 e Fase 2 não foram redesenhadas.

---

## 1. Propósito de Task

Para o usuário: **Contato = quem é o cliente; Negócio = o que estamos vendendo; Tarefa = o que
precisamos fazer em seguida** (follow-up, ligação, WhatsApp, reunião, enviar proposta, ou "Outra").
Nenhum modelo novo — `Task` (já existente desde a fundação de "CRM Execução Comercial") já tinha
todos os campos pedidos (`contactId`, `dealId`, `type`, `title`, `description`, `dueAt`, `status`,
`ownerUserId`, `teamId`, `completedAt`) e todos os endpoints necessários
(`POST/GET/PATCH /tasks`, `POST /tasks/:id/complete`, `POST /tasks/:id/cancel`) — inclusive
`PATCH /tasks/:id` já aceitava `dueAt`, o que significa que **reagendar não precisou de nenhuma
extensão de backend** (item 16 do pedido original antecipava essa possibilidade; não foi
necessária). O trabalho desta fase foi 100% de frontend: fazer essas capacidades já existentes
aparecerem nos 3 lugares certos, com a linguagem certa.

## 2. Diferença entre Task e Deal

Preservada sem nenhuma mudança de modelo. Uma Task pode existir **sem** Deal (contato ainda não
virou oportunidade, mas já precisa de um follow-up) — nunca obrigatório criar negócio pra agendar
uma ação. O vínculo é sempre `Task → Contact` (+ `Deal` opcional), nunca `Task → InboxConversation`
— a conversa é contexto operacional (onde a ação nasce), a tarefa é contexto comercial (o que fazer
com aquele Contact/Deal). Nenhum campo `conversationId` foi adicionado a `Task`, como pedido
explicitamente (item 4).

## 3. `nextPendingTask`

Regra já existia, centralizada em `web/features/crm/presentation.ts` (usada por
`crm-panel.tsx`/`DealDetailModal`/Contact 360 desde a Fase 2): filtra `status === "pending"`,
opcionalmente por `contactId`/`dealId`, ordena por `dueAt` ascendente (tarefas sem prazo vão pro
final). Como "atrasada" sempre tem `dueAt` no passado, ela naturalmente ordena antes de qualquer
tarefa futura — a regra pedida no item 6 ("se houver tarefa atrasada, a mais antiga/urgente recebe
destaque") já estava correta e **não precisou de nenhuma mudança**; só passou a ser exibida de um
jeito mais rico (com badge "Atrasada", ver §11).

## 4. Criação pela conversa

`crm-panel.tsx`, seção "COMERCIAL": nova subseção **"Próxima ação"**, logo abaixo do negócio atual.
Sem tarefa pendente: "Nenhuma próxima atividade" + "+ Criar próxima ação". Com tarefa pendente:
card mostrando tipo amigável, prazo, badge "Atrasada" quando aplicável, e ações **Concluir** /
**Reagendar** / **Ver** (abre o `DealDetailModal` embutido quando a tarefa tem negócio vinculado).
Criação usa o novo `QuickCreateTaskModal` (compartilhado, ver §"Arquivos"), sem sair da conversa;
Contact já vem definido, `dealId` resolvido automaticamente (ver §8). O botão genérico "+ Tarefa" no
rodapé da seção COMERCIAL passou a abrir o MESMO modal (nenhuma segunda implementação).

## 5. Criação pelo Deal

`DealDetailModal` ganhou uma seção **"Próximas atividades"** no Resumo (entre "Contexto" e "Ações
contextuais"): lista as tarefas pendentes DESTE negócio, ordenadas por `dueAt` ascendente, com
Concluir/Reagendar por linha e "+ Nova tarefa" abrindo o mesmo `QuickCreateTaskModal` — sempre
inline, nunca navega. Como o negócio já é conhecido, `dealChoice` é sempre `{mode: "auto", dealId:
deal.id}`, nunca ambíguo. O antigo botão "Criar tarefa" em "Ações contextuais" (que navegava para
`/tasks?dealId=...`) foi removido — a nova seção dedicada substitui essa entrada com o fluxo inline
pedido pela fase; a prop `onCreateTask` (que os 3 chamadores de `DealDetailModal` passavam como
callback de navegação) deixou de existir — o componente agora resolve isso sozinho.

## 6. Criação pelo Contact

`contacts/page.tsx`, `ContactDetailModal`: o botão "Criar tarefa" em "Ações contextuais" (Resumo)
passou de `router.push("/tasks?contactId=...")` para abrir o `QuickCreateTaskModal` inline (item
20), Contact já definido. A aba **Tarefas** ganhou um botão "+ Tarefa" equivalente e foi
reorganizada (ver §"Contact 360" abaixo). `dealChoice` é resolvido a partir dos negócios ABERTOS
deste Contact (`groupDealsByStatus(deals).open`, já existente da Fase 2), pela mesma
`resolveTaskDealChoice` usada na conversa — nenhuma lógica divergente entre os dois pontos de
entrada.

## 7. Tarefas sem Deal

Confirmado sem nenhuma mudança necessária: `QuickCreateTaskModal` sempre recebe `contactId`, e
`dealId` só é enviado quando `dealChoice.mode` é `"auto"` ou o usuário escolhe um no `"choose"` — no
modo `"none"` (Contact sem nenhum negócio aberto), a Task nasce só com `contactId`, exatamente como
pedido ("não obrigar criação de negócio para poder fazer follow-up").

## 8. Múltiplos Deals

`resolveTaskDealChoice` (novo, `web/features/crm/task-scheduling.ts`, 3 testes unitários) formaliza
a regra pedida: 0 negócios abertos → `{mode: "none"}` (Task só no Contact); 1 negócio aberto →
`{mode: "auto", dealId}` (preenchido sozinho, nunca perguntado de novo); 2+ negócios abertos →
`{mode: "choose", options}` — o `QuickCreateTaskModal` então mostra o seletor "Relacionar esta
tarefa a qual negócio?" com "Sem negócio" + cada negócio pelo nome, **nunca escolhendo um deles em
silêncio**. Mesma função reusada por `crm-panel.tsx` e por `ContactDetailModal` — nenhuma lógica
duplicada (item 28).

## 9. Conclusão

Sempre via `completeTask(taskId, workspaceId)` — o MESMO use case/endpoint já existente
(`POST /tasks/:id/complete`, grava `completedAt` e o evento `task_completed` na timeline, sem
alteração). Chamado a partir de 4 lugares agora (conversa, `DealDetailModal`, Contact 360, tela
Tarefas), todos revalidando os dados locais depois (`onChanged`/`onTasksChanged`/`mutate`) — nunca
uma segunda função de "concluir". Erros de backend (ex.: RBAC) aparecem via `toast.error`, nunca
escondidos (item 37).

## 10. Reagendamento

`RescheduleTaskPopover` (novo, compartilhado) — popover pequeno com os atalhos "Hoje/Amanhã/+2
dias/Próxima semana" + campo `datetime-local` livre, chamando `updateTask(taskId, workspaceId,
{dueAt})` ao salvar. Como o backend já suportava `dueAt` no `PATCH /tasks/:id`, **nenhuma extensão
de schema/endpoint foi necessária** — confirma a hipótese do item 16 do pedido ("se o backend não
suportar, implementar a menor extensão necessária"): não precisou. Usado nos mesmos 4 lugares que a
conclusão, sempre atualizando a MESMA Task (nunca cria uma segunda).

## 11. Atraso

`isTaskOverdue` (já existente em `presentation.ts`, reusada sem alteração de regra) continua sendo a
única fonte de verdade — `pending` + `dueAt` antes do início do dia atual. O que mudou foi só a
apresentação: um badge explícito "Atrasada" (`Badge variant="destructive"`) foi adicionado no card
de "Próxima ação" da conversa, no `DealDetailModal` e na tela Tarefas (que já tinha uma view
"Atrasadas" dedicada, mas não um badge textual no card) — sem alarme visual exagerado, como pedido.

## 12. Fechamento operacional — 19/20 de setembro de 2026

Revisão inicial: `main` em `8a45ec3`, sincronizada com `origin/main`; 6 arquivos modificados e 5 novos.
Todos pertenciam à Fase 3. A separação do antigo modal misto de tarefa/proposta em Conversas
preserva o fluxo de proposta existente; nenhuma capacidade de Propostas ou Fase 4 foi adicionada.
Nenhuma mudança de schema, endpoint, migration ou backfill.

### Bugs encontrados e correções

- O DealDetailModal dentro de Conversas revalidava apenas negócios. Agora revalida também tarefas
  após criar, concluir e reagendar, atualizando a próxima ação imediatamente.
- O novo reagendamento cortava strings ISO e confundia UTC com horário local. Agora interpreta o
  instante antes de preencher datetime-local. Criação rápida e reagendamento serializam o horário
  local em ISO antes de enviar ao timestamptz existente. Exemplo: 14:00 em São Paulo → 17:00Z →
  input 14:00. Sem novo conceito de fuso por workspace.
- A próxima ação não mostrava o responsável; passou a usar o resolvedor userLabel existente.
- Erro ao concluir em Conversas agora gera toast, como os outros pontos de entrada.
- Negócios carregava somente tarefas pendentes, ocultando as concluídas na aba Atividades.
  Agora carrega o histórico e continua filtrando as pendentes para a próxima ação.
- O acesso a Ver atividades no resumo do negócio estava disponível só com mais de cinco tarefas;
  agora aparece quando há atividades pendentes.
- Inputs de data dos novos formulários receberam nomes acessíveis.

### Timezone e riscos herdados

`WORKSPACE_TIMEZONE = NOT_IMPLEMENTED_PREEXISTING`.

Datas são exibidas no fuso do navegador. O ajuste de serialização dos dois novos formulários evita
perder o horário escolhido, mas não cria configuração de timezone por workspace. O formulário
legado da tela geral ainda envia datas sem offset; mantido como risco sistêmico preexistente.
A definição de atraso também é herdada: telas de tarefa usam início do dia; Home usa instante atual.
O atalho Abrir conversa segue a resolução existente de Contatos/Negócios: a última conversa do
Contact retornada pela listagem vence no mapa. Não há seletor novo de canal.

### Verificação

- Backend: `tsc --noEmit` e `architecture:check` passaram novamente após as correções.
- Backend: 34/34 testes em `crm-execucao-comercial`, `crm-conversas-integration`,
  `crm-pipelines-deals` e `crm-inteligencia`; banco isolado PGlite dos testes, não produção.
- Frontend: `tsc --noEmit`, 52/52 testes Vitest e `npm run build` passaram após as correções.
- Novo `web/e2e/phase3-tasks.spec.ts`: Chrome real, fixtures HTTP explícitas, fuso São Paulo,
  desktop 1440 × 900 e viewport 390 × 844. Isso é regressão de UI local, não QA autenticado
  da API de produção. Não simula teclado virtual de um aparelho físico.
- Casos: 0/1/2 negócios, vínculo explícito, criação inline, mesmo ID no reagendamento,
  toast de 403, conclusão, atualização do negócio embutido e consistência entre telas.
- Resultado: 10/10 cenários passaram (5 cenários em cada viewport).

### Commit de implementação

`9737237a3033ea8026c9858784db48588dd11582` — `feat(crm): integra tarefas e follow-up à jornada comercial`.
Inclui as correções descobertas na revisão, 14 testes unitários de agendamento e os cenários de UI.

### Deploy e QA de produção

`DEPLOYED_SHA = 5bd44a3fc0b0fe9b3952581ae09febaac39828b3`.

Esse commit (`docs: registra validação local da Fase 3 comercial`) inclui a implementação
`9737237a3033ea8026c9858784db48588dd11582`. Push normal para `origin/main`, sem force;
HEAD == origin/main e working tree limpa antes do empacotamento.

- Pacote: `git archive --format=tar` do SHA exato, 26.163.200 bytes.
- SHA-256 conferido localmente e no servidor:
  `7c78ac412b80d0731bef4e49c3361a1f29c5d1b6f9a26c39807535f4ce2b46e0`.
- Backup: `/opt/zuno/deploy_backups/pre-phase3-20260920T022921Z.tgz`.
- Extração em `/opt/zuno`; `tar -df` confirmou o conteúdo do archive antes e depois do build.
- Build/recreate dirigido a `zuno-api`, `zuno-web`, `vorix-worker`, usando o Compose existente.
- Nenhuma migration nova, nenhum comando de migration/backfill executado. Os hooks idempotentes
  já existentes no startup da API foram preservados.
- SHA-256 de `.env.zuno` antes/depois idêntico:
  `3470644bf708162fba7590256a2c4cc0e2c3acd981c39396b064888e91e4fa5c`.
- `INBOX_CRM_AUTO_CONTACT_ENABLED=false` efetivo, confirmado no worker após o deploy.
- Nenhuma flag foi editada.

**Ocorrência operacional:** a comparação inicial do texto bruto de `Config.Env` divergiu e
interrompeu o script depois de iniciar os containers. A investigação confirmou o mesmo
`com.docker.compose.config-hash` dos três serviços antes/depois, o mesmo `.env.zuno`, e nenhuma
divergência de valor entre o runtime e a configuração resolvida do Compose/imagem. O hash bruto
não foi usado como prova de equivalência. O registro do SHA só foi finalizado após essas
verificações e nova conferência do archive. Não foi necessária alteração de aplicação nem redeploy.

### Saúde e smoke pós-deploy

Verificado em **2026-09-20 02:33 UTC** (19/09, 23:33 em São Paulo).

`PRODUCTION_HEALTH = PASS`, com o aviso preexistente de readiness descrito abaixo.

| Checagem | Resultado |
|---|---|
| API | running / Docker healthy; `/v1/health` HTTP 200, status ok |
| WORKER | running / Docker healthy; ponte automática false |
| WEB | running; `/` e `/login` HTTP 200; login renderiza no Chrome |
| `/readyz` | HTTP 200, ready=true; database, secrets, operations e fila PASS |
| Aviso de readiness | status degraded por production_guard=warn, preexistente na Fase 2; configuração preservada |
| Logs desde 02:29:21Z | 0 ocorrências de error/fatal/uncaught/unhandled/níveis 50–60 nos três serviços |
| Login, 1440 e 390 | Campos e botão renderizam, sem pageerror ou overflow horizontal |
| Home, Conversas, Contatos, Negócios, Tarefas sem sessão | Redirecionam corretamente ao login; conteúdo autenticado não foi exercitado |

O frontend não possui Docker healthcheck; sua saúde foi verificada por HTTP e renderização real,
sem atribuir a ele um status Docker healthy inexistente.
**SMOKE_ANONYMOUS = PASS; SMOKE_AUTHENTICATED = PENDING_ACCESS**. Renderizar o login não comprova
autenticação bem-sucedida nem o funcionamento interno das cinco telas protegidas.

Evidências: [smoke JSON](qa/fase3/production-smoke.json),
[login de produção 1440](qa/fase3/production-login-1440.png),
[login de produção 390](qa/fase3/production-login-390.png).

### Histórico de commits do fechamento

- `9737237a3033ea8026c9858784db48588dd11582`: implementação final e regressões.
- `5bd44a3fc0b0fe9b3952581ae09febaac39828b3`: documentação pré-deploy; **SHA publicado**.
- O commit que contém esta atualização final e `docs/qa/fase3/` registra smoke, imagens e
  classificação; é somente documental e não altera o código da aplicação publicada.

### Browser QA e screenshots

Regressão local: 10/10 cenários passaram. Uma execução adicional de quatro cenários passou
para persistir os screenshots (a primeira usava anexos em memória do reporter).
Os dados das imagens são fixtures controladas; não são clientes de produção.

| Evidência local | Desktop | 390px |
|---|---|---|
| Criação inline | [1440](qa/fase3/local-1440-phase3-criacao-inline.png) | [390](qa/fase3/local-390-phase3-criacao-inline.png) |
| Reagendamento | [1440](qa/fase3/local-1440-phase3-reagendar.png) | [390](qa/fase3/local-390-phase3-reagendar.png) |
| Próxima ação e toast 403 | [1440](qa/fase3/local-1440-phase3-conversa.png) | [390](qa/fase3/local-390-phase3-conversa.png) |
| Contact 360 / atrasada | [1440](qa/fase3/local-1440-phase3-contact360.png) | [390](qa/fase3/local-390-phase3-contact360.png) |
| Home / tarefa atrasada | [1440](qa/fase3/local-1440-phase3-home.png) | [390](qa/fase3/local-390-phase3-home.png) |

Os screenshots de criação, reagendamento, próxima ação e Contact 360 foram inspecionados visualmente.
O Chrome confirma criação inline, ausência de overflow horizontal, nomes acessíveis dos inputs,
mesmo ID ao reagendar/concluir e navegação para `?conversation=conv-phase3`.
O teclado virtual real permanece sem evidência: viewport reduzida não equivale a aparelho físico.

### Limite da classificação de produção

Não foi fornecida conta de teste nem sessão autenticada de produção após a solicitação nesta rodada.
Não foram criados tokens artificialmente, alteradas credenciais, semeados dados pelo banco nem
modificadas conversas de clientes. O QA real autenticado continua bloqueado por esse acesso.
`PENDING_QA` distingue ausência de evidência de uma falha reproduzida; marcar esses itens como
`VERIFIED_RUNTIME` ou declarar um bug `FAILED` sem executar o fluxo seria incorreto.

| Critério em produção | Classificação | Evidência disponível / falta |
|---|---|---|
| CONVERSATION_CREATE_TASK | PENDING_QA | UI local: criação inline com Contact e Deal corretos |
| CONTACT_ONLY_TASK | PENDING_QA | UI local: contactId correto e dealId ausente |
| MULTIPLE_DEALS_TASK_CONTEXT | PENDING_QA | UI local: Sem negócio por padrão; escolha explícita do segundo Deal |
| NEXT_PENDING_TASK | PENDING_QA | UI local: tarefa criada exibida; prioridade da atrasada; vazio após concluir |
| DEAL_CREATE_TASK | PENDING_QA | UI local: negócio embutido atualiza imediatamente após criar/concluir |
| CONTACT_CREATE_TASK | PENDING_QA | UI local: Contact 360 cria sem navegar |
| TASK_RESCHEDULE | PENDING_QA | UI local: mesmo ID, ISO correto, erro 403 visível, sucesso atualiza |
| TASK_COMPLETE | PENDING_QA | UI local e backend: status done, completedAt; falta clique autenticado |
| OVERDUE_TASK | PENDING_QA | Fixture local aparece em Atrasadas, conversa, Contact 360 e Home |
| TASKS_SCREEN | PENDING_QA | UI local: agrupamento Atrasadas e contexto; demais ações sem QA produtivo |
| TASK_OPEN_CONVERSATION | PENDING_QA | UI local navega à conversa exata do Contact |
| TASK_HOME_INTEGRATION | PENDING_QA | UI local: tarefa controlada exibida no painel existente |
| TASK_CROSS_SCREEN_CONSISTENCY | PENDING_QA | Fixture única em Contact 360, Tarefas, Conversas e Home; sem duplicata |
| MOBILE_TASK_FLOW | PENDING_QA | 5/5 cenários em 390px; falta backend real e teclado virtual |
| WORKSPACE_TIMEZONE | NOT_IMPLEMENTED_PREEXISTING | Risco sistêmico documentado; não é o bloqueador desta fase |
| PHASE_3_PRODUCTION_READY | NO | Falta QA real autenticado, incluindo smoke funcional das telas privadas |

Para concluir, usar um workspace de teste autenticado e repetir o roteiro original completo:
conversa com Deal, sem Deal e múltiplos Deals; responsável atribuído; próxima tarefa após conclusão;
concluir/reagendar nas quatro telas; Ver no negócio; indicadores; mesma Task após reload; mobile
com teclado. Só então substituir PENDING_QA por VERIFIED_RUNTIME/PASS ou FAILED com evidência.

Fase 4 não iniciada. Nenhuma funcionalidade de Propostas adicionada.
