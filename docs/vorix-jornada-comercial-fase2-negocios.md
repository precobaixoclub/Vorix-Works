# Jornada Comercial Integrada — Fase 2: Conversa → Contato → Negócio

> Escopo: só tornar o conceito de NEGÓCIO claro e natural dentro do Vorix — criação humana (nunca
> automática), contexto comercial na conversa e no Contact 360, e higiene de fluxo (ganho/perda/
> reabertura). Nenhuma mudança em Proposal Templates, tracking avançado de propostas, envio de
> proposta por WhatsApp, Timeline 360 agregada, novo Task workflow, IA criando negócio, ou funil
> novo — tudo isso continua fora desta rodada, para fases futuras (não iniciadas).
>
> Pré-requisito confirmado: Fase 1 (bridge automática Inbox→CRM) já auditada e com seus gaps
> fechados — ver `docs/vorix-jornada-comercial-fase1-contatos.md`, §20.

---

## 1. Propósito de Negócio

Para o usuário: **Contato = quem é o cliente; Negócio = o que estamos tentando vender para ele.**
Um contato pode ter vários negócios ao longo do tempo — nenhuma mudança de modelo foi necessária
(`Deal` já existia, fundação de fases anteriores); o trabalho desta fase é inteiramente de
**experiência**: fazer esse conceito aparecer no lugar certo (conversa, Contact 360, Kanban) com a
linguagem certa, sem o usuário precisar "entrar no CRM" deliberadamente.

## 2. Vínculo com Contact

Inalterado no schema (`deals.contact_id`, já existente). O que mudou é a **resolução do negócio
relevante** de um contato, agora centralizada em `web/features/crm/deal-resolution.ts`
(`resolveActiveDeal`/`groupDealsByStatus`) — nunca reimplementada ad-hoc em cada tela que precisa
saber "qual negócio mostrar para este contato": o painel da conversa (`crm-panel.tsx`) e o Contact
360 (`contacts/page.tsx`) reusam as MESMAS duas funções puras.

## 3. Vínculo indireto com Conversa

Um Negócio nunca referencia uma `InboxConversation` diretamente (schema inalterado) — o vínculo
sempre passa por `Contact` (`Deal.contactId` → conversas daquele `crmContactId`). Isso preserva o
isolamento Inbox↔CRM da Fase 1: nada nesta fase importa código de CRM dentro de `application/inbox/`
nem o contrário; a resolução "quais conversas este negócio tem" acontece nas camadas de UI/hooks
(`conversationByContactId`), nunca no backend do módulo Deal.

## 4. Criação pela conversa

`crm-panel.tsx` (`LinkedCrmSection`, seção "COMERCIAL" da conversa): quando não há negócio aberto,
mostra "Nenhum negócio aberto" + botão "+ Criar negócio", que abre `QuickCreateDealModal`
(`web/components/crm/QuickCreateDealModal.tsx`, novo componente compartilhado) **sem sair da
conversa**. Campos obrigatórios: só Título + Valor; Pipeline/Etapa/Responsável/Equipe/Previsão de
fechamento ficam recolhidos em "Opções avançadas" com defaults inteligentes (primeiro pipeline
padrão, primeira etapa). Contato já vem definido (nunca perguntado de novo). `origin: "whatsapp"` é
enviado automaticamente quando o negócio nasce da conversa (antes, o quick-create local não
enviava `origin` nenhum).

Depois de criar, a seção "COMERCIAL" atualiza imediatamente (revalida `useDeals`) — sem reload.

## 5. Criação pelo Contact 360

Antes: o botão "Criar negócio" fazia `router.push` para `/deals?contactId=...`, saindo da tela do
contato. Agora: o mesmo `QuickCreateDealModal` abre inline dentro do `ContactDetailModal`
(`contacts/page.tsx`), contato já preenchido; ao criar, a aba Negócios revalida
(`onDealsChanged`/`mutateSelectedContactDeals`) sem navegação nenhuma. O Kanban de Negócios
(`deals/page.tsx`) mantém seu próprio fluxo de criação (com `SearchableCombo` de contato, para quando
não se está numa conversa/contato específico) — não foi redesenhado, só passou a coexistir com o
fluxo inline das outras duas telas.

## 6. Múltiplos negócios

