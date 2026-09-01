# Módulo Conversas — Backlog Prioritário Pós-Fase 7

A Fase 7 está encerrada e aprovada; não há Fase 8 para o módulo Conversas. Os três itens abaixo
foram identificados na auditoria da Fase 7, avaliados e **deliberadamente não implementados**
nesta fase (julgamento de escopo/risco, não descuido — ver
`docs/conversas-fase7-relatorio.md`, seção 1). Ficam registrados aqui como backlog priorizado para
quando houver decisão de retomar trabalho estrutural no módulo. Nenhum é bloqueante para o piloto
controlado com IA desligada.

## 1. Reconciliação de mensagem `queued` órfã (publish() falha após persistência)

**Cenário**: em `sendInboxMessage`, a linha da mensagem é inserida no Postgres com
`status = 'queued'` e só depois é publicada em `inbox.outgoing.queue`. Se
`outboundQueue.publish()` lançar erro DEPOIS do insert ter sido commitado, a mensagem existe no
banco mas nunca chega à fila — fica `queued` para sempre, sem nenhum processo tentando reenviá-la.

**Por que não foi corrigido agora**: a correção correta exige um mecanismo de reconciliação novo
(uma varredura periódica que republica mensagens `queued` sem contrapartida na fila há mais que X
minutos) — isso é infraestrutura nova, fora do escopo de "corrigir bugs concretos" de uma fase que
não deveria adicionar funcionalidade.

**Prioridade**: alta — é a lacuna mais parecida com "perda silenciosa de mensagem" das três aqui,
mesmo sendo de baixa probabilidade (a janela é só a chamada de publish em si).

**Mitigação enquanto não é implementado**: o runbook (`docs/conversas-runbook.md`, seção 7) já
orienta a filtrar `inbox_messages` por `status = 'queued'` há muito tempo sem `lastAttemptAt`
recente como sinal manual de investigação.

## 2. Atomicidade do rate limiter / circuit breaker compartilhados

**Cenário**: `OperationalRateLimiter.consume` e `OperationalCircuitBreaker.recordFailure`
(`src/application/operations/operational-services.ts`) fazem leitura→cálculo em
JS→gravação, não um `UPDATE` atômico único. Sob concorrência real (`CONSUMER_PREFETCH=5` permite
até 5 envios simultâneos pela mesma conexão), duas execuções concorrentes podem ler o mesmo estado
antes de qualquer uma escrever de volta — o rate limiter pode deixar passar mais mensagens que o
limite configurado, e a contagem de falhas do circuit breaker pode subcontar, atrasando quando o
circuito realmente abre.

**Por que não foi corrigido agora**: é código de PLATAFORMA, compartilhado com o Publication (não
exclusivo do Inbox) — uma correção adequada é reescrever para `UPDATE` condicional atômico em SQL,
mudança que merece revisão própria e testes de regressão contra os DOIS consumidores, não uma
correção apressada dentro do escopo do módulo Conversas.

**Prioridade**: média — degradação suave (limite/circuito um pouco menos rígido sob pico), nunca
perda de dado ou brecha de segurança.

## 3. Corrida de recibo (delivered/read) antes de `external_message_id` persistir

**Cenário**: `updateStatusByExternalId` casa o recibo pelo par `(connectionId, externalMessageId)`.
Entre `provider.sendText` retornar o `externalMessageId` e `markSent` gravá-lo na linha, a coluna
ainda está `NULL` — se um recibo de entrega/leitura chegar exatamente nessa janela (milissegundos),
`updateStatusByExternalId` não encontra nenhuma linha e o recibo é perdido silenciosamente, sem
retry.

**Por que não foi corrigido agora**: a janela é da ordem de milissegundos, sem evidência de
ocorrência real; corrigir exigiria reordenar quando `external_message_id` fica disponível, o que a
API do WuzAPI não permite antecipar (só é conhecido depois que o envio já aconteceu).

**Prioridade**: baixa — no pior caso, o status da mensagem fica um passo atrás (`sent` em vez de
`delivered`/`read`) até o próximo recibo do mesmo tipo chegar (ex.: se perder `delivered` mas
`read` chegar depois sem essa corrida, o status avança normalmente).

---

Nenhum destes três itens deve ser implementado sem uma decisão explícita de retomar trabalho
estrutural no módulo — não fazem parte da preparação para homologação/piloto em andamento.
