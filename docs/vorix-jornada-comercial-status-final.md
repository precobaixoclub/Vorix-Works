# Jornada Comercial Integrada — Status Consolidado (Fases 1–5)

> Atualizado em 20 de setembro de 2026, no fechamento operacional da Fase 5.
> `DEPLOYED_SHA = 4a388aa`. Este documento resume o estado de cada fase; os documentos individuais
> (`vorix-jornada-comercial-fase1-contatos.md` até `fase5-integracao-final.md`) têm o detalhe
> completo de cada um.

## Fase 1 — Ponte Inbox → CRM (Contatos)

**O quê**: bridge automática que cria/atualiza `Contact`/`ContactIdentity` a partir de conversas do
Inbox, controlada pela flag `INBOX_CRM_AUTO_CONTACT_ENABLED` (permanece `false` em produção — nunca
ativada sem pedido explícito). Deep-link do Contact 360, filtro de Conversas por `contactId`, e
backfill controlado (nunca executado em produção).

- Implementada: sim.
- Testada: sim (testes de integração real, isolamento multi-tenant).
- Deployada: sim (SHA `7fa49b8`).
- Runtime verificado: smoke real (containers saudáveis, flag confirmada `false` no log do worker).
- Pendências: QA autenticado (clicar numa conversa/Contact reais) nunca foi feito neste ambiente —
  `PENDING_QA` desde então, roteiro em `fase2-negocios.md` §22 (documentado junto da Fase 2 por
  terem sido fechadas na mesma rodada).

## Fase 2 — Conversa → Contato → Negócio

**O quê**: `QuickCreateDealModal`, seção COMERCIAL na conversa, negócios em andamento/ganhos/
perdidos no Contact 360, `LossReasonModal`, `resolveActiveDeal`/`groupDealsByStatus`.

- Implementada: sim.
- Testada: sim (79 testes de backend, 38 de frontend na época).
- Deployada: sim (SHA `7fa49b8`, mesmo deploy da Fase 1).
- Runtime verificado: smoke real PASS.
- Pendências: QA autenticado real nunca reportado pelo usuário — `PENDING_QA`.

## Fase 3 — Negócio → Tarefa / Próxima Ação

**O quê**: seção "Próxima ação" na conversa, "Próximas atividades" no `DealDetailModal`, aba
Tarefas do Contact 360 (Atrasadas/Próximas/Concluídas), Reagendar/"Abrir conversa" na tela Tarefas.
Backend de Task já existia pronto antes desta fase — o trabalho foi todo frontend.

- Implementada: sim (parte por outra sessão, backend; frontend nesta jornada).
- Testada: sim (12 testes novos de frontend, suíte de backend relevante sem regressão).
- Deployada: sim (commits `9737237`/`5bd44a3`/`df885cc`, incluídos no deploy da Fase 4).
- Runtime verificado: smoke real PASS junto do deploy da Fase 4.
- Pendências: QA autenticado real — `PENDING_QA`.

## Fase 4 — Propostas

**O quê**: ciclo completo de Proposta (templates, envio por WhatsApp via ponte
`proposal-delivery-use-cases.ts`, link público com token só em hash SHA-256, tracking de
visualização, aceite move o Deal pra Ganho, recusa nunca move o Deal).

- Implementada: sim (substancialmente pré-existente, auditada e com gaps reais fechados nesta
  jornada: mojibake, guard de isolamento sem cobrir `commercial`/`commercial-bridge`,
  `ProposalDetailModal` incompleto, mensagens técnicas vazando na página pública, +4 testes).
- Testada: sim (suíte de propostas completa, isolamento multi-tenant, idempotência de envio).
- Deployada: sim (SHA `e89fd4b`, migration `0130_commercial_proposals_phase4` aplicada).
- Runtime verificado: smoke real PASS (rotas novas respondendo certo, sem erro nos logs).
- Pendências: QA autenticado real (aceitar/recusar uma proposta de verdade pela página pública,
  clicar no fluxo inteiro) — `PENDING_QA`.

## Fase 5 — Amarração Final (Timeline Comercial 360)

**O quê**: `GET /contacts/:id/activity` — ponte neutra que agrega `timeline_events` +
`inbox_conversation_events` numa Timeline 360 por Contato; Contact 360 "Histórico" consumindo isso;
ator sempre resolvido (nunca UUID cru); itens clicáveis; `isTaskOverdue` unificado (3 definições
divergentes viravam 1); `task_rescheduled` passou a ser gravado; bloco "Proposta visualizada sem
resposta" no Home; deep-link `?proposal=`; ação "Abrir cliente" na seção COMERCIAL da conversa
(gap real encontrado e corrigido); nomes de contato/negócio deixaram de ser texto morto em
`DealDetailModal`/`ProposalDetailModal`.

- Implementada: sim.
- Testada: sim (7 testes novos de backend — integração real via Postgres/pglite — + 4 de frontend;
  87 testes de backend de CRM/atendimento e 56 de frontend sem regressão).
- Deployada: sim (SHA `4a388aa`).
- Runtime verificado: smoke real PASS; rota nova confirmada viva em produção (401 correto pra
  requisição sem autenticação, nunca 500).
- Pendências: QA autenticado real (abrir o Histórico de um Contact de verdade, ver o bloco novo do
  Home renderizado com dados reais, testar os deep-links num navegador, QA mobile 390px) —
  `PENDING_QA`, mesma classificação de todas as fases anteriores.

## Visão geral

| Fase | Implementada | Testada | Deployada | Runtime (smoke) | QA autenticado real |
|---|---|---|---|---|---|
| 1 — Contatos | Sim | Sim | Sim (`7fa49b8`) | PASS | `PENDING_QA` |
| 2 — Negócios | Sim | Sim | Sim (`7fa49b8`) | PASS | `PENDING_QA` |
| 3 — Tarefas | Sim | Sim | Sim (via Fase 4) | PASS | `PENDING_QA` |
| 4 — Propostas | Sim | Sim | Sim (`e89fd4b`) | PASS | `PENDING_QA` |
| 5 — Timeline 360 | Sim | Sim | Sim (`4a388aa`) | PASS | `PENDING_QA` |

**O único item verdadeiramente pendente em todas as 5 fases é o mesmo**: uma sessão de navegador
autenticada real, clicando pelo produto com dados de produção — algo que nenhuma rodada deste
projeto teve ferramenta para fazer neste ambiente. O código está implementado, testado
automaticamente (unitário + integração real contra Postgres) e deployado com saúde confirmada em
todas as 5 fases; nenhuma classificação foi inflada para `VERIFIED_RUNTIME` sem essa evidência.

`COMMERCIAL_JOURNEY_PRODUCTION_READY = NO` — a lacuna exata para virar `YES` é: alguém com acesso
de navegador autenticado em produção percorrer os roteiros de QA já documentados em cada doc de
fase (Fase 1 `fase1-contatos.md` §20+, Fase 2 `fase2-negocios.md` §21–22, Fase 3
`fase3-tarefas.md`, Fase 4 `fase4-propostas.md` classificação final, Fase 5
`fase5-integracao-final.md` §22) e reportar o resultado — nenhuma nova feature nem correção de
código é necessária para isso, só a execução do QA real.