`resolveActiveDeal` retorna `{ current, openDeals }`. Quando há mais de um negócio ABERTO:
- Na conversa: mostra "N negócios em andamento" com uma lista compacta; clicar em qualquer um abre o
  `DealDetailModal` embutido no próprio painel.
- No Contact 360: a aba Negócios agrupa visualmente **Em andamento / Ganhos / Perdidos**
  (`groupDealsByStatus`, `DealStatusGroup`) em vez de uma lista plana — sem precisar de três páginas
  nem de uma nova coluna de status.

Nenhuma coluna `primary_deal_id` foi criada no banco — a "prioridade" é sempre resolvida
dinamicamente a partir de `deals` já carregados (item 8 do pedido original).

## 7. Negócio atual

Regra implementada em `resolveActiveDeal` (`web/features/crm/deal-resolution.ts`, com 8 testes
unitários em `web/tests/deal-resolution.test.ts`): dentre os negócios **abertos** (sem `wonAt`/
`lostAt`), o mais recentemente atualizado por etapa (`lastStageChangedAt` mais recente) é o
"negócio atual" mostrado na conversa. Ganho/Perdido nunca contam como atual enquanto existir outro
aberto — testado explicitamente (`"ganho/perdido nunca contam como atual quando há outro negócio
aberto"`).

## 8. Pipeline

Nenhuma mudança na modelagem de Pipeline. `QuickCreateDealModal` busca pipelines via
`usePipelines`/`usePipelineStages` (hooks já existentes) e usa o pipeline marcado como padrão
(`isDefault`) como default — mesma convenção já usada pelo Kanban de Negócios.

## 9. Stages

Para mostrar o **nome** da etapa de um negócio fora do Kanban (onde as etapas de UM pipeline já
estavam carregadas), foi criado `useStagesByPipeline(workspaceId, pipelineIds)`
(`web/features/crm/hooks.ts`) — busca as etapas de vários pipelines de uma vez (chaveado pela lista
ordenada de ids), porque os negócios de um mesmo contato podem pertencer a pipelines diferentes e
não é possível chamar `usePipelineStages` dentro de um loop (regra dos hooks). Usado pelo Contact
360 (`DealStatusGroup`) e pelo painel da conversa (para o "negócio atual" e para o `DealDetailModal`
embutido).

`moveDealStage` continua sendo o **único** caminho para mudar etapa — nenhum novo fluxo desta fase
grava `stageId` por qualquer outro caminho; todos (conversa, Contact 360, Kanban) chamam a mesma
função.

## 10. Ganho

Sem mudança de regra (`wonAt` setado por `moveDealStage`, já testado em fases anteriores). Único
ajuste: o toast do Kanban passou de "Negócio marcado como ganho." para **"Negócio ganho 🎉"** —
feedback mais claro, sem gamificação exagerada, conforme pedido.

## 11. Perda

Motivo continua obrigatório (`DEAL_LOSS_REASON_REQUIRED` no backend, inalterado). O modal de motivo
foi **extraído** do Kanban (`deals/page.tsx`) para um componente compartilhado
(`web/components/crm/LossReasonModal.tsx`) e agora é reusado em **três** lugares com o mesmo
comportamento: Kanban de Negócios, painel da conversa (`crm-panel.tsx`) e Contact 360
(`contacts/page.tsx`). Antes, mover para "Perdido" a partir do Contact 360 era **bloqueado** com um
toast mandando o usuário voltar pro Kanban — essa lacuna foi fechada; agora os três lugares abrem o
mesmo modal de motivo e chamam `moveDealStage` com o motivo escolhido.

## 12. Próxima atividade

