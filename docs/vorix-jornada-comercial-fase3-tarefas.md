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

Fechamento em andamento. Acesso SSH confirmado no host documentado em `docs/deployment.md`.
Acesso autenticado ao workspace foi solicitado ao operador e ainda não foi disponibilizado.
Nenhum resultado de fixture local será classificado como VERIFIED_RUNTIME de produção.
O deploy usa `git archive` do SHA confirmado no `origin/main`, backup prévio e comparação do
arquivo de ambiente e das variáveis de runtime dos três serviços.
`INBOX_CRM_AUTO_CONTACT_ENABLED` permanece efetivamente false (ausente, default false).

`PHASE_3_PRODUCTION_READY = NO` — até deploy, smoke e QA autenticado concluídos.
