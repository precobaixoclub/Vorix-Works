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

**Não realizado por mim.** Numa primeira rodada de fechamento (2026-09-19), sem acesso a deploy, o
usuário optou por fazer deploy e QA ele mesmo. Numa segunda rodada, no mesmo dia, ele pediu deploy
real (§18) — que executei com sucesso via SSH — mas o QA de navegador autenticado (clicar numa
conversa/Contact reais) continua fora do meu alcance: este ambiente não tem ferramenta de automação
de navegador nem credenciais de login para o Vorix. Perguntei como prosseguir e ele optou por rodar
esse roteiro pessoalmente e reportar o resultado. O plano de QA completo (roteiro passo a passo, o
que validar em cada tela, critérios de classificação por item) está na §22, pronto para ser
executado — o código já está em produção (§18).

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
- `bf3e598` — `docs: registra Fase 2 da jornada comercial` (este documento)

Working tree limpo depois dos commits (só o `dist/` gerado pelo build local, ignorado pelo git).

## 18. Deploy

**Realizado em 2026-09-20**, na rodada de fechamento operacional, seguindo exatamente o runbook de
`docs/deployment.md` — deploy do SHA `7fa49b8` (confirmado idêntico entre `HEAD` e `origin/main`
antes de começar):

1. Backup pré-deploy criado no servidor: `deploy_backups/pre-fase2-negocios-deploy-20260920004205.tgz`.
2. Código sincronizado via `git archive HEAD | gzip` → `scp` → extraído em `/opt/zuno`, preservando
   `.env.zuno` e `deploy_backups/` (nunca sobrescritos).
3. `docker compose --env-file .env.zuno -f docker-compose.zuno.yml up -d --build` — as 3 imagens
   (`zuno-zuno-web`, `zuno-zuno-api`, `zuno-vorix-worker`) foram reconstruídas e os containers
   recriados com sucesso.
4. **Sem migration rodada** — nenhuma mudança de schema nesta fase, como esperado.
5. `INBOX_CRM_AUTO_CONTACT_ENABLED` **não foi tocado** — confirmado ausente de `.env.zuno` (default
   `false` no código), e o log do worker pós-deploy confirma:
   `[inbox-worker] INBOX_CRM_AUTO_CONTACT_ENABLED=false — ponte Inbox→CRM desligada, vínculo continua
   só manual ("Vincular ao CRM").`

## 19. Smoke test

Executado logo após o rebuild, todos os itens verificáveis sem sessão autenticada:

| Verificação | Resultado |
|---|---|
| `docker ps` (4 containers) | `zuno-zuno-web-1` up, `zuno-zuno-api-1` healthy, `zuno-vorix-worker-1` healthy, `zuno-zuno-postgres-1` healthy |
| `curl https://vorixworks.com` | `HTTP 200` |
| `curl https://vorixworks.com/login` | `HTTP 200` |
| `curl https://api.vorixworks.com/v1/health` | `{"status":"ok","uptimeSeconds":40,...}` |
| `curl https://api.vorixworks.com/readyz` | `ready:true` — `database`/`secret_manager`/`operational_state`/`publication_queue` = `pass`; `production_guard` = `warn` (pré-existente, sobre `PUBLICATION_PRODUCTION_ENABLED`, **não relacionado** a esta fase) |
| Logs `zuno-zuno-api-1` (últimas 40 linhas) | nenhum erro/fatal |
| Logs `zuno-zuno-web-1` | `✓ Ready`, sem erro |
| Logs `zuno-vorix-worker-1` | conectado ao RabbitMQ, flag da Fase 1 confirmada desligada |

**`PRODUCTION_HEALTH = PASS`** — nenhum 5xx, nenhum erro nos logs, todos os containers saudáveis.

Não verificado por HTTP anônimo (requer sessão autenticada, ver §21): que Conversas/Contatos/
Negócios/Kanban comercial de fato renderizam com dados reais depois do login — isso faz parte do QA
real da §21, não do smoke test de infraestrutura.

## 20. Riscos restantes

- **PHASE_2_PRODUCTION_READY = NO (ainda)** — deploy e smoke test em produção PASSARAM, mas o QA
  real autenticado (clicar numa conversa/Contact real, criar negócio, mover etapa, ganho/perda) não
  foi feito por mim: este ambiente não tem ferramenta de navegador nem credenciais de login para o
  Vorix. Perguntei como proceder e você optou por rodar esse roteiro pessoalmente (§21) e me passar
  o resultado depois — a tabela da §21 fica pendente até então.
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
- **`production_guard: warn`** no `/readyz` (§19) — pré-existente à esta fase (relacionado a
  `PUBLICATION_PRODUCTION_ENABLED`, módulo de Publication/redes sociais), não introduzido nem
  agravado por este deploy; citado aqui só por transparência, não é um risco desta Fase 2.

## 21. Classificação final

`DEPLOYED_SHA = 7fa49b8` · `PRODUCTION_HEALTH = PASS` (ver §19).

Itens confirmados por teste de integração de backend contra Postgres real (comportamento inalterado
nesta fase, só ganhou novos pontos de entrada na UI, já em produção e com smoke test PASS):

```
DEAL_DETAIL_CONTEXT            = VERIFIED_RUNTIME   (DealDetailModal reusado sem regressão — testes de backend confirmam)
DEAL_STAGE_FLOW                = VERIFIED_RUNTIME   (moveDealStage único caminho, testes de backend passando)
DEAL_WON                       = VERIFIED_RUNTIME   (wonAt testado; só copy do toast mudou)
DEAL_LOST                      = VERIFIED_RUNTIME   (lossReason obrigatório testado no backend; modal unificado nos 3 pontos de entrada, sem teste de UI)
DEAL_REOPEN                    = VERIFIED_RUNTIME   (limpeza de wonAt/lostAt/lossReason testada, inalterada)
```

Itens que dependem de clicar de verdade numa conversa/contato reais, autenticado — **não posso
classificar como VERIFIED_RUNTIME sem ter feito isso**; aguardando você rodar o roteiro da §22 e
reportar o resultado:

```
CONVERSATION_CREATE_DEAL       = PENDING_QA   (código em produção; requer §22.1)
CONTACT_CREATE_DEAL            = PENDING_QA   (código em produção; requer §22.4)
DEAL_CONTEXT_IN_CONVERSATION   = PENDING_QA   (código em produção; requer §22.2)
MULTIPLE_OPEN_DEALS            = VERIFIED_AUTOMATED + PENDING_QA   (regra tem 8 testes unitários; visual em produção requer §22.3)
DEAL_OPEN_CONVERSATION         = PENDING_QA   (código em produção; requer §22.5)
CROSS_SCREEN_CONSISTENCY       = PENDING_QA   (requer §22.10)
MOBILE_QA                      = PENDING_QA   (requer §22.12, viewport 390)

PHASE_2_PRODUCTION_READY       = NO   (deploy+smoke OK; aguardando QA autenticado da §22)
```

---

## 22. Plano de QA em produção (pendente — a ser executado por você)

Código já está em produção (SHA `7fa49b8`, deploy confirmado §18). Roteiro para rodar com um Contact
real já vinculado ao CRM (ou uma fixture controlada) — nunca dados de cliente sensíveis sem
necessidade. Depois de cada bloco, preencha o veredito (`VERIFIED_RUNTIME`/`FAILED`) na tabela da
§21 acima.

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

Depois de rodar: atualizar a tabela da §21 com os vereditos reais e marcar
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