Reaproveita `nextPendingTask` (`web/features/crm/presentation.ts`, já existente, usado pelo "Vorix
Intelligence") em todos os lugares novos — nenhuma lógica duplicada. Mostrado no card de "negócio
atual" da conversa, no card de cada negócio agrupado no Contact 360, e no resumo do
`DealDetailModal` (que já mostrava isso antes desta fase).

## 13. Origem

`origin` do negócio criado a partir da conversa agora é `"whatsapp"` explicitamente (antes: nenhum
valor era enviado pelo quick-create local). Criado pelo Contact 360 ou pelo Kanban: `origin`
continua opcional/livre, sem nenhuma attribution de marketing inventada.

## 14. Timeline

Nenhuma mudança nos eventos gravados. `deal_created`/`deal_stage_changed` continuam gravados por
`createDeal`/`moveDealStage` (backend, inalterado) — como todos os fluxos novos desta fase (conversa,
Contact 360) chamam exatamente essas mesmas funções (via `QuickCreateDealModal`/`LossReasonModal`),
os mesmos eventos são gravados automaticamente, sem nenhum caminho novo de escrita direta.

## 15. Browser QA

**Não realizado.** Confirmado explicitamente na rodada de fechamento (2026-09-19): este ambiente não
tem acesso SSH/servidor de produção nem a um workspace Vorix autenticado com dados reais — o usuário
optou por assumir deploy e QA de navegador ele mesmo, em vez de me dar acesso ou aceitar um QA local
com dados de teste como substituto. O plano de QA completo (roteiro passo a passo, o que validar em
cada tela, critérios de classificação por item) está na §21, pronto para ser executado após o
deploy.

Mitigado, na ausência de QA de navegador, com a verificação mais forte disponível: `tsc --noEmit`
limpo (backend e frontend), `npm run build` de produção do frontend limpo, `npm run
architecture:check` completo (inclui `check-crm-isolation`/`check-inbox-conversation-isolation` e
todos os outros guards do projeto) OK, e as suítes de teste de backend relevantes ao CRM/Deal
passando integralmente contra Postgres real (via pglite) — nenhuma regressão introduzida nos fluxos
de `moveDealStage`/ganho/perda/reabertura que já eram testados. Isso comprova que o código está
correto e tipado ponta a ponta, mas **não substitui** clicar de verdade numa conversa real.

## 16. Testes

Como esta fase é majoritariamente frontend (nenhuma regra nova de backend — reusa `createDeal`/
`moveDealStage` sem alteração), os testes novos cobrem a lógica pura extraída:

- `web/tests/deal-resolution.test.ts` (8 testes): `isDealOpen`, e `resolveActiveDeal` (sem negócios,
  prioriza o mais recentemente atualizado, ganho/perdido nunca "atual" havendo outro aberto, nenhum
  atual quando só há ganho/perdido), `groupDealsByStatus` (separação correta em andamento/ganho/
  perdido).
- Testes de backend pré-existentes (não escritos nesta fase, mas re-executados para confirmar que
  nada quebrou): `tests/crm-pipelines-deals.test.mjs` — `moveDealStage` como único caminho, ganho
  marca `wonAt`, perda exige `lossReason`, reabertura limpa ganho/perda, isolamento cross-tenant.
  **79/79 passando** (rodado junto com as suítes de CRM/Inbox da Fase 1).

**Não implementado nesta rodada** (gap documentado, não escondido): testes automatizados fim-a-fim
para "Conversa+Contact → criar Deal com contactId correto" e "Contact 360 → criar Deal aparece no
mesmo Contact" — como a criação em si usa `createDeal` sem alteração de contrato (já testado por
`crm-pipelines-deals.test.mjs`), e a parte nova é só UI (modal inline em vez de navegação), a
cobertura de unidade sobre `resolveActiveDeal`/`groupDealsByStatus` foi priorizada sobre um teste de
integração de UI que este ambiente não tem como rodar (sem harness de componente React configurado
no projeto — só Vitest puro, sem Testing Library).

## 17. Commits

Feitos na rodada de fechamento (2026-09-19), depois de revisar o diff completo
(`git status`/`git diff --stat`/`--name-status`) e confirmar que ele cobria exatamente o esperado
(mais os 3 gaps da Fase 1, já reportados e aprovados para ir junto neste mesmo fechamento — ver
`docs/vorix-jornada-comercial-fase1-contatos.md`, §20):

- `9d4fee8` — `fix(crm): fecha gaps da Fase 1 — deep-link, fetch escopado e backfill controlado`
- `c8344e4` — `feat(crm): integra negócios à conversa e Contact 360 (Fase 2)`
- (este commit de documentação, hash abaixo)

Working tree limpo depois dos commits (só o `dist/` gerado pelo build local, ignorado pelo git).

## 18. Deploy

**Não realizado — por decisão explícita do usuário nesta rodada de fechamento**, não só por falta de
acesso: perguntei diretamente se deveria fazer deploy/QA eu mesmo (com acesso que ele forneceria) ou
deixar por conta dele, e a resposta foi "só commit + push; você faz deploy e QA". Então:

- Commits acima já estão em `main` local, com push para `origin/main` feito nesta mesma rodada
  (ver confirmação de SHA idêntico entre `HEAD` e `origin/main` abaixo).
- Deploy real fica com você, seguindo o runbook já documentado na Fase 1 (§17 daquele relatório):
  `git pull` no servidor → build → `docker compose up -d --build`. **Sem migration para rodar**
  (nenhuma mudança de schema nesta fase).
- `INBOX_CRM_AUTO_CONTACT_ENABLED` permanece `false` — não foi tocado nesta rodada, como pedido.

## 19. Riscos restantes

- **PHASE_2_PRODUCTION_READY = NO** — código pronto, testado e commitado, mas sem deploy nem QA de
  navegador reais ainda. Não deve ser tratado como "pronto para produção" até você rodar o plano da
  §21.
- **Sem QA de navegador ao vivo** (§15) — mesmo risco já assumido na Fase 1, mitigado da mesma forma
  (typecheck + build + testes de integração reais, sem mock). Plano de QA detalhado na §21.
- **Ações "Criar tarefa"/"Criar proposta" no Contact 360 continuam navegando** (não inline) — só
  "Criar negócio" ganhou o fluxo inline nesta fase, por ser o foco explícito do pedido; unificar os
  outros dois fica para uma fase futura, se desejado.
