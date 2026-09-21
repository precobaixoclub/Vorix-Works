# Jornada Comercial Integrada — Status Final (Fases 1–5)

> Operational QA final executado em produção em 20 de setembro de 2026 (21 de setembro UTC).
> `DEPLOYED_SHA = c010919`. Workspace exclusivo: `ws-homolog-whatsapp` (`Homologacao WhatsApp Real`).
> Usuário real de QA com papel `editor`; nenhum bypass de autenticação, JWT fabricado, backfill,
> migration ou alteração de flag.

## Resultado operacional

O QA percorreu a jornada com dados controlados criados pela interface: um Contact, dois Deals, uma
Task, um Proposal Template e duas Proposals. A mesma identidade foi conferida em Home, Contact 360,
Negócios, Tarefas, Propostas e Timeline. A sessão real foi usada de forma sequencial e o
`storageState` rotativo permaneceu fora do Git.

Não havia conversa controlada no workspace e não foi fornecido número WhatsApp externo de teste.
Esses dois pontos continuam pendentes externos; nenhum telefone real ou aleatório foi usado.

Para exercitar o ciclo público sem enviar WhatsApp, as duas Proposals criadas pela UI foram
transicionadas para `sent` por uma chamada temporária e auditável ao use case `sendProposal` dentro
do container da API. Isso registrou `proposal_sent`, não chamou o provedor e não é evidência de
envio por WhatsApp.

## Cenários executados

- Login real, Home e telas privadas: PASS.
- Contact 360: seis seções carregaram dados reais; nenhum UUID/JID/LID/token apareceu na UI.
- Deal `QA Comercial`, R$ 1.500: criado inline, pipeline padrão, etapa inicial `Novo`.
- Task `Follow-up`: criada para Contact/Deal, reagendada mantendo o ID, exibida atrasada na Home e
  concluída; permaneceu em Concluídas e saiu das pendências.
- Template: defaults selecionados. Depois da criação, o modelo foi alterado e a Proposal preservou
  `Proposta QA Comercial`, confirmando snapshot.
- Proposal 1: criada para o primeiro Deal, aberta anonimamente mais de uma vez, tracking registrado,
  aceita; Proposal `accepted` e Deal em `Ganho`.
- Proposal 2: criada para o segundo Deal, visualizada e recusada; Proposal `rejected` e Deal em
  `Novo`, com ações de nova tarefa/proposta e perda manual disponíveis.
- Home Intelligence: tarefa atrasada, oportunidade sem próxima ação e Proposal visualizada sem
  resposta apareceram quando aplicáveis. Após resolução, tarefa e Proposal encerradas sumiram.
- Timeline 360: contato, negócios, Task, Proposals e ganho apareceram em ordem, sem IDs crus. Links
  de Deal e Proposal abriram o contexto correto.
- Deep links suportados `?contactId=`, `?dealId=` e `?proposal=` passaram em abertura, refresh e
  Back. A aplicação não implementa `?contact=`; o contrato existente é `?contactId=`.
- Mobile 390 px: Home, Contact 360, Deal, Tarefas, Proposal, Timeline e página pública sem overflow
  horizontal crítico; botões, modais e scroll acessíveis.

## Bugs encontrados e corrigidos

1. **Página pública exigia login.** `/p/<token>` era redirecionado para `/login`. O proxy agora
   libera `/p/`; foi adicionado E2E sem cookie. Commit `a8e12d8`.
2. **Home ignorava o encerramento da Proposal.** O frontend enviava `status=viewed`, o repositório
   já suportava o filtro, mas a rota descartava o parâmetro. A rota/use case agora o propagam e há
   regressão `draft`/`sent`. Commit `c010919`.

As correções foram publicadas e retestadas no mesmo cenário. O commit documental seguro `f08f6c4`
também entrou no push; `.qa/` continua ignorado.

## Verificação

- Frontend: typecheck, build e 56/56 testes Vitest.
- E2E: página pública sem cookie e fluxo público em 1440/390; execução focal final 4/4.
- Backend: `architecture:check`; suíte Fase 4 de propostas 9/9 em PGlite.
- Builds de produção sem migration; backups preservados em `/opt/zuno/deploy_backups/`.

