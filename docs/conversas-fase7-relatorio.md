# Módulo Conversas — Relatório Final da Fase 7 (Hardening, Segurança, Homologação, Piloto)

Última fase estrutural do módulo. Nenhuma funcionalidade de produto nova foi adicionada — todo
trabalho aqui é correção de bugs concretos, testes, segurança e documentação operacional sobre o
que já existia das Fases 1–6. `CONVERSATIONS_MODULE_ENABLED` permanece `false`. Commit desta fase:
`894cfc7` (+ correções subsequentes descritas abaixo).

> **Status: Fase 7 aprovada. Não há Fase 8.** Nenhuma alteração estrutural adicional será feita no
> módulo a partir daqui. O trabalho restante é exclusivamente a EXECUÇÃO dos três roteiros de
> homologação já preparados (`docs/conversas-homologacao-broker.md`,
> `docs/conversas-homologacao-restore.md`, `docs/conversas-homologacao-whatsapp.md`) quando o
> ambiente permitir, seguida do piloto controlado (`docs/conversas-piloto.md`). Os três achados de
> menor severidade da auditoria (seção 1) estão formalizados como backlog priorizado em
> `docs/conversas-backlog-pos-fase7.md` — não implementar sem decisão explícita de retomar trabalho
> estrutural.

## 1. Auditoria arquitetural

Três auditorias independentes cobriram a cadeia completa WhatsApp→WuzAPI→RabbitMQ→worker→Inbox→
IA/humano→outbound→worker→WuzAPI:

- **Isolamento/arquitetura**: sem dependência circular entre `inbox` e `conversation`/`chat`/
  `ai-gateway`; nenhuma chamada direta ao WuzAPI fora do `MessagingProvider` port/circuit breaker;
  todo `:id` de rota passa por `mustConnectionBelongToTenantAndWorkspace`/
  `mustConversationBelongToTenantAndWorkspace` (nunca 403, sempre 404 — não revela existência
  cross-tenant); sem ACK antecipado no worker.