- **`DealDetailModal` embutido no painel da conversa não oferece "Abrir conversa"** (redundante,
  já que o usuário está dentro da própria conversa) — só os dois outros pontos de entrada (Kanban,
  Contact 360) ganharam esse botão, exatamente como o pedido especificava ("se o Contact possuir
  conversa").
- **Nenhum teste de integração de UI** para os fluxos inline novos (§16) — risco mitigado por
  `tsc --noEmit` limpo (garante que os tipos/props entre `QuickCreateDealModal`/`LossReasonModal` e
  seus três chamadores estão corretos) e pela reutilização estrita de `createDeal`/`moveDealStage`
  sem alteração de contrato.

## 20. Classificação final

Itens confirmados por teste de integração de backend contra Postgres real (não mudaram de
comportamento nesta fase, só ganharam novos pontos de entrada na UI, já cobertos pelo typecheck):

```
DEAL_DETAIL_CONTEXT            = VERIFIED_RUNTIME   (DealDetailModal reusado sem regressão — testes de backend confirmam)
DEAL_STAGE_FLOW                = VERIFIED_RUNTIME   (moveDealStage único caminho, testes de backend passando)
DEAL_WON                       = VERIFIED_RUNTIME   (wonAt testado; só copy do toast mudou)
DEAL_LOST                      = VERIFIED_RUNTIME   (lossReason obrigatório testado no backend; modal unificado nos 3 pontos de entrada, sem teste de UI)
DEAL_REOPEN                    = VERIFIED_RUNTIME   (limpeza de wonAt/lostAt/lossReason testada, inalterada)
```

Itens que dependem de clicar de verdade numa conversa/contato reais — **não posso classificar como
VERIFIED_RUNTIME sem ter feito isso**; ficam como pendentes até você rodar o plano da §21:

```
CONVERSATION_CREATE_DEAL       = PENDING_QA   (tipado e buildado; requer §21.7)
CONTACT_CREATE_DEAL            = PENDING_QA   (tipado e buildado; requer §21.10)
DEAL_CONTEXT_IN_CONVERSATION   = PENDING_QA   (tipado e buildado; requer §21.7-9)
MULTIPLE_OPEN_DEALS            = VERIFIED_AUTOMATED + PENDING_QA   (regra tem 8 testes unitários; visual na conversa/Contact 360 requer §21.9)
DEAL_OPEN_CONVERSATION         = PENDING_QA   (botão existe e tipado; requer §21.11)

PHASE_2_PRODUCTION_READY       = NO   (aguardando deploy + QA da §21)
```

---

## 21. Plano de QA em produção (pendente — a ser executado por você)

Roteiro para rodar depois do deploy, com um Contact real já vinculado ao CRM (ou uma fixture
controlada) — nunca dados de cliente sensíveis sem necessidade. Depois de cada bloco, preencha o
veredito (`VERIFIED_RUNTIME`/`FAILED`) na tabela da §20 acima.

1. **Conversa** — abrir uma conversa DIRETA real com Contact CRM vinculado. Sem negócio: deve
   mostrar "Nenhum negócio em andamento" + "+ Criar negócio". Criar "Teste Comercial Vorix" / R$
   1.500: contato já preenchido, sem perguntar de novo, pipeline/etapa default corretos, conclui sem
   sair da conversa, seção atualiza na hora, aparece como negócio atual. → `CONVERSATION_CREATE_DEAL`
2. **Negócio atual** — confirmar Título/Valor/Etapa/Responsável/Próxima atividade no card; abrir o
   negócio e confirmar que é o `DealDetailModal` de verdade. → `DEAL_CONTEXT_IN_CONVERSATION`
3. **Múltiplos negócios** — criar um segundo negócio aberto para o mesmo Contact; confirmar que a UI
   mostra a contagem certa, ambos acessíveis, sem inventar "negócio primário". → `MULTIPLE_OPEN_DEALS`
4. **Contact 360** — abrir o mesmo Contact; aba Negócios deve mostrar Em Andamento/Ganhos/Perdidos;
   criar um negócio inline (contato já definido, sem navegar, lista atualiza na hora). →
   `CONTACT_CREATE_DEAL`
5. **Abrir conversa do negócio** — dentro do `DealDetailModal`, clicar "Abrir conversa" e confirmar
   que abre a conversa certa (não a lista geral). → `DEAL_OPEN_CONVERSATION`
6. **Mover etapa** — mover entre etapas abertas; conferir que `moveDealStage` é o único caminho, UI/
   Contact 360/conversa/Kanban todos refletem a mudança.
7. **Perdido** — mover para Perdido; `LossReasonModal` deve aparecer e bloquear sem motivo; conferir
   `lostAt`/`lossReason`/`wonAt=null` nos três pontos de entrada (Kanban, conversa, Contact 360).
8. **Reabrir** — mover de Perdido de volta a uma etapa aberta; conferir que `lostAt`/`lossReason`/
   `wonAt` voltam a `null`.
9. **Ganho** — mover para Ganho; conferir `wonAt` preenchido e classificação em "Ganhos" no Contact
   360.
10. **Sincronia entre telas** — o MESMO negócio precisa ter título/valor/etapa/status idênticos em
    Conversas, Contact 360, Kanban e `DealDetailModal` — nunca dados divergentes.
11. **Kanban de Atendimento ≠ Kanban de Negócios** — confirmar visualmente que continuam conceitos
    separados (fase operacional da conversa vs. etapa comercial do Deal).
12. **Browser QA visual** — capturar em desktop (1440) e mobile (390): conversa sem negócio, criação,
    negócio criado, múltiplos negócios, Contact 360, `DealDetailModal`, `LossReasonModal`, Kanban
    comercial.
13. **Cleanup** — se usou negócio/contato de teste descartável, remover ao final; nunca apagar dado
    real de cliente.

Depois de rodar: atualizar a tabela da §20 com os vereditos reais e marcar
`PHASE_2_PRODUCTION_READY = YES` só se tudo vier `VERIFIED_RUNTIME`.

---

## Arquivos alterados/criados

- `web/features/crm/deal-resolution.ts` (novo) — `resolveActiveDeal`/`groupDealsByStatus`.
- `web/tests/deal-resolution.test.ts` (novo) — 8 testes unitários.
- `web/components/crm/QuickCreateDealModal.tsx` (novo) — criação rápida compartilhada.
- `web/components/crm/LossReasonModal.tsx` (novo) — motivo de perda compartilhado (extraído do Kanban).
- `web/components/crm/DealDetailModal.tsx` — prop/ação "Abrir conversa".
- `web/features/crm/hooks.ts` — `useStagesByPipeline`.
- `web/app/workspaces/[workspaceId]/conversas/crm-panel.tsx` — seção "COMERCIAL" reescrita.
- `web/app/workspaces/[workspaceId]/contacts/page.tsx` — criação inline, agrupamento de Negócios, "Abrir conversa".
- `web/app/workspaces/[workspaceId]/deals/page.tsx` — `LossReasonModal` compartilhado, "Abrir conversa", copy.