## Saúde pós-deploy

Verificado em 21/09/2026 02:20 UTC:

| Checagem | Resultado |
|---|---|
| API `/v1/health` | HTTP 200, status `ok` |
| `/readyz` | HTTP 200, `ready=true`; aviso preexistente `production_guard=warn` |
| WEB | HTTP 200; página pública anônima e telas autenticadas em Chrome |
| Containers | API/worker/PostgreSQL healthy; web running |
| Logs críticos (30 min) | 0 em API, web e worker |

Na renovação houve 401/403 esperados do refresh antigo após rotação/restart. A UI também consulta
`/teams` com o papel `editor` e recebe 403, e o stream do Inbox pode registrar reconexão/CORS quando
expira; nenhum bloqueou os fluxos. Não houve 5xx, pageerror, erro React ou loop anormal no final.

## Evidências

- [Contact 360 desktop](qa/commercial-final/contact360-desktop.png)
- [Home Intelligence](qa/commercial-final/home-intelligence-desktop.png)
- [Home após resolver as pendências](qa/commercial-final/home-resolved-desktop.png)
- [Deal ganho](qa/commercial-final/deal-won-desktop.png)
- [Task concluída](qa/commercial-final/tasks-completed-desktop.png)
- [Proposal aceita](qa/commercial-final/proposal-accepted-desktop.png)
- [Snapshot da Proposal](qa/commercial-final/proposal-snapshot-desktop.png)
- [Timeline desktop](qa/commercial-final/timeline-desktop.png)
- [Página pública desktop](qa/commercial-final/public-proposal-desktop.png)
- [Contact 360 mobile](qa/commercial-final/contact360-mobile.png)
- [Timeline mobile](qa/commercial-final/timeline-mobile.png)
- [Página pública mobile](qa/commercial-final/public-proposal-mobile.png)

As imagens contêm somente dados do workspace de QA. Nenhum segredo ou token está visível.

## Classificação final

```text
AUTHENTICATED_QA = PASS
PRODUCTION_HEALTH = PASS
CONVERSATION_COMMERCIAL_CONTEXT = PENDING_EXTERNAL_CONVERSATION
CONTACT_360 = VERIFIED_RUNTIME
DEAL_FLOW = VERIFIED_RUNTIME
TASK_FLOW = VERIFIED_RUNTIME
TASK_RESCHEDULE = VERIFIED_RUNTIME
TASK_COMPLETE = VERIFIED_RUNTIME
PROPOSAL_TEMPLATE = VERIFIED_RUNTIME
PROPOSAL_CREATE = VERIFIED_RUNTIME
PUBLIC_PROPOSAL = VERIFIED_RUNTIME
PROPOSAL_VIEW_TRACKING = VERIFIED_RUNTIME
PROPOSAL_ACCEPT = VERIFIED_RUNTIME
DEAL_WON_FROM_PROPOSAL = VERIFIED_RUNTIME
PROPOSAL_REJECT = VERIFIED_RUNTIME
REJECT_KEEPS_DEAL_OPEN = VERIFIED_RUNTIME
TIMELINE_360 = VERIFIED_RUNTIME
TIMELINE_DEEP_LINKS = VERIFIED_RUNTIME
DEEP_LINKS = VERIFIED_RUNTIME
HOME_COMMERCIAL_INTELLIGENCE = VERIFIED_RUNTIME
CROSS_SCREEN_CONSISTENCY = VERIFIED_RUNTIME
MOBILE_COMMERCIAL_FLOW = PASS
PROPOSAL_SEND_WHATSAPP = PENDING_EXTERNAL_TEST_NUMBER

COMMERCIAL_CORE_PRODUCTION_READY = YES
WHATSAPP_PROPOSAL_RUNTIME_VERIFIED = NO
COMMERCIAL_JOURNEY_PRODUCTION_READY = NO
```

O core interno está pronto. A jornada completa continua `NO` por dois critérios externos sem
evidência: contexto comercial dentro de uma conversa QA e envio real da Proposal por WhatsApp para
um número controlado. Fase 6 não foi iniciada.