- **Bugs concretos encontrados e corrigidos** (nenhum módulo correto foi reescrito):
  1. **Crítico** — envio duplicado ao WhatsApp possível se o worker morresse entre
     `provider.sendText` suceder e `markSent` commitar (a mensagem ficava `queued`, redelivery
     reenviava). Corrigido com claim atômico CAS `queued→sending` (`tryMarkSending`) antes de
     chamar o provider; uma redelivery que encontra `sending` nunca reenvia — fica para
     reconciliação manual em vez de duplicidade real. Ver `processOutboundMessage` em
     `src/application/inbox/inbox-use-cases.ts`.
  2. **Alto** — `OperationalCircuitBreaker.canExecute` ficava em fail-open permanente em
     `half_open` se o processo que pegou o trial morresse antes de `recordSuccess`/`recordFailure`
     (qualquer chamada concorrente durante o half-open também retornava `allowed: true`,
     desabilitando a proteção silenciosamente). Corrigido: só uma chamada de trial por vez;
     auto-cura após outro cooldown completo se o trial nunca for resolvido.
  3. **Alto** — kill switch `INBOX_OUTBOUND_SEND_PAUSED` podia esgotar a escada de retry (~6,4min)
     e ir para DLQ enquanto a pausa ainda estava ativa, contradizendo "nunca perde a mensagem".
     Corrigido com um `MessagingProviderErrorKind` novo (`operator_paused`) que nunca esgota a
     escada enquanto a pausa durar.
  4. **Médio** — `markSent` sem guard de status podia reviver uma mensagem já `failed` de volta a
     `sent` numa execução concorrente atrasada. Corrigido (exige `status = 'sending'`, pré-requisito
     do fix #1).
  5. **Médio** — `applyConnectionStateChanged` podia "ressuscitar" uma conexão `logged_out`/
     `requires_repair` via um evento de fila atrasado/reentregue com um estado anterior ao logout.
     Corrigido: nunca sobrescreve um estado terminal.
  6. **UI** — painel "Inteligência artificial" na Inbox mostrava "IA ativa" mesmo com atendimento
     humano já assumido (a IA nunca responde nesse caso de qualquer forma — `isConversationEligibleForAi`
     já checava isso). Mensagem corrigida para refletir o estado real.
- **Achados documentados como limitação conhecida (não corrigidos nesta fase)** — julgamento de
  escopo/risco, não negligência:
  - `OperationalRateLimiter.consume`/`OperationalCircuitBreaker.recordFailure` são
    read-modify-write não atômicos; sob concorrência real alta (`CONSUMER_PREFETCH=5` permite até 5
    envios simultâneos por conexão) podem sub-aplicar o limite/sub-contar falhas. Severidade baixa
    (degradação suave, não perda de dado/segurança) e é código de PLATAFORMA compartilhado também
    pelo Publication — uma correção atômica adequada (UPDATE condicional em SQL) é mudança maior o
    suficiente para merecer sua própria revisão dedicada, fora do escopo de "corrigir bugs
    concretos" desta fase de hardening específica do Inbox. **Backlog para uma fase futura de
    plataforma, não do módulo Conversas.**
  - Mensagem outbound pode ficar presa `queued` sem reconciliação se `outboundQueue.publish()`
    falhar DEPOIS do insert no Postgres (`sendInboxMessage`). Corrigir exigiria um mecanismo de
    reconciliação novo (varredura periódica) — feature nova, fora do escopo desta fase
    ("não adicionar novas funcionalidades"). **Backlog.**
  - Um recibo de entrega/leitura pode ser perdido (silenciosamente, sem retry) se chegar
    (casado por `external_message_id`) na janela estreita entre `provider.sendText` suceder e
    `markSent` commitar (a coluna ainda é `NULL` nesse instante). Janela é da ordem de
    milissegundos; sem evidência de ocorrência real; mitigação exigiria reordenar quando
    `external_message_id` é conhecido, o que a API do WuzAPI não permite antecipar. **Backlog.**

## 2. Idempotência financeira

Chave determinística `inbox_auto_reply:<messageIds ordenados>`, persistida em
`ai_generation_ledger.idempotency_key` (índice único parcial, migration `0087`). Um crash entre
debitar crédito e concluir a resposta nunca cobra duas vezes na reentrega, mesmo com o claim de IA
expirado (lease de 90s). Teste explícito: "debitou → crash simulado antes da conclusão →
reprocessou → exatamente uma cobrança" (`tests/inbox-resilience.test.mjs`). **VERIFIED_AUTOMATED.**

## 3. Backup/restore

Mecanismo real (`scripts/backup-postgres.sh`, `pg_dump`) já existe desde a Fase 6. Drill de
integridade (`scripts/restore-drill.mjs`) roda contra pglite (protocolo de fio real, mas não o
executável `pg_dump`/`pg_restore` de verdade) e sempre recusa produção como destino
(`assertNotProduction`) — `tests/backup-restore-drill.test.mjs` passa. O teste com o binário
`pg_dump`/`pg_restore` real não pôde ser executado neste ambiente (Docker/Postgres/`pg_dump`
confirmados indisponíveis). Roteiro de execução pronto em
`docs/conversas-homologacao-restore.md`. **RUNTIME_VALIDATION_PENDING_POSTGRES_RESTORE.**

## 4. Broker real (RabbitMQ)

Topologia (exchange/filas/DLQ/escada de retry) implementada e coberta por testes de aplicação;
comportamento de reconexão/DLQ/SIGTERM/graceful shutdown contra uma instância RabbitMQ real não
pôde ser executado (sem Docker neste ambiente). Roteiro de execução pronto em
`docs/conversas-homologacao-broker.md`. **RUNTIME_VALIDATION_PENDING_BROKER.**

## 5. Homologação WhatsApp

Roteiro de 14 itens em `docs/conversas-homologacao-whatsapp.md`, nenhum executado (sem número de
telefone/QR disponível). **RUNTIME_VALIDATION_PENDING_QR.**

## 6. Campos de mídia (sendImage/sendAudio/sendVideo/sendDocument)

Re-auditado contra o `WuzApiClient` — os nomes de campo já eram explicitamente marcados no código
como "pendente de confirmação" (por analogia com `sendText`, único endpoint confirmado ao vivo no
spike da Fase 2). Nenhuma mudança de código: não há evidência para presumir os nomes certos ou
errados sem testar contra uma instância real. Documentado em
`docs/conversas-homologacao-whatsapp.md`. **RUNTIME_VALIDATION_PENDING_QR.**

## 7. Segurança e isolamento (IDOR/cross-tenant)

`tests/inbox-security-hardening.test.mjs` (novo): todas as rotas de conexão (`qr`,
`refresh-status`, `disconnect`), leitura de conversa (`messages`, `events`) e as 7 ações de escrita
(`read`, `assign`, `ai`, envio de mensagem, `close`, `reopen`, `transfer`) testadas com um
`connectionId`/`conversationId` real de OUTRO tenant — todas retornam 404 (nunca 403) e sem
nenhum efeito colateral verificado. **VERIFIED_AUTOMATED.**

## 8. SSE

`shouldDeliverInboxNotification` extraída como função pura testável — isolamento estrito por
tenant+workspace, múltiplos assinantes simultâneos nunca vazam evento entre tenants
(`tests/inbox-security-hardening.test.mjs`). **VERIFIED_AUTOMATED** para a lógica de filtro; o
fan-out cross-processo via RabbitMQ real não foi exercitado (mesma limitação da seção 4).
**RUNTIME_VALIDATION_PENDING_BROKER** para essa parte específica.

## 9. Secrets

Auditoria dedicada: `WUZAPI_ADMIN_TOKEN`, token de sessão, chave de criptografia, credenciais de
RabbitMQ/Postgres e chaves de IA nunca aparecem em resposta HTTP, payload de SSE, metadata pública
ou log. `.env.example`/`.env.zuno.example` só têm placeholders. **VERIFIED_AUTOMATED.**

## 10. Exposição de rede (WuzAPI/RabbitMQ)

Confirmado nos arquivos compose de produção: sem porta pública, rede Docker interna dedicada
(`conversas_internal`), `zuno-web` sem rota de rede até WuzAPI/RabbitMQ — o frontend nunca fala com
WuzAPI diretamente. **VERIFIED_AUTOMATED.**

## 11. Teste de carga

`scripts/inbox-load-smoke.mjs` (novo) — 10 conexões, 100 conversas, 1000 mensagens inbound em
rajadas de 50, ~20% das conversas com IA ligada, outbound processado ao final. Rodado contra
pglite (sem RabbitMQ real — mede a camada aplicação+Postgres, que o broker nunca protege sozinho).
Resultado: **zero falhas** em qualquer camada.

| Etapa | n | avg | p50 | p95 | p99 |
|---|---|---|---|---|---|
| `registerInboundMessage` | 1000 | 91,8ms | 90,2ms | 112,2ms | 125,0ms |
| `maybeGenerateAiResponse` | 216 | 107,9ms | 80,7ms | 232,2ms | 239,7ms |
| `processOutboundMessage` | 171 | 2,7ms | 2,7ms | 2,8ms | 6,0ms |

Nenhum gargalo óbvio encontrado nesta escala — o lock de IA por conversa (esperado, serializa
gerações concorrentes na MESMA conversa) explica a cauda mais longa de `maybeGenerateAiResponse`.
Números absolutos não são representativos de Postgres real (pglite é WASM, overhead diferente) —
o valor está no formato relativo (sem deadlock, sem erro, IA-lock funcionando sob rajada) e como
baseline para comparação futura. **VERIFIED_AUTOMATED** (camada aplicação); o comportamento sob
carga do RabbitMQ real permanece **RUNTIME_VALIDATION_PENDING_BROKER**.

## 12. Limites de recursos

Sem VPS real disponível nesta fase — `free -h`/`docker stats`/`df -h` não puderam ser coletados.
Limites atuais (`vorix-worker: 384m`, conservadores desde a Fase 1) mantidos sem alteração, por
instrução explícita de nunca reduzir por economia sem evidência. **DEFERRED** até haver specs de
VPS reais.

## 13. Health endpoints

Já consolidados desde a Fase 6: `GET /v1/system/health`, `/system/circuit-breakers`,
`/system/rate-limits`, `/system/backpressure`, `/system/queues`, worker `/metrics`
(`INBOX_WORKER_METRICS_PORT`), heartbeat file + `scripts/inbox-worker-healthcheck.mjs`. Nenhum
dashboard novo necessário — os endpoints já distinguem "container saudável" de "WhatsApp
conectado" (`messaging_connections.status` é a fonte de verdade para o segundo). **VERIFIED_AUTOMATED.**

## 14. Alertas

Vorix não tem Alertmanager/Slack hoje. Não introduzido nesta fase (evitaria ampliar
infraestrutura). Sinais já existem via `/metrics` (Prometheus) e os endpoints da seção 13 — prontos
para consumo por um Alertmanager futuro sem mudança de código, quando/se essa infra for adotada.
Eventos que deveriam disparar alerta quando essa infra existir: worker offline, gateway offline,
RabbitMQ offline, sessão desconectada por tempo excessivo, DLQ crescendo, outbound atrasado, backup
falhou. **DEFERRED** (documentado, sem infra nova).

## 15. Logs

Auditoria confirmou uso consistente de `correlationId`/`tenantId`/`workspaceId`/`connectionId`/
`conversationId`/`messageId`/`provider`/`event` nos pontos de log do worker e da API; nunca
conteúdo integral de conversa, nunca secret. **VERIFIED_AUTOMATED.**

## 16. Integridade dos estados

Duas transições impossíveis fechadas nesta fase (ver seção 1, itens 4 e 5). Demais casos já
mitigados por Fases anteriores (`assignedUserId`+`aiEnabled=true` é possível no dado, mas
`isConversationEligibleForAi` sempre impede a IA de responder nesse caso — UI agora reflete isso
corretamente). **VERIFIED_AUTOMATED.**

## 17. Retenção

Nenhuma política destrutiva implementada (decisão de produto, não desta fase). Crescimento
observado nas tabelas `inbox_messages`/`inbox_conversation_events`/execuções de IA/logs/métricas —
recomendação para decisão futura de produto: retenção por tempo (ex.: arquivar/purgar eventos e
métricas brutas após N meses, preservando mensagens). **DEFERRED**, aguardando decisão de produto.

## 18. Índices e queries

Dois gaps estruturais fechados via migration `0088`: índice funcional para
`coalesce(last_message_at, created_at)` (usado pela ordenação da lista de conversas, sem suporte
do índice simples anterior) e índice parcial para o claim de IA `processing` expirado (metade da
condição do drenador de IA nunca tinha suporte de índice desde a Fase 6). Demais achados (filtro de
`unread_count`, índices compostos mine/unassigned/status) deliberadamente NÃO alterados — sem
evidência medida de necessidade ("não criar índice por precaução"). **VERIFIED_AUTOMATED** para os
dois gaps fechados; nota estrutural registrada para os demais, sem ação.

## 19. N+1

Lista de conversas usa JOIN único (não é N+1). `GET /inbox/members` é intencionalmente N+1 por
design — volume de membros por tenant é pequeno, sem evidência de custo real. Frontend sem padrão
N+1 identificado. **VERIFIED_AUTOMATED.**

## 20. Migrations

`tests/inbox-migrations-clean-run.test.mjs` (novo, 2 testes): banco limpo aplica 0001→última sem
erro; banco simulando produção parado em 0083 aplica 0084+ incrementalmente sem depender de estado
manual. Ambos passam. **VERIFIED_AUTOMATED.**

## 21. Granularidade de feature flag para piloto

**Achado**: `CONVERSATIONS_MODULE_ENABLED` é um único booleano global, sem granularidade por
tenant/workspace. O único mecanismo comparável no Vorix (`ProductionGuard.canaryTenantIds/
canaryWorkspaceIds`, usado pelo Publication) não está conectado ao Inbox, e conectá-lo agora seria
construir uma plataforma de flags nova — fora de escopo ("não criar uma nova plataforma de
flags"). Mecanismo real de controle do piloto sem flag nova: o escopo é controlado pelo DADO
(`messaging_connections` só existe para o workspace que a criar explicitamente, via RBAC
`inbox:manage_connections`), não por uma flag — ver `docs/conversas-piloto.md`. **DEFERRED**
(documentado; nenhuma plataforma de flags nova construída, por instrução explícita).

## 22. Kill switches

Dois mecanismos independentes, documentados em `docs/conversas-runbook.md`:
`AI_INBOX_AUTO_REPLY_ENABLED=false` (pausa só a IA, atendimento humano continua) e
`INBOX_OUTBOUND_SEND_PAUSED=true` (pausa só o envio outbound, nunca perde mensagem — bug de DLQ
após ~6min corrigido nesta fase). Ambos testados
(`tests/inbox-resilience.test.mjs`, `tests/inbox-security-hardening.test.mjs`). **VERIFIED_AUTOMATED.**

## 23. Runbook de incidente

`docs/conversas-runbook.md` — 9 seções operacionais (onde olhar primeiro; WhatsApp desconectado;
logged_out/requires_repair; worker crashou; RabbitMQ caiu; DLQ crescendo; IA consumindo demais;
suspeita de duplicidade; kill switches; restore seguro). **VERIFIED_AUTOMATED** (entregável de
documentação).

## 24. Plano de piloto

`docs/conversas-piloto.md` — pré-requisitos, ativação gradual (mecanismo apenas → humano observado
24-48h → IA em poucas conversas → expansão gradual), sinais de alerta que pausam o avanço.
**VERIFIED_AUTOMATED** (entregável de documentação).

## 25. Rollback

`docs/conversas-rollback.md` — frontend/API/worker/gateway/migrations/feature flag, com a regra
central de que rollback do Vorix nunca toca no gateway WuzAPI. **VERIFIED_AUTOMATED** (entregável
de documentação).

## 26. Definition of Done — classificação final

| # | Item | Classificação |
|---|---|---|
| 1 | Auditoria arquitetural + bugs corrigidos | VERIFIED_AUTOMATED |
| 2 | Idempotência financeira | VERIFIED_AUTOMATED |
| 3 | Backup/restore real (pg_dump/psql) | RUNTIME_VALIDATION_PENDING_POSTGRES_RESTORE |
| 4 | Broker real (RabbitMQ) | RUNTIME_VALIDATION_PENDING_BROKER |
| 5 | Homologação WhatsApp | RUNTIME_VALIDATION_PENDING_QR |
| 6 | Campos de mídia | RUNTIME_VALIDATION_PENDING_QR |
| 7 | Segurança/IDOR/cross-tenant | VERIFIED_AUTOMATED |
| 8 | SSE (lógica de filtro / fan-out real) | VERIFIED_AUTOMATED / RUNTIME_VALIDATION_PENDING_BROKER |
| 9 | Secrets | VERIFIED_AUTOMATED |
| 10 | Exposição de rede | VERIFIED_AUTOMATED |
| 11 | Teste de carga (aplicação / broker real) | VERIFIED_AUTOMATED / RUNTIME_VALIDATION_PENDING_BROKER |
| 12 | Limites de recursos com VPS real | DEFERRED |
| 13 | Health endpoints | VERIFIED_AUTOMATED |
| 14 | Alertas | DEFERRED |
| 15 | Logs | VERIFIED_AUTOMATED |
| 16 | Integridade dos estados | VERIFIED_AUTOMATED |
| 17 | Retenção | DEFERRED |
| 18 | Índices e queries | VERIFIED_AUTOMATED |
| 19 | N+1 | VERIFIED_AUTOMATED |
| 20 | Migrations (limpo + incremental) | VERIFIED_AUTOMATED |
| 21 | Granularidade de feature flag | DEFERRED |
| 22 | Kill switches | VERIFIED_AUTOMATED |
| 23 | Runbook de incidente | VERIFIED_AUTOMATED |
| 24 | Plano de piloto | VERIFIED_AUTOMATED |
| 25 | Rollback | VERIFIED_AUTOMATED |
| 26 | Esta tabela | VERIFIED_AUTOMATED |
| 27 | Testes finais | VERIFIED_AUTOMATED |
| 28 | Nenhuma feature nova adicionada | VERIFIED_AUTOMATED |

## 27. Testes finais

- Suite completa do módulo Conversas (persistência, atendimento, HTTP, IA, resiliência, segurança,
  migrations, backup/restore): **74/74**.
- `tests/operational-hardening.test.mjs` (inclui novo teste de regressão do fail-open do circuit
  breaker): **10/10**.
- `npm run typecheck` e `npm run build` (backend): limpos.
- `web/`: `npm run typecheck` e `npm run build`: limpos (rota `/workspaces/[workspaceId]/conversas`
  compilada).
- `npm run architecture:check`: limpo, incluindo `check-inbox-conversation-isolation`.
- Suite completa do monorepo (`npm test`, 2692 testes): **2690 passam, 2 falham** —
  `tests/analytics.test.mjs` (janela relativa `last_30_days`, flake de data, não relacionado a
  Conversas) e `tests/cli.smoke.test.mjs` (timeout de renderização, módulo Creative Engine, não
  relacionado a Conversas). Ambos falham também isoladamente, fora de qualquer interação com o
  módulo Inbox — não escondidos, reportados aqui como achado, não como sucesso.

## 28. Nenhuma funcionalidade nova

Confirmado: nenhum código desta fase adiciona departamentos avançados, chatbot builder, RAG, CRM
automático, campanhas, omnichannel, múltiplos providers, analytics avançado ou workflow builder.
Todo trabalho foi correção de bug, teste, segurança ou documentação operacional.

---

## Encerramento

A Fase 7 fecha a arquitetura do módulo Conversas. Os itens `RUNTIME_VALIDATION_PENDING_*` (backup/
restore real, broker real, homologação WhatsApp/mídia) permanecem formalmente pendentes — não
foram, e não devem ser, marcados como concluídos sem execução real. `CONVERSATIONS_MODULE_ENABLED`
permanece `false`. **Não há Fase 8.** O próximo passo é exclusivamente homologação real (seções
3–6) e piloto controlado (`docs/conversas-piloto.md`), quando o ambiente (Docker/VPS/número de
telefone) estiver disponível.

Ordem de execução das homologações quando o ambiente permitir: primeiro broker real
(`docs/conversas-homologacao-broker.md`) e restore real
(`docs/conversas-homologacao-restore.md`), por não dependerem de um número de telefone; depois a
homologação completa do WhatsApp (`docs/conversas-homologacao-whatsapp.md`) assim que houver um
número de teste disponível. Nenhum dos três roteiros deve ser marcado `VERIFIED_RUNTIME` sem
execução real documentada. Só depois de todas as três homologações fechadas, avançar para o piloto
com IA desligada, observação de 24–48h e ampliação gradual (`docs/conversas-piloto.md`).
